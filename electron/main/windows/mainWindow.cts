// T-306: main window creation and its window-level helpers (edge detection, teleport to the primary display), moved unchanged out of
// main.cts. The main window reference lives in `appState` (electron/main/state.cts); everything that main.cts owns (paths, the media
// change filter, the persist-flush request) is injected through `MainWindowDeps` so this module never uses `__dirname` itself.
// T-321 (window model A, ARC-02 / K16): on Windows the window no longer is a fixed 6000x4000 "ghost" window. It covers exactly the
// ACTIVE display (the display the bar lives on) and is re-fitted when displays change or the bar moves to another display. The pure
// part (display choice, target bounds, no-op detection) is electron/lib/windowModel.cts. macOS (and the unshipped Linux path) keep
// their previous behaviour unchanged.
import { app, BrowserWindow, Menu, MenuItem, powerMonitor, screen } from 'electron';
import * as fs from 'fs';
import { shouldOpenDevTools } from '../../lib/devTools.cjs';
import { secureWebPreferences } from '../../lib/webPrefs.cjs';
import type { createChangeFilter } from '../../lib/dedupe.cjs';
import { createTopmostKeeper, type TopmostKeeper } from '../../lib/topmostKeeper.cjs';
import {
    type DisplayLike,
    type WindowModelGeometry,
    type WindowPoint,
    findDisplayNearestPoint,
    geometryForDisplay,
    isUsableDisplay,
    pickActiveDisplay,
    planWindowFit,
    rectCenter,
    rectsEqual,
} from '../../lib/windowModel.cjs';
import type { AppPaths } from '../lib/appPaths.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import { raiseOpenSettingsWindow } from './settingsWindow.cjs';
import { FALLBACK_SCREEN_HEIGHT, FALLBACK_SCREEN_WIDTH, GHOST_WINDOW_WIDTH } from '../../../shared/geometry.js';
import type { IpcWindowGeometry } from '../../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isDev = !app.isPackaged;

export interface MainWindowDeps {
    appPaths: AppPaths;
    /** `<userData>/window-state.json`. */
    windowStatePath: string;
    /** Dev-only: load the built dist/*.html instead of the Vite dev server (see main.cts). */
    loadsFromDist: boolean;
    mediaChangeFilter: ReturnType<typeof createChangeFilter>;
    requestPersistFlush: () => Promise<boolean> | null;
}

let currentEdge: string = 'left';

// ─── Window model A (Windows only, T-321) ─────────────────────────────
/** The display the main window is fitted to (null before the first fit, and always null on macOS / Linux). */
let fittedGeometry: WindowModelGeometry | null = null;
/** True while Screenshot Studio has stretched the window over all displays: no re-fit may move it then. */
let modelSuspended = false;
/** A display change arrived while suspended: re-fit on resume. */
let refitPendingOnResume = false;
/** True while fitMainWindowToDisplay() itself moves the window (its own 'move' events are not a user move). */
let isFitting = false;
let displayListenersRegistered = false;
let displayRefitTimer: ReturnType<typeof setTimeout> | null = null;
let moveRefitTimer: ReturnType<typeof setTimeout> | null = null;
/** Display events come in bursts (a resolution change fires several); one re-fit after they settle. */
const DISPLAY_REFIT_DEBOUNCE_MS = 250;
/** When fitMainWindowToDisplay() last called setBounds (ms timestamp). */
let lastSetBoundsAt = 0;
/** A move re-fit is skipped this soon after a fit moved the window (anti ping-pong on mixed-DPI setups). */
const MOVE_REFIT_COOLDOWN_MS = 500;

/**
 * R-04: re-asserts the always-on-top level and raises the bar (moveTop, never focus) after anything that can push it behind other
 * windows. Skips while the user is picking a pin target or Screenshot Studio deliberately demoted the window.
 */
let topmostKeeper: TopmostKeeper | null = null;
/** Screen / power listeners are process-wide: registered once, they always talk to the current keeper. */
let topmostListenersRegistered = false;
function requestTopmost(reason: string): void {
    topmostKeeper?.request(reason);
}

/** MAC-015: true once the current main window passed ready-to-show (its own show / hidden-start decision has been made). */
let mainWindowReady = false;
export function isMainWindowReady(): boolean {
    return mainWindowReady;
}

