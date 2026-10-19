// T-309: pin-window feature, moved unchanged out of main.cts: pin targeting (blur of the main window while a target is awaited),
// the pinned-window tracker and its click-through border overlay (T-142 / T-146 / T-147), the pin IPC handlers and the persisted
// border style. All PowerShell work goes through the bridge API in ./native.cts; the pure helpers stay in electron/lib
// (pinBorder.cts, pinPosition.cts). `appState.isAwaitingPinTarget` is shared with the window modules (electron/main/state.cts).
import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron';
import * as path from 'path';
import { secureWebPreferences } from '../../lib/webPrefs.cjs';
import { parsePinPositionReply } from '../../lib/pinPosition.cjs';
import {
    type CssSlot,
    type PinBorderStyle,
    type PinRect,
    DEFAULT_PIN_BORDER_STYLE,
    PIN_BORDER_VISIBLE_CSS,
    PIN_BORDER_ZORDER_REFRESH_MS,
    PIN_STYLE_FILE_NAME,
    buildPinBorderPageUrl,
    buildPinBorderStyleCss,
    createCssSlot,
    createMotionDetector,
    isHiddenWindowRect,
    readPinStyleFile,
    rectsEqual,
    validatePinBorderStyle,
    writePinStyleFileAtomic,
} from '../../lib/pinBorder.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import { getUiLanguage } from '../app/helpers.cjs';
import { t } from '../../lib/mainStrings.cjs';
import { isPsAvailable, psRequest, psWrite, restartPsBridgeIfDown } from './native.cjs';

// MAC-055 (owner decision K-7): Pin Window is UNSUPPORTED on macOS (there is no public API to keep another app's window on top).
// enter-pin-targeting answers immediately with pinned-window-changed(null) + pin-targeting-complete so neither the plugin nor the
// host stays in targeting mode, shows one notice per session, and never touches KoBar's own window level or workspace behaviour.
// The unpin handlers are no-ops that only report "nothing pinned". Windows behaviour is unchanged.
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

let pinUnsupportedNoticeShown = false;

/** One native notice per app session explaining that pinning other windows is not available on macOS. */
function notifyPinUnsupportedOnce() {
    if (pinUnsupportedNoticeShown) return;
    pinUnsupportedNoticeShown = true;
    void (async () => {
        try {
            if (!Notification.isSupported()) return;
            const lang = await getUiLanguage();
            new Notification({ title: 'KoBar', body: t(lang, 'pinUnsupportedMac') }).show();
        } catch (e) {
            console.error('Pin notice failed:', e);
        }
    })();
}

// T-146: pin border colour/width, loaded once at startup by initPinBorderStyle() (missing/corrupt file -> default) and changed via set-pin-border-style.
let pinStylePath = '';
let pinBorderStyle: PinBorderStyle = DEFAULT_PIN_BORDER_STYLE;
let pinStyleUnsaved = false;

let trackRequestPending = false;
let borderWindow: BrowserWindow | null = null;
// T-146: the border's visibility and live style are inserted stylesheets (see electron/lib/pinBorder.cts).
let borderVisibilitySlot: CssSlot | null = null;
let borderStyleSlot: CssSlot | null = null;
const pinMotion = createMotionDetector();
let lastBorderZOrderAt = 0;
let screenToDipFailureLogged = false;

let trackingInterval: NodeJS.Timeout | null = null;
let pinnedHwnd: number | null = null;
const allPinnedHwnds: Set<number> = new Set();

/** Loads the persisted border style from `userDataPath`; called once from main.cts at the old module-load position. */
export function initPinBorderStyle(userDataPath: string) {
    pinStylePath = path.join(userDataPath, PIN_STYLE_FILE_NAME);
    pinBorderStyle = readPinStyleFile(pinStylePath);
}

