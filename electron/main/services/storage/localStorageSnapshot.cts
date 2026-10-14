// T-404: one-time, masked copy of the renderer's localStorage into userData/kobar-data/localstorage-snapshot/
// A read-only archive, a safety net before the persist backend moves to
// the file store (T-405). localStorage itself is never changed: the renderer only reads it and sends the entries here.
// Pure Node (no Electron); fs, clock and the storage service are injected so it is unit-tested against a temp dir.
//
// Layout (fixed names only; localStorage key names are JSON data inside snapshot.json, never path segments):
//   localstorage-snapshot/snapshot.json  { schemaVersion, takenAt, appVersion, keyCount, keys: { <key>: <masked value> },
//                                          omitted: { <key>: { reason, bytes } } }
//   localstorage-snapshot/.done          { schemaVersion, takenAt, keyCount }: written after snapshot.json
//   manifest.json migratedFromLocalStorageAt = takenAt: recorded last; the ONLY signal the renderer decides by.
// Idempotent: a recorded manifest field or a valid `.done` marker means "already done" (the marker also repairs a missing
// manifest field). A run that fails before the marker is written leaves no marker and is simply repeated next startup.
//
// Masking (single source: electron/lib/storageBackup.cts, the pre-migration backup mask, in its strict mode):
//   - The key -> value map is masked like one JSON object: a key whose NAME matches SECRET_KEY_PATTERN (`apiKey`, `auth`,
//     `token`, `..._session_iso_<ws>`, ...) keeps its name, its value becomes MASKED_VALUE (empty values stay empty).
//   - Every other value is walked recursively (nested objects/arrays, JSON strings nested in values, JSON strings encoded
//     twice), secret-named fields and well-known token shapes are masked.
//   - What cannot be masked reliably (unparsable text that looks secret, JSON nested too deep, a token inside the key name)
//     is kept by name and UTF-8 size only (`omitted`), never by value. A token inside a key name is masked
//     in the recorded name too.
// The archive is excluded from every full backup / share flow (layout.cts INTERNAL_STORAGE_ENTRIES).
// Logs carry counts, sizes, timings and error codes only, never a key name or a value.
import * as nodePath from 'path';
import type { IpcLocalStorageSnapshotResult, IpcLocalStorageSnapshotStatus } from '../../../../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};
import { isFsPathInside } from '../../../lib/fsGuards.cjs';
import { MASKED_VALUE, SECRET_KEY_PATTERN, containsSecretValue, maskSecretValues, maskSecrets } from '../../../lib/storageBackup.cjs';
import { type StorageFs, atomicWriteFileSync, blockingSleep, fsErrorCode, realStorageFs } from './atomicWrite.cjs';
import {
    LOCALSTORAGE_SNAPSHOT_DIR_NAME,
    LOCALSTORAGE_SNAPSHOT_FILE_NAME,
    LOCALSTORAGE_SNAPSHOT_MARKER_NAME,
    STORAGE_MAX_VALUE_BYTES,
    TMP_DIR_NAME,
} from './layout.cjs';
import type { StorageService } from './storageService.cjs';

/** Format of snapshot.json and `.done` (independent of the store's schemaVersion). */
export const LOCALSTORAGE_SNAPSHOT_SCHEMA_VERSION = 1;
/** Upper bound for the whole request (UTF-8 bytes of every key and value), the same 20 MB cap as one store value. */
export const LOCALSTORAGE_SNAPSHOT_MAX_BYTES = STORAGE_MAX_VALUE_BYTES;
/** Upper bound for the number of keys (a real localStorage holds far fewer). */
export const LOCALSTORAGE_SNAPSHOT_MAX_ENTRIES = 100_000;
const MAX_MARKER_BYTES = 4 * 1024;
/** Masking yields to the event loop after this many value characters, so main stays responsive. */
const YIELD_EVERY_CHARS = 256 * 1024;

type LogDetails = Record<string, string | number | boolean>;

export type LocalStorageEntries = ReadonlyArray<readonly [string, string]>;

export interface OmittedEntry {
    reason: string;
    /** UTF-8 size of the original value. */
    bytes: number;
}

