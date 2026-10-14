// One-time "take a backup" hint (T-215). A tiny standalone localStorage flag, deliberately NOT part of `kobar-storage`
// (no store migration needed). Read and written through Storage.prototype so the workspace isolation patch
// (src/utils/localStorageIsolation.ts) never turns it into a per-workspace key.

export const BACKUP_HINT_KEY = 'kobar-backup-hint-shown';

/** True when the hint was never shown on this installation. Storage errors count as "already shown" (never nag). */
export function shouldShowBackupHint(storage: Storage = window.localStorage): boolean {
    try {
        return Storage.prototype.getItem.call(storage, BACKUP_HINT_KEY) === null;
    } catch {
        return false;
    }
}

/** Records that the hint was shown. Never throws. */
export function markBackupHintShown(storage: Storage = window.localStorage): void {
    try {
        Storage.prototype.setItem.call(storage, BACKUP_HINT_KEY, '1');
    } catch {
        /* ignore */
    }
}
