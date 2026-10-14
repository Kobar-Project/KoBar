// Full backup restore, step 1 (T-212): parse, validate and preview a `kobar-backup` file. WRITES NOTHING.
//
// `parseBackup(text, options)` turns the file text into
//   - a `plan`: the localStorage entries a restore may write, plus what it must leave alone (secrets that were
//     removed or blanked when the backup was made) and the plugin enabled flags of installed plugins;
//   - a `preview`: a summary for the confirmation UI (counts, skipped keys with reasons, warning codes).
// The actual write and relaunch is T-213; the UI is T-215. Restore never installs or removes plugins.
// Key acceptance rules: see keyPolicy.ts. Core value validation: see coreValues.ts.

import { z } from 'zod';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from './buildBackup';
import { type PathMapper, RESTORE_LIMITS, isPlainObject, parseJsonSafely, rawValuePathMapper, validateCoreValue } from './coreValues';
import { applyKeepLocal, endpointGuardFor, endpointKeysToKeepLocal } from './keepLocal';
import { CORE_KEYS, MAX_KEY_LENGTH, type SkipReason, createKeyClassifier } from './keyPolicy';
import { approvedPluginIds, restrictRestoredPluginFlagsCounted } from './restorePluginFlags';

/** Largest backup file accepted (UTF-8 bytes); same bound as FULL_BACKUP_MAX_BYTES in electron/lib/fullBackup.cts. */
export const RESTORE_MAX_BYTES = 64 * 1024 * 1024;

export const RESTORE_INPUT_LIMITS = {
    maxKeys: 10_000,
    maxRedactions: 100_000,
    maxRedactionPathLength: 64,
    maxPlugins: 1000,
    /** Skipped keys listed in the preview (the total is always reported). */
    maxSkippedListed: 500,
    /** Key names in the preview are cut to this length. */
    maxListedKeyChars: 120,
} as const;

/** Blocking errors: the backup cannot be restored at all. */
export type RestoreErrorCode =
    | 'not-string'
    | 'too-large'
    | 'invalid-json'
    | 'not-a-backup'
    | 'schema-newer'
    | 'schema-unsupported'
    | 'invalid-envelope'
    | 'invalid-redactions'
    | 'storage-version-newer'
    | 'too-many-keys'
    | 'nothing-to-restore'
    | 'internal-error';

/**
 * Warning codes for the preview (the UI translates them, T-215). `own-backups-only` is always present: a backup can
 * carry plugin data and settings that change what the app and its plugins do, so users must only load files they
 * created themselves. `secrets-endpoint-changed` (T-159, only when `ParseBackupOptions.readLocal` is given): at least one
 * local secret is NOT carried over because an endpoint / URL in the same record (T-161) differs in the backup, or
 * because an endpoint key stored next to a kept-local secret key would change.
 */
export type RestoreWarningCode =
    | 'own-backups-only'
    | 'from-newer-app'
    | 'unknown-app-version'
    | 'includes-secrets'
    | 'secrets-kept-local'
    | 'secrets-endpoint-changed'
    | 'redacted-text'
    | 'skipped-keys'
    | 'missing-plugins'
    | 'core-storage-missing'
    | 'core-storage-skipped'
    | 'core-fields-dropped'
    | 'forbidden-keys-stripped'
    | 'invalid-plugin-list'
    | 'invalid-extensions-config'
    | 'plugin-flags-dropped';

export const OWN_BACKUPS_ONLY_WARNING: RestoreWarningCode = 'own-backups-only';

export type RestoreCategory = 'core' | 'isolated' | 'plugin';

export interface RestoreEntry {
    key: string;
    /** Value to write. Core values are validated, migrated and re-serialized; plugin values are the raw backup string. */
    value: string;
    category: RestoreCategory;
    /** Owning plugin (plugin keys and isolated plugin keys). */
    pluginId?: string;
    /** Workspace of an `_iso_<workspaceId>` key. */
    workspaceId?: string;
}

