import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { FORCED_THEME_COLOR_KEY, type KobarStorageMigrateOptions, migrateKobarStorage } from '../../src/store/migrations';

// T-013: fixture-chain framework. A "profile" is a pure in-memory snapshot of what a real user
// has on disk: localStorage entries plus Electron `userData` files. `migrateProfileToLatest`
// carries an old profile to the newest state in ONE call.
//
// Two independent mechanisms (see tests/fixtures/profiles/README.md):
// 1. kobar-storage: ALWAYS run through `migrateKobarStorageBlob`, gated on the blob's own version
//    (like Zustand persist). A kobar-storage-only change = new `migrateKobarStorage` branch +
//    KOBAR_STORAGE_VERSION bump. No step, no LATEST_PROFILE_VERSION bump.
// 2. MIGRATION_STEPS: only non-kobar-storage changes (userData files, backups ...). Each appended
//    step bumps LATEST_PROFILE_VERSION. Steps must be contiguous and the first starts at
//    BASE_PROFILE_VERSION. The list is empty today.

export interface Profile {
    /**
     * Profile (chain) version: its own counter, NOT the `kobar-storage` persist version. Only
     * MIGRATION_STEPS bump it. Every real profile starts at BASE_PROFILE_VERSION.
     */
    version: number;
    /** localStorage entries (key -> raw string). Keys must never be deleted by a step. */
    localStorage: Record<string, string>;
    /** userData files (relative POSIX path -> raw text content). */
    userData: Record<string, string>;
}

export interface MigrationStep {
    from: number;
    to: number;
    name: string;
    apply(profile: Profile): Profile;
}

/**
 * Current `kobar-storage` persist version. MUST equal `version` in useAppStore's persist options
 * (guarded by tests/store-persist-options.dom.test.ts). Bump together with a
 * new `if (version < N)` block in `migrateVersionedBlocks` (src/store/migrations/index.ts).
 */
export const KOBAR_STORAGE_VERSION = 32;

/** Profile version of the oldest fixture (tests/fixtures/profiles/v21). The chain starts here. */
export const BASE_PROFILE_VERSION = 21;

/** Latest profile (chain) version. Bump whenever a step is appended to MIGRATION_STEPS. */
export const LATEST_PROFILE_VERSION = 21;

type KobarStorageMigrate = (state: unknown, version: number, options?: KobarStorageMigrateOptions) => unknown;

export interface ChainOptions {
    /** Defaults to MIGRATION_STEPS. Injectable so tests can simulate a future step. */
    steps?: readonly MigrationStep[];
    /** Defaults to KOBAR_STORAGE_VERSION. Injectable so tests can simulate a future bump. */
    kobarStorageVersion?: number;
    /** Defaults to the live migrateKobarStorage. */
    migrate?: KobarStorageMigrate;
}

/**
 * Mirrors Zustand persist: `migrate` runs ONCE from the stored blob version to the current one,
 * and is skipped only when the stored version already equals the current one. Self-gated on the
 * blob version, so it is safe to call unconditionally. Like the store's `migratePersistedKobarStorage`
 * it passes the profile's own `kobar_force_theme_color` localStorage value (v26, T-601).
 */
export function migrateKobarStorageBlob(
    profile: Profile,
    targetVersion: number = KOBAR_STORAGE_VERSION,
    migrate: KobarStorageMigrate = migrateKobarStorage,
): Profile {
    const raw = profile.localStorage['kobar-storage'];
    if (raw === undefined) return profile;
    const blob = JSON.parse(raw) as { state: unknown; version: number };
    if (blob.version === targetVersion) return profile;
    const state = migrate(blob.state, blob.version, { forcedThemeColor: profile.localStorage[FORCED_THEME_COLOR_KEY] ?? null });
    return {
        ...profile,
        localStorage: {
            ...profile.localStorage,
            'kobar-storage': JSON.stringify({ state, version: targetVersion }),
        },
    };
}

/**
 * Non-kobar-storage steps only (userData files, backups ...). Example:
 * { from: 21, to: 22, name: 'window-state backup', apply(profile) { ... } }
 * and set LATEST_PROFILE_VERSION = 22.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [];

/** Migrates kobar-storage (always, self-gated) and then applies every step still ahead. */
export function migrateProfileToLatest(input: Profile, options: ChainOptions = {}): Profile {
    const {
        steps = MIGRATION_STEPS,
        kobarStorageVersion = KOBAR_STORAGE_VERSION,
        migrate = migrateKobarStorage,
    } = options;
    let profile: Profile = migrateKobarStorageBlob(structuredClone(input), kobarStorageVersion, migrate);
    for (const step of steps) {
        if (profile.version >= step.to) continue;
        profile = { ...step.apply(profile), version: step.to };
    }
    return profile;
}

// Text files only: utf8 decoding + CRLF normalisation would corrupt binary files.
function readDirRecursive(root: string, dir = root, out: Record<string, string> = {}) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) readDirRecursive(root, full, out);
        else out[relative(root, full).split('\\').join('/')] = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    }
    return out;
}

/** Loads tests/fixtures/profiles/v<version>/ as a Profile. */
export function loadProfileFixture(version: number): Profile {
    const base = fileURLToPath(new URL(`../fixtures/profiles/v${version}/`, import.meta.url));
    const localStorage = JSON.parse(readFileSync(join(base, 'localStorage.json'), 'utf8')) as Record<string, string>;
    return { version, localStorage, userData: readDirRecursive(join(base, 'userData')) };
}
