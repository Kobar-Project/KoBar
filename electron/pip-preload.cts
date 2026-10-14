// Narrow preload for the PiP window (SEC-07). Exposes only what the PiP player needs:
// close, move and media updates. The full `window.api` bridge is NOT available here.
import { contextBridge, ipcRenderer as electronIpcRenderer } from 'electron';
import type { MediaUpdate } from './lib/mediaTypes.cjs';
import type { TypedIpcRenderer } from '../shared/ipc-contract.js' with { 'resolution-mode': 'import' };

// T-304: typed view of ipcRenderer after shared/ipc-contract.ts (type annotation only; the type import is erased, so this
// sandboxed preload still requires nothing but `electron`).
const ipcRenderer: TypedIpcRenderer<Electron.IpcRendererEvent> = electronIpcRenderer;

contextBridge.exposeInMainWorld('pipApi', {
    close: () => ipcRenderer.send('close-pip'),
    // Reserved for JS-driven dragging; the PiP currently drags via -webkit-app-region.
    move: (dx: number, dy: number) => ipcRenderer.send('move-window', { dx, dy }),
    onMediaUpdate: (callback: (data: MediaUpdate) => void) => {
        const handler = (_event: unknown, data: MediaUpdate) => callback(data);
        ipcRenderer.on('media-update', handler);
        return () => {
            ipcRenderer.removeListener('media-update', handler);
        };
    },
});
