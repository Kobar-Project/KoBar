// T-307: everything around electron-updater, moved unchanged out of main.cts: build-flavor resolution, the autoUpdater setup
// and its events, and the four updater IPC handlers. The main window comes from `appState`; the UI language is injected.
import { app, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { sanitizeVersion } from '../../lib/uiGuards.cjs';
import { type MainLang, t } from '../../lib/mainStrings.cjs';
import { type KobarFlavor, canSelfUpdateFor, resolveFlavor } from '../../lib/buildFlags.cjs';
import { UPDATE_FEED } from '../../lib/links.cjs';
import { appState } from '../state.cjs';

export interface UpdaterIpcDeps {
    getUiLanguage(): Promise<MainLang>;
}

// T-216: the build flavor comes from `kobarFlavor` / `kobarAutoUpdate` in the packaged package.json plus process.windowsStore
// (see electron/lib/buildFlags.cts). Source files are no longer rewritten for this.
function readPackagedBuildMetadata(): { kobarFlavor?: unknown; kobarAutoUpdate?: unknown; kobarMacSigned?: unknown } {
    if (!app.isPackaged) return {};
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
        return parsed && typeof parsed === 'object'
            ? (parsed as { kobarFlavor?: unknown; kobarAutoUpdate?: unknown; kobarMacSigned?: unknown })
            : {};
    } catch {
        return {};
    }
}
const packagedBuildMetadata = readPackagedBuildMetadata();
const kobarFlavor: KobarFlavor = resolveFlavor({
    packageFlavor: packagedBuildMetadata.kobarFlavor,
    windowsStore: process.windowsStore,
    isPackaged: app.isPackaged,
});
// Store and dev builds must never self-update; every updater IPC checks this flag (REL-14).
const canSelfUpdate: boolean = canSelfUpdateFor(
    kobarFlavor,
    packagedBuildMetadata.kobarAutoUpdate,
    process.platform,
    packagedBuildMetadata.kobarMacSigned
); // MAC-016: unsigned macOS builds never self-update
let lastUpdateVersion: string | null = null;

/** Called from the app.whenReady() callback, at the point where the updater used to be configured inline. */
export function setupUpdater() {
    // Auto Updater Setup
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // T-219: never move users to an older release, and read updates only from the canonical repository (not from whatever
    // app-update.yml an old build baked in).
    autoUpdater.allowDowngrade = false;
    if (canSelfUpdate) autoUpdater.setFeedURL({ ...UPDATE_FEED });

    autoUpdater.on('update-available', (info) => {
        lastUpdateVersion = info.version;
        if (appState.mainWindow) {
            appState.mainWindow.webContents.send('update-available', info.version);
        }
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (appState.mainWindow) {
            appState.mainWindow.webContents.send('update-download-progress', {
                percent: progressObj.percent,
                bytesPerSecond: progressObj.bytesPerSecond,
                transferred: progressObj.transferred,
                total: progressObj.total,
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (appState.mainWindow) {
            appState.mainWindow.webContents.send('update-download-complete', info.version);
        }
    });

    autoUpdater.on('error', (err) => {
        if (appState.mainWindow) {
            appState.mainWindow.webContents.send('update-error', err?.message || 'Unknown update error');
        }
    });

    if (canSelfUpdate) {
        // MAC-016: the `error` event above already reports failures to the UI; this only stops an unhandled rejection.
        autoUpdater.checkForUpdates().catch(() => undefined);
    }
}

export function registerUpdaterIpc(deps: UpdaterIpcDeps) {
    const { getUiLanguage } = deps;

    // The dialog text is fixed here: renderer/plugin-supplied strings are ignored (SEC-15). Only the
    // version the updater itself reported is shown, after validation. The renderer's four arguments (title, message,
    // yesLabel, noLabel) are intentionally not read at all; the handler takes no payload.
    ipcMain.handle('ask-for-update', async () => {
        if (!canSelfUpdate || !appState.mainWindow || appState.mainWindow.isDestroyed()) return false;
        const version = sanitizeVersion(lastUpdateVersion);
        const lang = await getUiLanguage();
        if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return false;
        const result = await dialog.showMessageBox(appState.mainWindow, {
            type: 'info',
            title: 'KoBar',
            message: version ? t(lang, 'updateAvailableVersion', { version }) : t(lang, 'updateAvailable'),
            buttons: [t(lang, 'download'), t(lang, 'later')],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
        });
        return result.response === 0;
    });

    ipcMain.on('download-and-install-update', () => {
        if (!canSelfUpdate) return;
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('quit-and-install-update', () => {
        if (!canSelfUpdate) return;
        autoUpdater.quitAndInstall();
    });

    ipcMain.handle('check-for-updates-manual', async () => {
        if (!canSelfUpdate) return { status: 'disabled' };
        try {
            const result = await autoUpdater.checkForUpdates();
            if (!result) {
                throw new Error('No update information retrieved');
            }
            const currentVersion = app.getVersion();
            const latestVersion = result.updateInfo.version;
            const updateAvailable = latestVersion !== currentVersion;

            return {
                status: 'success',
                updateAvailable,
                version: latestVersion,
            };
        } catch (error: any) {
            return {
                status: 'error',
                message: error?.message || 'Unknown error',
            };
        }
    });
}
