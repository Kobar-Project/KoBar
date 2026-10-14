import { undoV30 } from './undoV30';
import { BACKUP_KEY_V29, migratedOnboardingV29 } from '../../src/store/migrations/v29';

// T-604: rebuilds the pre-v29 state from a migrated one, exactly as documented in src/store/migrations/v29.ts:
// delete `onboarding`, restore the backed-up raw value and remove the backup slot (and `legacyBackup` when v29 created
// it, i.e. it is empty afterwards). Without a v29 slot, v29 either added the key with nothing to back up (no
// `tutorialState`, or the backup could not be written) or changed nothing, so only the exact record v29 writes is removed.
// Tests of the older blocks run the whole chain and compare exact expectations; they compare
// `undoV26(undoV27(undoV28(undoV29(output))))` so they keep checking only their own block. tests/migrate.v29.test.ts
// uses it to prove the v29 change is reversible.

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const SLOT = new RegExp(`^${BACKUP_KEY_V29}(#\\d+)?$`);

interface BackupEntry {
    added?: true;
    values?: { onboarding: unknown };
    tutorialState?: unknown;
}

/** Returns a reverted copy (v30 is undone first, T-615d); the input is not changed. Uses the newest v29 backup slot. */
export function undoV29<T>(migrated: T): T {
    const state = structuredClone(undoV30(migrated)) as unknown;
    if (!isObject(state)) return state as T;
    const backup = isObject(state.legacyBackup) ? state.legacyBackup : undefined;
    const slots = backup ? Object.keys(backup).filter((key) => SLOT.test(key)) : [];
    const slot = slots[slots.length - 1];
    if (backup === undefined || slot === undefined) {
        if (JSON.stringify(state.onboarding) === JSON.stringify(migratedOnboardingV29())) delete state.onboarding;
        return state as T;
    }
    const entry = backup[slot] as BackupEntry;
    delete state.onboarding;
    Object.assign(state, entry.values ?? {});
    delete backup[slot];
    if (Object.keys(backup).length === 0) delete state.legacyBackup;
    return state as T;
}
