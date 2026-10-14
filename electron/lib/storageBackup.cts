// Pre-migration backup of the renderer's persisted `kobar-storage` value (PROD-02, T-201).
//
// The preload reads the raw localStorage string at page load, before the renderer's Zustand store can hydrate or
// migrate it, and hands it to the main process over an internal synchronous IPC channel. This module turns that raw
// string into a backup file in `userData/backups/`:
//   - secrets are masked (key names matching SECRET_KEY_PATTERN, well-known API token shapes in string values and in
//     key names, also inside nested and double-encoded JSON strings; see MaskOptions),
//   - a new file is only written when the masked content differs from the newest existing backup, so a normal restart
//     does not create a backup every launch,
//   - the newest `keep` (default 5) backups are kept, plus the newest backup of each older stored version (pinned,
//     capped at BACKUP_MAX_PINNED); only files matching our own name pattern (and our own leftover temp files) are
//     ever deleted,
//   - writes are atomic (temp file + rename) and nothing here ever throws.
// Pure logic with an injectable fs, no Electron imports, so it can be unit-tested with temp directories.

import { createHash } from 'crypto';
import * as nodeFs from 'fs';
import * as path from 'path';

export const BACKUP_DIR_NAME = 'backups';
export const BACKUP_KEEP = 5;
/** Upper bound for the raw string accepted from the renderer (UTF-8 bytes). */
export const BACKUP_MAX_RAW_BYTES = 20 * 1024 * 1024;
export const MASKED_VALUE = '***MASKED***';

/** Object keys whose values are replaced by MASKED_VALUE (case-insensitive, substring match; over-masking is fine). */
export const SECRET_KEY_PATTERN = /key|token|secret|passw(?:or)?d|passphrase|pass$|pwd|credential|auth|jwt|cookie|session|bearer/i;

/**
 * Well-known API key / token shapes, masked wherever they appear inside a string value (e.g. pasted into a note).
 * A copy with base64 boundaries lives in src/backup/redact.ts (T-211 full backup); keep both lists in sync
 * (tests/backup.redact.test.ts checks that both find the same shapes).
 */
const SECRET_VALUE_SOURCE =
    '(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' +
    '|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{20,}' +
    '|gsk_[A-Za-z0-9]{20,}|pplx-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])' +
    '|Bearer\\s+[A-Za-z0-9._~+/=-]{16,}' +
    '|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+)';

/** Leftover temp files of an interrupted backup write (our own naming only). */
const TEMP_NAME_PATTERN = /^\.kobar-storage\..*\.tmp$/;

/** Upper bound for pinned pre-migration backups (newest backup of each older version), see planPrune. */
export const BACKUP_MAX_PINNED = 10;

/** Nested JSON strings (plugin data is often stored stringified) are parsed and masked up to this depth. */
const MAX_NESTED_JSON_DEPTH = 4;

const BACKUP_NAME_PATTERN =
    /^kobar-storage\.(?:v(?:\d+|unknown)|unparsable)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-(\d+))?\.(?:json|txt)$/;

export type StoredVersion = number | 'unknown';

export type MaskResult =
    { kind: 'json'; text: string; version: StoredVersion } | { kind: 'unparsable'; text: string } | { kind: 'skipped'; reason: string };

export interface StorageBackupResult {
    created: boolean;
    path?: string;
    reason?: string;
}

/** The subset of `fs` used here (injectable for tests). */
export interface BackupFs {
    mkdirSync(p: string, options: { recursive: true }): unknown;
    readdirSync(p: string): string[];
    readFileSync(p: string, encoding: 'utf8'): string;
    writeFileSync(p: string, data: string, options: { encoding: 'utf8'; flag: 'wx' }): void;
    renameSync(from: string, to: string): void;
    unlinkSync(p: string): void;
}

function secretValueRegExp(): RegExp {
    return new RegExp(SECRET_VALUE_SOURCE, 'g');
}

/** True when `text` contains a well-known API key / token shape. */
export function containsSecretValue(text: string): boolean {
    return secretValueRegExp().test(text);
}

/** `text` with every well-known token shape replaced by MASKED_VALUE (e.g. for a key NAME that contains a token). */
export function maskSecretValues(text: string): string {
    return text.replace(secretValueRegExp(), MASKED_VALUE);
}

