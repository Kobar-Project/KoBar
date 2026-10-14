// Full backup restore, step 2 (T-213): write a validated restore plan (parseBackup.ts) and relaunch.
//
// Order (each step only runs when the previous one succeeded):
//   1. Flush the debounced `kobar-storage` write, then write-lock the persist storage (pending writes are dropped and
//      nothing reaches localStorage until the relaunch) and pause the chat store's persist writes.
//   2. Automatic full backup of the CURRENT data (secrets excluded, like a default export) into userData/backups/.
//   3. Write the plan's localStorage entries. Secret fields that were blanked in the backup get the user's current
//      value (keepLocalFields, matched by element `id`, never by position for objects) unless an endpoint field in the same
//      record differs from the local one (T-159, T-161, keepLocal.ts); an endpoint key that would be paired with a secret
//      kept under its own key is not written. Plugin flags inside `kobar-storage` (workspace records) may not enable a
//      plugin that is disabled or not installed here (T-415, restorePluginFlags.ts). If a write fails, every key already
//      written is put back.
//   4. Main applies the plugin enabled flags (installed plugins only; may disable, never enables) and relaunches.
// On any failure before the relaunch the data is left as it was and the lock state is restored.
//
// Default decision (T-213, to be confirmed by the owner): local keys that are NOT in the backup are kept, never
// deleted. That keeps the restore reversible and protects data the backup could not carry (e.g. skipped keys).
// The UI (T-215) calls restoreFullBackup with the plan returned by parseBackup.

import { createJSONStorage } from 'zustand/middleware';
import { type DebouncedStorage, appPersistStorage } from '../store/persistStorage';
import { useAppStore } from '../store/useAppStore';
import { useChatStore } from '../store/useChatStore';
import { buildBackup, serializeBackup } from './buildBackup';
import { PERSIST_META_KEY, serializeLocalWriteMeta } from '../storage/fileBackedStorage';
import { APP_STORE_KEY, readAppStoreValue, snapshotLocalStorage, withAppStoreValue } from './exportBackup';
import { applyKeepLocalFields, endpointGuardFor, endpointKeysToKeepLocal } from './keepLocal';
import { isHostInternalKey } from './keyPolicy';
import type { KeepLocalField, RestorePlan } from './parseBackup';
import { isPlainObject } from './coreValues';
import { approvedPluginIds, restrictRestoredPluginFlags } from './restorePluginFlags';

// Kept here for the callers and tests that import it from this module.
export { applyKeepLocalFields };

export const RESTORE_LOCK_REASON = 'restore-in-progress';

export type RestoreFailureReason = 'busy' | 'backup-failed' | 'write-failed' | 'apply-failed' | 'error';

export type RestoreResult = { success: true } | { success: false; reason: RestoreFailureReason; detail?: string; rolledBack: boolean };

type RestoreStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export interface RestoreDeps {
    api: Pick<Window['api'], 'getBackupSources' | 'getAppVersion' | 'createPreRestoreBackup' | 'applyRestoreAndRelaunch'>;
    storage: RestoreStorage;
    persist: Pick<DebouncedStorage, 'flush' | 'lockWrites' | 'unlockWrites' | 'lockReason'>;
    /** Stops the chat store's persist writes; returns a function that resumes them. */
    pauseChatPersist: () => () => void;
    /** Queues one write of the current `kobar-storage` state (after a failed restore unlocked the storage). */
    rewritePersist: () => void;
    now: () => Date;
    /** T-405: the current `kobar-storage` value (persist storage) for the pre-restore backup. Absent: localStorage only. */
    readAppStore?: () => string | null;
}

/**
 * Production pause of the chat store's persist writes. The returned resume function restores the storage and writes
 * the current chat state once, so changes made while paused are not left in memory only.
 */
export function pauseChatPersist(): () => void {
    useChatStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    // Same storage the store was created with (zustand's default for `persist`).
    return () => {
        useChatStore.persist.setOptions({ storage: createJSONStorage(() => localStorage) });
        useChatStore.setState({});
    };
}

function rewritePersist(): void {
    // The persist middleware writes on every setState, also for an empty update.
    useAppStore.setState({});
}

function defaultDeps(): RestoreDeps {
    return {
        api: window.api,
        storage: window.localStorage,
        persist: appPersistStorage,
        pauseChatPersist,
        rewritePersist,
        now: () => new Date(),
        readAppStore: readAppStoreValue,
    };
}

// ---------------------------------------------------------------- keep-local fields (see keepLocal.ts)

function groupFields(fields: readonly KeepLocalField[]): Map<string, string[][]> {
    const byKey = new Map<string, string[][]>();
    for (const field of fields) {
        const list = byKey.get(field.key) ?? [];
        list.push(field.path);
        byKey.set(field.key, list);
    }
    return byKey;
}

// ---------------------------------------------------------------- write with rollback

/** Raw access: `_iso_` keys are written as they are, bypassing the workspace isolation patch. */
function rawAccess(storage: RestoreStorage) {
    const isReal = typeof Storage !== 'undefined' && storage instanceof Storage;
    return {
        get: (key: string) => (isReal ? Storage.prototype.getItem.call(storage, key) : storage.getItem(key)),
        set: (key: string, value: string) => (isReal ? Storage.prototype.setItem.call(storage, key, value) : storage.setItem(key, value)),
        remove: (key: string) => (isReal ? Storage.prototype.removeItem.call(storage, key) : storage.removeItem(key)),
    };
}

