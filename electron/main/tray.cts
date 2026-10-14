// T-306: system tray (icon, context menu, double-click toggle), moved unchanged out of main.cts. The main window comes from `appState`;
// the icon paths are injected through `appPaths` (this module never uses `__dirname`).
import { app, Menu, nativeImage, Tray } from 'electron';
import * as path from 'path';
import { type MainLang, t } from '../lib/mainStrings.cjs';
import type { AppPaths } from './lib/appPaths.cjs';
import { appState } from './state.cjs';
import { teleportToPrimaryCenter } from './windows/mainWindow.cjs';
import { openSettingsWindow } from './windows/settingsWindow.cjs';

let tray: Tray | null = null;

export function createTray(appPaths: AppPaths, getUiLanguage: () => Promise<MainLang>) {
    // Resolve the icon path dynamically for both development and packaged environments
    // Dev path relative to dist-electron: ../build/icon-256x256.ico
    const iconPath = appPaths.iconIco256;

    let trayIcon = nativeImage.createFromPath(iconPath);

    // Fallback resolution using the app root if current path fails
    if (trayIcon.isEmpty()) {
        const rootPath = path.join(app.getAppPath(), 'build/icon-256x256.ico');
        trayIcon = nativeImage.createFromPath(rootPath);
    }

    // In case of emergency (still empty), attempt to use a standard PNG logo as last resort
    if (trayIcon.isEmpty()) {
        const pngPath = appPaths.iconPng;
        trayIcon = nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
    }

    tray = new Tray(trayIcon);

    const buildMenu = (lang: MainLang) =>
        Menu.buildFromTemplate([
            {
                label: t(lang, 'trayShowHide'),
                click: () => {
                    if (appState.mainWindow) {
                        if (appState.mainWindow.isVisible() && !appState.mainWindow.isMinimized()) {
                            appState.mainWindow.hide();
                        } else {
                            // Teleport to primary display center before showing
                            teleportToPrimaryCenter();
                        }
                    }
                },
            },
            {
                label: t(lang, 'traySettings'),
                click: () => {
                    if (appState.mainWindow) {
                        teleportToPrimaryCenter();
                        appState.mainWindow.webContents.send('open-settings');
                    }
                },
            },
            // T-605: dev runs only, so the new Settings window can be tried before T-615 wires the gear to it. Packaged builds never show it.
            ...(app.isPackaged
                ? []
                : [
                      {
                          label: 'Settings window (dev preview)',
                          click: () => {
                              void openSettingsWindow();
                          },
                      },
                  ]),
            {
                label: t(lang, 'trayTeleport'),
                click: () => {
                    if (appState.mainWindow) {
                        teleportToPrimaryCenter();
                    }
                },
            },
            { type: 'separator' },
            {
                label: t(lang, 'trayQuit'),
                click: () => {
                    app.quit();
                },
            },
        ]);

    tray.setToolTip('KoBar');
    tray.setContextMenu(buildMenu('en'));
    // The saved UI language is read asynchronously; swap in the localised menu as soon as it is known (a failed read keeps English).
    void getUiLanguage()
        .then((lang) => {
            if (tray && !tray.isDestroyed()) tray.setContextMenu(buildMenu(lang));
        })
        .catch(() => undefined);

    tray.on('double-click', () => {
        if (appState.mainWindow) {
            if (appState.mainWindow.isVisible() && !appState.mainWindow.isMinimized()) {
                appState.mainWindow.hide();
            } else {
                // Teleport to primary display center before showing
                teleportToPrimaryCenter();
            }
        }
    });
}
