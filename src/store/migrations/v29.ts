// kobar-storage v28 -> v29 (T-604: first-run state, UI-22 / PROD-13).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file. The record shape is
// deliberately copied here instead of imported from src/store/onboarding.ts, which may change later.
//
// v29 adds one persisted top-level field, `onboarding` (`{ status, version, migrated? }`, see src/store/onboarding.ts).
// Every state that reaches this block was written by an existing installation (a fresh install has no stored state, so
// no migration runs and the store default `pending` applies). Existing users must never see the new first-run flow, so:
// - Missing `onboarding` (every state written before v29): set to `{ status: 'completed', version: 1, migrated: true }`,
//   whatever the v1 `tutorialState` says (pending, snoozed, completed, missing or garbage).
// - Present and valid with status `completed` or `skipped`: kept as it is (no released version wrote this key; this is
//   what a second run sees).
// - Present with any other value (`pending`, an unknown shape, garbage): replaced by the record above after a raw backup.
// `tutorialState` is NOT changed: the current TutorialManager and v1 plugins still read it, and a 1.2.x downgrade reads
// it too. It is only copied into the backup slot, so its value at the switch survives T-622 retiring it.
// Raw backup: when there is a raw value to keep (a replaced `onboarding` and/or a present `tutorialState`), it is first
// copied into `legacyBackup.onboardingV29` (or the first free slot `onboardingV29#2`, `#3`, ...):
// `{ added?: true, values?: { onboarding }, tutorialState? }` (`added`: the key was missing; `values`: the replaced raw
// value; `tutorialState`: an unchanged copy).
// The pre-v29 state is rebuilt by deleting `onboarding` and restoring `values`.
// When that backup cannot be written (legacyBackup is not an object, every slot is taken, the entry cannot be cloned or
// is too large) nothing is replaced here; only a missing `onboarding` is added.
// Notes, workspaces, plugin data and every other field are never touched.
// A 1.2.x downgrade drops the field on its first write (it is not in 1.2.x's partialize); nothing else is lost.
// Idempotent: a second run finds a `completed` record and writes no backup entry.

type Loose = Record<string, unknown>;

export const ONBOARDING_KEY_V29 = 'onboarding';
export const BACKUP_KEY_V29 = 'onboardingV29';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for one backup entry, measured as JSON text (the values are tiny; this only stops garbage). */
export const MAX_BACKUP_CHARS_V29 = 64 * 1024;

const STATUSES_V29 = ['pending', 'completed', 'skipped'] as const;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const isPresent = (obj: Loose, key: string) => hasOwn(obj, key) && obj[key] !== undefined;

/** The record v29 writes for an existing user (a fresh object on every call). */
export function migratedOnboardingV29(): { status: 'completed'; version: 1; migrated: true } {
    return { status: 'completed', version: 1, migrated: true };
}

const KEYS_V29 = new Set(['status', 'version', 'migrated']);

/** A valid v29 onboarding record (known status, positive safe-integer version, `migrated` missing or true, no other key). */
export function isOnboardingV29(value: unknown): boolean {
    if (!isObject(value)) return false;
    if (!Object.keys(value).every((key) => KEYS_V29.has(key))) return false;
    if (typeof value.status !== 'string' || !(STATUSES_V29 as readonly string[]).includes(value.status)) return false;
    if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) return false;
    return value.migrated === undefined || value.migrated === true;
}

/** A present value v29 keeps: a valid record whose first run is already over. */
const isFinishedV29 = (value: unknown) => isOnboardingV29(value) && (value as Loose).status !== 'pending';

interface BackupEntry {
    added?: true;
    values?: { onboarding: unknown };
    tutorialState?: unknown;
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (isPresent(state, 'legacyBackup') && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V29 : `${BACKUP_KEY_V29}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

function backupClone(value: BackupEntry): { ok: true; value: BackupEntry } | { ok: false } {
    try {
        const text = JSON.stringify(value);
        if (text === undefined || text.length > MAX_BACKUP_CHARS_V29) return { ok: false };
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** Writes the backup entry; false when it cannot be written safely. */
function writeBackup(state: Loose, entry: BackupEntry): boolean {
    const slot = freeBackupSlot(state);
    if (slot === null) return false;
    const clone = backupClone(entry);
    if (!clone.ok) return false;
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone.value };
    return true;
}

/** The whole v29 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV29(state: unknown): void {
    if (!isObject(state)) return;
    const present = isPresent(state, ONBOARDING_KEY_V29);
    if (present && isFinishedV29(state[ONBOARDING_KEY_V29])) return;

    const entry: BackupEntry = present ? { values: { onboarding: state[ONBOARDING_KEY_V29] } } : { added: true };
    const hasTutorial = isPresent(state, 'tutorialState');
    if (hasTutorial) entry.tutorialState = state.tutorialState;

    // Backup first (verified copy of the raw values), then the change; without a safe backup only the addition.
    if ((present || hasTutorial) && writeBackup(state, entry)) {
        state[ONBOARDING_KEY_V29] = migratedOnboardingV29();
        return;
    }
    if (!present) state[ONBOARDING_KEY_V29] = migratedOnboardingV29();
}