/** Registers the main window blur listener that completes a pin request. Call from the app 'ready' callback, as before. */
export function registerPinTargetingHandler() {
    app.on('browser-window-blur', (_event, window) => {
        if (appState.isAwaitingPinTarget && window === appState.mainWindow) {
            appState.isAwaitingPinTarget = false;
            // Wait 200ms for the OS to fully focus the new third-party window
            setTimeout(() => {
                if (isWin) {
                    const psPinScript = (id: number) => `
                    $hwnd = [K]::GetForegroundWindow()
                    $GWL_EXSTYLE = -20
                    $WS_EX_TOPMOST = 0x0008
                    $HWND_TOPMOST = -1
                    $HWND_NOTOPMOST = -2
                    
                    $exStyle = [K]::GetWindowLong($hwnd, $GWL_EXSTYLE)
                    if (($exStyle -band $WS_EX_TOPMOST) -eq $WS_EX_TOPMOST) {
                        # Already TopMost, so UNPIN it
                        [K]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, 3)
                        Write-Output "${id}|UNPINNED:$hwnd"
                    } else {
                        # Not TopMost, so PIN it
                        [K]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, 3)
                        Write-Output "${id}|PINNED:$hwnd"
                    }
                    `;
                    if (isPsAvailable()) {
                        psRequest((id) => psPinScript(id) + '\n', { timeoutMs: 10000 }).then((output) => {
                            if (!output) return;
                            if (output.startsWith('PINNED:')) {
                                const hwnd = parseInt(output.split('PINNED:')[1].trim());
                                if (!Number.isFinite(hwnd)) return;
                                allPinnedHwnds.add(hwnd);
                                startWindowTracking(hwnd);
                            } else if (output.startsWith('UNPINNED:')) {
                                const hwnd = parseInt(output.split('UNPINNED:')[1].trim());
                                if (!Number.isFinite(hwnd)) return;
                                allPinnedHwnds.delete(hwnd);
                                if (pinnedHwnd === hwnd) stopWindowTracking();
                            }
                        });
                    }
                }
                if (isWin) appState.mainWindow?.webContents.send('pin-targeting-complete');
            }, 200);
        }
    });
}

/** Registers enter-pin-targeting, unpin-*, get/set-pin-border-style. */
export function registerPinIpc() {
    ipcMain.on('enter-pin-targeting', () => {
        if (isMac) {
            // MAC-055 / K-7: unsupported on macOS; report "nothing pinned", leave targeting mode, tell the user once.
            const win = appState.mainWindow;
            if (win && !win.isDestroyed()) {
                win.webContents.send('pinned-window-changed', null);
                win.webContents.send('pin-targeting-complete');
            }
            notifyPinUnsupportedOnce();
            return;
        }
        // T-317: a user action; if the PowerShell bridge gave up after crashes, give it one more (rate-limited) chance.
        if (isWin) restartPsBridgeIfDown();
        appState.isAwaitingPinTarget = true;
    });

    ipcMain.on('unpin-current-window', () => {
        if (isWin && pinnedHwnd) {
            const hwndToUnpin = pinnedHwnd;
            const psUnpinScript = `
        $hwnd = [IntPtr]${hwndToUnpin}
        $HWND_NOTOPMOST = -2
        [K]::SetWindowPos($hwnd, $HWND_NOTOPMOST, 0, 0, 0, 0, 3)
        `;
            if (isPsAvailable()) {
                psWrite(psUnpinScript + '\n');
            }
            allPinnedHwnds.delete(hwndToUnpin);
            stopWindowTracking();
        } else if (isMac && appState.mainWindow && !appState.mainWindow.isDestroyed()) {
            appState.mainWindow.webContents.send('pinned-window-changed', null);
        }
    });

    ipcMain.on('unpin-all-windows', () => {
        if (isWin && allPinnedHwnds.size > 0) {
            let psUnpinAllScript = '';
            allPinnedHwnds.forEach((hwnd) => {
                psUnpinAllScript += `[K]::SetWindowPos([IntPtr]${hwnd}, -2, 0, 0, 0, 0, 3)\n`;
            });
            if (isPsAvailable()) {
                psWrite(psUnpinAllScript + '\n');
            }
            allPinnedHwnds.clear();
            stopWindowTracking();
            // Reset frontend targeting state
            appState.mainWindow?.webContents.send('pin-targeting-complete');
        } else if (isMac && appState.mainWindow && !appState.mainWindow.isDestroyed()) {
            appState.mainWindow.webContents.send('pinned-window-changed', null);
        }
    });

    // T-146: host addition (not part of the v1 plugin contract). Only a validated `#RRGGBB` colour and an integer width 1-4
    // are accepted; anything else is rejected without side effects.
    ipcMain.handle('get-pin-border-style', () => ({ color: pinBorderStyle.color, width: pinBorderStyle.width }));

    ipcMain.handle('set-pin-border-style', (_event, input: unknown) => {
        const style = validatePinBorderStyle(input);
        if (!style) return { success: false, error: 'invalid-style' };
        // Unchanged and already on disk: no write (a caller looping on this cannot churn the file).
        if (!pinStyleUnsaved && style.color === pinBorderStyle.color && style.width === pinBorderStyle.width) return { success: true };
        pinBorderStyle = style;
        borderStyleSlot?.set(buildPinBorderStyleCss(style));
        pinStyleUnsaved = !writePinStyleFileAtomic(pinStylePath, style);
        return pinStyleUnsaved ? { success: false, error: 'persist-failed' } : { success: true };
    });
}

