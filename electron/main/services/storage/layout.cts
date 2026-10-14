// T-402: on-disk layout of userData/kobar-data/ and the name/id validation the storage
// service applies on every call. Pure: no Electron, no I/O.
import * as nodePath from 'path';
import { resolveInside } from '../../../lib/paths.cjs';
import { BACKUP_MAX_RAW_BYTES } from '../../../lib/storageBackup.cjs';

/** Folder under userData that holds the file-backed store. */
export const STORAGE_DIR_NAME = 'kobar-data';
/** Storage (directory layout + envelope) schema this build reads and writes. Newer on disk = read-only mode. */
export const STORAGE_SCHEMA_VERSION = 1;
export const MANIFEST_FILE_NAME = 'manifest.json';
export const TMP_DIR_NAME = '.tmp';
export const BAK_DIR_NAME = '.bak';
export const CORRUPT_DIR_NAME = '.corrupt';
/** T-404: read-only, masked archive of every localStorage key, taken once. */
export const LOCALSTORAGE_SNAPSHOT_DIR_NAME = 'localstorage-snapshot';
export const LOCALSTORAGE_SNAPSHOT_FILE_NAME = 'snapshot.json';
/** Marker written after snapshot.json: the snapshot is complete and is never taken again (idempotence). */
export const LOCALSTORAGE_SNAPSHOT_MARKER_NAME = '.done';
/** T-411: safeStorage-encrypted secret blobs `secrets/<name>.bin`; never read or written by the StorageService. */
export const SECRETS_DIR_NAME = 'secrets';

/** Largest value accepted for one key, the same limit as the pre-migration backup (`BACKUP_MAX_RAW_BYTES`). */
export const STORAGE_MAX_VALUE_BYTES = BACKUP_MAX_RAW_BYTES;
/**
 * Largest envelope file written or read back for a given value limit: the single source of this limit. The value is a
 * JSON string inside JSON, so escaping can grow it; persist output is mostly quotes (2x at worst). Bigger files are
 * rejected on write and treated as corrupt on read instead of being read into memory.
 */
export function maxFileBytesFor(maxValueBytes: number): number {
    return 2 * maxValueBytes + 1024 * 1024;
}
export const STORAGE_MAX_FILE_BYTES = maxFileBytesFor(STORAGE_MAX_VALUE_BYTES);

/**
 * Key allowlist: a key is an enum value, never a path segment. Each key maps to a fixed relative path.
 * Only the host persist key exists in M4; chat, workspaces and contexts are reserved for later tasks.
 */
export const STORAGE_KEYS = ['kobar-storage'] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

const KEY_PATHS: Record<StorageKey, readonly string[]> = {
    'kobar-storage': ['host', 'kobar-storage.json'],
};

export function isStorageKey(value: unknown): value is StorageKey {
    return typeof value === 'string' && (STORAGE_KEYS as readonly string[]).includes(value);
}

/** Path segments of a key's file below the storage root (e.g. `['host', 'kobar-storage.json']`). */
export function storageKeySegments(key: StorageKey): readonly string[] {
    return KEY_PATHS[key];
}

/**
 * Entries below the storage root that are internal (temp files, rotation backups, quarantined files, the localStorage
 * snapshot archive, encrypted secrets). A future "delete all", full backup or share flow must skip them.
 */
export const INTERNAL_STORAGE_ENTRIES = Object.freeze([
    TMP_DIR_NAME,
    BAK_DIR_NAME,
    CORRUPT_DIR_NAME,
    LOCALSTORAGE_SNAPSHOT_DIR_NAME,
    SECRETS_DIR_NAME,
]);

/** True when `relativePath` (relative to the storage root, either separator) is or lies inside an internal entry. */
export function isInternalStorageEntry(relativePath: string): boolean {
    const first = relativePath.split(/[\\/]/).find((segment) => segment !== '' && segment !== '.');
    return first !== undefined && INTERNAL_STORAGE_ENTRIES.includes(first);
}

const STORAGE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const WIN_RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * True for ids that may become one folder name under the storage root (workspace / plugin ids): only
 * `[a-z0-9-]`, 1-64 chars, no Windows reserved device name. Dots are not allowed, so `..` can never appear.
 */
export function isValidStorageId(id: unknown): id is string {
    return typeof id === 'string' && STORAGE_ID_PATTERN.test(id) && !WIN_RESERVED_ID.test(id);
}

/**
 * Resolves `segments` below `root` and returns the absolute path, or null when the lexical result leaves `root` or is
 * `root` itself. Callers that touch the disk additionally check links with `isFsPathInside` (fsGuards).
 */
export function resolveStoragePath(root: string, segments: readonly string[]): string | null {
    const resolved = resolveInside(root, ...segments);
    if (resolved === null || resolved === nodePath.resolve(root)) return null;
    return resolved;
}

// ---- .bak/ file names ---------------------------------------------------------------------------------------------

/** What a rotation backup name records about the file it preserved. */
export interface BakNameInfo {
    key: StorageKey;
    /** When the backup was taken (epoch ms). Orders backups newest first. */
    takenAt: number;
    /** `seq` of the preserved envelope (0 when it could not be read). */
    seq: number;
    /** Storage schema of the preserved envelope (0 when unknown). */
    schema: number;
    /** Persist `version` inside the preserved value, or null when unknown. */
    version: number | null;
}

const BAK_NAME_PATTERN = /^([a-z-]+)\.(\d{13})\.(\d{1,15})\.s(\d{1,6})v(\d{1,6}|x)\.json$/;

/** `<key>.<takenAt 13 digits>.<seq>.s<schema>v<version|x>.json`, e.g. `kobar-storage.1760000000000.42.s1v22.json`. */
export function bakFileName(info: BakNameInfo): string {
    const takenAt = String(Math.max(0, Math.trunc(info.takenAt))).padStart(13, '0');
    const version = info.version === null ? 'x' : String(info.version);
    return `${info.key}.${takenAt}.${Math.max(0, Math.trunc(info.seq))}.s${Math.max(0, Math.trunc(info.schema))}v${version}.json`;
}

/** Parses a rotation backup name; null for anything that is not exactly our own naming (never read or delete those). */
export function parseBakFileName(name: string): BakNameInfo | null {
    const match = BAK_NAME_PATTERN.exec(name);
    if (!match || !isStorageKey(match[1])) return null;
    const takenAt = Number(match[2]);
    const seq = Number(match[3]);
    const schema = Number(match[4]);
    if (!Number.isSafeInteger(takenAt) || !Number.isSafeInteger(seq) || !Number.isSafeInteger(schema)) return null;
    return { key: match[1], takenAt, seq, schema, version: match[5] === 'x' ? null : Number(match[5]) };
}

/** Name for a quarantined (corrupt) file: `<original name>.<takenAt>.corrupt`. */
export function corruptFileName(originalName: string, takenAt: number): string {
    return `${originalName}.${String(Math.max(0, Math.trunc(takenAt))).padStart(13, '0')}.corrupt`;
}

/** Leftover temp files of our own atomic writes (`<name>.<pid>.<rand>.tmp`); only these are ever cleaned. */
export function isStorageTempName(name: string): boolean {
    return /^[a-z0-9.-]+\.tmp$/.test(name);
}
