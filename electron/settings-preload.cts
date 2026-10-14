// T-606: narrow preload for the Settings window only (like pip-preload for PiP). It exposes ONLY `window.settingsBridge`: subscribe
// to the settings snapshots main relays from the main window, ask for the current one, and send an action. The full `window.api`
// bridge, the storage channels and every plugin global are NOT available here, so this window can neither read nor write
// persisted state; the main window's store stays the single source of truth (it validates and applies every action itself).
// Main accepts `settings:action` / `settings:request-state` from the Settings window's top frame only.
import { contextBridge, ipcRenderer as electronIpcRenderer } from 'electron';
import type { IpcSettingsStateMessage, IpcSettingsWindowBridge, TypedIpcRenderer } from '../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};

// Typed view of ipcRenderer after shared/ipc-contract.ts (type annotation only; the type import is erased, so this sandboxed
// preload still requires nothing but `electron`).
const ipcRenderer: TypedIpcRenderer<Electron.IpcRendererEvent> = electronIpcRenderer;

const settingsBridge: IpcSettingsWindowBridge = {
    onState: (callback) => {
        const handler = (_event: unknown, message: IpcSettingsStateMessage) => callback(message);
        ipcRenderer.on('settings:state', handler);
        return () => {
            ipcRenderer.removeListener('settings:state', handler);
        };
    },
    requestState: () => ipcRenderer.send('settings:request-state'),
    dispatch: (action) => ipcRenderer.send('settings:action', action),
    onShowPage: (callback) => {
        const handler = (_event: unknown, page: string) => callback(page);
        ipcRenderer.on('settings:show-page', handler);
        return () => {
            ipcRenderer.removeListener('settings:show-page', handler);
        };
    },
    // R2-15: Google Calendar (Experimental) controls; the answers are statuses only, never a token.
    gcalStatus: () => ipcRenderer.invoke('gcal-settings-status'),
    gcalConnect: () => ipcRenderer.invoke('gcal-settings-connect'),
    gcalDisconnect: () => ipcRenderer.invoke('gcal-settings-disconnect'),
    gcalSetEnabled: (enabled: boolean) => ipcRenderer.invoke('gcal-settings-set-enabled', enabled),
    gcalRefresh: () => ipcRenderer.invoke('gcal-settings-refresh'),
};

contextBridge.exposeInMainWorld('settingsBridge', settingsBridge);
