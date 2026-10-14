import { describe, expect, it } from 'vitest';
import {
    type DisplayLike,
    findDisplayNearestPoint,
    fitBoundsToDisplay,
    geometriesEqual,
    geometryForDisplay,
    isUsableDisplay,
    pickActiveDisplay,
    planWindowFit,
    rectCenter,
    rectsEqual,
} from '../electron/lib/windowModel.cjs';
import { readMainModule } from './helpers/mainSource';

// T-321 (window model A, ARC-02 / K16): on Windows the main window covers exactly the active display. The pure helpers are tested
// with fake displays (all rectangles in DIP, as Electron reports Display.bounds / workArea and BrowserWindow bounds); the wiring in
// electron/main/windows/mainWindow.cts, windowIpc.cts and services/screenshot.cts is checked at source level (the app is not booted).

function display(id: number, x: number, y: number, width: number, height: number, scaleFactor = 1, taskbar = 40): DisplayLike {
    return {
        id,
        bounds: { x, y, width, height },
        workArea: { x, y, width, height: height - taskbar },
        scaleFactor,
    };
}

const PRIMARY = display(1, 0, 0, 1920, 1080);
// A 4K display at 150 % to the LEFT of the primary (negative origin): 3840x2160 physical = 2560x1440 DIP.
const LEFT_HIDPI = display(2, -2560, -360, 2560, 1440, 1.5);
// A display stacked ABOVE the primary.
const ABOVE = display(3, 0, -1080, 1920, 1080, 1.25);

describe('pickActiveDisplay', () => {
    it('single display: always that display', () => {
        expect(pickActiveDisplay({ displays: [PRIMARY] })).toBe(PRIMARY);
        expect(pickActiveDisplay({ displays: [PRIMARY], barPoint: { x: 99999, y: -5 } })).toBe(PRIMARY);
        expect(pickActiveDisplay({ displays: [PRIMARY], lastDisplayId: 42, cursorPoint: { x: 10, y: 10 } })).toBe(PRIMARY);
    });

    it('the bar point wins over the last display and the cursor (dual, mixed DPI, negative origin)', () => {
        const displays = [PRIMARY, LEFT_HIDPI];
        expect(pickActiveDisplay({ displays, barPoint: { x: -100, y: 500 }, lastDisplayId: 1, cursorPoint: { x: 500, y: 500 } })).toBe(
            LEFT_HIDPI
        );
        expect(pickActiveDisplay({ displays, barPoint: { x: 100, y: 500 }, lastDisplayId: 2 })).toBe(PRIMARY);
        // Edges: the left display ends at x = -1 (right edge exclusive), the primary starts at 0.
        expect(pickActiveDisplay({ displays, barPoint: { x: -1, y: 0 } })).toBe(LEFT_HIDPI);
        expect(pickActiveDisplay({ displays, barPoint: { x: 0, y: 0 } })).toBe(PRIMARY);
    });

    it('a bar point between / outside displays resolves to the nearest display', () => {
        expect(pickActiveDisplay({ displays: [PRIMARY, LEFT_HIDPI], barPoint: { x: -3000, y: 0 } })).toBe(LEFT_HIDPI);
        expect(pickActiveDisplay({ displays: [PRIMARY, LEFT_HIDPI], barPoint: { x: 5000, y: 200 } })).toBe(PRIMARY);
        // Vertical stack: the y coordinate decides (the old main code looked at y = 100 only).
        expect(pickActiveDisplay({ displays: [PRIMARY, ABOVE], barPoint: { x: 960, y: -540 } })).toBe(ABOVE);
        expect(pickActiveDisplay({ displays: [PRIMARY, ABOVE], barPoint: { x: 960, y: 540 } })).toBe(PRIMARY);
    });

    it('without a bar point: the last fitted display while it exists, then the cursor, then the primary, then the first', () => {
        const displays = [PRIMARY, LEFT_HIDPI];
        expect(pickActiveDisplay({ displays, lastDisplayId: 2, cursorPoint: { x: 10, y: 10 }, primaryId: 1 })).toBe(LEFT_HIDPI);
        // Display 2 was removed: the cursor decides.
        expect(pickActiveDisplay({ displays: [PRIMARY, ABOVE], lastDisplayId: 2, cursorPoint: { x: 5, y: -5 }, primaryId: 1 })).toBe(ABOVE);
        // Removed and no cursor: the primary.
        expect(pickActiveDisplay({ displays: [ABOVE, PRIMARY], lastDisplayId: 2, primaryId: 1 })).toBe(PRIMARY);
        // Nothing known: the first display.
        expect(pickActiveDisplay({ displays: [ABOVE, PRIMARY] })).toBe(ABOVE);
    });

    it('the window centre comes after the last display and before the cursor', () => {
        // The fitted display still exists: it wins over the window centre.
        expect(pickActiveDisplay({ displays: [PRIMARY, LEFT_HIDPI], lastDisplayId: 1, windowPoint: { x: -100, y: 0 } })).toBe(PRIMARY);
        // The fitted display was removed and Windows moved the window: the window centre wins over the cursor.
        expect(
            pickActiveDisplay({
                displays: [PRIMARY, LEFT_HIDPI],
                lastDisplayId: 3,
                windowPoint: { x: -1280, y: 360 },
                cursorPoint: { x: 500, y: 500 },
                primaryId: 1,
            })
        ).toBe(LEFT_HIDPI);
        // No usable window centre: the cursor.
        expect(
            pickActiveDisplay({
                displays: [PRIMARY, LEFT_HIDPI],
                lastDisplayId: 3,
                windowPoint: { x: Number.NaN, y: 0 },
                cursorPoint: { x: -5, y: 5 },
                primaryId: 1,
            })
        ).toBe(LEFT_HIDPI);
        // The bar point still wins over everything.
        expect(
            pickActiveDisplay({
                displays: [PRIMARY, LEFT_HIDPI],
                barPoint: { x: 10, y: 10 },
                lastDisplayId: 2,
                windowPoint: { x: -10, y: 0 },
            })
        ).toBe(PRIMARY);
    });

    it('ignores non-finite inputs and unusable displays; null when no display is usable', () => {
        const broken = { id: 9, bounds: { x: 0, y: 0, width: 0, height: 1080 }, workArea: PRIMARY.workArea, scaleFactor: 1 };
        expect(isUsableDisplay(broken)).toBe(false);
        expect(pickActiveDisplay({ displays: [broken, PRIMARY], barPoint: { x: 1, y: 1 } })).toBe(PRIMARY);
        expect(pickActiveDisplay({ displays: [LEFT_HIDPI, PRIMARY], barPoint: { x: Number.NaN, y: 0 }, lastDisplayId: 1 })).toBe(PRIMARY);
        expect(pickActiveDisplay({ displays: [] })).toBeNull();
        expect(pickActiveDisplay({ displays: [broken] })).toBeNull();
    });
});