export function createWindow(deps: MainWindowDeps) {
    const { appPaths, windowStatePath, loadsFromDist, mediaChangeFilter, requestPersistFlush } = deps;

    mainWindowReady = false;
    const primary = screen.getPrimaryDisplay();

    // Mac: use `bounds` (full screen incl. menu bar + Dock area) instead of `workArea`.
    // This prevents macOS from clipping the transparent window at the Dock boundary.
    const macScreen = isMac ? primary.bounds : primary.workArea;
    // Windows (T-321): the window covers the primary display, where ready-to-show teleports the bar on every launch anyway (the old
    // window-state.json position only lived until that teleport, so it is no longer read; it is still written below).
    fittedGeometry = null;
    const winModel = isWin && isUsableDisplay(primary) ? geometryForDisplay(primary) : null;
    const winWidth = winModel ? winModel.width : macScreen.width;
    const winHeight = winModel ? winModel.height : macScreen.height;
    const winX = winModel ? winModel.displayBounds.x : macScreen.x;
    const winY = winModel ? winModel.displayBounds.y : macScreen.y;

    appState.mainWindow = new BrowserWindow({
        x: winX,
        y: winY,
        width: winWidth,
        height: winHeight,
        // Windows: no minimum size, the window is re-fitted to displays of other sizes with setBounds.
        ...(isWin ? {} : { minWidth: winWidth, minHeight: winHeight }),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000', // Explicit transparent alpha channel to fix Windows DWM occlusion blurring
        alwaysOnTop: true,
        skipTaskbar: true,
        type: (isWin ? 'toolbar' : 'panel') as 'toolbar', // Win: toolbar (DWM throttle fix) | Mac: panel (NSPanel, floats above Dock)
        resizable: false,
        maximizable: false,
        hasShadow: isMac ? false : true, // Mac: prevent native shadow being cast on invisible transparent divs (ghost stroke)
        icon: appPaths.iconPng,
        webPreferences: secureWebPreferences({
            preload: appPaths.preload,
        }),
    });

    if (isWin) {
        // Re-apply through the window model (mixed-DPI setups can scale the constructor bounds) and follow display changes.
        fitMainWindowToDisplay(primary, 'create');
        registerDisplayListeners();
    } else if (isMac) {
        appState.mainWindow.setMinimumSize(winWidth, winHeight);
        appState.mainWindow.setSize(winWidth, winHeight);
    }
    // Win: screen-saver (highest DWM level) | Mac: floating (above Dock, below TCC prompts)
    appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
    if (isMac) {
        // Ensure KoBar stays above Dock, Mission Control overlays, and full-screen apps on macOS
        // MAC-015: skipTransformProcessType is deliberately NOT set (here and at ready-to-show). By default Electron transforms the process to UIElement (DockHide) on each call. Packaged builds are
        // already UIElement (LSUIElement, MAC-011), so it is a no-op there. Plain-Electron dev runs are not, and there the transform
        // hides the Dock icon and is what lets the window float over full-screen apps, so skipping it would break dev behaviour.
        appState.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        appState.mainWindow.setHiddenInMissionControl(true); // MAC-034: keep the full-screen transparent bar out of Mission Control / App Exposé
        appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1); // re-enforce after workspace registration
    }
    appState.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    setupTopmostKeeper();

    if (isDev && !loadsFromDist) {
        appState.mainWindow.loadURL('http://localhost:5173');
    } else {
        appState.mainWindow.loadFile(appPaths.indexHtml);
    }

    // Edge detection — fires during drag for smooth real-time updates
    appState.mainWindow.on('move', () => {
        handleWindowMove();
    });

    if (isWin) {
        // Window model A: when the window was moved onto another display (dragging the bar across monitors moves it with
        // move-window), it is re-fitted to that display.
        appState.mainWindow.on('move', () => {
            scheduleMoveRefit();
        });
    }

    // Dev only: KOBAR_DEVTOOLS=1 opens DevTools in a detached window (docked DevTools is unusable in this screen-sized transparent window).
    if (shouldOpenDevTools(app.isPackaged, process.env)) {
        appState.mainWindow.webContents.once('did-finish-load', () => appState.mainWindow?.webContents.openDevTools({ mode: 'detach' }));
    }

    // Fallback only: the main path is the renderer's `media-resync` request (it may subscribe after this event fires).
    appState.mainWindow.webContents.on('did-finish-load', () => mediaChangeFilter.reset());
    // T-321: a renderer reload during a Screenshot Studio session drops the overlay that would have ended it; leave the suspension
    // (a no-op when none is active) so the window is fitted to its display again.
    appState.mainWindow.webContents.on('did-finish-load', () => resumeMainWindowModel('renderer-reload'));

    if (isWin) {
        // Shutdown / restart / log-off may end the process without closing the window: flush persist state first.
        // Never preventDefault here; the user's session end is not delayed.
        const onSessionEnding = () => {
            void requestPersistFlush();
        };
        appState.mainWindow.on('query-session-end', onSessionEnding);
        appState.mainWindow.on('session-end', onSessionEnding);
    }

    appState.mainWindow.once('ready-to-show', () => {
        if (appState.mainWindow) {
            const loginSettings = app.getLoginItemSettings();
            const isHidden = process.argv.includes('--hidden') || loginSettings.wasOpenedAtLogin;

            // Teleport to center on fresh boot and force Mini Mode (pass showWindow flag based on args)
            teleportToPrimaryCenter(!isHidden);

            if (!isHidden) {
                appState.mainWindow.show();
            }
            appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
            if (isMac) {
                // Re-enforce workspace visibility after window is fully loaded
                appState.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                appState.mainWindow.setHiddenInMissionControl(true); // MAC-034: changing workspace behaviour can reset it
                appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
            }
            handleWindowMove(true);

            // Dispatch forcing Mini Mode right after load
            appState.mainWindow.webContents.send('force-center-mini-mode');
            mainWindowReady = true;
        }
    });

    let saveBoundsTimeout: ReturnType<typeof setTimeout>;
    appState.mainWindow.on('move', () => {
        clearTimeout(saveBoundsTimeout);
        saveBoundsTimeout = setTimeout(async () => {
            if (!appState.mainWindow) return;
            const [x, y] = appState.mainWindow.getPosition();
            try {
                await fs.promises.writeFile(windowStatePath, JSON.stringify({ x, y }));
            } catch (err) {
                console.error('Failed to save window state:', err);
            }
        }, 500);
    });

    // Re-enforce Always on Top when losing focus to taskbar (R-04: debounced, with moveTop, skipped while picking a pin target)
    appState.mainWindow.on('blur', () => requestTopmost('blur'));

    // Handle Context Menu for Copy/Paste in Notes
    appState.mainWindow.webContents.on('context-menu', (_event, params) => {
        const menu = new Menu();

        if (params.isEditable) {
            menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
            menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
            menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
            menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
            menu.append(new MenuItem({ type: 'separator' }));
            menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
        } else if (params.selectionText && params.selectionText.trim() !== '') {
            menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        }

        if (menu.items.length > 0) {
            menu.popup({ window: appState.mainWindow! });
        }
    });
}

