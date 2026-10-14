// kobar-storage v25 -> v26 (T-601, UI-32: appearance model).
// Pure: no store/window imports (the caller passes the localStorage value); never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file. The mapping tables
// are deliberately copied here instead of imported from src/theme or src/store/appearance.ts, which may change later.
//
// v26 adds three persisted fields; the v1 fields stay and keep their values (plugins read
// `theme`, `customThemeColor`, `design` and `glassOpacity`, and a 1.2.x downgrade still reads them):
// - `scheme` (top level only, global): an existing user gets 'dark' (their look does not change). Fresh installs
//   never run a migration and get the store default 'system'.
// - `accent` (top level and every workspace record, per workspace like `theme` today): from `theme` with the mapping
//   table; 'custom' keeps the hex in `customThemeColor` and becomes the matching preset when the hex equals a preset's
//   dark value (`#f4a125` -> 'amber') or 'amber' when the hex is not a valid `#rgb`/`#rrggbb`. An unknown or
//   missing theme becomes 'amber'.
//   `kobar_force_theme_color` (localStorage, written next to every custom colour change and read on startup by <= v25 to
//   override `customThemeColor`) is what such a user actually sees. It is applied to the top level and to the ACTIVE
//   workspace record (the v24 live copy) when their theme is 'custom': a valid forced hex that differs from
//   `customThemeColor` replaces it (raw value backed up). Other workspace records keep their own colour (<= v25
//   rewrote the forced key from the record on every switch).
// - `material` (top level and every workspace record): `design === 'style2'` with `glassOpacity < 90` -> 'translucent',
//   everything else -> 'solid'. A missing design is the old default 'style1', a missing/non-numeric glassOpacity
//   the old default 60. `design` and `glassOpacity` keep their values, so the v1 view stays consistent with `material`.
// - `teleportShortcut` (T-144, dead feature) is removed from the top level; its raw value is backed up.
// Present valid v26 values are kept. A present foreign value of a v26 key (no released version wrote these keys) is
// replaced after a raw backup.
// Raw backup: every value v26 replaces or removes is first copied into `legacyBackup.appearanceV26` (or the first free
// slot `appearanceV26#2`, `#3`, ...): `{ forcedThemeColor?, top?: { values }, workspaces?: [{ index, id, values }] }`.
// The pre-v26 state is rebuilt by deleting `scheme`/`accent`/`material` (top level and records) and restoring `values`.
// When that backup cannot be written (legacyBackup is not an object, every slot is taken, the entry cannot be cloned or
// is too large) nothing is replaced or removed here; only the missing v26 keys are added. Not fully lossless: the store no
// longer persists `teleportShortcut` (partialize), so that dead field is dropped on the next write without a backup.
// Notes, isolatedData, plugin data, workspace ids/names and every other field are never touched.
// Idempotent: a second run finds valid v26 values and writes no backup entry.

type Loose = Record<string, unknown>;

export const SCHEMES_V26 = ['system', 'dark', 'light'] as const;
export const ACCENTS_V26 = ['amber', 'orange', 'red', 'pink', 'violet', 'blue', 'green', 'graphite', 'custom'] as const;
export const MATERIALS_V26 = ['solid', 'translucent'] as const;

export type AccentV26 = (typeof ACCENTS_V26)[number];
export type MaterialV26 = (typeof MATERIALS_V26)[number];

/** Old theme -> accent ('custom' handled separately). */
export const THEME_TO_ACCENT_V26: Readonly<Record<string, AccentV26>> = Object.freeze({
    ember: 'amber',
    coffee: 'orange',
    crimson: 'red',
    sakura: 'pink',
    amethyst: 'violet',
    lavender: 'violet',
    midnight: 'blue',
    ocean: 'blue',
    emerald: 'green',
    nord: 'graphite',
});

