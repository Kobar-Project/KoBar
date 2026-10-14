// T-604 (v29): the first-run (onboarding) state. Pure: no store or DOM access.
//
// `onboarding` is the source of truth for the first-run flow that replaces the v1 tutorial (T-622: three cards and the
// starter pack; T-740: the first-run plugin migration UI). It is device-level: settings exports never carry it and a
// settings import never sets it (src/store/importExport.ts); a full backup restore does (src/backup/coreValues.ts).
// - Fresh install (no stored state, so no migration runs): the store default, `pending`.
// - Existing user (any stored state older than v29): `completed` with `migrated: true`, whatever `tutorialState` says
//   (src/store/migrations/v29.ts).
// The v1 `tutorialState` stays in the store, unchanged and independent of this, until T-622 retires the old tutorial.

export type OnboardingStatus = 'pending' | 'completed' | 'skipped';

export interface OnboardingState {
    /** `pending`: the first-run flow has not been finished; `completed`: finished; `skipped`: dismissed by the user. */
    status: OnboardingStatus;
    /** Version of the first-run flow the status refers to (a later flow can ask again by raising ONBOARDING_VERSION). */
    version: number;
    /** Set by the v29 migration: an existing user who never saw the new first-run flow. */
    migrated?: true;
}

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = ['pending', 'completed', 'skipped'];

/** Current first-run flow version. */
export const ONBOARDING_VERSION = 1;

/** Store default of a fresh install. */
export const DEFAULT_ONBOARDING: Readonly<OnboardingState> = Object.freeze({ status: 'pending', version: ONBOARDING_VERSION });

export const isOnboardingStatus = (value: unknown): value is OnboardingStatus =>
    typeof value === 'string' && (ONBOARDING_STATUSES as readonly string[]).includes(value);

const ONBOARDING_KEYS = new Set(['status', 'version', 'migrated']);

/**
 * A usable onboarding record: a known status, a positive safe-integer version, `migrated` missing or `true`, and no
 * other keys.
 */
export function isOnboardingState(value: unknown): value is OnboardingState {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (!Object.keys(record).every((key) => ONBOARDING_KEYS.has(key))) return false;
    if (!isOnboardingStatus(record.status)) return false;
    if (typeof record.version !== 'number' || !Number.isSafeInteger(record.version) || record.version < 1) return false;
    return record.migrated === undefined || record.migrated === true;
}