/** R-04: creates the keeper for the current main window and subscribes to the events that can bury the bar. Idempotent per window. */
function setupTopmostKeeper(): void {
    const win = appState.mainWindow;
    if (!win) return;
    topmostKeeper?.stop();
    const keeper = createTopmostKeeper({
        getWindow: () => appState.mainWindow,
        shouldSkip: () => appState.isAwaitingPinTarget || modelSuspended,
        level: topmostLevel(),
        log: (m) => console.warn(m),
        // The Settings window stays in front of the bar while it is open.
        afterAssert: raiseOpenSettingsWindow,
    });
    topmostKeeper = keeper;
    keeper.start();
    win.on('show', () => requestTopmost('show'));
    win.on('restore', () => requestTopmost('restore'));
    win.on('focus', raiseOpenSettingsWindow);
    win.on('closed', () => {
        keeper.stop();
        if (topmostKeeper === keeper) topmostKeeper = null;
    });
    if (topmostListenersRegistered) return;
    topmostListenersRegistered = true;
    try {
        screen.on('display-added', () => requestTopmost('display-added'));
        screen.on('display-removed', () => requestTopmost('display-removed'));
        screen.on('display-metrics-changed', () => requestTopmost('display-metrics-changed'));
        powerMonitor.on('resume', () => requestTopmost('power-resume'));
        powerMonitor.on('unlock-screen', () => requestTopmost('unlock-screen'));
    } catch (err) {
        console.warn('[KoBar] topmost listeners could not be registered:', err);
    }
}