export interface KeepLocalField {
    /** localStorage key of an accepted entry. */
    key: string;
    /**
     * Path inside the value THIS PLAN WRITES (`RestoreEntry.value`), not inside the backup file: array positions are
     * rewritten for elements that validation dropped (workspaces, notes, isolated notes, chats), and paths into dropped
     * elements or fields are left out (`counts.droppedKeepLocalFields`). Nested JSON strings are entered transparently,
     * as recorded by redact.ts. T-213 must find the local value by identity, not by position: e.g. match
     * `state.workspaces[n]` with the local workspace of the same `id` (and notes by `id`), because the local arrays can
     * be ordered differently.
     */
    path: string[];
}

export interface RestorePlan {
    /** Entries a restore may write, sorted by key. Keys are unique. */
    entries: RestoreEntry[];
    /**
     * Secret fields that were blanked ('' / null) when the backup was made. A restore must keep the user's CURRENT
     * value at these paths instead of writing the blank (e.g. API keys).
     */
    keepLocalFields: KeepLocalField[];
    /** Keys that were left out of the backup because they hold secrets; a restore must keep the local value. */
    keepLocalKeys: string[];
    /** Enabled flags of the backup for plugins installed now. Nothing is installed or enabled by parsing. */
    extensionsConfig: Record<string, boolean>;
}

export interface SkippedKey {
    /** Key name, cut to RESTORE_INPUT_LIMITS.maxListedKeyChars. */
    key: string;
    reason: SkipReason | 'invalid-value';
    pluginId?: string;
}

export interface MissingPlugin {
    id: string;
    name: string;
    version: string;
}

export interface RestorePreview {
    createdAt: string | null;
    appVersion: string;
    currentAppVersion: string;
    fromNewerApp: boolean;
    includesSecrets: boolean;
    counts: {
        notes: number;
        workspaces: number;
        chats: number;
        coreKeys: number;
        isolatedKeys: number;
        pluginKeys: number;
        acceptedKeys: number;
        skippedKeys: number;
        pluginsInBackup: number;
        missingPlugins: number;
        keepLocalFields: number;
        /**
         * Keep-local secret fields that a restore will not fill because an endpoint in their record differs (T-159,
         * T-161), plus endpoint keys it will not write because a secret kept under its own key would be paired with them.
         */
        keepLocalBlocked: number;
        /** Redacted secret fields whose place no longer exists after validation (nothing to keep there). */
        droppedKeepLocalFields: number;
        keepLocalKeys: number;
        redactedTexts: number;
        droppedNotes: number;
        /** Plugin enable flags in workspace records that are not carried over (plugin off or not installed here, T-415). */
        pluginFlagsDropped: number;
    };
    /** First RESTORE_INPUT_LIMITS.maxSkippedListed skipped keys; `counts.skippedKeys` is the total. */
    skipped: SkippedKey[];
    /** Plugins listed in the backup that are not installed (their data is skipped; restore installs nothing). */
    missingPlugins: MissingPlugin[];
    /** Persisted `kobar-storage` fields that failed validation and were dropped (e.g. `theme`, `workspaces[].name`). */
    droppedCoreFields: string[];
    warnings: RestoreWarningCode[];
}

export interface ParseBackupOptions {
    /** Manifest ids of the plugins installed right now. */
    installedPluginIds: Iterable<string>;
    /** Version of the running app (from the main process). */
    currentAppVersion: string;
    /**
     * Reads the current raw localStorage value of a key (without the workspace isolation patch). Optional: it lets the
     * preview report secrets that the endpoint guard (keepLocal.ts) will not carry over; the restore itself always
     * decides again at write time. Never required for the plan.
     */
    readLocal?: (key: string) => string | null;
    /**
     * The current extensions-config.json of this machine (`getBackupSources().extensionsConfig`). Plugin flags inside the
     * restored `kobar-storage` may stay `true` only for installed plugins it does not disable (restorePluginFlags.ts,
     * T-415). Absent: no plugin counts as approved (fail closed).
     */
    currentExtensionsConfig?: unknown;
}

export type ParseBackupResult = { ok: true; plan: RestorePlan; preview: RestorePreview } | { ok: false; error: RestoreErrorCode };

// ---------------------------------------------------------------- helpers

/** UTF-8 byte length, stopping early once `limit` is exceeded. */
function utf8LengthExceeds(text: string, limit: number): boolean {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            bytes += 4;
            i++;
        } else bytes += 3;
        if (bytes > limit) return true;
    }
    return false;
}

