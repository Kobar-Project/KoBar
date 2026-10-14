// kobar-storage v21 -> v22 (T-205, WS-06 + WS-08 data repair).
// Pure: no store/window imports; works on the loose persisted shape and never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.

// Persisted state is untyped legacy data: every field is checked before use.
type Loose = Record<string, unknown>;

/** Store defaults at the time of v22 (useAppStore: toggleWidth 22, featureSpacing 8, isPopupSmartPositioning false). */
export const V22_SETTING_DEFAULTS = {
    toggleWidth: 22,
    featureSpacing: 8,
    isPopupSmartPositioning: false,
} as const;

type V22SettingKey = keyof typeof V22_SETTING_DEFAULTS;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const SETTING_IS_VALID: Record<V22SettingKey, (value: unknown) => boolean> = {
    toggleWidth: isFiniteNumber,
    featureSpacing: isFiniteNumber,
    isPopupSmartPositioning: (value) => typeof value === 'boolean',
};

/**
 * WS-06: the three settings were never persisted. Fill each one that is missing (or has an invalid type)
 * from the active workspace's stored value when valid, otherwise from the store default.
 * A valid value already present in the persisted data is never overwritten.
 */
export function fillWorkspaceSettingsV22(state: Loose): void {
    const workspaces: unknown[] = Array.isArray(state.workspaces) ? state.workspaces : [];
    const activeId = state.activeWorkspaceId;
    const activeWs =
        activeId === null || activeId === undefined ? undefined : workspaces.find((w): w is Loose => isObject(w) && w.id === activeId);

    for (const key of Object.keys(V22_SETTING_DEFAULTS) as V22SettingKey[]) {
        const isValid = SETTING_IS_VALID[key];
        if (isValid(state[key])) continue;
        const fromWorkspace = activeWs?.[key];
        state[key] = isValid(fromWorkspace) ? fromWorkspace : V22_SETTING_DEFAULTS[key];
    }
}

/** A note id the repair may reason about: a safe integer (beyond 2^53 `id + 1` is no longer distinct). */
const isSafeNoteId = (value: unknown): value is number => Number.isSafeInteger(value);

/** Safe-integer note ids in list order (entries without one are ignored). */
function noteIds(notes: readonly unknown[]): number[] {
    const ids: number[] = [];
    for (const note of notes) {
        if (isObject(note) && isSafeNoteId(note.id)) ids.push(note.id);
    }
    return ids;
}

/** max(0, ...ids) without spreading (safe for very long lists). */
function maxId(ids: readonly number[]): number {
    let max = 0;
    for (const id of ids) if (id > max) max = id;
    return max;
}

/**
 * WS-08: renumbers later duplicates of a note id. The first occurrence keeps its id; later duplicates get
 * max(id)+1, +2, ... in list order. Order, content and every other field are kept; entries without a
 * safe-integer id are left as they are, and so is a duplicate whose new id would leave the safe-integer range.
 * Returns the SAME array when nothing changes, otherwise a new array (input untouched).
 */
export function renumberDuplicateNoteIds<T>(notes: readonly T[]): T[] {
    const ids = noteIds(notes);
    let nextId = maxId(ids) + 1;
    const seen = new Set<number>();
    let changed = false;
    const out = notes.map((note) => {
        if (!isObject(note) || !isSafeNoteId(note.id)) return note;
        if (!seen.has(note.id)) {
            seen.add(note.id);
            return note;
        }
        if (!isSafeNoteId(nextId)) return note;
        changed = true;
        const id = nextId++;
        seen.add(id);
        return { ...note, id } as unknown as T;
    });
    return changed ? out : (notes as T[]);
}

/**
 * Repairs one note context in place: `notes` (duplicate ids), `activeNoteId` (dangling -> first note id) and
 * `nextNoteId` (never below max(id)+1, never lowered). Fields are only written when they need a change.
 * - `activeNoteId` is left alone when it is absent or there is no note to point at (the store resolves it at runtime).
 * - `nextNoteId` is added when absent only if `addMissingNext` is set (top-level state, where the store would
 *   otherwise fall back to its default counter) and there is at least one note.
 */
function repairNoteContext(holder: Loose, addMissingNext: boolean): void {
    if (!Array.isArray(holder.notes)) return;
    const notes = renumberDuplicateNoteIds(holder.notes);
    if (notes !== holder.notes) holder.notes = notes;

    const ids = noteIds(notes);
    const pointsAtNote = notes.some((note) => isObject(note) && note.id === holder.activeNoteId);
    if (ids.length > 0 && holder.activeNoteId !== undefined && !pointsAtNote) {
        holder.activeNoteId = ids[0];
    }

    const minNext = maxId(ids) + 1;
    // Beyond the safe-integer range a counter cannot be repaired meaningfully; leave it as stored.
    if (!isSafeNoteId(minNext)) return;
    const stored = holder.nextNoteId;
    if (isFiniteNumber(stored)) {
        if (stored < minNext) holder.nextNoteId = minNext;
    } else if (stored !== undefined || (addMissingNext && ids.length > 0)) {
        holder.nextNoteId = minNext;
    }
}

/**
 * WS-08: repairs duplicate note ids and stale counters in the top-level context (`notes`, `activeNoteId`,
 * `nextNoteId`), in `globalNotes` (ids only; the shared context has no stored counters) and in every
 * workspace's `isolatedData`. Mutates `state` in place like the older blocks.
 */
export function repairNoteIdsV22(state: Loose): void {
    repairNoteContext(state, true);
    if (Array.isArray(state.globalNotes)) {
        const globalNotes = renumberDuplicateNoteIds(state.globalNotes);
        if (globalNotes !== state.globalNotes) state.globalNotes = globalNotes;
    }
    if (Array.isArray(state.workspaces)) {
        for (const workspace of state.workspaces) {
            if (isObject(workspace) && isObject(workspace.isolatedData)) repairNoteContext(workspace.isolatedData, false);
        }
    }
}

/** The whole v22 block. Does nothing for a non-object state. */
export function migrateToV22(state: unknown): void {
    if (!isObject(state)) return;
    fillWorkspaceSettingsV22(state);
    repairNoteIdsV22(state);
}