export interface MaskOptions {
    /**
     * T-404 (localStorage snapshot). Both modes share one walker (T-414): they enter JSON-encoded strings
     * (stringified JSON stringified again), mask token shapes inside object key NAMES (a `#<n>` suffix keeps masked
     * names that collide distinct) and never pass on nested JSON deeper than MAX_NESTED_JSON_DEPTH unchecked.
     * They differ only in what happens to a nested JSON string that cannot be walked (too deep, or the walk fails):
     *   - strict: gives up on the whole input (`skipped`, reason `mask-failed`); the snapshot then keeps that key by name
     *     and size only;
     *   - default (pre-migration backups): only that one value is decided, by the same rule maskSecrets applies to
     *     unparsable input (see maskUnwalkable), so one odd plugin value never costs the user the whole backup.
     */
    strict?: boolean;
}

/** Thrown in strict mode for nested JSON that cannot be walked; the caller drops the value instead of risking a leak. */
class UnmaskableError extends Error {}

/** JSON `\uXXXX` escapes could spell a secret-like key name that a plain-text check would not see. */
const UNICODE_ESCAPE_PATTERN = /\\u[0-9a-fA-F]{4}/;

/**
 * True when raw (unparsed) text shows a secret-like key name or a token shape. In raw JSON text a name is followed by a
 * quote, so SECRET_KEY_PATTERN's anchored `pass$` never matches there; `/pass/i` covers it (over-masking is fine).
 */
function rawTextLooksSecret(text: string): boolean {
    return SECRET_KEY_PATTERN.test(text) || /pass/i.test(text) || containsSecretValue(text);
}

/**
 * Non-strict fallback for a nested JSON string that is not walked: kept verbatim only when it shows no sign of a secret
 * (no secret-like key name, no token shape, no `\u` escape that could hide one), otherwise replaced by MASKED_VALUE.
 */
function maskUnwalkable(value: string): string {
    const suspicious = rawTextLooksSecret(value) || UNICODE_ESCAPE_PATTERN.test(value);
    return suspicious ? MASKED_VALUE : value;
}

function maskString(value: string, jsonDepth: number, strict: boolean): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
        let nested: unknown;
        let parsed = false;
        try {
            nested = JSON.parse(trimmed);
            parsed = true;
        } catch {
            // Not JSON: fall through to the plain-string scan.
        }
        const container = parsed && nested !== null && typeof nested === 'object';
        const encoded = parsed && typeof nested === 'string';
        if (container || encoded) {
            if (jsonDepth >= MAX_NESTED_JSON_DEPTH) {
                if (strict) throw new UnmaskableError('nested JSON too deep');
                return maskUnwalkable(value);
            }
            const walk = (): string => {
                if (container) return JSON.stringify(maskValue(nested, jsonDepth + 1, strict));
                // An encoded string whose content needs no masking is kept verbatim (no whitespace / escape changes).
                // Safe: it decodes to exactly that content. Containers are always re-serialized, because the raw text
                // may hold a duplicate key that JSON.parse dropped.
                const inner = maskString(nested as string, jsonDepth + 1, strict);
                return inner === nested ? value : JSON.stringify(inner);
            };
            if (strict) return walk();
            try {
                return walk();
            } catch {
                return maskUnwalkable(value);
            }
        }
    }
    return value.replace(secretValueRegExp(), MASKED_VALUE);
}

function maskValue(value: unknown, jsonDepth: number, strict: boolean): unknown {
    if (typeof value === 'string') return maskString(value, jsonDepth, strict);
    if (Array.isArray(value)) return value.map((item) => maskValue(item, jsonDepth, strict));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            // Booleans, null and empty strings cannot carry a secret; keep them so the copy stays useful.
            const harmless = child === null || child === undefined || typeof child === 'boolean' || child === '';
            const masked = SECRET_KEY_PATTERN.test(key) && !harmless ? MASKED_VALUE : maskValue(child, jsonDepth, strict);
            // A token used as a property name is masked in the name too; collisions get a `#<n>` suffix.
            let name = containsSecretValue(key) ? maskSecretValues(key) : key;
            if (name !== key || Object.prototype.hasOwnProperty.call(out, name)) {
                const base = name;
                for (let n = 2; Object.prototype.hasOwnProperty.call(out, name); n++) name = `${base}#${n}`;
            }
            Object.defineProperty(out, name, { value: masked, enumerable: true, writable: true, configurable: true });
        }
        return out;
    }
    return value;
}

