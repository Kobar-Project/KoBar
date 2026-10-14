// Main-process side of the full backup export (T-211, PROD-14). The renderer builds the `kobar-backup` JSON
// (src/backup/buildBackup.ts) from its localStorage plus the sources returned here; main only:
//   - supplies `extensions-config.json` (enabled flags) and the installed plugin list (metadata, never code),
//   - validates the finished file content (type, size, envelope) before it is written,
//   - writes it to the path chosen in main's own save dialog (never a renderer-supplied path).
// No Electron imports; the fs reads go through injectable helpers so this can be unit tested.

import * as nodePath from 'path';
import { listPluginDirs } from './pluginScan.cjs';

export const FULL_BACKUP_FORMAT = 'kobar-backup';
export const FULL_BACKUP_SCHEMA_VERSION = 1;
/** Upper bound for the serialized backup (UTF-8 bytes). localStorage itself is capped far below this. */
export const FULL_BACKUP_MAX_BYTES = 64 * 1024 * 1024;
/** Upper bound for a single text field of a plugin entry. */
const MAX_FIELD_LENGTH = 256;
/** Upper bound for the number of extensions-config entries / plugins listed. */
const MAX_ENTRIES = 1000;

export interface BackupPluginEntry {
    id: string;
    folder: string;
    name: string;
    version: string;
    enabled: boolean;
    githubRepo: string;
}

export interface BackupSources {
    extensionsConfig: Record<string, boolean>;
    plugins: BackupPluginEntry[];
}

function hasControlChars(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}

function cleanString(value: unknown, fallback = ''): string {
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH || hasControlChars(value)) return fallback;
    return value;
}

/** Only `string -> boolean` entries of a plain object (the shape of extensions-config.json). Never throws. */
export function sanitizeExtensionsConfig(input: unknown): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
    try {
        let count = 0;
        for (const key of Object.keys(input)) {
            if (count >= MAX_ENTRIES) break;
            const value = (input as Record<string, unknown>)[key];
            if (typeof value !== 'boolean' || cleanString(key) !== key || key === '') continue;
            // defineProperty: a `__proto__` key stays an own entry instead of setting the prototype.
            Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
            count++;
        }
    } catch {
        return {};
    }
    return out;
}

/**
 * Backup entry of one installed plugin folder. The id rule matches `get-installed-extensions` (manifest id, else the
 * folder name) so a restore can match `extensions-config` keys. Only plain short strings are copied.
 */
export function backupPluginEntry(folder: string, manifest: unknown, config: Readonly<Record<string, boolean>>): BackupPluginEntry {
    const m = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) ? (manifest as Record<string, unknown>) : {};
    const id = cleanString(m.id) || folder;
    return {
        id,
        folder,
        name: cleanString(m.name) || folder,
        version: cleanString(m.version) || '1.0.0',
        enabled: config[id] !== false,
        githubRepo: cleanString(m.githubRepo) || cleanString(m.githubLink),
    };
}

/**
 * Installed plugins in `extensionsDir` (real folders only, links skipped, see listPluginDirs). Folders without a
 * readable manifest are skipped. `readManifest` returns the parsed manifest or null. Never throws.
 */
export function collectInstalledPlugins(
    extensionsDir: string,
    config: Readonly<Record<string, boolean>>,
    readManifest: (manifestPath: string) => unknown
): BackupPluginEntry[] {
    const out: BackupPluginEntry[] = [];
    try {
        for (const folder of listPluginDirs(extensionsDir)) {
            if (out.length >= MAX_ENTRIES) break;
            let manifest: unknown = null;
            try {
                manifest = readManifest(nodePath.join(extensionsDir, folder, 'manifest.json'));
            } catch {
                manifest = null;
            }
            if (manifest === null || manifest === undefined) continue;
            out.push(backupPluginEntry(folder, manifest, config));
        }
    } catch {
        return out;
    }
    return out;
}

export type BackupTextCheck = { ok: true } | { ok: false; reason: 'not-string' | 'too-large' | 'not-json' | 'not-a-backup' };

/**
 * Accepts only a string of at most FULL_BACKUP_MAX_BYTES that parses to a `kobar-backup` envelope of a known schema
 * version with an object `localStorage`. Never throws.
 */
export function validateFullBackupText(text: unknown): BackupTextCheck {
    if (typeof text !== 'string') return { ok: false, reason: 'not-string' };
    // Cheap upper bound first (a UTF-16 code unit is at most 3 UTF-8 bytes), then the exact size.
    if (text.length > FULL_BACKUP_MAX_BYTES || Buffer.byteLength(text, 'utf8') > FULL_BACKUP_MAX_BYTES) {
        return { ok: false, reason: 'too-large' };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'not-json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: 'not-a-backup' };
    const envelope = parsed as Record<string, unknown>;
    const storage = envelope.localStorage;
    if (
        envelope.format !== FULL_BACKUP_FORMAT ||
        envelope.schemaVersion !== FULL_BACKUP_SCHEMA_VERSION ||
        typeof envelope.includesSecrets !== 'boolean' ||
        typeof storage !== 'object' ||
        storage === null ||
        Array.isArray(storage)
    ) {
        return { ok: false, reason: 'not-a-backup' };
    }
    return { ok: true };
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** Suggested file name in local time, e.g. `kobar-backup-2026-10-12-1530.json`. */
export function fullBackupFileName(now: Date): string {
    const time = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
    const date = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
    return `kobar-backup-${date}-${pad(time.getHours())}${pad(time.getMinutes())}.json`;
}
