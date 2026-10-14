// T-614: the main window's one system-sync instance, wired to the real window.api, the app store and the full-backup export.
// main.tsx hands it to startSettingsSync. Host-internal, not part of the plugin contract.
import { getDataTransferMode, openDataTransferDialog } from '../backup/dataTransferDialog';
import { isRestoreDialogOpen, openRestoreDialog } from '../backup/restoreDialog';
import { exportFullBackup } from '../backup/exportBackup';
import { IS_STORE_FLAVOR } from '../buildFlags';
import { createSystemSync, type SystemSyncApi } from './systemSync';
import { useAppStore } from './useAppStore';

/** The main window is a click-through ghost window: let it take mouse input and focus so the dialog / tutorial can be used. */
function bringWindowForward(): void {
    try {
        (globalThis as { api?: { setIgnoreMouseEvents?: (ignore: boolean) => void } }).api?.setIgnoreMouseEvents?.(false);
        window.focus();
    } catch {
        /* best effort */
    }
}

export const systemSync = createSystemSync({
    api: () => (globalThis as { api?: SystemSyncApi }).api,
    isHydrated: () => useAppStore.getState().isHydrated,
    updatesEnabled: !IS_STORE_FLAVOR,
    exportBackup: (options) => exportFullBackup(options),
    openRestore: () => {
        // T-615b: the restore and the data transfer dialogs are never open together.
        if (getDataTransferMode() !== null) return;
        openRestoreDialog();
        bringWindowForward();
    },
    openDataTransfer: (mode) => {
        if (isRestoreDialogOpen()) return;
        openDataTransferDialog(mode);
        bringWindowForward();
    },
    restartTutorial: () => {
        const state = useAppStore.getState();
        state.setIsManualTutorialTrigger(true);
        state.setTutorialState({ status: 'pending', snoozeUntil: undefined });
        bringWindowForward();
    },
});