/** Dark preset values as of v26; a custom hex equal to one of them becomes that preset. */
const PRESET_DARK_HEX_V26: Readonly<Record<string, AccentV26>> = Object.freeze({
    '#f4a125': 'amber',
    '#f28c45': 'orange',
    '#f2626f': 'red',
    '#f07ab8': 'pink',
    '#a78bfa': 'violet',
    '#4ca8f5': 'blue',
    '#45c98b': 'green',
    '#a3abb8': 'graphite',
});

/** `glassOpacity` at or above this value counts as solid. */
export const GLASS_SOLID_THRESHOLD_V26 = 90;
/** Store defaults of <= v25, used for missing values exactly like the store did. */
const DEFAULT_GLASS_OPACITY_V25 = 60;
const DEFAULT_CUSTOM_COLOR_V25 = '#f4a125';
/** Scheme for every existing user. */
export const EXISTING_USER_SCHEME_V26 = 'dark';

export const BACKUP_KEY_V26 = 'appearanceV26';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for one backup entry, measured as JSON text (the values are short; this only stops garbage). */
export const MAX_BACKUP_CHARS_V26 = 64 * 1024;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const includes = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);

/** `#rgb` / `#rrggbb` (with or without `#`, any case) -> lowercase `#rrggbb`; null when invalid. */
export function normalizeHexV26(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const raw = input.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
    return null;
}

/** Accent for a stored theme / custom colour pair (missing colour = the old default). */
export function accentFromLegacyV26(theme: unknown, customThemeColor: unknown): AccentV26 {
    if (theme === 'custom') {
        const hex = normalizeHexV26(customThemeColor === undefined ? DEFAULT_CUSTOM_COLOR_V25 : customThemeColor);
        if (!hex) return 'amber';
        return PRESET_DARK_HEX_V26[hex] ?? 'custom';
    }
    if (typeof theme === 'string' && hasOwn(THEME_TO_ACCENT_V26, theme)) return THEME_TO_ACCENT_V26[theme];
    return 'amber';
}

/** Material for a stored design / glass opacity pair (missing values = the old defaults). */
export function materialFromLegacyV26(design: unknown, glassOpacity: unknown): MaterialV26 {
    if (design !== 'style2') return 'solid';
    const opacity = typeof glassOpacity === 'number' && Number.isFinite(glassOpacity) ? glassOpacity : DEFAULT_GLASS_OPACITY_V25;
    return opacity >= GLASS_SOLID_THRESHOLD_V26 ? 'solid' : 'translucent';
}

interface Op {
    holder: Loose;
    key: string;
    next: unknown;
    /** Removes the key instead of setting `next`. */
    remove?: boolean;
    /** True when an existing value is replaced or removed (needs a raw backup). */
    overwrite: boolean;
    /** null = top level, otherwise the workspace index. */
    group: number | null;
}

function planProfile(holder: Loose, group: number | null, ops: Op[], allowOverwrite: boolean, forced: string | null): void {
    // accent (and the forced custom colour that feeds it)
    const accentPresent = hasOwn(holder, 'accent') && holder.accent !== undefined;
    if (!includes(ACCENTS_V26, holder.accent) && (!accentPresent || allowOverwrite)) {
        let color: unknown = holder.customThemeColor;
        if (allowOverwrite && forced !== null && holder.theme === 'custom' && forced !== normalizeHexV26(color)) {
            const colorPresent = hasOwn(holder, 'customThemeColor') && holder.customThemeColor !== undefined;
            ops.push({ holder, key: 'customThemeColor', next: forced, overwrite: colorPresent, group });
            color = forced;
        }
        ops.push({ holder, key: 'accent', next: accentFromLegacyV26(holder.theme, color), overwrite: accentPresent, group });
    }
    // material
    const materialPresent = hasOwn(holder, 'material') && holder.material !== undefined;
    if (!includes(MATERIALS_V26, holder.material) && (!materialPresent || allowOverwrite)) {
        const next = materialFromLegacyV26(holder.design, holder.glassOpacity);
        ops.push({ holder, key: 'material', next, overwrite: materialPresent, group });
    }
}