function destroyBorderWindow() {
    borderVisibilitySlot?.dispose();
    borderStyleSlot?.dispose();
    borderVisibilitySlot = null;
    borderStyleSlot = null;
    pinMotion.reset();
    if (borderWindow) {
        if (!borderWindow.isDestroyed()) borderWindow.destroy();
        borderWindow = null;
    }
}

/** Native rect (physical px) -> DIP. screenToDipRect handles mixed-DPI setups; the primary scale factor is a fallback. */
function physicalToDipRect(phys: PinRect): PinRect {
    try {
        if (isWin && typeof screen.screenToDipRect === 'function') {
            const r = screen.screenToDipRect(null, phys);
            return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        }
    } catch (err) {
        // Logged once: this runs on every 50 ms tracker tick.
        if (!screenToDipFailureLogged) console.error('[pin] screenToDipRect failed, using the primary scale factor:', err);
        screenToDipFailureLogged = true;
    }
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    return {
        x: Math.round(phys.x / sf),
        y: Math.round(phys.y / sf),
        width: Math.round(phys.width / sf),
        height: Math.round(phys.height / sf),
    };
}

/**
 * Moves the overlay onto the tracked rect; skips setBounds/setAlwaysOnTop when nothing changed (T-142). Compares with the
 * window's real bounds (not the last requested ones): on mixed-DPI setups Electron may adjust a window after setBounds,
 * and a mismatch must be re-applied on the next still tick.
 */
function applyBorderBounds(win: BrowserWindow, phys: PinRect) {
    const bounds = physicalToDipRect(phys);
    const now = Date.now();
    if (!rectsEqual(bounds, win.getBounds())) {
        win.setBounds(bounds);
    } else if (now - lastBorderZOrderAt < PIN_BORDER_ZORDER_REFRESH_MS) {
        return;
    }
    // Keep it above the pinned window even after that window is re-focused (both are topmost).
    win.setAlwaysOnTop(true, topmostLevel(), 1);
    lastBorderZOrderAt = now;
}

/** The pinned window exists but is not visible (minimized, hidden, cloaked): hide the border, keep tracking. */
function onPinnedHidden() {
    const win = borderWindow;
    if (!win || win.isDestroyed()) return;
    pinMotion.reset();
    borderVisibilitySlot?.set(null);
}

