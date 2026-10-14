// Recovery actions after a failed `kobar-storage` hydration (T-152, follow-up of T-201).
//
// Default decisions (owner unavailable, safest and most reversible):
//   - The app never continues with defaults on its own: writes stay locked (HYDRATION_FAILED_LOCK_REASON) until the
//     user picks a recovery action on the recovery panel.
//   - Every action that will replace the unreadable value first keeps a verbatim copy of it under a new localStorage
//     key `kobar-storage.unreadable.<timestamp>` (never overwriting an existing key, never deleting anything). The
//     masked pre-migration backups in userData/backups/ (T-201) stay as a second copy. If the copy cannot be made and
//     read back, the action is refused and nothing changes.
//   - "Start fresh" puts the persisted fields back to the store's initial (default) values without touching the broken
//     data, then unlocks writes and marks the store hydrated, exactly like a fresh profile.
//   - "Restore from a backup file" reuses restoreFullBackup (T-213), which keeps the 'hydration-failed' lock on failure.

import { isUnreadableStoreCopyKey, UNREADABLE_STORE_COPY_PREFIX } from '../backup/keyPolicy';
import type { RestorePlan } from '../backup/parseBackup';
import { type RestoreResult, restoreFullBackup } from '../backup/restoreBackup';
import { HYDRATION_FAILED_LOCK_REASON, markHydrationRecovered } from './hydrationError';
import { appPersistStorage, type DebouncedStorage } from './persistStorage';
import { type AppState, useAppStore } from './useAppStore';

const MAX_COPY_NAME_ATTEMPTS = 100;

type CopyStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;

/** Raw access that bypasses the workspace isolation patch (src/utils/localStorageIsolation.ts). */
function rawAccess(storage: CopyStorage) {
    const isReal = typeof Storage !== 'undefined' && storage instanceof Storage;
    return {
        get: (key: string): string | null => (isReal ? Storage.prototype.getItem.call(storage, key) : storage.getItem(key)),
        set: (key: string, value: string): void =>
            isReal ? Storage.prototype.setItem.call(storage, key, value) : storage.setItem(key, value),
    };
}

export type PreserveResult = { ok: true; key: string | null } | { ok: false };

/** `2026-10-12T10-00-00-000Z` (no `:` or `.`). */
function stamp(now: Date): string {
    return now.toISOString().replace(/[:.]/g, '-');
}

/** localStorage key of the app store, taken from its persist options (single source of truth). */
function appStoreKey(): string | undefined {
    return useAppStore.persist.getOptions().name;
}

/**
 * T-405: the value the failed hydration read. The persist storage returns it even when it came from the file store and
 * localStorage holds another (older) value or none.
 */
function hydratedStoreValue(storeKey: string): string | null {
    return appPersistStorage.getItem(storeKey);
}

/**
 * Keeps a verbatim copy of the current `kobar-storage` value under `kobar-storage.unreadable.<timestamp>`. An identical
 * existing copy is reused (no duplicate on retry). Returns `{ ok: true, key: null }` when there is nothing to keep.
 * Never throws, never overwrites or removes a key.
 * `read` supplies the value to keep (default: the raw value in `storage`; the app passes the hydrated value, T-405).
 */
export function preserveUnreadableStore(
    storage: CopyStorage = window.localStorage,
    now: Date = new Date(),
    storeKey: string | undefined = appStoreKey(),
    read?: (key: string) => string | null
): PreserveResult {
    try {
        if (!storeKey) return { ok: false };
        const raw = rawAccess(storage);
        const value = read ? read(storeKey) : raw.get(storeKey);
        if (value === null) return { ok: true, key: null };
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key !== null && isUnreadableStoreCopyKey(key)) keys.push(key);
        }
        for (const key of keys) if (raw.get(key) === value) return { ok: true, key };
        const base = `${UNREADABLE_STORE_COPY_PREFIX}${stamp(now)}`;
        let key = base;
        for (let n = 1; raw.get(key) !== null; n++) {
            // Bounded: a storage that reports every key as taken must not hang the UI.
            if (n > MAX_COPY_NAME_ATTEMPTS) return { ok: false };
            key = `${base}-${n}`;
        }
        raw.set(key, value);
        return raw.get(key) === value ? { ok: true, key } : { ok: false };
    } catch {
        return { ok: false };
    }
}