function versionOf(parsed: unknown): StoredVersion {
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const version = (parsed as { version?: unknown }).version;
        if (typeof version === 'number' && Number.isSafeInteger(version) && version >= 0) return version;
    }
    return 'unknown';
}

/** `version` of the persist wrapper `{ state, version }`, or 'unknown' when missing, invalid or not JSON. */
export function parseStoredVersion(raw: string): StoredVersion {
    try {
        return versionOf(JSON.parse(raw));
    } catch {
        return 'unknown';
    }
}

/**
 * Masks secrets in the raw persisted string.
 * - Valid JSON: every secret-named key and every known token shape (in values and in key names, also inside nested and
 *   double-encoded JSON strings) is masked; returns the re-serialized JSON.
 * - Not JSON: the raw text is kept only when it shows no sign of a secret (no secret-like key name or token shape);
 *   otherwise the backup is skipped, because unparsable text cannot be masked reliably.
 * - `options.strict` (T-404): see MaskOptions.
 */
export function maskSecrets(raw: string, options: MaskOptions = {}): MaskResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        if (rawTextLooksSecret(raw)) {
            return { kind: 'skipped', reason: 'unparsable-may-contain-secrets' };
        }
        return { kind: 'unparsable', text: raw };
    }
    try {
        const masked = maskValue(parsed, 0, options.strict === true);
        return { kind: 'json', text: JSON.stringify(masked), version: versionOf(parsed) };
    } catch {
        // E.g. pathological nesting (or, in strict mode, JSON nested too deep): never risk writing an unmasked copy.
        return { kind: 'skipped', reason: 'mask-failed' };
    }
}

function timestampOf(now: Date): string {
    const time = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
    return time.toISOString().replace(/[:.]/g, '-');
}

/** `kobar-storage.v<version>.<timestamp>.json`; the version is sanitised to a non-negative integer or 'unknown'. */
export function backupFileName(version: unknown, now: Date): string {
    const safe = typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? String(version) : 'unknown';
    return `kobar-storage.v${safe}.${timestampOf(now)}.json`;
}

/** `kobar-storage.unparsable.<timestamp>.txt` for a raw value that is not JSON (and showed no secrets). */
export function unparsableBackupFileName(now: Date): string {
    return `kobar-storage.unparsable.${timestampOf(now)}.txt`;
}

/** True for names this module creates (and is therefore allowed to prune). */
export function isBackupFileName(name: string): boolean {
    return BACKUP_NAME_PATTERN.test(name);
}

/** Backup names (others are ignored) sorted newest first. */
export function sortBackupNames(names: readonly string[]): string[] {
    const entries: { name: string; stamp: string; counter: number }[] = [];
    for (const name of names) {
        const match = BACKUP_NAME_PATTERN.exec(name);
        if (match) entries.push({ name, stamp: match[1], counter: match[2] ? Number(match[2]) : 0 });
    }
    entries.sort((a, b) => {
        if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
        if (a.counter !== b.counter) return b.counter - a.counter;
        return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
    });
    return entries.map((e) => e.name);
}

/** Numeric stored version encoded in a backup name, or null for `vunknown` / `unparsable` / foreign names. */
export function backupVersionOf(name: string): number | null {
    const match = /^kobar-storage\.v(\d+)\./.exec(name);
    if (!match || !isBackupFileName(name)) return null;
    const version = Number(match[1]);
    return Number.isSafeInteger(version) ? version : null;
}

/**
 * Names to delete. Kept: the newest `keep` backups overall, plus the newest backup of every stored version lower than
 * the highest one (the pre-migration snapshot of each older version), at most `maxPinned` of those (the oldest versions
 * are evicted first). Files not matching our pattern are never listed.
 */