export interface MaskedLocalStorage {
    /** Key -> masked value (null prototype, so any key name is an own property). */
    keys: Record<string, string>;
    /** Keys kept by name and size only. */
    omitted: Record<string, OmittedEntry>;
    keyCount: number;
    omittedCount: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the request: `{ entries: [key, value][] }` of strings, within the entry and byte caps. */
export function validateLocalStorageRequest(
    request: unknown,
    maxBytes: number = LOCALSTORAGE_SNAPSHOT_MAX_BYTES
): { ok: true; entries: LocalStorageEntries } | { ok: false; status: 'invalid-request' | 'too-large' } {
    if (!isPlainObject(request) || !Array.isArray(request.entries)) return { ok: false, status: 'invalid-request' };
    const entries = request.entries as unknown[];
    if (entries.length > LOCALSTORAGE_SNAPSHOT_MAX_ENTRIES) return { ok: false, status: 'too-large' };
    let chars = 0;
    for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string')
            return { ok: false, status: 'invalid-request' };
        chars += entry[0].length + entry[1].length;
        // UTF-8 never has fewer bytes than UTF-16 code units: certainly too large.
        if (chars > maxBytes) return { ok: false, status: 'too-large' };
    }
    // A UTF-16 code unit is at most 3 UTF-8 bytes: only count exactly when the cheap bound does not settle it.
    if (chars * 3 > maxBytes) {
        let bytes = 0;
        for (const entry of entries as Array<[string, string]>) {
            bytes += Buffer.byteLength(entry[0], 'utf8') + Buffer.byteLength(entry[1], 'utf8');
            if (bytes > maxBytes) return { ok: false, status: 'too-large' };
        }
    }
    return { ok: true, entries: entries as Array<[string, string]> };
}

function setOwn<T>(target: Record<string, T>, name: string, value: T): void {
    Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}

/** A name not used yet in either map (two key names that contained different tokens can mask to the same text). */
function freeName(name: string, taken: (candidate: string) => boolean): string {
    if (!taken(name)) return name;
    for (let n = 2; ; n++) if (!taken(`${name}#${n}`)) return `${name}#${n}`;
}

/** Masks one entry (see the module comment). Never throws; what cannot be masked reliably is reported as `omitted`. */
export function maskLocalStorageEntry(
    key: string,
    raw: string
): { kind: 'value'; name: string; value: string } | { kind: 'omitted'; name: string; reason: string } {
    if (containsSecretValue(key)) return { kind: 'omitted', name: maskSecretValues(key), reason: 'secret-in-key-name' };
    // An empty value cannot carry a secret (the same rule storageBackup applies to object fields).
    if (SECRET_KEY_PATTERN.test(key)) return { kind: 'value', name: key, value: raw === '' ? '' : MASKED_VALUE };
    try {
        const masked = maskSecrets(raw, { strict: true });
        if (masked.kind === 'skipped') return { kind: 'omitted', name: key, reason: masked.reason };
        return { kind: 'value', name: key, value: masked.text };
    } catch {
        return { kind: 'omitted', name: key, reason: 'mask-failed' };
    }
}

/** Masks every entry, yielding (`yieldNow`) after each chunk of value characters so a large localStorage does not block main. */
export async function maskLocalStorageEntries(
    entries: LocalStorageEntries,
    yieldNow: () => Promise<void> = async () => {}
): Promise<MaskedLocalStorage> {
    const keys = Object.create(null) as Record<string, string>;
    const omitted = Object.create(null) as Record<string, OmittedEntry>;
    const taken = (candidate: string) =>
        Object.prototype.hasOwnProperty.call(keys, candidate) || Object.prototype.hasOwnProperty.call(omitted, candidate);
    let keyCount = 0;
    let omittedCount = 0;
    let sinceYield = 0;
    for (const [key, raw] of entries) {
        const result = maskLocalStorageEntry(key, raw);
        const name = freeName(result.name, taken);
        if (result.kind === 'value') {
            setOwn(keys, name, result.value);
            keyCount += 1;
        } else {
            setOwn(omitted, name, { reason: result.reason, bytes: Buffer.byteLength(raw, 'utf8') });
            omittedCount += 1;
        }
        sinceYield += key.length + raw.length;
        if (sinceYield >= YIELD_EVERY_CHARS) {
            sinceYield = 0;
            await yieldNow();
        }
    }
    return { keys, omitted, keyCount, omittedCount };
}

export interface LocalStorageSnapshotDeps {
    service: Pick<StorageService, 'root' | 'init' | 'recordLocalStorageMigration'>;
    appVersion: string;
    fs?: StorageFs;
    clock?: () => number;
    random?: () => number;
    sleepSync?: (ms: number) => void;
    pid?: number;
    isInside?: (base: string, target: string) => boolean;
    /** Lets the event loop run between masking chunks (default: setImmediate). */
    yieldNow?: () => Promise<void>;
    maxBytes?: number;
    log?: (event: string, details?: LogDetails) => void;
}

export interface LocalStorageSnapshotWriter {
    /** Takes the snapshot unless it was taken before. Never rejects; concurrent calls share one run. */
    run(request: unknown): Promise<IpcLocalStorageSnapshotResult>;
}

function result(status: IpcLocalStorageSnapshotStatus, migratedFromLocalStorageAt: number | null = null): IpcLocalStorageSnapshotResult {
    return { ok: status === 'written' || status === 'already-done', status, migratedFromLocalStorageAt };
}

