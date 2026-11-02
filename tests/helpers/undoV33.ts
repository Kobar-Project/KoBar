// CNL-03: rebuilds the pre-v33 state from a migrated one: the v33 block only ADDS fields that no older state carries (top level
// and every workspace record), so undoing it deletes them. `undoV30` (tests/helpers/undoV30.ts) calls this first, so the older
// block tests that compare `undoV26(undoV27(undoV28(undoV29(output))))` keep checking only their own block.

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const BAR_KEYS = ['barItemSizes', 'barHiddenItems', 'tonalSurfaces', 'notesTabVisible'] as const;

/** Returns a copy without the v33 fields; the input is not changed. */
export function undoV33<T>(migrated: T): T {
    const state = structuredClone(migrated) as unknown;
    if (!isObject(state)) return state as T;
    for (const key of BAR_KEYS) delete state[key];
    delete state.privacyMode;
    if (Array.isArray(state.workspaces)) {
        for (const ws of state.workspaces) {
            if (isObject(ws)) for (const key of BAR_KEYS) delete ws[key];
        }
    }
    return state as T;
}
