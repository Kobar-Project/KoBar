// kobar-storage v24 -> v25 (T-409, PROD-19, WS-09: one owner for the enabled-plugin set of each context).
// Pure: no store/window imports; works on the loose persisted shape and never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// v25 adds one persisted top-level field, `defaultExtensionsConfig` (see src/store/workspace/enabledExtensions.ts):
// the Default workspace's enabled-plugin list, saved by the store when a workspace becomes active and restored when the
// Default workspace is active again (set back to null once main confirmed writing it). extensions-config.json stays where it is and keeps its
// `Record<string, boolean>` format (1.2.x reads it unchanged); `currentExtensionsConfig` and
// `workspaces[].enabledExtensions` keep their shape and values.
// - Missing (every state written before v25): left missing. The store default `null` means "Default active, or the
//   Default list is unknown" (the list a pre-v25 workspace switch overwrote cannot be recovered), so returning to the
//   Default workspace keeps the current set, as 1.2.x did. Nothing is invented.
// - Present and null, or a plain object of booleans: kept as it is.
// - Present with any other value (no released version wrote this key, so it is foreign data): replaced by its boolean
//   entries (a plain object) or by null, after the raw value was copied into `legacyBackup.defaultExtensionsConfigV25`
//   (or the first free slot `#2`, `#3`, ...). When that backup cannot be written (legacyBackup is not an object, every
//   slot is taken, the value cannot be cloned or is too large) nothing is changed; the store reads the field leniently.
// A 1.2.x downgrade drops the field on its first write (it is not in 1.2.x's partialize); nothing else is lost.
// Idempotent: a second run finds a valid value and writes no backup entry.

type Loose = Record<string, unknown>;

export const DEFAULT_EXTENSIONS_KEY_V25 = 'defaultExtensionsConfig';
export const BACKUP_KEY_V25 = 'defaultExtensionsConfigV25';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for the backed-up raw value, measured as JSON text (a plugin list is small; this only stops garbage). */
export const MAX_BACKUP_CHARS_V25 = 64 * 1024;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** null, or a plain object whose own values are all booleans (no prototype names). */
export function isValidDefaultExtensionsConfigV25(value: unknown): boolean {
    if (value === null) return true;
    if (!isObject(value)) return false;
    return Object.keys(value).every((key) => !RESERVED_KEYS.has(key) && typeof value[key] === 'boolean');
}

function booleanEntries(value: unknown): Record<string, boolean> | null {
    if (!isObject(value)) return null;
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(value)) {
        if (!RESERVED_KEYS.has(key) && typeof value[key] === 'boolean') out[key] = value[key];
    }
    return out;
}

function backupClone(value: unknown): { ok: true; value: unknown } | { ok: false } {
    try {
        const text = JSON.stringify(value);
        if (text !== undefined && text.length > MAX_BACKUP_CHARS_V25) return { ok: false };
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (hasOwn(state, 'legacyBackup') && state.legacyBackup !== undefined && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V25 : `${BACKUP_KEY_V25}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

/** The whole v25 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV25(state: unknown): void {
    if (!isObject(state) || !hasOwn(state, DEFAULT_EXTENSIONS_KEY_V25)) return;
    const raw = state[DEFAULT_EXTENSIONS_KEY_V25];
    if (raw === undefined || isValidDefaultExtensionsConfigV25(raw)) return;

    const slot = freeBackupSlot(state);
    if (slot === null) return; // no safe place for the raw value: change nothing
    const clone = backupClone(raw);
    if (!clone.ok) return;

    // Backup first (verified copy of the raw value), then the change.
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone.value };
    state[DEFAULT_EXTENSIONS_KEY_V25] = booleanEntries(raw);
}
