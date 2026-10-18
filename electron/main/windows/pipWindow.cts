// T-306: Picture-in-Picture window creation and its stale-close guard, moved unchanged out of main.cts. The PiP and main window
// references live in `appState`; paths, the dev-server switch and the media change filter are injected through `PipWindowDeps`.
import { app, BrowserWindow, screen } from 'electron';
import { secureWebPreferences } from '../../lib/webPrefs.cjs';
import type { createChangeFilter } from '../../lib/dedupe.cjs';
import type { AppPaths } from '../lib/appPaths.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import {
    PIP_WINDOW_HEIGHT,
    PIP_WINDOW_MIN_HEIGHT,
    PIP_WINDOW_MIN_WIDTH,
    PIP_WINDOW_SCREEN_MARGIN,
    PIP_WINDOW_WIDTH,
} from '../../../shared/geometry.js';

const isDev = !app.isPackaged;

export interface PipWindowDeps {
    appPaths: AppPaths;
    /** Dev-only: load the built dist/*.html instead of the Vite dev server (see main.cts). */
    loadsFromDist: boolean;
    mediaChangeFilter: ReturnType<typeof createChangeFilter>;
    /** T-316: called after a PiP window became the current one and after the current one closed (media polling demand). */
    onPipWindowChanged: () => void;
}

export function createPipWindow(deps: PipWindowDeps, videoUrl: string, title: string, _albumArt?: string | null) {
    const { appPaths, loadsFromDist, mediaChangeFilter, onPipWindowChanged } = deps;
    if (appState.pipWindow && !appState.pipWindow.isDestroyed()) {
        appState.pipWindow.close();
    }

    const pipWidth = PIP_WINDOW_WIDTH;
    const pipHeight = PIP_WINDOW_HEIGHT;

    // Position in the bottom-right corner of the primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: dX, y: dY, width: dW, height: dH } = primaryDisplay.workArea;
    const startX = dX + dW - pipWidth - PIP_WINDOW_SCREEN_MARGIN;
    const startY = dY + dH - pipHeight - PIP_WINDOW_SCREEN_MARGIN;

    // SEC-07: PiP gets its own narrow preload (close/move/media only), not the full window.api bridge.
    const pipPreloadPath = appPaths.pipPreload;

    const win = new BrowserWindow({
        x: startX,
        y: startY,
        width: pipWidth,
        height: pipHeight,
        minWidth: PIP_WINDOW_MIN_WIDTH,
        minHeight: PIP_WINDOW_MIN_HEIGHT,
        frame: false,
        transparent: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        hasShadow: true,
        backgroundColor: '#000000',
        icon: appPaths.iconPng,
        webPreferences: secureWebPreferences({
            preload: pipPreloadPath,
        }),
    });

    appState.pipWindow = win;
    // An open PiP shows the live track, so media polling must run (T-316).
    onPipWindowChanged();

    // Spoof user agent to bypass YouTube Error 153 (automation/webview block)
    win.webContents.userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    win.setAspectRatio(16 / 9);
    win.setAlwaysOnTop(true, topmostLevel(), 2);

    const encodedUrl = encodeURIComponent(videoUrl);
    const encodedTitle = encodeURIComponent(title);

    // ARC-22: PiP has its own lightweight entry (pip.html) without the app store/persist.
    if (isDev && !loadsFromDist) {
        win.loadURL(`http://localhost:5173/pip.html?url=${encodedUrl}&title=${encodedTitle}&platform=${process.platform}`);
    } else {
        win.loadFile(appPaths.pipHtml, {
            // MAC-022: the renderer sets <html data-platform> from this.
            query: { url: videoUrl, title, platform: process.platform },
        });
    }

    // Best-effort seed with the current track (T-136). The PiP preload listener may register right after this event, in
    // which case the PiP simply waits for the next media-update; it already starts from the title/art in its URL.
    win.webContents.on('did-finish-load', () => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        const last = mediaChangeFilter.last('media-update');
        if (last && last.payload) win.webContents.send('media-update', last.payload);
    });

    // A replaced window's late 'closed' event must not clear the newer window or announce a close (T-136).
    win.on('closed', () => {
        if (appState.pipWindow !== win) return;
        appState.pipWindow = null;
        if (appState.mainWindow && !appState.mainWindow.isDestroyed()) appState.mainWindow.webContents.send('pip-closed');
        onPipWindowChanged();
    });
}