function buildPlan(state: Loose, forcedRaw: unknown, allowOverwrite: boolean): Op[] {
    const ops: Op[] = [];
    const forced = normalizeHexV26(forcedRaw);

    const schemePresent = hasOwn(state, 'scheme') && state.scheme !== undefined;
    if (!includes(SCHEMES_V26, state.scheme) && (!schemePresent || allowOverwrite)) {
        ops.push({ holder: state, key: 'scheme', next: EXISTING_USER_SCHEME_V26, overwrite: schemePresent, group: null });
    }
    planProfile(state, null, ops, allowOverwrite, forced);
    if (allowOverwrite && hasOwn(state, 'teleportShortcut')) {
        ops.push({ holder: state, key: 'teleportShortcut', next: undefined, remove: true, overwrite: true, group: null });
    }

    // Same "active record" rule as v24 / the store's patchActiveWorkspace(): a non-empty id, every record carrying it.
    const activeId = state.activeWorkspaceId;
    const hasActive = typeof activeId === 'string' && activeId !== '';
    if (Array.isArray(state.workspaces)) {
        state.workspaces.forEach((ws, index) => {
            if (!isObject(ws)) return;
            planProfile(ws, index, ops, allowOverwrite, hasActive && ws.id === activeId ? forced : null);
        });
    }
    return ops;
}

interface BackupEntry {
    forcedThemeColor?: unknown;
    top?: { values: Loose };
    workspaces?: { index: number; id: unknown; values: Loose }[];
}

function buildEntry(ops: Op[], forcedRaw: unknown): BackupEntry {
    const entry: BackupEntry = {};
    const byIndex = new Map<number, { index: number; id: unknown; values: Loose }>();
    for (const op of ops) {
        if (!op.overwrite) continue;
        const before = op.holder[op.key];
        if (op.group === null) {
            if (!entry.top) entry.top = { values: {} };
            entry.top.values[op.key] = before;
        } else {
            let item = byIndex.get(op.group);
            if (!item) {
                item = { index: op.group, id: op.holder.id, values: {} };
                byIndex.set(op.group, item);
            }
            item.values[op.key] = before;
        }
        if (op.key === 'customThemeColor') entry.forcedThemeColor = forcedRaw;
    }
    if (byIndex.size > 0) entry.workspaces = [...byIndex.values()].sort((a, b) => a.index - b.index);
    return entry;
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (hasOwn(state, 'legacyBackup') && state.legacyBackup !== undefined && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V26 : `${BACKUP_KEY_V26}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

function backupClone(value: BackupEntry): { ok: true; value: BackupEntry } | { ok: false } {
    try {
        const text = JSON.stringify(value);
        if (text === undefined || text.length > MAX_BACKUP_CHARS_V26) return { ok: false };
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** Writes the backup entry for the overwriting ops; false when it cannot be written safely. */
function writeBackup(state: Loose, ops: Op[], forcedRaw: unknown): boolean {
    const slot = freeBackupSlot(state);
    if (slot === null) return false;
    const clone = backupClone(buildEntry(ops, forcedRaw));
    if (!clone.ok) return false;
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone.value };
    return true;
}

function applyOps(ops: Op[]): void {
    for (const op of ops) {
        if (op.remove) delete op.holder[op.key];
        else op.holder[op.key] = op.next;
    }
}

/**
 * The whole v26 block. Mutates `state` in place like the older blocks; does nothing for a non-object state.
 * `forcedThemeColor`: the raw `kobar_force_theme_color` localStorage value of this machine (only the persisted-state
 * path passes it; a settings file import does not, since that key belongs to this machine and not to the file).
 */
export function migrateToV26(state: unknown, forcedThemeColor?: unknown): void {
    if (!isObject(state)) return;
    const ops = buildPlan(state, forcedThemeColor, true);
    if (!ops.some((op) => op.overwrite)) {
        applyOps(ops);
        return;
    }
    // Backup first (verified copy of the raw values), then the changes; without a safe backup only the additions.
    if (writeBackup(state, ops, forcedThemeColor)) applyOps(ops);
    else applyOps(buildPlan(state, forcedThemeColor, false));
}
