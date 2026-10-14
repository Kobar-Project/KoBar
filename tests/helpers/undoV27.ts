import { BACKUP_KEY_V27 } from '../../src/store/migrations/v27';

// T-602: rebuilds the pre-v27 state from a migrated one, exactly as documented in src/store/migrations/v27.ts:
// delete `density` (top level and workspace records), restore the backed-up raw values and remove the backup slot (and
// `legacyBackup` when v27 created it, i.e. it is empty afterwards).
// Tests of the older blocks run the whole chain and compare exact expectations; they compare `undoV26(undoV27(output))`
// so they keep checking only their own block. tests/migrate.v27.test.ts uses it to prove the v27 change is reversible.

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const SLOT = new RegExp(`^${BACKUP_KEY_V27}(#\\d+)?$`);

interface BackupEntry {
    top?: { values: Loose };
    workspaces?: { index: number; values: Loose }[];
}

/** Returns a reverted copy; the input is not changed. Uses the newest v27 backup slot. */
export function undoV27<T>(migrated: T): T {
    const state = structuredClone(migrated) as unknown;
    if (!isObject(state)) return state as T;
    delete state.density;
    const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
    for (const ws of workspaces) {
        if (isObject(ws)) delete ws.density;
    }
    if (isObject(state.legacyBackup)) {
        const backup = state.legacyBackup;
        const slots = Object.keys(backup).filter((key) => SLOT.test(key));
        const slot = slots[slots.length - 1];
        if (slot !== undefined) {
            const entry = backup[slot] as BackupEntry;
            Object.assign(state, entry.top?.values ?? {});
            for (const item of entry.workspaces ?? []) {
                const ws = workspaces[item.index];
                if (isObject(ws)) Object.assign(ws, item.values);
            }
            delete backup[slot];
            if (Object.keys(backup).length === 0) delete state.legacyBackup;
        }
    }
    return state as T;
}
