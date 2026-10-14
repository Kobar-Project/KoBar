// Full backup builder (T-211, PROD-14 / K10). Pure: the caller supplies the localStorage snapshot and the data that
// comes from the main process (extensions-config.json, installed plugin list, app version).
//
// What a `kobar-backup` file contains:
//   - every localStorage key of the app origin as its raw string (core stores, `_iso_<workspace>` plugin keys,
//     plugin data), secrets removed unless `includeSecrets` (owner decision S2),
//   - the content of `extensions-config.json` (enabled flags) and the list of installed plugins (metadata only).
// What it never contains: KoBox files, plugin code (`extensions/`), the automatic pre-migration backups and any
// other userData file. Restore (T-212/T-213) reads this format; bump BACKUP_SCHEMA_VERSION on any breaking change.
//
// File store (T-412, "full backup v2"): every key of userData/kobar-data/ that
// holds user data (FILE_STORE_KEYS_IN_BACKUP) is carried under its localStorage key name with the persist storage's
// current value (exportBackup.ts overlays it; that is the file's value when the file is newer). The store's internal
// entries (FILE_STORE_EXCLUDED_ENTRIES) are never read. The envelope did not change, so the schema stays at version 1:
// backups written before the file store (1.2.x) are read as they are, and 1.2.x still accepts this envelope.

import { isHostInternalKey } from './keyPolicy';
import { type RedactedField, type RemovedKey, redactSecrets, setOwn } from './redact';

export const BACKUP_FORMAT = 'kobar-backup';
export const BACKUP_SCHEMA_VERSION = 1;

/** Fixed (English) warning stored in a backup that includes secrets; the UI shows its own translated warning. */
export const SECRETS_WARNING = 'This backup contains API keys and other secrets in plain text. Keep the file private and do not share it.';

/**
 * Data that is deliberately not part of a full backup. Informative only (no reader checks it). T-412 added the file
 * store's internal entries and the safeStorage secrets (encrypted for this Windows user, unreadable anywhere else).
 */
export const BACKUP_EXCLUDED = ['KoBox', 'plugin-code', 'automatic-backups', 'file-store-internals', 'encrypted-secrets'] as const;

/**
 * File store keys (userData/kobar-data, electron/main/services/storage/layout.cts STORAGE_KEYS) whose current value a backup
 * carries, under the same name as their localStorage key. A test keeps this equal to STORAGE_KEYS, so a new file store key
 * cannot be added without deciding how the backup covers it.
 */
export const FILE_STORE_KEYS_IN_BACKUP = ['kobar-storage'] as const;

/**
 * Internal entries of the file store that never enter a backup or a shared file: temp files, rotation backups,
 * quarantined files, the masked localStorage archive and the encrypted secrets. A test keeps this equal to
 * INTERNAL_STORAGE_ENTRIES (layout.cts). Declarative only: no runtime code consumes this list (the renderer has no access to those folders).
 */
export const FILE_STORE_EXCLUDED_ENTRIES = ['.tmp', '.bak', '.corrupt', 'localstorage-snapshot', 'secrets'] as const;

export interface BackupPluginEntry {
    id: string;
    folder: string;
    name: string;
    version: string;
    enabled: boolean;
    githubRepo: string;
}

export interface BackupSnapshot {
    /** Raw localStorage content (key -> value), read without the workspace isolation layer. */
    localStorage: Readonly<Record<string, string>>;
    extensionsConfig: Readonly<Record<string, boolean>>;
    plugins: readonly BackupPluginEntry[];
    appVersion: string;
    now: Date;
}

export interface BuildBackupOptions {
    /** Owner decision S2: false by default; true only after the user explicitly opted in (with a warning). */
    includeSecrets?: boolean;
}

export interface KobarBackupV1 {
    format: typeof BACKUP_FORMAT;
    schemaVersion: typeof BACKUP_SCHEMA_VERSION;
    createdAt: string;
    app: { name: 'KoBar'; version: string };
    includesSecrets: boolean;
    secretsWarning: string | null;
    redactions: { removedKeys: RemovedKey[]; redactedFields: RedactedField[] };
    excluded: string[];
    localStorage: Record<string, string>;
    extensionsConfig: Record<string, boolean>;
    plugins: BackupPluginEntry[];
}

function toIsoString(now: Date): string {
    return now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
}

/** String values only; host-internal keys (this machine's storage bookkeeping, T-405) never enter a backup. */
function stringsOnly(entries: Readonly<Record<string, string>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(entries)) {
        if (isHostInternalKey(key)) continue;
        const value = entries[key];
        if (typeof value === 'string') setOwn(out, key, value);
    }
    return out;
}

function booleansOnly(config: Readonly<Record<string, boolean>>): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(config)) {
        const value = config[key];
        if (typeof value === 'boolean') setOwn(out, key, value);
    }
    return out;
}

/** Builds a `kobar-backup` object (schema version 1). Secrets are removed unless `includeSecrets` is true. */
export function buildBackup(snapshot: BackupSnapshot, options: BuildBackupOptions = {}): KobarBackupV1 {
    const includeSecrets = options.includeSecrets === true;
    const entries = stringsOnly(snapshot.localStorage);
    const redaction = includeSecrets ? { entries, removedKeys: [], redactedFields: [] } : redactSecrets(entries);
    return {
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        createdAt: toIsoString(snapshot.now),
        app: { name: 'KoBar', version: typeof snapshot.appVersion === 'string' ? snapshot.appVersion : '' },
        includesSecrets: includeSecrets,
        secretsWarning: includeSecrets ? SECRETS_WARNING : null,
        redactions: { removedKeys: redaction.removedKeys, redactedFields: redaction.redactedFields },
        excluded: [...BACKUP_EXCLUDED],
        localStorage: redaction.entries,
        extensionsConfig: booleansOnly(snapshot.extensionsConfig),
        plugins: snapshot.plugins.map((p) => ({ ...p })),
    };
}

/** Serialized backup file content. */
export function serializeBackup(backup: KobarBackupV1): string {
    return JSON.stringify(backup, null, 2);
}
