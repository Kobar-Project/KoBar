// T-310: Screenshot Studio capture, PrintScreen trigger and screenshot saving, moved unchanged out of main.cts. The capture rate
// limiter (SEC-16), the capture flash, the save-screenshot path-grant check (T-042) and every check order are as before. The live
// collaborators (path grants, protected roots, UI language, the IPC registry) are injected by main.cts so there is one source of truth.
// copy-screenshot-to-clipboard stays in ./clipboard.cts and is registered from the same position as before.
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell, systemPreferences } from 'electron';
import * as fs from 'fs';
import { exec } from 'child_process';
import { createCaptureLimiter } from '../../lib/captureLimiter.cjs';
import { screenshotDialogDefaultPath } from '../../lib/dialogPaths.cjs';
import { decodeImagePayload, isProtectedPath, normalizeImageFormat, validateScreenshotSave } from '../../lib/fileArgs.cjs';
import { type MainLang, t } from '../../lib/mainStrings.cjs';
import { secureWebPreferences } from '../../lib/webPrefs.cjs';
import type { PathGrants } from '../../lib/pathGrants.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import { SAVE_SCREENSHOT_OPTIONS } from '../ipc/schemas.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import { registerCopyScreenshotIpc } from './clipboard.cjs';
import { isPsAvailable, psWrite, restartPsBridgeIfDown } from './native.cjs';
import { notifyBlockedFileAccess } from './notifications.cjs';
import { resumeMainWindowModel, suspendMainWindowModel } from '../windows/mainWindow.cjs';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

export interface ScreenshotDeps {
    registry: IpcRegistry;
    pathGrants: PathGrants;
    /** The 'not-user-selected' reason string shared with the other path-grant checks in main.cts. */
    notUserSelected: string;
    getUiLanguage: () => Promise<MainLang>;
    getProtectedAppRoots: () => string[];
    getKoBoxRoots: () => string[];
}

let preScreenshotBounds: { x: number; y: number; width: number; height: number } | null = null;

// SEC-16: bound capture frequency (mitigation only, a same-realm plugin cannot be authenticated).
const captureLimiter = createCaptureLimiter();

// SEC-16: brief OS-level flash on every captured display so the user notices a capture happened.
// Frameless, transparent to mouse, never focused; destroyed after ~200 ms.
function flashDisplays(displays: Electron.Display[]) {
    for (const d of displays) {
        let flash: BrowserWindow | null = null;
        try {
            flash = new BrowserWindow({
                x: d.bounds.x,
                y: d.bounds.y,
                width: d.bounds.width,
                height: d.bounds.height,
                frame: false,
                transparent: false,
                backgroundColor: '#ffffff',
                resizable: false,
                movable: false,
                focusable: false,
                skipTaskbar: true,
                hasShadow: false,
                show: false,
                alwaysOnTop: true,
                webPreferences: secureWebPreferences(),
            });
            const w = flash;
            // Schedule cleanup first so a later failure cannot leak the window.
            setTimeout(() => {
                if (!w.isDestroyed()) w.destroy();
            }, 200);
            w.setBounds(d.bounds); // re-apply: mixed-DPI setups can scale the constructor bounds
            w.setIgnoreMouseEvents(true);
            w.setAlwaysOnTop(true, topmostLevel(), 2);
            w.setOpacity(0.3);
            w.showInactive();
            w.moveTop();
        } catch (err) {
            console.warn('[KoBar] capture flash failed:', err);
            if (flash && !flash.isDestroyed()) flash.destroy();
        }
    }
}