export function createLocalStorageSnapshotWriter(deps: LocalStorageSnapshotDeps): LocalStorageSnapshotWriter {
    const fs = deps.fs ?? realStorageFs;
    const clock = deps.clock ?? Date.now;
    const timing = { random: deps.random ?? Math.random, sleepSync: deps.sleepSync ?? blockingSleep, pid: deps.pid ?? process.pid };
    const isInside = deps.isInside ?? isFsPathInside;
    const yieldNow = deps.yieldNow ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
    const maxBytes = deps.maxBytes ?? LOCALSTORAGE_SNAPSHOT_MAX_BYTES;
    const log = deps.log ?? ((event, details) => console.warn('[KoBar] localstorage-snapshot:', event, details ?? {}));
    const root = nodePath.resolve(deps.service.root);
    const dir = nodePath.join(root, LOCALSTORAGE_SNAPSHOT_DIR_NAME);
    const snapshotPath = nodePath.join(dir, LOCALSTORAGE_SNAPSHOT_FILE_NAME);
    const markerPath = nodePath.join(dir, LOCALSTORAGE_SNAPSHOT_MARKER_NAME);
    const tmpDir = nodePath.join(root, TMP_DIR_NAME);
    let inFlight: Promise<IpcLocalStorageSnapshotResult> | null = null;

    function guard(p: string): string {
        if (!isInside(root, p)) throw Object.assign(new Error('storage path guard'), { code: 'PATH_GUARD' });
        return p;
    }

    /** `takenAt` of a valid `.done` marker, or null (missing, unreadable or not ours: the snapshot is taken again). */
    function readMarker(): number | null {
        try {
            const p = guard(markerPath);
            const stat = fs.statSync(p);
            if (!stat.isFile() || stat.size > MAX_MARKER_BYTES) return null;
            const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (!isPlainObject(parsed)) return null;
            const takenAt = parsed.takenAt;
            return typeof takenAt === 'number' && Number.isSafeInteger(takenAt) && takenAt >= 0 ? takenAt : null;
        } catch {
            return null;
        }
    }

    function writeFile(p: string, text: string): { ok: true } | { ok: false; code: string } {
        try {
            fs.mkdirSync(guard(dir), { recursive: true });
            fs.mkdirSync(guard(tmpDir), { recursive: true });
            return atomicWriteFileSync(fs, guard(p), tmpDir, text, timing);
        } catch (err) {
            return { ok: false, code: fsErrorCode(err) };
        }
    }

    async function doRun(request: unknown): Promise<IpcLocalStorageSnapshotResult> {
        const status = deps.service.init();
        if (status.disabled) return result('disabled');
        if (status.readOnly) return result('read-only');
        if (!status.available || !status.manifest) return result('unavailable');
        const recorded = status.manifest.migratedFromLocalStorageAt;
        if (recorded !== null) return result('already-done', recorded);
        const markedAt = readMarker();
        if (markedAt !== null) {
            // Snapshot complete, manifest update lost (crash or write error): repair the manifest, never take it again.
            if (!deps.service.recordLocalStorageMigration(markedAt)) log('manifest-repair-failed', { manifest: false });
            return result('already-done', markedAt);
        }

        const valid = validateLocalStorageRequest(request, maxBytes);
        if (!valid.ok) {
            log('rejected', { reason: valid.status });
            return result(valid.status);
        }
        const started = clock();
        const masked = await maskLocalStorageEntries(valid.entries, yieldNow);
        const takenAt = clock();
        const text = JSON.stringify({
            schemaVersion: LOCALSTORAGE_SNAPSHOT_SCHEMA_VERSION,
            takenAt,
            appVersion: deps.appVersion,
            keyCount: masked.keyCount,
            omittedCount: masked.omittedCount,
            keys: masked.keys,
            omitted: masked.omitted,
        });
        const written = writeFile(snapshotPath, text);
        if (!written.ok) {
            log('write-failed', { file: LOCALSTORAGE_SNAPSHOT_FILE_NAME, code: written.code });
            return result('io');
        }
        const marker = writeFile(
            markerPath,
            JSON.stringify({
                schemaVersion: LOCALSTORAGE_SNAPSHOT_SCHEMA_VERSION,
                takenAt,
                keyCount: masked.keyCount + masked.omittedCount,
            })
        );
        if (!marker.ok) {
            log('write-failed', { file: LOCALSTORAGE_SNAPSHOT_MARKER_NAME, code: marker.code });
            return result('io');
        }
        const manifestOk = deps.service.recordLocalStorageMigration(takenAt);
        log('written', {
            keys: masked.keyCount,
            omitted: masked.omittedCount,
            chars: text.length,
            ms: clock() - started,
            manifest: manifestOk,
        });
        return { ...result('written', takenAt), keyCount: masked.keyCount, omittedCount: masked.omittedCount };
    }

    return {
        run(request) {
            if (inFlight) return inFlight;
            const running = doRun(request).catch((err: unknown) => {
                log('failed', { code: fsErrorCode(err) });
                return result('io');
            });
            inFlight = running.finally(() => {
                inFlight = null;
            });
            return inFlight;
        },
    };
}