export function planPrune(existingNames: readonly string[], keep: number = BACKUP_KEEP, maxPinned: number = BACKUP_MAX_PINNED): string[] {
    const limit = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : BACKUP_KEEP;
    const pinLimit = Number.isFinite(maxPinned) ? Math.max(0, Math.floor(maxPinned)) : BACKUP_MAX_PINNED;
    const sorted = sortBackupNames(existingNames);
    const keepSet = new Set(sorted.slice(0, limit));

    const newestPerVersion = new Map<number, string>();
    for (const name of sorted) {
        const version = backupVersionOf(name);
        if (version !== null && !newestPerVersion.has(version)) newestPerVersion.set(version, name);
    }
    if (newestPerVersion.size > 0) {
        const highest = Math.max(...newestPerVersion.keys());
        const olderVersions = [...newestPerVersion.keys()].filter((v) => v < highest).sort((a, b) => b - a);
        for (const version of olderVersions.slice(0, pinLimit)) keepSet.add(newestPerVersion.get(version) as string);
    }
    return sorted.filter((name) => !keepSet.has(name));
}

/** Accepts only a string within BACKUP_MAX_RAW_BYTES (checked by the main-process IPC handler too). */
export function isAcceptableBackupInput(raw: unknown): raw is string {
    return typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= BACKUP_MAX_RAW_BYTES;
}

function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

function uniqueName(base: string, existing: ReadonlySet<string>): string {
    if (!existing.has(base)) return base;
    const dot = base.lastIndexOf('.');
    for (let i = 1; i < 1000; i++) {
        const candidate = `${base.slice(0, dot)}-${i}${base.slice(dot)}`;
        if (!existing.has(candidate)) return candidate;
    }
    return `${base.slice(0, dot)}-${Date.now()}${base.slice(dot)}`;
}

export interface CreateBackupOptions {
    backupsDir: string;
    raw: unknown;
    now?: Date;
    fs?: BackupFs;
    keep?: number;
}

/**
 * Writes a masked backup of `raw` unless the newest existing backup already has the same masked content.
 * Never throws: every failure is reported as `{ created: false, reason }`.
 */
export function createBackupIfChanged(options: CreateBackupOptions): StorageBackupResult {
    const fs: BackupFs = options.fs ?? (nodeFs as unknown as BackupFs);
    let tempPath: string | null = null;
    try {
        if (!isAcceptableBackupInput(options.raw)) return { created: false, reason: 'invalid-input' };
        const now = options.now ?? new Date();
        const masked = maskSecrets(options.raw);
        if (masked.kind === 'skipped') return { created: false, reason: masked.reason };

        fs.mkdirSync(options.backupsDir, { recursive: true });
        const names: string[] = [];
        for (const entry of fs.readdirSync(options.backupsDir)) {
            if (!TEMP_NAME_PATTERN.test(entry)) {
                names.push(entry);
                continue;
            }
            try {
                // Leftover of an interrupted write (crash between write and rename).
                fs.unlinkSync(path.join(options.backupsDir, entry));
            } catch {
                names.push(entry);
            }
        }
        const newest = sortBackupNames(names)[0];
        if (newest) {
            const newestPath = path.join(options.backupsDir, newest);
            try {
                if (sha256(fs.readFileSync(newestPath, 'utf8')) === sha256(masked.text)) {
                    return { created: false, reason: 'unchanged', path: newestPath };
                }
            } catch {
                // Unreadable newest backup: write a fresh one.
            }
        }

        const baseName = masked.kind === 'json' ? backupFileName(masked.version, now) : unparsableBackupFileName(now);
        const name = uniqueName(baseName, new Set(names));
        const finalPath = path.join(options.backupsDir, name);
        tempPath = path.join(options.backupsDir, `.${name}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
        fs.writeFileSync(tempPath, masked.text, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, finalPath);
        tempPath = null;

        for (const stale of planPrune([...names, name], options.keep ?? BACKUP_KEEP)) {
            try {
                fs.unlinkSync(path.join(options.backupsDir, stale));
            } catch {
                // A backup that cannot be pruned now is retried on the next backup.
            }
        }
        return { created: true, path: finalPath };
    } catch {
        if (tempPath) {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                /* ignore */
            }
        }
        return { created: false, reason: 'error' };
    }
}