/** Puts every key back to its previous value (removing keys that did not exist). Returns false if any step failed. */
function rollback(storage: RestoreStorage, previous: Map<string, string | null>): boolean {
    const raw = rawAccess(storage);
    let ok = true;
    for (const [key, value] of previous) {
        try {
            if (value === null) raw.remove(key);
            else raw.set(key, value);
        } catch {
            ok = false;
        }
    }
    return ok;
}

let restoring = false;

/**
 * Writes `plan` and lets main relaunch the app. On success the persist lock stays until the relaunch. Never throws.
 * Secrets are never logged.
 */
export async function restoreFullBackup(plan: RestorePlan, deps: RestoreDeps = defaultDeps()): Promise<RestoreResult> {
    if (restoring) return { success: false, reason: 'busy', rolledBack: true };
    restoring = true;
    const previousLock = deps.persist.lockReason();
    let resumeChat: (() => void) | null = null;
    const undoLock = () => {
        try {
            resumeChat?.();
        } catch {
            /* ignore */
        }
        if (previousLock === null) {
            deps.persist.unlockWrites();
            // Edits made while locked were dropped from the write queue: write the current state once.
            try {
                deps.rewritePersist();
            } catch {
                /* ignore */
            }
        } else deps.persist.lockWrites(previousLock);
    };
    let previous: Map<string, string | null> | null = null;
    let succeeded = false;
    try {
        // 1. The pending state belongs in the pre-restore backup: flush, then lock (drops anything newer).
        deps.persist.flush();
        deps.persist.lockWrites(RESTORE_LOCK_REASON);
        resumeChat = deps.pauseChatPersist();

        // 2. Automatic backup of the current data, without secrets.
        const [sources, appVersion] = await Promise.all([deps.api.getBackupSources(), deps.api.getAppVersion()]);
        const current = withAppStoreValue(snapshotLocalStorage(deps.storage), deps.readAppStore?.());
        const backup = buildBackup({
            localStorage: current,
            extensionsConfig: sources?.extensionsConfig ?? {},
            plugins: Array.isArray(sources?.plugins) ? sources.plugins : [],
            appVersion: typeof appVersion === 'string' ? appVersion : '',
            now: deps.now(),
        });
        const saved = await deps.api.createPreRestoreBackup(serializeBackup(backup));
        if (!saved?.success) {
            undoLock();
            return { success: false, reason: 'backup-failed', detail: saved?.reason, rolledBack: true };
        }

        // 3. Write. Keys of the backup only; local keys absent from it are kept (see the module comment).
        const raw = rawAccess(deps.storage);
        const fields = groupFields(plan.keepLocalFields);
        previous = new Map();
        try {
            // T-161: an endpoint key that would be paired with a secret kept under its own key stays as it is locally.
            const keepEndpoint = endpointKeysToKeepLocal(plan.entries, plan.keepLocalKeys, (key) => raw.get(key));
            const appStoreNow = deps.readAppStore?.() ?? null;
            // T-415: plugin flags in the restored kobar-storage again, against this machine's state right now (the plan
            // may be older or hand-made). Unknown sources approve nothing (fail closed).
            const approved = approvedPluginIds(
                (Array.isArray(sources?.plugins) ? sources.plugins : []).map((p: unknown) => (isPlainObject(p) ? p.id : undefined)),
                sources?.extensionsConfig
            );
            for (const entry of plan.entries) {
                if (keepEndpoint.has(entry.key)) continue;
                // T-412: host-internal keys (this machine's storage bookkeeping) are never written from a plan, even a
                // hand-made one; parseBackup already skips them. The marker below is the restore's own write.
                if (isHostInternalKey(entry.key)) continue;
                const local = raw.get(entry.key);
                // T-405: kept secret fields come from the current app store value (it may be newer than localStorage).
                const mergeBase = entry.key === APP_STORE_KEY && appStoreNow !== null ? appStoreNow : local;
                const planned = entry.key === APP_STORE_KEY ? restrictRestoredPluginFlags(entry.value, approved) : entry.value;
                const value = applyKeepLocalFields(planned, mergeBase, fields.get(entry.key) ?? [], endpointGuardFor(entry.key));
                if (!previous.has(entry.key)) previous.set(entry.key, local);
                raw.set(entry.key, value);
                if (entry.key === APP_STORE_KEY) {
                    // T-405: mark the restored value as KoBar's latest localStorage write, so the file store (older) never
                    // wins over it at the relaunch (src/storage/fileBackedStorage.ts). Rolled back with the rest.
                    if (!previous.has(PERSIST_META_KEY)) previous.set(PERSIST_META_KEY, raw.get(PERSIST_META_KEY));
                    raw.set(PERSIST_META_KEY, serializeLocalWriteMeta(value, deps.now().getTime()));
                }
            }
        } catch {
            const rolledBack = rollback(deps.storage, previous);
            undoLock();
            return { success: false, reason: 'write-failed', rolledBack };
        }

        // 4. Plugin flags + relaunch (main).
        const applied = await deps.api.applyRestoreAndRelaunch({ ...plan.extensionsConfig });
        if (!applied?.success) {
            const rolledBack = rollback(deps.storage, previous);
            undoLock();
            return { success: false, reason: 'apply-failed', detail: applied?.reason, rolledBack };
        }
        succeeded = true;
        return { success: true };
    } catch {
        const rolledBack = previous ? rollback(deps.storage, previous) : true;
        undoLock();
        console.error('[KoBar] Full backup restore failed');
        return { success: false, reason: 'error', rolledBack };
    } finally {
        // After a successful restore the app is relaunching: a second restore must not start.
        if (!succeeded) restoring = false;
    }
}