export function handleWindowMove(force = false) {
    if (!appState.mainWindow) return;
    let newEdge: 'left' | 'right';
    let bounds: Electron.Rectangle;
    if (isWin) {
        const detected = detectWindowsEdge();
        if (!detected) return;
        ({ edge: newEdge, workArea: bounds } = detected);
    } else {
        const [x] = appState.mainWindow.getPosition();
        const [width] = appState.mainWindow.getSize();
        const windowCenter = x + width / 2;
        const activeDisplay = screen.getDisplayNearestPoint({ x: windowCenter, y: 100 });
        bounds = activeDisplay.workArea;
        newEdge = windowCenter > bounds.x + bounds.width / 2 ? 'right' : 'left';
    }

    if (force || newEdge !== currentEdge) {
        currentEdge = newEdge;
        appState.mainWindow.webContents.send('edge-changed', newEdge, bounds);
    }

    // Off-screen clamping of the sidebar is intentionally disabled so the user can move
    // the window anywhere. (The unused clamp computation was removed in T-004.)
}

/**
 * Windows (T-321): the display under the window centre and the edge the window reports. A fitted window is centred on its display,
 * so it reports 'left' exactly like the always re-centred ghost window did; 'right' only when the window centre is right of both the
 * display's and the work area's centre (a window moved off-model, e.g. by a plugin's moveWindow).
 */
function detectWindowsEdge(): { edge: 'left' | 'right'; workArea: Electron.Rectangle } | null {
    const win = appState.mainWindow;
    if (!win || win.isDestroyed()) return null;
    try {
        const windowBounds = win.getBounds();
        const display = screen.getDisplayNearestPoint(rectCenter(windowBounds));
        const windowCenterX = windowBounds.x + windowBounds.width / 2;
        const boundsCenterX = display.bounds.x + display.bounds.width / 2;
        const workAreaCenterX = display.workArea.x + display.workArea.width / 2;
        const edge = windowCenterX > Math.max(boundsCenterX, workAreaCenterX) ? 'right' : 'left';
        return { edge, workArea: display.workArea };
    } catch (err) {
        console.warn('[KoBar] edge detection failed:', err);
        return null;
    }
}

// Calculates the ghost window (x, y) so it is perfectly centered horizontally
// and clamped to the top of the primary display. Used on tray show on macOS and Linux (Windows fits the window to the display, T-321).
function calculatePrimaryCenterPosition(): { x: number; y: number } {
    const primary = screen.getPrimaryDisplay();
    const wa = primary.workArea; // { x, y, width, height } in OS coords

    if (isMac) {
        return { x: wa.x, y: wa.y };
    }

    // Center the 6000x4000 ghost window horizontally, clamp vertically to top
    const windowWidth = GHOST_WINDOW_WIDTH;

    const x = Math.floor(wa.x + wa.width / 2 - windowWidth / 2);
    const y = wa.y;

    return { x, y };
}

export function teleportToPrimaryCenter(showWindow = true) {
    if (!appState.mainWindow) return;

    if (isWin) {
        // Window model A: cover the primary display. A teleport also ends a screenshot suspension that was never resumed.
        modelSuspended = false;
        refitPendingOnResume = false;
        try {
            fitMainWindowToDisplay(screen.getPrimaryDisplay(), 'teleport');
        } catch (err) {
            console.warn('[KoBar] teleport: primary display lookup failed:', err);
        }
    } else {
        const pos = calculatePrimaryCenterPosition();
        appState.mainWindow.setPosition(pos.x, pos.y);
    }

    if (showWindow) {
        appState.mainWindow.show();
        if (appState.mainWindow.isMinimized()) appState.mainWindow.restore();
        appState.mainWindow.setAlwaysOnTop(true, topmostLevel(), 1);
        appState.mainWindow.focus();
    }

    // Re-detect edge and send updated screen bounds to the frontend
    handleWindowMove(true);

    // Force the frontend to reset to Mini Mode and position perfectly at the center
    appState.mainWindow.webContents.send('force-center-mini-mode');
}

// ─── Window model A (Windows only, T-321) ─────────────────────────────

function toIpcWindowGeometry(geometry: WindowModelGeometry): IpcWindowGeometry {
    return {
        width: geometry.width,
        height: geometry.height,
        centerX: geometry.centerX,
        centerY: geometry.centerY,
        fallbackScreenWidth: FALLBACK_SCREEN_WIDTH,
        fallbackScreenHeight: FALLBACK_SCREEN_HEIGHT,
        displayId: geometry.displayId,
        displayBounds: { ...geometry.displayBounds },
        workArea: { ...geometry.workArea },
        scaleFactor: geometry.scaleFactor,
    };
}

