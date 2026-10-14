// T-606: wiring of the Settings window state sync (the relay logic is electron/lib/settingsSync.cts, pure and unit-tested).
//
// Channels (all internal, none in window.api; shapes in shared/ipc-contract.ts, schemas in ipc/schemas.cts):
//   settings:publish-state  main window renderer -> main   sender policy `main-window-top-frame` (claim-once __kobarSettingsSync)
//   settings:request-state  Settings window -> main        sender policy `settings-window-top-frame` (settings-preload)
//   settings:action         Settings window -> main        sender policy `settings-window-top-frame` (settings-preload)
//   settings:state          main -> Settings window only
//   settings:apply-action   main -> main window only
// Persisted state is never written here: the Settings window has no storage channel at all, and the storage IPC
// (services/storage/storageIpc.cts) accepts writes from the main window's top frame only.
//
// Main window lifetime: the first accepted publish attaches listeners to the main window's webContents. A main-frame, cross-document
// navigation (reload, dev HMR full reload) is reported in two steps (did-start-navigation, then did-navigate; see the ordering rules
// in lib/settingsSync.cts), a crashed renderer or a destroyed webContents resets the relay at once. Either way the Settings window's
// mirror drops to "waiting" until the new renderer publishes. The Settings window itself closes with the main window (settingsWindow.cts).
import type { WebContents } from 'electron';
import { createSettingsRelay, type SettingsRelay } from '../../lib/settingsSync.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import { SETTINGS_ACTION_OPTIONS, SETTINGS_PUBLISH_STATE_OPTIONS, SETTINGS_REQUEST_STATE_OPTIONS } from '../ipc/schemas.cjs';
import { appState } from '../state.cjs';

const watched = new WeakSet<WebContents>();

/** Resets the relay when the main window's renderer goes away or loads a new document. */
function watchMainRenderer(contents: WebContents, target: SettingsRelay): void {
    if (watched.has(contents)) return;
    watched.add(contents);
    contents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) target.navigationStarted();
    });
    contents.on('did-navigate', () => target.navigationCommitted());
    contents.on('render-process-gone', (_event, details) => target.resetMain(`render-process-gone:${details.reason}`));
    contents.once('destroyed', () => target.resetMain('destroyed'));
}

/** Registers the three inbound channels (main window publish, Settings window request / action). */
export function registerSettingsSyncIpc(registry: IpcRegistry): SettingsRelay {
    const current = createSettingsRelay({
        sendToSettings: (message) => {
            const win = appState.settingsWindow;
            if (win && !win.isDestroyed()) win.webContents.send('settings:state', message);
        },
        sendToMain: (action) => {
            const win = appState.mainWindow;
            if (!win || win.isDestroyed()) return false;
            win.webContents.send('settings:apply-action', action);
            return true;
        },
    });

    registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, (event, message) => {
        watchMainRenderer(event.sender, current);
        current.publish(message);
    });
    registry.on('settings:request-state', SETTINGS_REQUEST_STATE_OPTIONS, () => {
        current.requestState();
    });
    registry.on('settings:action', SETTINGS_ACTION_OPTIONS, (_event, action) => {
        // Only the three known fields travel on (the registry hands over the original object; extra fields are never forwarded).
        current.action({ id: action.id, type: action.type, payload: action.payload });
        // T-610: the v1 plugin settings panel opens in the main window, so bring that window forward (no new channel; the main
        // window renderer still validates the id against its plugin list and may reject the action).
        const payload = action.payload as { id?: unknown } | null | undefined;
        const opensSettings =
            action.type === 'plugin.openSettings' &&
            typeof payload === 'object' &&
            payload !== null &&
            typeof payload.id === 'string' &&
            payload.id.length > 0;
        // T-611: install-from-file shows a native dialog and install-from-GitHub works in the Plugins tab: both live in the main window.
        const emptyPayload =
            action.payload === undefined ||
            (typeof action.payload === 'object' &&
                action.payload !== null &&
                !Array.isArray(action.payload) &&
                Object.keys(action.payload).length === 0);
        const opensInstallFlow = (action.type === 'plugin.installFromFile' || action.type === 'plugin.installFromGithub') && emptyPayload;
        if (opensSettings || opensInstallFlow) {
            const win = appState.mainWindow;
            if (win && !win.isDestroyed()) {
                win.show();
                win.focus();
            }
        }
    });
    return current;
}
