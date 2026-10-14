// T-214 (WS-05): deleting a workspace from the Workspaces screen.
//
// Order (each step only runs when the previous one succeeded):
//   1. Flush the debounced `kobar-storage` write so the backup holds the current state.
//   2. Automatic full backup (secrets excluded, like a default export) into userData/backups/ through main
//      (`create-pre-delete-backup`). If it fails, nothing is deleted.
//   3. The store's `deleteWorkspace` (T-206 single context-switch path: when the workspace was active the data context
//      switches to shared in the same commit, so nothing writes the removed workspace's keys afterwards).
//   4. Only then the workspace's own `<base>_iso_<id>` localStorage keys are removed (raw, bypassing the isolation
//      patch). A key that could also belong to another existing workspace is kept (see findWorkspaceIsoKeys).
//
// Default decision (T-214): the red line "localStorage is never deleted" is about the storage migration. Here only the
// deleted workspace's own `_iso_<id>` keys are removed, after an explicit confirmation that says so and after a
// successful automatic backup.

import { buildBackup, serializeBackup } from '../../backup/buildBackup';
import { snapshotLocalStorage } from '../../backup/exportBackup';
import { ISO_MARKER } from '../../backup/keyPolicy';
import { flushAppPersist } from '../persistStorage';

/** Never suffixed by the isolation patch (system key); listed so it can never be selected by accident. */
const PROTECTED_KEYS = new Set(['kobar-storage']);

/**
 * Keys written by the isolation patch for `workspaceId`: `<non-empty base>_iso_<workspaceId>`, matched on the exact
 * suffix (no prefix match on the id). A key whose suffix also matches another known workspace id (e.g. ids `b` and
 * `a_iso_b`) is ambiguous and is never selected.
 */
export function findWorkspaceIsoKeys(keys: readonly string[], workspaceId: string, otherWorkspaceIds: readonly string[]): string[] {
    if (typeof workspaceId !== 'string' || workspaceId === '') return [];
    const suffix = `${ISO_MARKER}${workspaceId}`;
    const otherSuffixes = otherWorkspaceIds
        .filter((id) => typeof id === 'string' && id !== '' && id !== workspaceId)
        .map((id) => `${ISO_MARKER}${id}`);
    return keys.filter(
        (key) =>
            typeof key === 'string' &&
            key.length > suffix.length &&
            key.endsWith(suffix) &&
            !PROTECTED_KEYS.has(key) &&
            !otherSuffixes.some((other) => key.length > other.length && key.endsWith(other))
    );
}

type IsoStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

function storageKeys(storage: IsoStorage): string[] {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
    }
    return keys;
}

/** Removes the keys of findWorkspaceIsoKeys. Raw removal: the isolation patch must not rewrite the key names. */
export function removeWorkspaceIsoKeys(storage: IsoStorage, workspaceId: string, otherWorkspaceIds: readonly string[]): string[] {
    const rawRemove =
        typeof Storage !== 'undefined' && storage instanceof Storage
            ? (key: string) => Storage.prototype.removeItem.call(storage, key)
            : (key: string) => storage.removeItem(key);
    const keys = findWorkspaceIsoKeys(storageKeys(storage), workspaceId, otherWorkspaceIds);
    const removed: string[] = [];
    for (const key of keys) {
        try {
            rawRemove(key);
            removed.push(key);
        } catch (error) {
            console.warn('[KoBar] Could not remove an isolated workspace key', error);
        }
    }
    return removed;
}

export type DeleteWorkspaceResult =
    | { success: true; removedKeys: number }
    | { success: false; reason: 'busy' | 'not-found' | 'backup-failed' | 'delete-failed'; detail?: string };

export interface DeleteWorkspaceDeps {
    api: Pick<Window['api'], 'getBackupSources' | 'getAppVersion' | 'createPreDeleteBackup'>;
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>;
    flush: () => void;
    now: () => Date;
    getWorkspaceIds: () => string[];
    /** The store's synchronous deleteWorkspace (context switch included). */
    deleteWorkspace: (id: string) => void;
}

let deleting = false;

/** Backup, then delete, then remove the workspace's `_iso_<id>` keys. Nothing is deleted when the backup fails. */
export async function deleteWorkspaceWithBackup(id: string, deps: DeleteWorkspaceDeps): Promise<DeleteWorkspaceResult> {
    if (deleting) return { success: false, reason: 'busy' };
    if (!deps.getWorkspaceIds().includes(id)) return { success: false, reason: 'not-found' };
    deleting = true;
    try {
        try {
            const [sources, appVersion] = await Promise.all([deps.api.getBackupSources(), deps.api.getAppVersion()]);
            // Flush right before the snapshot (after the awaits), so edits made meanwhile are included too.
            deps.flush();
            const backup = buildBackup({
                localStorage: snapshotLocalStorage(deps.storage),
                extensionsConfig: sources?.extensionsConfig ?? {},
                plugins: Array.isArray(sources?.plugins) ? sources.plugins : [],
                appVersion: typeof appVersion === 'string' ? appVersion : '',
                now: deps.now(),
            });
            const saved = await deps.api.createPreDeleteBackup(serializeBackup(backup));
            if (!saved?.success) return { success: false, reason: 'backup-failed', detail: saved?.reason };
        } catch {
            return { success: false, reason: 'backup-failed' };
        }

        // The workspace may have been removed while the backup was written.
        const idsBefore = deps.getWorkspaceIds();
        if (!idsBefore.includes(id)) return { success: false, reason: 'not-found' };
        try {
            deps.deleteWorkspace(id);
            const idsAfter = deps.getWorkspaceIds();
            if (idsAfter.includes(id)) return { success: false, reason: 'delete-failed' };

            // Every other workspace that existed before the delete guards its own keys.
            const others = idsBefore.filter((other) => other !== id);
            const removed = removeWorkspaceIsoKeys(deps.storage, id, others);
            return { success: true, removedKeys: removed.length };
        } catch (error) {
            console.error('[KoBar] Workspace delete failed after the backup', error);
            return { success: false, reason: 'delete-failed' };
        }
    } finally {
        deleting = false;
    }
}

/** Production dependencies (window.api, real localStorage, the app persist flush). */
export function defaultDeleteWorkspaceDeps(store: {
    getWorkspaceIds: () => string[];
    deleteWorkspace: (id: string) => void;
}): DeleteWorkspaceDeps {
    return {
        api: window.api,
        storage: window.localStorage,
        flush: flushAppPersist,
        now: () => new Date(),
        getWorkspaceIds: store.getWorkspaceIds,
        deleteWorkspace: store.deleteWorkspace,
    };
}