const SEMVER = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})/;

/** 1 when `a` is newer than `b`, -1 when older, 0 when equal; null when either is not `x.y.z`. */
export function compareAppVersions(a: string, b: string): number | null {
    const ma = SEMVER.exec(a);
    const mb = SEMVER.exec(b);
    if (!ma || !mb) return null;
    for (let i = 1; i <= 3; i++) {
        const diff = Number(ma[i]) - Number(mb[i]);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * Bidirectional controls, zero-width and other invisible format characters (soft hyphen, Arabic letter mark, word
 * joiner and invisible operators): they can make a listed name look like another one.
 */
const INVISIBLE_CHARS = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/** True for C0 and C1 control characters (and DEL). */
function isControlChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Text for the preview UI: invisible/bidi characters removed, control characters shown as U+FFFD. */
export function displayText(text: string): string {
    return Array.from(text.replace(INVISIBLE_CHARS, ''), (char) => (isControlChar(char) ? '\uFFFD' : char)).join('');
}

/** Display form of a key, cut by code point (a surrogate pair is never split). */
function cutKey(key: string): string {
    const codePoints = Array.from(displayText(key));
    const max = RESTORE_INPUT_LIMITS.maxListedKeyChars;
    return codePoints.length > max ? `${codePoints.slice(0, max).join('')}...` : codePoints.join('');
}

const listedText = z.string().max(MAX_KEY_LENGTH);

const redactionsSchema = z.object({
    removedKeys: z
        .array(z.object({ key: listedText, reason: z.enum(['secret-name', 'unprocessable']) }))
        .max(RESTORE_INPUT_LIMITS.maxRedactions),
    redactedFields: z
        .array(
            z.object({
                key: listedText,
                path: z.array(listedText).max(RESTORE_INPUT_LIMITS.maxRedactionPathLength),
                reason: z.enum(['field', 'pattern']),
            })
        )
        .max(RESTORE_INPUT_LIMITS.maxRedactions),
});

type Redactions = z.infer<typeof redactionsSchema>;

const pluginEntrySchema = z.object({
    id: z.string().min(1).max(200),
    name: z.string().max(200).catch(''),
    version: z.string().max(50).catch(''),
});

const appInfoSchema = z.object({ version: z.string().max(50) });

// ---------------------------------------------------------------- pipeline

/**
 * Parses and validates a `kobar-backup` file and returns a restore plan plus a preview. Pure: reads nothing but its
 * arguments, writes nothing, never throws.
 */
export function parseBackup(text: unknown, options: ParseBackupOptions): ParseBackupResult {
    try {
        return parseBackupUnsafe(text, options);
    } catch {
        // Defensive: every step above is guarded; an unexpected failure must not reach the caller as an exception.
        return { ok: false, error: 'internal-error' };
    }
}

function parseBackupUnsafe(text: unknown, options: ParseBackupOptions): ParseBackupResult {
    if (typeof text !== 'string') return { ok: false, error: 'not-string' };
    if (text.length > RESTORE_MAX_BYTES || utf8LengthExceeds(text, RESTORE_MAX_BYTES)) return { ok: false, error: 'too-large' };

    let forbiddenKeys = 0;
    const countForbidden = () => {
        forbiddenKeys++;
    };
    const parsed = parseJsonSafely(text, countForbidden);
    if (!parsed) return { ok: false, error: 'invalid-json' };
    const root = parsed.value;
    if (!isPlainObject(root) || root.format !== BACKUP_FORMAT) return { ok: false, error: 'not-a-backup' };

    const schemaVersion = root.schemaVersion;
    if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) return { ok: false, error: 'schema-unsupported' };
    if (schemaVersion > BACKUP_SCHEMA_VERSION) return { ok: false, error: 'schema-newer' };
    if (schemaVersion !== BACKUP_SCHEMA_VERSION) return { ok: false, error: 'schema-unsupported' };

    if (typeof root.includesSecrets !== 'boolean' || !isPlainObject(root.localStorage)) return { ok: false, error: 'invalid-envelope' };
    const includesSecrets = root.includesSecrets;
    const storage = root.localStorage;
    // Far above a real profile (Chromium caps localStorage at ~10 MB); refusing is clearer than restoring a part.
    if (Object.keys(storage).length > RESTORE_INPUT_LIMITS.maxKeys) return { ok: false, error: 'too-many-keys' };

    // Without valid redaction records a restore could overwrite the user's API keys with blanks: refuse.
    let redactions: Redactions = { removedKeys: [], redactedFields: [] };
    const parsedRedactions = redactionsSchema.safeParse(root.redactions);
    if (parsedRedactions.success) redactions = parsedRedactions.data;
    else if (!includesSecrets) return { ok: false, error: 'invalid-redactions' };

    const installed = new Set<string>();
    for (const id of options.installedPluginIds) if (typeof id === 'string') installed.add(id);
    const warnings = new Set<RestoreWarningCode>([OWN_BACKUPS_ONLY_WARNING]);

    // ---- Plugins listed in the backup (metadata only).
    // Read before the keys: the listed ids help to find the right owner of id-prefixed keys (keyPolicy.ts rule 3).
    const missingPlugins: MissingPlugin[] = [];
    const backupPluginIds = new Set<string>();
    let pluginsInBackup = 0;
    if (Array.isArray(root.plugins)) {
        const seen = new Set<string>();
        let invalid = false;
        for (const entry of root.plugins.slice(0, RESTORE_INPUT_LIMITS.maxPlugins)) {
            const res = pluginEntrySchema.safeParse(entry);
            if (!res.success) {
                invalid = true;
                continue;
            }
            if (seen.has(res.data.id)) continue;
            seen.add(res.data.id);
            pluginsInBackup++;
            backupPluginIds.add(res.data.id);
            if (!installed.has(res.data.id)) {
                missingPlugins.push({
                    id: displayText(res.data.id),
                    name: displayText(res.data.name),
                    version: displayText(res.data.version),
                });
            }
        }
        if (invalid || root.plugins.length > RESTORE_INPUT_LIMITS.maxPlugins) warnings.add('invalid-plugin-list');
    } else if (root.plugins !== undefined) {
        warnings.add('invalid-plugin-list');
    }
    if (missingPlugins.length > 0) warnings.add('missing-plugins');

    // ---- localStorage entries. kobar-storage first: it decides which workspaces `_iso_` keys may belong to.
    const entries: RestoreEntry[] = [];
    const skipped: SkippedKey[] = [];
    let skippedTotal = 0;
    const skip = (key: string, reason: SkippedKey['reason'], pluginId?: string) => {
        skippedTotal++;
        if (skipped.length < RESTORE_INPUT_LIMITS.maxSkippedListed) {
            skipped.push(pluginId === undefined ? { key: cutKey(key), reason } : { key: cutKey(key), reason, pluginId });
        }
    };

    let notes = 0;
    let workspaces = 0;
    let chats = 0;
    let droppedNotes = 0;
    let pluginFlagsDropped = 0;
    let droppedCoreFields: string[] = [];
    let workspaceIds = new Set<string>();

    const appStoreRaw = Object.prototype.hasOwnProperty.call(storage, 'kobar-storage') ? storage['kobar-storage'] : undefined;
    let appStoreValue: string | undefined;
    let appStorePaths: PathMapper | undefined;
    /** Accepted key -> maps redaction paths into the value written (plugin values are written unchanged). */
    const pathMappers = new Map<string, PathMapper>();
    if (appStoreRaw === undefined) {
        warnings.add('core-storage-missing');
    } else if (typeof appStoreRaw !== 'string' || appStoreRaw.length > RESTORE_LIMITS.maxValueChars) {
        warnings.add('core-storage-skipped');
    } else {
        const forcedThemeColor = Object.prototype.hasOwnProperty.call(storage, 'kobar_force_theme_color')
            ? storage.kobar_force_theme_color
            : undefined;
        const result = validateCoreValue('app-store', appStoreRaw, countForbidden, forcedThemeColor);
        if (result.ok && result.appStore) {
            // T-415: a restored workspace record must not enable a plugin that is not enabled here (T-213).
            const restricted = restrictRestoredPluginFlagsCounted(
                result.value,
                approvedPluginIds(installed, options.currentExtensionsConfig)
            );
            appStoreValue = restricted.value;
            pluginFlagsDropped = restricted.dropped;
            if (pluginFlagsDropped > 0) warnings.add('plugin-flags-dropped');
            appStorePaths = result.mapPath;
            notes = result.appStore.notes;
            workspaces = result.appStore.workspaces;
            droppedNotes = result.appStore.droppedNotes;
            droppedCoreFields = result.appStore.droppedFields;
            workspaceIds = new Set(result.appStore.workspaceIds);
            if (droppedCoreFields.length > 0 || droppedNotes > 0) warnings.add('core-fields-dropped');
        } else if (!result.ok && result.problem === 'version-newer') {
            return { ok: false, error: 'storage-version-newer' };
        } else {
            warnings.add('core-storage-skipped');
        }
    }

    const classify = createKeyClassifier({ installedPluginIds: installed, workspaceIds, backupPluginIds });
    for (const key of Object.keys(storage).sort()) {
        const value = storage[key];
        const cls = classify(key);
        if (!cls.accepted) {
            skip(key, cls.reason, cls.pluginId);
            continue;
        }
        if (typeof value !== 'string') {
            skip(key, 'invalid-value', cls.category === 'plugin' ? cls.pluginId : undefined);
            continue;
        }
        if (value.length > RESTORE_LIMITS.maxValueChars) {
            skip(key, 'value-too-large', cls.category === 'plugin' ? cls.pluginId : undefined);
            continue;
        }
        const isolated = cls.workspaceId !== undefined;
        const category: RestoreCategory = isolated ? 'isolated' : cls.category;
        if (cls.category === 'core') {
            let coreValue: string | undefined;
            let mapPath: PathMapper | undefined;
            if (key === 'kobar-storage') {
                coreValue = appStoreValue;
                mapPath = appStorePaths;
            } else {
                const result = validateCoreValue(CORE_KEYS[cls.coreKey].kind, value, countForbidden);
                if (result.ok) {
                    coreValue = result.value;
                    mapPath = result.mapPath;
                    chats += result.chats ?? 0;
                }
            }
            if (coreValue === undefined || mapPath === undefined) {
                skip(key, 'invalid-core-value');
                continue;
            }
            pathMappers.set(key, mapPath);
            entries.push(
                isolated ? { key, value: coreValue, category, workspaceId: cls.workspaceId } : { key, value: coreValue, category }
            );
        } else {
            pathMappers.set(key, rawValuePathMapper(value));
            entries.push(
                isolated
                    ? { key, value, category, pluginId: cls.pluginId, workspaceId: cls.workspaceId }
                    : { key, value, category, pluginId: cls.pluginId }
            );
        }
    }
    if (skippedTotal > 0) warnings.add('skipped-keys');
    if (forbiddenKeys > 0) warnings.add('forbidden-keys-stripped');

    // ---- Redaction metadata, only for keys this plan writes (or would accept).
    const acceptedKeys = new Set(entries.map((e) => e.key));
    const keepLocalFields: KeepLocalField[] = [];
    let redactedTexts = 0;
    let droppedKeepLocalFields = 0;
    const seenFields = new Set<string>();
    for (const field of redactions.redactedFields) {
        if (!acceptedKeys.has(field.key)) continue;
        if (field.reason !== 'field') {
            redactedTexts++;
            continue;
        }
        // Identical records are handled once (JSON keeps the key/path boundaries unambiguous).
        const identity = JSON.stringify([field.key, ...field.path]);
        if (seenFields.has(identity)) continue;
        seenFields.add(identity);
        const mapPath = pathMappers.get(field.key);
        const path = mapPath ? mapPath(field.path) : null;
        if (path) keepLocalFields.push({ key: field.key, path });
        else droppedKeepLocalFields++;
    }
    // Preview only: secrets the endpoint guard will leave blank (the restore decides again against the live values).
    let keepLocalBlocked = 0;
    if (typeof options.readLocal === 'function' && keepLocalFields.length > 0) {
        const pathsByKey = new Map<string, string[][]>();
        for (const field of keepLocalFields) pathsByKey.set(field.key, [...(pathsByKey.get(field.key) ?? []), field.path]);
        for (const entry of entries) {
            const paths = pathsByKey.get(entry.key);
            if (!paths) continue;
            let local: string | null = null;
            try {
                const read = options.readLocal(entry.key);
                local = typeof read === 'string' ? read : null;
            } catch {
                // Fail closed, like the restore: an unreadable local value is reported as blocked.
                if (endpointGuardFor(entry.key) !== false) keepLocalBlocked += paths.length;
                continue;
            }
            keepLocalBlocked += applyKeepLocal(entry.value, local, paths, endpointGuardFor(entry.key)).blocked;
        }
    }
    const keepLocal = new Set<string>();
    const seenRemoved = new Set<string>();
    for (const removed of redactions.removedKeys) {
        // A key that is in the backup after all is written from the backup; only absent, acceptable keys are kept.
        // Each distinct key is classified once.
        if (acceptedKeys.has(removed.key) || seenRemoved.has(removed.key)) continue;
        seenRemoved.add(removed.key);
        if (classify(removed.key).accepted) keepLocal.add(removed.key);
    }
    const keepLocalKeys = [...keepLocal];
    // Preview only (T-161): endpoint keys the restore will not write because a secret kept under its own key would
    // otherwise end up next to a different endpoint.
    if (typeof options.readLocal === 'function' && keepLocalKeys.length > 0) {
        const readLocal = options.readLocal;
        keepLocalBlocked += endpointKeysToKeepLocal(entries, keepLocalKeys, (key) => {
            const read = readLocal(key);
            return typeof read === 'string' ? read : null;
        }).size;
    }
    if (includesSecrets) warnings.add('includes-secrets');
    if (keepLocalFields.length > 0 || keepLocalKeys.length > 0) warnings.add('secrets-kept-local');
    if (keepLocalBlocked > 0) warnings.add('secrets-endpoint-changed');
    if (redactedTexts > 0) warnings.add('redacted-text');

    // ---- Plugin enabled flags: installed plugins only, booleans only.
    const extensionsConfig: Record<string, boolean> = {};
    if (isPlainObject(root.extensionsConfig)) {
        for (const id of Object.keys(root.extensionsConfig)) {
            const enabled = root.extensionsConfig[id];
            if (installed.has(id) && typeof enabled === 'boolean') {
                Object.defineProperty(extensionsConfig, id, { value: enabled, enumerable: true, writable: true, configurable: true });
            }
        }
    } else if (root.extensionsConfig !== undefined) {
        warnings.add('invalid-extensions-config');
    }

    // ---- Envelope details for the preview (lenient: informative only).
    const createdAt =
        typeof root.createdAt === 'string' && root.createdAt.length <= 64 && Number.isFinite(Date.parse(root.createdAt))
            ? root.createdAt
            : null;
    const app = appInfoSchema.safeParse(root.app);
    const appVersion = app.success ? app.data.version : '';
    const currentAppVersion = typeof options.currentAppVersion === 'string' ? options.currentAppVersion : '';
    const comparison = compareAppVersions(appVersion, currentAppVersion);
    const fromNewerApp = comparison === 1;
    if (fromNewerApp) warnings.add('from-newer-app');
    if (comparison === null) warnings.add('unknown-app-version');

    if (entries.length === 0) return { ok: false, error: 'nothing-to-restore' };

    const count = (category: RestoreCategory) => entries.filter((e) => e.category === category).length;
    return {
        ok: true,
        plan: { entries, keepLocalFields, keepLocalKeys, extensionsConfig },
        preview: {
            createdAt,
            appVersion,
            currentAppVersion,
            fromNewerApp,
            includesSecrets,
            counts: {
                notes,
                workspaces,
                chats,
                coreKeys: count('core'),
                isolatedKeys: count('isolated'),
                pluginKeys: count('plugin'),
                acceptedKeys: entries.length,
                skippedKeys: skippedTotal,
                pluginsInBackup,
                missingPlugins: missingPlugins.length,
                keepLocalFields: keepLocalFields.length,
                keepLocalBlocked,
                droppedKeepLocalFields,
                keepLocalKeys: keepLocalKeys.length,
                redactedTexts,
                droppedNotes,
                pluginFlagsDropped,
            },
            skipped,
            missingPlugins,
            droppedCoreFields,
            warnings: [...warnings],
        },
    };
}