describe('findDisplayNearestPoint', () => {
    it('returns the containing display, else the nearest', () => {
        expect(findDisplayNearestPoint([PRIMARY, LEFT_HIDPI], { x: -10, y: 0 })).toBe(LEFT_HIDPI);
        expect(findDisplayNearestPoint([PRIMARY, LEFT_HIDPI], { x: 1920, y: 10 })).toBe(PRIMARY);
        expect(findDisplayNearestPoint([], { x: 0, y: 0 })).toBeNull();
    });
});

describe('fitBoundsToDisplay / geometryForDisplay', () => {
    it('the window bounds are exactly the display bounds (DIP), including negative origins', () => {
        expect(fitBoundsToDisplay(PRIMARY)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
        expect(fitBoundsToDisplay(LEFT_HIDPI)).toEqual({ x: -2560, y: -360, width: 2560, height: 1440 });
    });

    it('rounds fractional DIP values to whole pixels', () => {
        const odd = { id: 5, bounds: { x: 1920.4, y: 0.6, width: 1706.67, height: 960.2 }, workArea: PRIMARY.workArea, scaleFactor: 2.25 };
        expect(fitBoundsToDisplay(odd)).toEqual({ x: 1920, y: 1, width: 1707, height: 960 });
    });

    it('the model reports the window size, its centre and the display', () => {
        expect(geometryForDisplay(LEFT_HIDPI)).toEqual({
            displayId: 2,
            displayBounds: { x: -2560, y: -360, width: 2560, height: 1440 },
            workArea: { x: -2560, y: -360, width: 2560, height: 1400 },
            scaleFactor: 1.5,
            width: 2560,
            height: 1440,
            centerX: 1280,
            centerY: 720,
        });
        // Odd sizes: the centre is rounded down; a bad scale factor falls back to 1.
        const odd = display(7, 0, 0, 1365, 767, Number.NaN);
        expect(geometryForDisplay(odd)).toMatchObject({ centerX: 682, centerY: 383, scaleFactor: 1 });
    });
});

describe('planWindowFit (no-op detection)', () => {
    it('first fit: setBounds needed and the model changed', () => {
        const plan = planWindowFit({ x: 0, y: 0, width: 6000, height: 4000 }, null, PRIMARY);
        expect(plan).toMatchObject({ needsSetBounds: true, geometryChanged: true, target: { x: 0, y: 0, width: 1920, height: 1080 } });
    });

    it('already fitted: nothing to do', () => {
        const previous = geometryForDisplay(PRIMARY);
        const plan = planWindowFit({ x: 0, y: 0, width: 1920, height: 1080 }, previous, PRIMARY);
        expect(plan.needsSetBounds).toBe(false);
        expect(plan.geometryChanged).toBe(false);
        expect(geometriesEqual(plan.geometry, previous)).toBe(true);
    });

    it('taskbar moved / resized (work area only): no setBounds, but the model changed', () => {
        const previous = geometryForDisplay(PRIMARY);
        const plan = planWindowFit({ x: 0, y: 0, width: 1920, height: 1080 }, previous, display(1, 0, 0, 1920, 1080, 1, 60));
        expect(plan.needsSetBounds).toBe(false);
        expect(plan.geometryChanged).toBe(true);
    });

    it('DPI change on the same display (same DIP bounds, other scale factor): model changed', () => {
        const previous = geometryForDisplay(PRIMARY);
        const plan = planWindowFit({ x: 0, y: 0, width: 1920, height: 1080 }, previous, display(1, 0, 0, 1920, 1080, 1.25));
        expect(plan.needsSetBounds).toBe(false);
        expect(plan.geometryChanged).toBe(true);
    });

    it('moved to another display, or the window was scaled by a mixed-DPI move: setBounds needed', () => {
        const previous = geometryForDisplay(PRIMARY);
        expect(planWindowFit({ x: 0, y: 0, width: 1920, height: 1080 }, previous, LEFT_HIDPI)).toMatchObject({
            needsSetBounds: true,
            geometryChanged: true,
        });
        expect(planWindowFit({ x: 0, y: 0, width: 2880, height: 1620 }, previous, PRIMARY)).toMatchObject({
            needsSetBounds: true,
            geometryChanged: false,
        });
        expect(planWindowFit(null, previous, PRIMARY).needsSetBounds).toBe(true);
    });

    it('rectsEqual / rectCenter', () => {
        expect(rectsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
        expect(rectsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
        expect(rectsEqual(null, { x: 1, y: 2, width: 3, height: 4 })).toBe(false);
        expect(rectCenter({ x: -2560, y: -360, width: 2560, height: 1440 })).toEqual({ x: -1280, y: 360 });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Source-level wiring (the app cannot be booted in tests)
// ---------------------------------------------------------------------------------------------------------------------

/** Source without block and line comments. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** The body of `function <name>(` up to the next top-level closing brace. */
function functionBody(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start);
    return rest.slice(0, rest.search(/\n\}\n/) + 2);
}

describe('main window wiring (window model A)', () => {
    const mainWindow = code(readMainModule('windows/mainWindow.cts'));
    const windowIpc = code(readMainModule('windows/windowIpc.cts'));
    const screenshot = code(readMainModule('services/screenshot.cts'));
    const createWindow = functionBody(mainWindow, 'createWindow');

    it('has no larger-than-screen hack, no maximum / minimum ghost size and no saved ghost position', () => {
        expect(mainWindow).not.toMatch(/enableLargerThanScreen/);
        expect(mainWindow).not.toMatch(/setMaximumSize\(/);
        expect(mainWindow).not.toMatch(/GHOST_WINDOW_(HEIGHT|MAX_SIZE)|DEFAULT_RIGHT_DOCK_OFFSET_X/);
        expect(mainWindow).not.toMatch(/\b2960\b/);
        // macOS keeps its minimum size (only Windows drops it); the Windows window is fitted to the primary display at creation.
        expect(createWindow).toContain('...(isWin ? {} : { minWidth: winWidth, minHeight: winHeight })');
        expect(createWindow).toMatch(
            /if \(isWin\) \{\s+fitMainWindowToDisplay\(primary, 'create'\);\s+registerDisplayListeners\(\);\s+\} else if \(isMac\) \{\s+appState\.mainWindow\.setMinimumSize\(winWidth, winHeight\);\s+appState\.mainWindow\.setSize\(winWidth, winHeight\);/
        );
    });

    it('keeps the window options that are red lines (click-through, always on top, no taskbar, transparent, secure webPreferences)', () => {
        for (const option of [
            'frame: false,',
            'transparent: true,',
            "backgroundColor: '#00000000',",
            'alwaysOnTop: true,',
            'skipTaskbar: true,',
            'resizable: false,',
            'maximizable: false,',
            'webPreferences: secureWebPreferences({',
        ]) {
            expect(createWindow).toContain(option);
        }
        expect(createWindow).toContain('appState.mainWindow.setIgnoreMouseEvents(true, { forward: true });');
    });

    it('re-fits on display changes (debounced) and when the window lands on another display', () => {
        const listeners = functionBody(mainWindow, 'registerDisplayListeners');
        for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
            expect(listeners).toContain(`screen.on('${event}', () => scheduleDisplayRefit('${event}'))`);
        }
        expect(listeners).toMatch(/if \(displayListenersRegistered\) return;/);
        const displayRefit = functionBody(mainWindow, 'scheduleDisplayRefit');
        expect(displayRefit).toMatch(/clearTimeout\(displayRefitTimer\)/);
        expect(displayRefit).toMatch(/DISPLAY_REFIT_DEBOUNCE_MS/);
        expect(displayRefit).toMatch(/refitToActiveDisplay\(reason\);\s+handleWindowMove\(true\);/);
        expect(displayRefit).toMatch(/try \{[\s\S]*\} catch \(err\) \{/);
        expect(createWindow).toMatch(/if \(isWin\) \{[^}]*appState\.mainWindow\.on\('move', \(\) => \{\s+scheduleMoveRefit\(\);/);
        const moveRefit = functionBody(mainWindow, 'scheduleMoveRefit');
        expect(moveRefit).toMatch(/if \(isFitting \|\| modelSuspended \|\| moveRefitTimer\) return;/);
        expect(moveRefit).toMatch(/display\.id === fittedGeometry\?\.displayId\) return;/);
        // Anti ping-pong: no move re-fit within the cooldown after a fit moved the window.
        expect(moveRefit).toMatch(
            /if \(Date\.now\(\) - lastSetBoundsAt < MOVE_REFIT_COOLDOWN_MS\) return;\s+refitToActiveDisplay\('moved-to-display', center\);/
        );
        expect(mainWindow).toMatch(/const MOVE_REFIT_COOLDOWN_MS = 500;/);
        expect(functionBody(mainWindow, 'fitMainWindowToDisplay')).toMatch(/isFitting = true;\s+lastSetBoundsAt = Date\.now\(\);/);
        // Without a bar point the window centre is passed (after the last display, before the cursor).
        expect(functionBody(mainWindow, 'refitToActiveDisplay')).toMatch(
            /lastDisplayId: fittedGeometry\?\.displayId \?\? null,\s+windowPoint: rectCenter\(win\.getBounds\(\)\),\s+cursorPoint: safeCursorPoint\(\),/
        );
    });

    it('a renderer reload ends a screenshot suspension', () => {
        expect(createWindow).toContain(
            "appState.mainWindow.webContents.on('did-finish-load', () => resumeMainWindowModel('renderer-reload'));"
        );
        expect(functionBody(mainWindow, 'resumeMainWindowModel')).toMatch(/if \(!modelSuspended\) return;/);
    });

    it('fits through the pure planner, skips no-op setBounds, falls back to the previous bounds and announces changes', () => {
        const fit = functionBody(mainWindow, 'fitMainWindowToDisplay');
        expect(fit).toMatch(/if \(!isWin \|\| !win \|\| win\.isDestroyed\(\)\) return false;/);
        expect(fit).toContain('planWindowFit(previousBounds, fittedGeometry, display)');
        expect(fit).toMatch(/if \(plan\.needsSetBounds\) \{/);
        expect(fit).toMatch(/catch \(err\) \{[\s\S]*if \(previousBounds\) win\.setBounds\(previousBounds\);[\s\S]*return false;/);
        expect(fit).toMatch(/if \(plan\.geometryChanged\) \{[\s\S]*sendGeometryChanged\(\);/);
        expect(functionBody(mainWindow, 'sendGeometryChanged')).toContain(
            "win.webContents.send('window-geometry-changed', toIpcWindowGeometry(fittedGeometry))"
        );
    });

    it('teleport fits the primary display on Windows and keeps the old position code for macOS', () => {
        const teleport = functionBody(mainWindow, 'teleportToPrimaryCenter');
        expect(teleport).toMatch(
            /if \(isWin\) \{[\s\S]*fitMainWindowToDisplay\(screen\.getPrimaryDisplay\(\), 'teleport'\);[\s\S]*\} else \{\s+const pos = calculatePrimaryCenterPosition\(\);\s+appState\.mainWindow\.setPosition\(pos\.x, pos\.y\);/
        );
        const handleMove = functionBody(mainWindow, 'handleWindowMove');
        // The macOS / Linux edge detection is the previous code, unchanged.
        expect(handleMove).toContain('const activeDisplay = screen.getDisplayNearestPoint({ x: windowCenter, y: 100 });');
    });

    it('windowIpc: recenter-window-on-widget and get-screen-bounds follow the fitted display on Windows only', () => {
        const recenter = windowIpc.slice(windowIpc.indexOf("ipcMain.handle('recenter-window-on-widget'"));
        expect(recenter).toMatch(/if \(isWin && win === appState\.mainWindow\) \{[\s\S]*fitMainWindowToPoint\(widgetCenter, 'recenter'\)/);
        // The non-Windows branch is the previous code.
        expect(recenter).toContain('const windowWidth = GHOST_WINDOW_WIDTH;');
        const bounds = windowIpc.slice(windowIpc.indexOf("ipcMain.handle('get-screen-bounds'"));
        expect(bounds).toMatch(
            /if \(win && isWin\) \{\s+return screen\.getDisplayNearestPoint\(rectCenter\(win\.getBounds\(\)\)\)\.workArea;/
        );
    });

    it('Screenshot Studio suspends the model while the window spans all displays and resumes after restoring it', () => {
        const start = screenshot.slice(
            screenshot.indexOf("ipcMain.handle('start-screenshot-capture'"),
            screenshot.indexOf("ipcMain.on('cancel-screenshot'")
        );
        const suspend = start.indexOf('suspendMainWindowModel();');
        expect(suspend).toBeGreaterThan(-1);
        expect(suspend).toBeLessThan(start.indexOf('appState.mainWindow.setBounds({'));
        for (const channel of ['cancel-screenshot', 'screenshot-session-complete']) {
            const handler = screenshot.slice(screenshot.indexOf(`ipcMain.on('${channel}'`));
            expect(handler, channel).toMatch(
                /if \(preScreenshotBounds\) appState\.mainWindow\.setBounds\(preScreenshotBounds\);\s+resumeMainWindowModel\('screenshot-end'\);/
            );
        }
        // A failed capture restores the window and resumes the model, then still rejects the invoke.
        const failure = start.slice(start.indexOf('} catch (err) {'));
        expect(failure).toMatch(
            /if \(stretched && appState\.mainWindow && !appState\.mainWindow\.isDestroyed\(\)\) \{\s+try \{\s+if \(preScreenshotBounds\) appState\.mainWindow\.setBounds\(preScreenshotBounds\);\s+resumeMainWindowModel\('screenshot-error'\);\s+appState\.mainWindow\.show\(\);/
        );
        expect(failure).toMatch(/throw err;/);
        expect(start.indexOf('stretched = true;')).toBeGreaterThan(suspend);
        // Flash windows keep using the display bounds.
        expect(screenshot).toContain('w.setBounds(d.bounds);');
    });
});