export function registerScreenshotIpc(deps: ScreenshotDeps) {
    const { registry, pathGrants, notUserSelected: NOT_USER_SELECTED, getUiLanguage, getProtectedAppRoots, getKoBoxRoots } = deps;

    // ─── Screenshot Studio: Custom In-App Capture ─────────────────────
    // Keep legacy trigger-screenshot for backward compat (e.g. PrintScreen key)
    ipcMain.on('trigger-screenshot', () => {
        if (isWin) {
            // T-317: a user action; if the PowerShell bridge gave up after crashes, give it one more (rate-limited) chance.
            // Right after such a restart the PrintScreen key event below waits in stdin behind the Add-Type compile of the fresh
            // bridge (a second or more), so the flash may come before the actual capture. Normal presses are unaffected.
            restartPsBridgeIfDown();
            // SEC-16: PrintScreen silently copies the full screen, so it shares the capture limit and is flashed too.
            if (isPsAvailable()) {
                if (!captureLimiter.tryAcquire().allowed) return;
                setTimeout(() => flashDisplays(screen.getAllDisplays()), 300);
                const psScreenshot = `
[K]::keybd_event(0x2C, 0, 0, 0)
[K]::keybd_event(0x2C, 0, 2, 0)
`;
                psWrite(psScreenshot + '\n');
            }
        } else if (isMac) {
            exec('screencapture -i -c');
        }
    });

    // Legacy take-screenshot kept for backward compatibility
    ipcMain.on('take-screenshot', (_event, hideApp) => {
        if (hideApp && appState.mainWindow) {
            appState.mainWindow.hide();
        }
        setTimeout(() => {
            if (isWin) {
                shell.openExternal('ms-screenclip:');
            } else if (isMac) {
                exec('screencapture -i -c', () => {
                    if (hideApp && appState.mainWindow) {
                        appState.mainWindow.show();
                        appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
                    }
                });
            }
        }, 150);
    });

    ipcMain.handle('start-screenshot-capture', async () => {
        const decision = captureLimiter.tryAcquire();
        if (!decision.allowed) {
            // Same shape as the existing 'permission_denied' return (empty captures + error); how Screenshot Studio
            // handles it has not been verified.
            return { captures: [], windowPosition: { x: 0, y: 0 }, error: 'rate_limited', retryAfterMs: decision.retryAfterMs };
        }

        // 0a. macOS Permission Check
        if (isMac) {
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            if (screenStatus !== 'granted') {
                const lang = await getUiLanguage();
                const response = await dialog.showMessageBox({
                    type: 'warning',
                    title: t(lang, 'screenRecordingTitle'),
                    message: t(lang, 'screenRecordingMessage'),
                    detail: t(lang, 'screenRecordingDetail'),
                    buttons: [t(lang, 'openSystemSettings'), t(lang, 'cancel')],
                    defaultId: 0,
                    cancelId: 1,
                });

                if (response.response === 0) {
                    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
                }

                // Abort gracefully
                return { captures: [], windowPosition: { x: 0, y: 0 }, error: 'permission_denied' };
            }
        }

        // 0b. Compute multi-monitor boundaries
        const displays = screen.getAllDisplays();
        let minX = displays[0].bounds.x,
            minY = displays[0].bounds.y;
        let maxX = displays[0].bounds.x + displays[0].bounds.width;
        let maxY = displays[0].bounds.y + displays[0].bounds.height;

        displays.forEach((d) => {
            if (d.bounds.x < minX) minX = d.bounds.x;
            if (d.bounds.y < minY) minY = d.bounds.y;
            if (d.bounds.x + d.bounds.width > maxX) maxX = d.bounds.x + d.bounds.width;
            if (d.bounds.y + d.bounds.height > maxY) maxY = d.bounds.y + d.bounds.height;
        });

        let captureData: { displayId: string; bounds: Electron.Rectangle; scaleFactor: number; imageDataUrl: string }[];
        let windowPos: number[];
        let stretched = false;
        try {
            // 1. Hide KoBar and temporarily resize it to cover ALL monitors seamlessly. T-321: the window model (Windows: the window covers
            //    the active display) is suspended until cancel-screenshot / screenshot-session-complete, so no display or move re-fit
            //    shrinks the window while the overlay needs all displays.
            if (appState.mainWindow) {
                suspendMainWindowModel();
                stretched = true;
                preScreenshotBounds = appState.mainWindow.getBounds();
                appState.mainWindow.setAlwaysOnTop(false); // DEMOTE BEFORE HIDE TO PREVENT BLACK SCREEN
                appState.mainWindow.setBounds({
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                });
                appState.mainWindow.hide();
            }

            // 2. Wait for the OS to fully render the desktop without KoBar
            await new Promise((resolve) => setTimeout(resolve, 200));

            // 3. Grab all displays
            // (displays already grabbed above)

            // 4. Capture all screens using desktopCapturer
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: {
                    // Use logical bounds instead of scaleFactor to prevent memory limits and empty thumbnails
                    width: Math.max(...displays.map((d) => d.bounds.width)),
                    height: Math.max(...displays.map((d) => d.bounds.height)),
                },
            });

            // 5. Build per-display capture data
            captureData = displays.map((display) => {
                // Correctly match the desktopCapturer screen source to the physical display
                let source = sources.find((s: any) => s.display_id === display.id.toString());
                // Fallback for edge-cases where ID parsing fails
                if (!source) {
                    source = sources.find((s: any) => s.name === `Screen ${display.id}`) || sources[0];
                }
                const thumbnail = source.thumbnail;

                if (thumbnail.isEmpty()) {
                    console.error(`[KoBar] WARNING: desktopCapturer returned empty thumbnail for display ${display.id}`);
                }

                return {
                    displayId: display.id.toString(),
                    bounds: display.bounds,
                    scaleFactor: display.scaleFactor,
                    imageDataUrl: thumbnail.toDataURL(),
                };
            });

            // 6. Get the window position for coordinate mapping
            //    The renderer needs this to position the overlay at the correct
            //    offset within the main window (now stretched over all displays).
            windowPos = appState.mainWindow ? appState.mainWindow.getPosition() : [0, 0];

            // 7. Show KoBar back so the overlay React component becomes visible
            if (appState.mainWindow) {
                appState.mainWindow.show();
                appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
            }
        } catch (err) {
            // T-321: a failed capture must not leave KoBar hidden, stretched over all displays and its window model suspended.
            // Restore it like cancel-screenshot does, then reject the invoke as before.
            console.error('[KoBar] screenshot capture failed:', err);
            if (stretched && appState.mainWindow && !appState.mainWindow.isDestroyed()) {
                try {
                    if (preScreenshotBounds) appState.mainWindow.setBounds(preScreenshotBounds);
                    resumeMainWindowModel('screenshot-error');
                    appState.mainWindow.show();
                    appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
                } catch (restoreErr) {
                    console.warn('[KoBar] window restore after a failed capture failed:', restoreErr);
                }
            }
            throw err;
        }

        // 7b. Visible indicator. Pixels are already grabbed, so the flash is not part of the capture;
        //     shown after KoBar is back so it stays on top.
        flashDisplays(displays);

        return {
            captures: captureData,
            windowPosition: { x: windowPos[0], y: windowPos[1] },
        };
    });

    // Cancel screenshot mode and restore KoBar
    ipcMain.on('cancel-screenshot', () => {
        if (appState.mainWindow) {
            if (preScreenshotBounds) appState.mainWindow.setBounds(preScreenshotBounds);
            // T-321: back on the window model; re-fits only if the displays changed during the session.
            resumeMainWindowModel('screenshot-end');
            appState.mainWindow.show();
            appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
        }
    });

    // Save screenshot to file
    registry.handle(
        'save-screenshot',
        SAVE_SCREENSHOT_OPTIONS,
        async (_event, data: { buffer: string; format: string; destinationPath?: string; defaultPath?: string }) => {
            const { buffer, destinationPath } = data ?? ({} as typeof data);
            // Only image formats are accepted; the decoded bytes must match the target extension (SEC-02).
            const format = normalizeImageFormat(data?.format);
            if (!format) return { success: false, reason: 'invalid-format' };
            const imageBuffer = decodeImagePayload(buffer);
            if (!imageBuffer) return { success: false, reason: 'invalid-image-data' };

            let savePath = destinationPath;

            if (savePath) {
                // T-042: a renderer-supplied destinationPath must be exactly a path the user dropped / picked. This
                // in-memory check runs BEFORE any validation that touches the file system (lstat on a UNC/SMB path
                // could reach the network); every T-109 check below still runs afterwards.
                if (!pathGrants.isGranted(savePath)) {
                    notifyBlockedFileAccess('save-screenshot');
                    return { success: false, reason: NOT_USER_SELECTED };
                }
            } else {
                // The save dialog below is opened by main itself, so its result is user-chosen and needs no grant.
                // Temporarily disable alwaysOnTop to ensure the dialog appears ON TOP of the screen-filler ghost window
                if (appState.mainWindow) appState.mainWindow.setAlwaysOnTop(false);

                // Open native save dialog as fallback
                const result = await dialog.showSaveDialog(appState.mainWindow!, {
                    title: 'Save Screenshot',
                    // T-042: the renderer-supplied folder is only used when it is a plain local path (no UNC/device/ADS);
                    // otherwise the dialog opens on the desktop.
                    defaultPath: screenshotDialogDefaultPath(
                        data.defaultPath,
                        app.getPath('desktop'),
                        `KoBar_Screenshot_${Date.now()}.${format}`
                    ),
                    filters: [{ name: 'Images', extensions: [format] }],
                });

                // Restore alwaysOnTop
                if (appState.mainWindow) appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);

                if (result.canceled || !result.filePath) return { success: false, reason: 'cancelled' };
                savePath = result.filePath;
            }

            // Check-then-write: a link swapped in after this check is not detected (no O_NOFOLLOW on Windows).
            const check = validateScreenshotSave(savePath, imageBuffer);
            if (!check.ok) {
                console.error('Screenshot save rejected:', check.reason);
                return { success: false, reason: check.reason };
            }
            if (isProtectedPath(savePath, getProtectedAppRoots(), getKoBoxRoots())) {
                console.error('Screenshot save rejected: target inside application data');
                return { success: false, reason: 'target-inside-app-data' };
            }

            try {
                await fs.promises.writeFile(savePath, imageBuffer);
                return { success: true, path: savePath };
            } catch (e) {
                console.error('Screenshot save error:', e);
                return { success: false, reason: String(e) };
            }
        }
    );

    // Copy screenshot to system clipboard (T-308: handler lives in electron/main/services/clipboard.cts)
    registerCopyScreenshotIpc();

    // Restore KoBar window after screenshot session finishes
    ipcMain.on('screenshot-session-complete', () => {
        if (appState.mainWindow) {
            if (preScreenshotBounds) appState.mainWindow.setBounds(preScreenshotBounds);
            // T-321: back on the window model; re-fits only if the displays changed during the session.
            resumeMainWindowModel('screenshot-end');
            appState.mainWindow.show();
            appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
        }
    });
}