/** One tracker result: hidden while minimized or moving, fades back in once the window has been still. */
function onPinnedRect(phys: PinRect) {
    const win = borderWindow;
    if (!win || win.isDestroyed()) return;
    // Defensive second line: IsIconic -> HIDDEN already covers minimized windows (-32000 parking rect).
    if (isHiddenWindowRect(phys)) {
        pinMotion.reset();
        borderVisibilitySlot?.set(null);
        return;
    }
    const motion = pinMotion.update(phys);
    if (motion.state === 'moving') {
        // Hidden while moving/resizing; bounds are applied right before the fade-in.
        borderVisibilitySlot?.set(null);
        return;
    }
    applyBorderBounds(win, phys);
    if (motion.becameStill) borderVisibilitySlot?.set(PIN_BORDER_VISIBLE_CSS);
}

function startWindowTracking(hwnd: number) {
    destroyBorderWindow();
    if (trackingInterval) clearInterval(trackingInterval);

    pinnedHwnd = hwnd;
    appState.mainWindow?.webContents.send('pinned-window-changed', hwnd);

    borderWindow = new BrowserWindow({
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        webPreferences: secureWebPreferences(),
    });
    borderWindow.setIgnoreMouseEvents(true);
    borderWindow.showInactive();
    borderWindow.setAlwaysOnTop(true, topmostLevel(), 1);
    lastBorderZOrderAt = Date.now();
    // Static, script-free page that starts hidden; visibility and live style changes are inserted stylesheets.
    const wc = borderWindow.webContents;
    const pageReady = new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()));
    const cssOps = {
        insert: (css: string) => pageReady.then(() => wc.insertCSS(css)),
        remove: (key: string) => pageReady.then(() => wc.removeInsertedCSS(key)),
    };
    borderVisibilitySlot = createCssSlot(cssOps);
    borderStyleSlot = createCssSlot(cssOps);
    // A style change while the page loads goes through borderStyleSlot, which waits for did-finish-load.
    void borderWindow
        .loadURL(buildPinBorderPageUrl(pinBorderStyle))
        .catch((err) => console.error('[pin] border page failed to load:', err));

    trackingInterval = setInterval(() => {
        if (!borderWindow || !pinnedHwnd || borderWindow.isDestroyed()) return;
        // At most one outstanding position request: skip this tick while the previous is unanswered.
        if (trackRequestPending) return;
        const trackedHwnd = pinnedHwnd;
        if (isPsAvailable()) {
            trackRequestPending = true;
            psRequest(
                (id) =>
                    `
        $hwnd = [IntPtr]${trackedHwnd}
        if (-not [K]::IsWindow($hwnd)) {
            Write-Output "${id}|LOST"
        } else {
            $rect = New-Object K+RECT
            if ([K]::IsIconic($hwnd) -or -not [K]::IsWindowVisible($hwnd) -or [K]::IsCloaked($hwnd) -or -not [K]::GetVisibleRect($hwnd, [ref]$rect)) {
                Write-Output "${id}|HIDDEN"
            } else {
                Write-Output "${id}|POS:$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
            }
        }
        ` + '\n'
            )
                .then((output) => {
                    trackRequestPending = false;
                    if (!output || trackedHwnd !== pinnedHwnd) return;
                    // POS rects are the VISIBLE frame (DWM extended frame bounds) in PHYSICAL pixels; the process is per-monitor DPI aware.
                    const reply = parsePinPositionReply(output);
                    if (reply.kind === 'pos') {
                        onPinnedRect(reply.rect);
                    } else if (reply.kind === 'hidden') {
                        onPinnedHidden();
                    } else if (reply.kind === 'lost') {
                        stopWindowTracking();
                    }
                })
                .catch((err) => {
                    // E.g. setBounds on a window that is closing; never let it become an unhandled rejection.
                    trackRequestPending = false;
                    console.error('[pin]', err);
                });
        }
    }, 50);
}

function stopWindowTracking() {
    pinnedHwnd = null;
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
    destroyBorderWindow();
    appState.mainWindow?.webContents.send('pinned-window-changed', null);
}