function safeAllDisplays(): Electron.Display[] {
    try {
        return screen.getAllDisplays();
    } catch (err) {
        console.warn('[KoBar] display list unavailable:', err);
        return [];
    }
}

function safePrimaryId(): number | null {
    try {
        return screen.getPrimaryDisplay().id;
    } catch {
        return null;
    }
}

function safeCursorPoint(): WindowPoint | null {
    try {
        return screen.getCursorScreenPoint();
    } catch {
        return null;
    }
}

/**
 * The current window model for `get-window-geometry`: on Windows the display the window is fitted to; otherwise (macOS sizes the
 * window to the display at creation and its renderer keeps using window.innerWidth) the display under the window centre.
 * Null only when no display can be resolved.
 */
export function getMainWindowGeometry(): IpcWindowGeometry | null {
    if (isWin && fittedGeometry) return toIpcWindowGeometry(fittedGeometry);
    try {
        const win = appState.mainWindow;
        const display = win && !win.isDestroyed() ? screen.getDisplayNearestPoint(rectCenter(win.getBounds())) : screen.getPrimaryDisplay();
        return isUsableDisplay(display) ? toIpcWindowGeometry(geometryForDisplay(display)) : null;
    } catch (err) {
        console.warn('[KoBar] window geometry unavailable:', err);
        return null;
    }
}

function sendGeometryChanged(): void {
    const win = appState.mainWindow;
    if (!win || win.isDestroyed() || !fittedGeometry) return;
    try {
        win.webContents.send('window-geometry-changed', toIpcWindowGeometry(fittedGeometry));
    } catch (err) {
        console.warn('[KoBar] window-geometry-changed could not be sent:', err);
    }
}

/**
 * Windows: gives the main window exactly the display's bounds. Never throws: on failure the window gets its previous bounds back
 * and the model is not changed. Skips setBounds when the window already has the target bounds. Announces `window-geometry-changed`
 * when the model changed. Returns true when it changed.
 */
function fitMainWindowToDisplay(display: DisplayLike, reason: string): boolean {
    const win = appState.mainWindow;
    if (!isWin || !win || win.isDestroyed()) return false;
    if (!isUsableDisplay(display)) {
        console.warn('[KoBar] window re-fit skipped, unusable display:', reason);
        return false;
    }
    let previousBounds: Electron.Rectangle | null = null;
    try {
        previousBounds = win.getBounds();
    } catch {
        previousBounds = null;
    }
    const plan = planWindowFit(previousBounds, fittedGeometry, display);
    if (plan.needsSetBounds) {
        isFitting = true;
        lastSetBoundsAt = Date.now();
        try {
            win.setBounds(plan.target);
            // Mixed DPI: the first setBounds onto a display with another scale factor can come out scaled; re-apply once.
            if (!rectsEqual(win.getBounds(), plan.target)) win.setBounds(plan.target);
            if (!rectsEqual(win.getBounds(), plan.target)) console.warn('[KoBar] window re-fit landed off target:', reason);
        } catch (err) {
            console.warn('[KoBar] window re-fit failed, keeping the previous bounds:', reason, err);
            try {
                if (previousBounds) win.setBounds(previousBounds);
            } catch {
                // Nothing more to do; the window keeps whatever bounds it has.
            }
            return false;
        } finally {
            isFitting = false;
        }
    }
    fittedGeometry = plan.geometry;
    if (plan.geometryChanged) {
        console.log('[KoBar] main window fitted to display', plan.geometry.displayId, reason);
        sendGeometryChanged();
    }
    return plan.geometryChanged;
}

/**
 * Windows: fits the window to the active display (pickActiveDisplay: the bar point when given, else the fitted display while it
 * exists, else the display under the window centre, else the cursor's display, else the primary). Does nothing while suspended or
 * on other platforms. Never throws.
 */
function refitToActiveDisplay(reason: string, barPoint: WindowPoint | null = null): boolean {
    if (!isWin || modelSuspended) return false;
    const win = appState.mainWindow;
    if (!win || win.isDestroyed()) return false;
    try {
        const display = pickActiveDisplay({
            displays: safeAllDisplays(),
            barPoint,
            lastDisplayId: fittedGeometry?.displayId ?? null,
            windowPoint: rectCenter(win.getBounds()),
            cursorPoint: safeCursorPoint(),
            primaryId: safePrimaryId(),
        });
        if (!display) {
            console.warn('[KoBar] window re-fit skipped, no display:', reason);
            return false;
        }
        return fitMainWindowToDisplay(display, reason);
    } catch (err) {
        console.warn('[KoBar] window re-fit failed:', reason, err);
        return false;
    }
}

