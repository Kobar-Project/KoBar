// T-315: the small app-level IPC handlers that sat in main.cts, moved unchanged: hide / quit, the internal persist-flush ack, and the
// version / dev-flag queries. main.cts registers the first group early (registerAppControlIpc) and the second one last (registerAppInfoIpc).
import { app, ipcMain } from 'electron';
import { appState } from '../state.cjs';
import type { MainContext } from './context.cjs';
import type { RuntimeEnv } from './runtime.cjs';

export function registerAppControlIpc(ctx: MainContext): void {
    const { persistFlusher } = ctx.persist;

    // IPC listeners
    ipcMain.on('hide-app', () => {
        if (appState.mainWindow) {
            appState.mainWindow.hide();
        }
    });

    ipcMain.on('quit-app', () => {
        app.quit();
    });

    // Internal ack for `flush-persist` (T-129). Only the main window's renderer may settle a request.
    ipcMain.on('flush-persist-done', (event, id: unknown) => {
        if (!appState.mainWindow || appState.mainWindow.isDestroyed() || event.sender !== appState.mainWindow.webContents) return;
        persistFlusher.ack(id);
    });
}

export function registerAppInfoIpc(env: RuntimeEnv): void {
    const { isDev } = env;

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    ipcMain.handle('is-dev', () => {
        return isDev;
    });
}
