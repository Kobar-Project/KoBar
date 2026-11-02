// kobar-storage v32 -> v33 (Canlı: bar presentation, tonal surfaces, notes tab, privacy mode).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// v33 adds five persisted fields. Per workspace record AND at the top level (the live copy of the active workspace):
//   - `barItemSizes`    bar item id -> 'icon' | 'tile' (a missing id is an icon)
//   - `barHiddenItems`  bar item ids hidden from the bar (the plugin stays enabled)
//   - `tonalSurfaces`   boolean, coloured surfaces
//   - `notesTabVisible` boolean, the Notes tab on the bar
// and at the top level only: `privacyMode` (boolean).
// Every state that reaches this block belongs to an existing user: the defaults keep the bar exactly as it was (no tiles, nothing
// hidden). A missing or invalid value gets its default; a valid one is kept (invalid entries of a record/list are dropped, the
// list is de-duplicated). `featureOrder` and everything else are untouched. Cosmetic data: no `legacyBackup` entry. Idempotent.

const MAX_ENTRIES_V33 = 500;
const MAX_ID_LENGTH_V33 = 200;

function isPlain(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanSizes(value: unknown): Record<string, 'icon' | 'tile'> {
    const out: Record<string, 'icon' | 'tile'> = {};
    if (!isPlain(value)) return out;
    let count = 0;
    for (const id of Object.keys(value)) {
        if (id === '__proto__' || id.length === 0 || id.length > MAX_ID_LENGTH_V33 || count >= MAX_ENTRIES_V33) continue;
        const size = value[id];
        if (size !== 'icon' && size !== 'tile') continue;
        out[id] = size;
        count++;
    }
    return out;
}

function cleanHidden(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const id of value) {
        if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH_V33) continue;
        if (seen.size >= MAX_ENTRIES_V33) break;
        seen.add(id);
    }
    return [...seen];
}

function cleanBool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeBarFields(target: Record<string, unknown>): void {
    target.barItemSizes = cleanSizes(target.barItemSizes);
    target.barHiddenItems = cleanHidden(target.barHiddenItems);
    target.tonalSurfaces = cleanBool(target.tonalSurfaces, true);
    target.notesTabVisible = cleanBool(target.notesTabVisible, true);
}

export function migrateToV33(state: unknown): void {
    if (!isPlain(state)) return;
    normalizeBarFields(state);
    state.privacyMode = cleanBool(state.privacyMode, false);
    if (Array.isArray(state.workspaces)) {
        for (const workspace of state.workspaces) {
            if (isPlain(workspace)) normalizeBarFields(workspace);
        }
    }
}