/**
 * Windows (recenter-window-on-widget): fits the window to the display under `point` (a screen point on the dropped widget) and
 * returns that display. While a screenshot session suspends the model nothing moves, the display is still returned. Null when no
 * display can be resolved (the caller then keeps the window where it is).
 */
export function fitMainWindowToPoint(point: WindowPoint, reason: string): Electron.Display | null {
    try {
        const display = pickActiveDisplay({
            displays: safeAllDisplays(),
            barPoint: point,
            lastDisplayId: fittedGeometry?.displayId ?? null,
            primaryId: safePrimaryId(),
        });
        if (display && isWin && !modelSuspended) fitMainWindowToDisplay(display, reason);
        return display;
    } catch (err) {
        console.warn('[KoBar] window fit to point failed:', reason, err);
        return null;
    }
}

function scheduleDisplayRefit(reason: string): void {
    if (displayRefitTimer) clearTimeout(displayRefitTimer);
    displayRefitTimer = setTimeout(() => {
        displayRefitTimer = null;
        try {
            if (modelSuspended) {
                refitPendingOnResume = true;
                return;
            }
            // A work-area-only change (taskbar moved or resized) changes the model without moving the window; edge-changed carries
            // the new work area to the renderer either way.
            refitToActiveDisplay(reason);
            handleWindowMove(true);
            requestTopmost(`${reason}-refit`);
        } catch (err) {
            console.warn('[KoBar] display change handling failed:', reason, err);
        }
    }, DISPLAY_REFIT_DEBOUNCE_MS);
}

function registerDisplayListeners(): void {
    if (displayListenersRegistered) return;
    displayListenersRegistered = true;
    try {
        screen.on('display-added', () => scheduleDisplayRefit('display-added'));
        screen.on('display-removed', () => scheduleDisplayRefit('display-removed'));
        screen.on('display-metrics-changed', () => scheduleDisplayRefit('display-metrics-changed'));
    } catch (err) {
        console.warn('[KoBar] display listeners could not be registered:', err);
    }
}

/**
 * Windows: after the window moved (not by a fit), re-fit it when its centre is now on another display than the fitted one. A move
 * within the same display (a plugin's moveWindow) is left alone, as before. Deferred so it runs outside the native move notification.
 */
function scheduleMoveRefit(): void {
    if (isFitting || modelSuspended || moveRefitTimer) return;
    moveRefitTimer = setTimeout(() => {
        moveRefitTimer = null;
        try {
            const win = appState.mainWindow;
            if (!win || win.isDestroyed() || modelSuspended) return;
            const center = rectCenter(win.getBounds());
            const display = findDisplayNearestPoint(safeAllDisplays(), center);
            if (!display || display.id === fittedGeometry?.displayId) return;
            // Anti ping-pong: a fit that just moved the window (mixed DPI can leave its centre on a neighbour) is not undone by
            // another move re-fit; the drop (recenter-window-on-widget) and display events still re-fit.
            if (Date.now() - lastSetBoundsAt < MOVE_REFIT_COOLDOWN_MS) return;
            refitToActiveDisplay('moved-to-display', center);
            requestTopmost('moved-to-display');
        } catch (err) {
            console.warn('[KoBar] move re-fit failed:', err);
        }
    }, 0);
}

/** Screenshot Studio stretches the window over all displays: no re-fit until resumeMainWindowModel(). Only Windows re-fits at all. */
export function suspendMainWindowModel(): void {
    modelSuspended = true;
}

/**
 * Ends a screenshot suspension (after the caller restored the window bounds) and re-fits the window to its display; that is a
 * no-op when nothing changed in between. Never throws.
 */
export function resumeMainWindowModel(reason: string): void {
    if (!modelSuspended) return;
    modelSuspended = false;
    const pending = refitPendingOnResume;
    refitPendingOnResume = false;
    try {
        if (refitToActiveDisplay(reason) || pending) handleWindowMove(true);
        requestTopmost(`${reason}-resume`);
    } catch (err) {
        console.warn('[KoBar] window model resume failed:', reason, err);
    }
}
