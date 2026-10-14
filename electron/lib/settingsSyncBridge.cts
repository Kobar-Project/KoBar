// T-606: the main window preload's half of the Settings window state sync. Pure: no Electron and no Node imports (it is inlined
// into the sandboxed preload bundle), so it is unit-tested with fake transport functions.
//
// The preload exposes the object returned here as `window.__kobarSettingsSync` (NOT window.api). `claim()` hands the two channel
// functions out exactly once: the host claims them at renderer start (src/store/sync.ts, imported by src/main.tsx before any plugin
// script is injected), so a plugin sharing the page realm only ever gets null. Main checks the sender (main window top frame) on
// every publish and pushes actions to the main window only.
import type {
    IpcClaimedSettingsSyncBridge,
    IpcSettingsAction,
    IpcSettingsPublish,
    IpcSettingsSyncBridge,
} from '../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };

/** The channel calls, supplied by the preload with string-literal channel names (tests/ipcContract.test.ts scans them). */
export interface SettingsSyncBridgeTransport {
    publish(message: IpcSettingsPublish): void;
    onAction(callback: (action: IpcSettingsAction) => void): () => void;
    openSettings(page?: string): void;
}

export function createSettingsSyncBridge(transport: SettingsSyncBridgeTransport): IpcSettingsSyncBridge {
    let claimed = false;
    return {
        claim(): IpcClaimedSettingsSyncBridge | null {
            if (claimed) return null;
            claimed = true;
            return {
                publish: (message) => transport.publish(message),
                onAction: (callback) => transport.onAction(callback),
                // T-615: only a string page name travels; anything else opens the window without a page.
                openSettings: (page) => transport.openSettings(typeof page === 'string' ? page : undefined),
            };
        },
    };
}
