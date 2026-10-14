// T-315: the window / display IPC handlers that sat in main.cts, moved unchanged: set-ignore-mouse-events, recenter-window-on-widget,
// get-window-position-sync, get-displays-info, get-screen-bounds and update-sidebar-rect. main.cts registers them in two groups at the same
// two points as before (the mouse-event handler first, the others after the PiP handlers). T-320 added get-window-geometry to the second group.
// T-321 (window model A): on Windows get-window-geometry answers the CURRENT model (the display the window is fitted to), and
// recenter-window-on-widget / get-screen-bounds follow the display the window covers. macOS keeps the previous code paths.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { fitMainWindowToPoint, getMainWindowGeometry, handleWindowMove } from './mainWindow.cjs';
import { isMainWindowTopFrame } from '../app/helpers.cjs';
import { appState } from '../state.cjs';
import { rectCenter } from '../../lib/windowModel.cjs';
import { GHOST_WINDOW_WIDTH } from '../../../shared/geometry.js';
import type { IpcWindowGeometry } from '../../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };

const isWin = process.platform === 'win32';

// Write-only for now: kept because the preload API `updateSidebarRect` must remain (plugin contract).
let sidebarRect = { width: 80, height: 600, offsetX: 1660, offsetY: 20 };

export function registerMouseEventsIpc(): void {
    ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            win.setIgnoreMouseEvents(ignore, { forward: true });
        }
    });
}

export function registerWindowIpc(): void {
    ipcMain.handle('recenter-window-on-widget', async (event, relativeX, relativeY, width, height) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return null;

        const [winX, winY] = win.getPosition();
        const physicalX = winX + relativeX;
        const physicalY = winY + relativeY;

        if (isWin && win === appState.mainWindow) {
            // Window model A: the window covers the display the widget was dropped on; the widget keeps its screen position.
            const widgetCenter = { x: Math.round(physicalX + width / 2), y: Math.round(physicalY + height / 2) };
            const display = fitMainWindowToPoint(widgetCenter, 'recenter');
            const [fittedX, fittedY] = win.getPosition();
            handleWindowMove(true);
            const workArea = display ? display.workArea : screen.getDisplayNearestPoint(widgetCenter).workArea;
            return { x: physicalX - fittedX, y: physicalY - fittedY, displayBounds: workArea };
        }

        // Find nearest display to the widget center
        const activeDisplay = screen.getDisplayNearestPoint({
            x: Math.round(physicalX + width / 2),
            y: Math.round(physicalY + height / 2),
        });

        // Calculate new centered window position
        const windowWidth = GHOST_WINDOW_WIDTH;
        const newWinX = Math.floor(activeDisplay.workArea.x + activeDisplay.workArea.width / 2 - windowWidth / 2);
        const newWinY = activeDisplay.workArea.y;

        // Move the window
        win.setPosition(newWinX, newWinY);

        // Calculate new relative coordinates
        const newRelativeX = physicalX - newWinX;
        const newRelativeY = physicalY - newWinY;

        // Trigger edge-changed to update screen bounds in the frontend
        handleWindowMove(true);

        return { x: newRelativeX, y: newRelativeY, displayBounds: activeDisplay.workArea };
    });

    ipcMain.on('get-window-position-sync', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        event.returnValue = win ? win.getPosition() : [0, 0];
    });

    // T-320: read once, synchronously, by src/utils/windowGeometry.ts before the first layout. Only the main window's top frame gets
    // the values (the only renderer with the full preload); any other sender gets null. A sync sender blocks until returnValue is
    // set, so it is always set. T-321: the values are the current window model (main also pushes window-geometry-changed).
    ipcMain.on('get-window-geometry', (event) => {
        let result: IpcWindowGeometry | null = null;
        try {
            if (isMainWindowTopFrame(event)) result = getMainWindowGeometry();
            else console.warn('[KoBar] get-window-geometry rejected:', 'sender');
        } finally {
            event.returnValue = result;
        }
    });

    ipcMain.handle('get-displays-info', () => {
        return {
            primaryDisplay: screen.getPrimaryDisplay(),
            allDisplays: screen.getAllDisplays(),
        };
    });

    ipcMain.handle('get-screen-bounds', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && isWin) {
            // Window model A: the display under the window centre (both axes; the window covers that display).
            return screen.getDisplayNearestPoint(rectCenter(win.getBounds())).workArea;
        }
        if (win) {
            const [x] = win.getPosition();
            const [width] = win.getSize();
            const windowCenter = x + width / 2;
            const activeDisplay = screen.getDisplayNearestPoint({ x: windowCenter, y: 100 });
            return activeDisplay.workArea;
        }
        return screen.getPrimaryDisplay().workArea;
    });

    ipcMain.on('update-sidebar-rect', (_event, rect) => {
        sidebarRect = { ...sidebarRect, ...rect };
    });
}
