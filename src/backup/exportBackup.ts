// Renderer side of the full backup export (T-211). Reads every localStorage key (read-only, nothing is changed or
// deleted), asks main for extensions-config.json and the installed plugin list, builds the `kobar-backup` JSON and
// hands it to main, which shows the save dialog and writes the file.

import { appPersistStorage, flushAppPersist } from '../store/persistStorage';
import { buildBackup, serializeBackup } from './buildBackup';
import { setOwn } from './redact';

type StorageReader = Pick<Storage, 'length' | 'key' | 'getItem'>;

/**
 * All keys of `storage` with their raw values. Values are read through `Storage.prototype.getItem` so the workspace
 * isolation patch (src/utils/localStorageIsolation.ts) does not rewrite the key names: `_iso_<id>` keys are read as
 * they are stored.
 */
export function snapshotLocalStorage(storage: StorageReader): Record<string, string> {
    const rawGetItem =
        typeof Storage !== 'undefined' && storage instanceof Storage
            ? (key: string) => Storage.prototype.getItem.call(storage, key)
            : (key: string) => storage.getItem(key);
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
    }
    const out: Record<string, string> = {};
    for (const key of keys.sort()) {
        const value = rawGetItem(key);
        if (typeof value === 'string') setOwn(out, key, value);
    }
    return out;
}

/** Key of the app store in localStorage and in the persist storage. */
export const APP_STORE_KEY = 'kobar-storage';

/**
 * T-405: the current `kobar-storage` value of the persist storage. It differs from localStorage only when the newer copy is
 * in the file store (a localStorage write failed, e.g. quota). Null when there is none.
 */
export function readAppStoreValue(): string | null {
    try {
        return appPersistStorage.getItem(APP_STORE_KEY);
    } catch {
        return null;
    }
}

/** `snapshot` with the app store value replaced by `appStore` when that is a string (T-405). */
export function withAppStoreValue(snapshot: Record<string, string>, appStore: string | null | undefined): Record<string, string> {
    if (typeof appStore === 'string') setOwn(snapshot, APP_STORE_KEY, appStore);
    return snapshot;
}

export interface ExportFullBackupResult {
    success: boolean;
    path?: string;
    reason?: string;
}

export interface ExportFullBackupDeps {
    api: Pick<Window['api'], 'getBackupSources' | 'saveFullBackup' | 'getAppVersion'>;
    storage: StorageReader;
    /** Writes the debounced `kobar-storage` value first so the snapshot is current. */
    flush: () => void;
    now: () => Date;
    /** T-405: the current `kobar-storage` value (persist storage), overlaid on the snapshot. Absent: localStorage only. */
    readAppStore?: () => string | null;
}

function defaultDeps(): ExportFullBackupDeps {
    return {
        api: window.api,
        storage: window.localStorage,
        flush: flushAppPersist,
        now: () => new Date(),
        readAppStore: readAppStoreValue,
    };
}

/** Builds a full backup and lets main save it. Secrets are excluded unless `includeSecrets` (owner decision S2). */
export async function exportFullBackup(
    options: { includeSecrets?: boolean } = {},
    deps: ExportFullBackupDeps = defaultDeps()
): Promise<ExportFullBackupResult> {
    try {
        const [sources, appVersion] = await Promise.all([deps.api.getBackupSources(), deps.api.getAppVersion()]);
        // Flush right before the snapshot (after the awaits), so edits made meanwhile are included too.
        deps.flush();
        const localStorage = withAppStoreValue(snapshotLocalStorage(deps.storage), deps.readAppStore?.());
        const backup = buildBackup(
            {
                localStorage,
                extensionsConfig: sources?.extensionsConfig ?? {},
                plugins: Array.isArray(sources?.plugins) ? sources.plugins : [],
                appVersion: typeof appVersion === 'string' ? appVersion : '',
                now: deps.now(),
            },
            { includeSecrets: options.includeSecrets === true }
        );
        const result = await deps.api.saveFullBackup(serializeBackup(backup));
        return result ?? { success: false, reason: 'no-response' };
    } catch (error) {
        console.error('[KoBar] Full backup failed:', error);
        return { success: false, reason: 'error' };
    }
}
