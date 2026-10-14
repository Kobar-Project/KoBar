// T-315: the app lifecycle handlers, moved unchanged out of main.cts: the whenReady startup sequence (windows, tray, permission handlers,
// media polling, quit hooks, pin targeting, updater) and window-all-closed. T-316: media polling starts here only when it is needed
// (updateMediaDemand, services/mediaDemand.cts); the extensions config it reads exists by then (whenReady runs after main.cts
// finished). registerAppLifecycle() is called by main.cts at the position where `app.whenReady().then(...)` and
// `app.on('window-all-closed', ...)` used to be; the whenReady callback still runs after main.cts finished.
import { app, BrowserWindow, globalShortcut, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDevShortcut } from '../../lib/devShortcut.cjs';
import { createTray } from '../tray.cjs';
import { stopMediaPolling, updateMediaDemand } from '../services/media.cjs';
import { startPsBridge, stopPsBridge } from '../services/native.cjs';
import { waitForKoBoxCleanup } from '../services/kobox.cjs';
import { registerPinTargetingHandler } from '../services/pin.cjs';
import { setupUpdater } from '../services/updater.cjs';
import { createWindow } from '../windows/mainWindow.cjs';
import type { MainContext } from './context.cjs';
import { installPermissionHandlers, setupCspDiagnostics } from './security.cjs';

export function registerAppLifecycle(ctx: MainContext): void {
    const { isWin, appPaths, windowDeps, persist, getUiLanguage } = ctx;
    const { quitFlushGuard } = persist;

    app.whenReady().then(() => {
        // Ensure KoBox exists
        const koBoxPath = path.join(app.getPath('userData'), 'KoBox');
        if (!fs.existsSync(koBoxPath)) {
            fs.mkdirSync(koBoxPath, { recursive: true });
        }

        // R2-13: dev only: a Start Menu shortcut with the dev AUMID makes toasts say "KoBar Dev" with the KoBar logo instead of "Electron".
        if (isWin && !app.isPackaged) {
            const programsDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
            ensureDevShortcut({
                platform: process.platform,
                programsDir,
                execPath: process.execPath,
                appPath: app.getAppPath(),
                iconPath: path.join(path.dirname(appPaths.iconPng), 'icon.ico'),
                aumid: 'com.eedali.kobar.dev',
                join: path.join,
                readShortcut: (file) => {
                    try {
                        return shell.readShortcutLink(file);
                    } catch {
                        return null;
                    }
                },
                writeShortcut: (file, details) => shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', details),
            });
        }

        // T-309: the PowerShell bridge (spawn script, respawn policy, stdout parsing) lives in electron/main/services/native.cts.
        if (isWin) {
            startPsBridge();
        }

        setupCspDiagnostics(ctx);
        createWindow(windowDeps());
        createTray(appPaths, getUiLanguage);

        // Default-deny permission model (see electron/lib/permissions.cts). Only the main app window may write the clipboard.
        installPermissionHandlers(ctx);

        // Clipboard polling is not started here: it runs only while a renderer called startClipboardListener (T-114).
        // T-316: media polling (SMTC worker / osascript + video-URL scan) only while the media plugin is enabled or a PiP window is open.
        updateMediaDemand({ appPaths });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow(windowDeps());
        });

        // First quit waits (bounded) for the renderer to flush its debounced persist state; later quits pass through.
        app.on('before-quit', (event) => quitFlushGuard.onBeforeQuit(event));

        // R2-11: the quit cleanup sends items to the Recycle Bin asynchronously; hold the exit back (bounded) until it settled.
        app.on('will-quit', (event) => {
            const cleanup = waitForKoBoxCleanup();
            if (cleanup) {
                event.preventDefault();
                void cleanup.then(() => app.quit());
                return;
            }
            globalShortcut.unregisterAll();
            stopPsBridge();
            stopMediaPolling();
        });

        // T-309: the main-window blur handler that completes a pin request lives in electron/main/services/pin.cts.
        registerPinTargetingHandler();

        // T-307: the updater setup moved unchanged to electron/main/services/updater.cts.
        setupUpdater();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
