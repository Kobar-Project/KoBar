// kobar-storage v31 -> v32 (R-15: movable plugin panels).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// v32 adds one optional persisted top-level field, `pluginPanelOffsets`: pluginId -> { x?, y? } (px offset from the panel's
// default position along the bar's free axis; x for a horizontal bar, y for a vertical one). No released version wrote it, so a
// missing key is left missing. Only a key that is already present is normalized: a non-object is deleted, an entry that is not a
// plain object is dropped, each axis keeps a finite number (rounded, clamped to +-100000) or is dropped, an entry without any
// axis is dropped. Cosmetic data: no `legacyBackup` entry. Nothing else is touched. Idempotent.
// The bound is copied here on purpose instead of imported from the panel helpers.

const LIMIT_V32 = 100000;
const MAX_ENTRIES_V32 = 500;
export const PLUGIN_PANEL_OFFSETS_KEY_V32 = 'pluginPanelOffsets';

function isPlain(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function axisValue(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(LIMIT_V32, Math.max(-LIMIT_V32, Math.round(value)));
}

export function migrateToV32(state: unknown): void {
    if (!isPlain(state)) return;
    if (!Object.prototype.hasOwnProperty.call(state, PLUGIN_PANEL_OFFSETS_KEY_V32)) return;
    const value = state[PLUGIN_PANEL_OFFSETS_KEY_V32];
    if (!isPlain(value)) {
        delete state[PLUGIN_PANEL_OFFSETS_KEY_V32];
        return;
    }
    const out: Record<string, { x?: number; y?: number }> = {};
    let count = 0;
    for (const id of Object.keys(value)) {
        if (id === '__proto__' || count >= MAX_ENTRIES_V32) continue;
        const entry = value[id];
        if (!isPlain(entry)) continue;
        const normalized: { x?: number; y?: number } = {};
        const x = axisValue(entry.x);
        const y = axisValue(entry.y);
        if (x !== null) normalized.x = x;
        if (y !== null) normalized.y = y;
        if (x === null && y === null) continue;
        out[id] = normalized;
        count++;
    }
    state[PLUGIN_PANEL_OFFSETS_KEY_V32] = out;
}
