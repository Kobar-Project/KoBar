import { BACKUP_KEY_V28 } from '../../src/store/migrations/v28';

// T-603: rebuilds the pre-v28 state from a migrated one, exactly as documented in src/store/migrations/v28.ts:
// re-insert every removed pseudo-note at its original position (ascending), restore the backed-up `activeNoteId` and
// remove the backup slot (and `legacyBackup` when v28 created it, i.e. it is empty afterwards).
// Tests of the older blocks run the whole chain and compare exact expectations; they compare
// `undoV26(undoV27(undoV28(output)))` so they keep checking only their own block. tests/migrate.v28.test.ts uses it to
// prove the v28 change is reversible.

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const SLOT = new RegExp(`^${BACKUP_KEY_V28}(#\\d+)?$`);

interface RemovedNote {
    index: number;
    note: unknown;
}

interface ContextEntry {
    removed: RemovedNote[];
    values?: Loose;
}

interface BackupEntry {
    top?: ContextEntry;
    globalNotes?: ContextEntry;
    workspaces?: ({ index: number } & ContextEntry)[];
}

function restore(holder: Loose, listKey: string, entry: ContextEntry | undefined): void {
    if (!entry) return;
    const list = Array.isArray(holder[listKey]) ? [...(holder[listKey] as unknown[])] : [];
    for (const item of [...entry.removed].sort((a, b) => a.index - b.index)) list.splice(item.index, 0, item.note);
    holder[listKey] = list;
    Object.assign(holder, entry.values ?? {});
}

/** Returns a reverted copy; the input is not changed. Uses the newest v28 backup slot. */
export function undoV28<T>(migrated: T): T {
    const state = structuredClone(migrated) as unknown;
    if (!isObject(state) || !isObject(state.legacyBackup)) return state as T;
    const backup = state.legacyBackup;
    const slots = Object.keys(backup).filter((key) => SLOT.test(key));
    const slot = slots[slots.length - 1];
    if (slot === undefined) return state as T;
    const entry = backup[slot] as BackupEntry;
    restore(state, 'notes', entry.top);
    restore(state, 'globalNotes', entry.globalNotes);
    const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
    for (const item of entry.workspaces ?? []) {
        const ws = workspaces[item.index];
        if (isObject(ws) && isObject(ws.isolatedData)) restore(ws.isolatedData, 'notes', item);
    }
    delete backup[slot];
    if (Object.keys(backup).length === 0) delete state.legacyBackup;
    return state as T;
}
