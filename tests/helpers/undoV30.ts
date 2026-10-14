import { BACKUP_KEY_V30, VIEW_MODE_KEY_V30 } from '../../src/store/migrations/v30';

// T-615d: rebuilds the pre-v30 state from a migrated one, as documented in src/store/migrations/v30.ts: re-insert the removed
// fake notes at their original index (ascending), restore `settingsWorkspaceViewMode` and remove the backup slot (and
// `legacyBackup` when v30 created it). `undoV29` (tests/helpers/undoV29.ts) calls this first, so the older block tests that
// compare `undoV26(undoV27(undoV28(undoV29(output))))` keep checking only their own block.

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const SLOT = new RegExp(`^${BACKUP_KEY_V30}(#[0-9]+)?$`);

interface Removed {
    index: number;
    note: unknown;
}

function reinsert(holder: Loose, key: string, removed: Removed[] | undefined): void {
    if (!removed) return;
    const list = Array.isArray(holder[key]) ? [...(holder[key] as unknown[])] : [];
    for (const { index, note } of [...removed].sort((a, b) => a.index - b.index)) list.splice(index, 0, note);
    holder[key] = list;
}

/** Returns a reverted copy; the input is not changed. Uses the newest v30 backup slot. */
export function undoV30<T>(migrated: T): T {
    const state = structuredClone(migrated) as unknown;
    if (!isObject(state)) return state as T;
    const backup = isObject(state.legacyBackup) ? state.legacyBackup : undefined;
    const slots = backup ? Object.keys(backup).filter((key) => SLOT.test(key)) : [];
    const slot = slots[slots.length - 1];
    if (backup === undefined || slot === undefined) return state as T;
    const entry = backup[slot] as {
        top?: Removed[];
        globalNotes?: Removed[];
        workspaces?: { index: number; removed: Removed[] }[];
        settingsWorkspaceViewMode?: unknown;
    };
    reinsert(state, 'notes', entry.top);
    reinsert(state, 'globalNotes', entry.globalNotes);
    for (const ws of entry.workspaces ?? []) {
        const record = Array.isArray(state.workspaces) ? (state.workspaces[ws.index] as Loose | undefined) : undefined;
        if (record && isObject(record.isolatedData)) reinsert(record.isolatedData, 'notes', ws.removed);
    }
    if (Object.prototype.hasOwnProperty.call(entry, VIEW_MODE_KEY_V30)) state[VIEW_MODE_KEY_V30] = entry[VIEW_MODE_KEY_V30];
    delete backup[slot];
    if (Object.keys(backup).length === 0) delete state.legacyBackup;
    return state as T;
}