/**
 * T-405: keeps the value the failed hydration read (possibly from the file store) and, when localStorage holds a
 * different value, that one too, so neither copy is lost when the recovery action replaces them.
 */
export function preserveHydratedStore(storage: CopyStorage = window.localStorage, now: Date = new Date()): PreserveResult {
    const hydrated = preserveUnreadableStore(storage, now, appStoreKey(), hydratedStoreValue);
    if (!hydrated.ok) return hydrated;
    const local = preserveUnreadableStore(storage, now);
    return local.ok ? hydrated : { ok: false };
}

/** Puts every persisted field back to its initial (default) value; runtime fields are kept. */
export function resetPersistedStateToDefaults(): void {
    const options = useAppStore.persist.getOptions();
    const initial = useAppStore.getInitialState();
    const defaults = (options.partialize ? options.partialize(initial) : initial) as Partial<AppState>;
    useAppStore.setState(defaults);
}

export interface StartFreshDeps {
    persist: Pick<DebouncedStorage, 'lockReason' | 'lockWrites' | 'unlockWrites' | 'flush'>;
    preserve: () => PreserveResult;
    resetToDefaults: () => void;
    /** Marks the store hydrated; its persist write is the first write after the unlock. */
    markHydrated: () => void;
}

function defaultStartFreshDeps(): StartFreshDeps {
    return {
        persist: appPersistStorage,
        preserve: () => preserveHydratedStore(),
        resetToDefaults: resetPersistedStateToDefaults,
        markHydrated: () => useAppStore.getState().setHydrated(true),
    };
}

export type StartFreshResult =
    { success: true; copyKey: string | null } | { success: false; reason: 'not-failed' | 'copy-failed' | 'error' };

/**
 * "Start fresh (keep a copy)". Only runs while the 'hydration-failed' lock is active; the copy is made first and the
 * reset happens while writes are still locked. On any error the lock is put back and nothing is written. Never throws.
 */
export function startFreshAfterHydrationFailure(deps: StartFreshDeps = defaultStartFreshDeps()): StartFreshResult {
    if (deps.persist.lockReason() !== HYDRATION_FAILED_LOCK_REASON) return { success: false, reason: 'not-failed' };
    const copy = deps.preserve();
    if (!copy.ok) return { success: false, reason: 'copy-failed' };
    try {
        deps.resetToDefaults();
        deps.persist.unlockWrites();
        deps.markHydrated();
        deps.persist.flush();
    } catch (error) {
        // Pending writes are discarded by the lock, so the stored value is unchanged.
        deps.persist.lockWrites(HYDRATION_FAILED_LOCK_REASON);
        console.error('[Store] Starting fresh after a failed hydration did not complete:', error);
        return { success: false, reason: 'error' };
    }
    markHydrationRecovered();
    return { success: true, copyKey: copy.key };
}

export type RecoveryRestoreResult = RestoreResult | { success: false; reason: 'copy-failed'; rolledBack: true };

export interface RecoveryRestoreDeps {
    preserve: () => PreserveResult;
    restore: (plan: RestorePlan) => Promise<RestoreResult>;
}

/** "Restore from a backup file": keeps the copy first, then the regular full restore (T-213). Never throws. */
export async function restoreFromRecovery(
    plan: RestorePlan,
    deps: RecoveryRestoreDeps = {
        preserve: () => preserveHydratedStore(),
        restore: (p) => restoreFullBackup(p),
    }
): Promise<RecoveryRestoreResult> {
    if (!deps.preserve().ok) return { success: false, reason: 'copy-failed', rolledBack: true };
    try {
        return await deps.restore(plan);
    } catch {
        return { success: false, reason: 'error', rolledBack: true };
    }
}
