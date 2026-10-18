// T-605: the Settings window (UI-09, UI-16, K15). A SEPARATE, normal window (framed, titled, in the taskbar, resizable, never
// always-on-top) that hosts settings.html. Single instance: opening it again focuses the open one. It closes with the main window
// (and therefore with the app). The pure parts (frame options, page location, focus step) are electron/lib/settingsWindow.cts.
//
// Security: the same pinned webPreferences as every window (secureWebPreferences), the app-wide navigation / window-open / webview
// guard and the default-deny permission handlers (app/security.cts; the permission handlers grant nothing to this window, it is not
// the main window). T-606: its OWN narrow preload (electron/settings-preload.cts) exposes only `window.settingsBridge` (settings
// snapshots in, actions out; see windows/settingsSync.cts); never the main window preload, so no window.api, no storage channels,
// and it can neither read nor write persisted state. The window's menu is removed, so on Windows / Linux it has no Reload /
// Toggle DevTools accelerators (on macOS the app-wide menu is built by app/appMenu.cts, MAC-014: no Reload / DevTools in
// packaged builds). DevTools follow the same dev-only KOBAR_DEVTOOLS=1 opt-in as the main window.
//
// IPC: `settings:open` (fire and forget, optional page name) is accepted only from the main window's top frame. T-615: its sender
// is the claim-once host bridge `__kobarSettingsSync.claim().openSettings(page)` (nothing in window.api, nothing plugin-visible).
// A page of an already open window is pushed with `settings:show-page` (Settings window only). The T-606 state-sync channels are
// registered from here too (windows/settingsSync.cts).
import { app, BrowserWindow } from 'electron';
import { shouldOpenDevTools } from '../../lib/devTools.cjs';
import type { MainLang } from '../../lib/mainStrings.cjs';
import {
    canOpenSettingsWindow,
    raiseSettingsWindow,
    focusExistingWindow,
    isSettingsPageName,
    settingsPageLocation,
    settingsWindowFrameOptions,
    type SettingsPageName,
} from '../../lib/settingsWindow.cjs';
import { secureWebPreferences } from '../../lib/webPrefs.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import { SETTINGS_OPEN_OPTIONS } from '../ipc/schemas.cjs';
import type { AppPaths } from '../lib/appPaths.cjs';
import { appState } from '../state.cjs';
import { topmostLevel } from '../platform.cjs';
import { registerSettingsSyncIpc } from './settingsSync.cjs';

const isDev = !app.isPackaged;
const SETTINGS_LEVEL = topmostLevel();

/** Puts the open Settings window back in front of the bar (no focus change). Safe to call when none is open. */
export function raiseOpenSettingsWindow(): void {
    raiseSettingsWindow(appState.settingsWindow, SETTINGS_LEVEL);
}

/** Shows the window in front of KoBar and gives it focus. */
function bringSettingsToFront(win: BrowserWindow): void {
    focusExistingWindow(win);
    raiseSettingsWindow(win, SETTINGS_LEVEL);
}
const DEV_ORIGIN = 'http://localhost:5173';

export interface SettingsWindowDeps {
    appPaths: AppPaths;
    /** Dev-only: load the built dist/*.html instead of the Vite dev server (see main.cts). */
    loadsFromDist: boolean;
    /** The UI language of the main window (app/helpers.cts), passed to the page in its query. */
    getUiLanguage: () => Promise<MainLang>;
}

let settingsDeps: SettingsWindowDeps | null = null;
/** Set while a window is being created (the language read is async), so a second request does not create a second window. */
let opening: Promise<void> | null = null;

/** Opens the Settings window, or focuses it when it is already open. Never rejects. */
export function openSettingsWindow(page?: SettingsPageName): Promise<void> {
    const existing = appState.settingsWindow;
    if (existing && !existing.isDestroyed()) {
        bringSettingsToFront(existing);
        if (page) existing.webContents.send('settings:show-page', page);
        return Promise.resolve();
    }
    if (opening) return opening;
    if (!canOpenSettingsWindow(appState.mainWindow)) return Promise.resolve();
    if (!settingsDeps) {
        console.error('[KoBar] Settings window requested before it was configured.');
        return Promise.resolve();
    }
    const deps = settingsDeps;
    opening = createSettingsWindow(deps, page)
        .catch((err) => console.error('[KoBar] Failed to open the Settings window:', err))
        .finally(() => {
            opening = null;
        });
    return opening;
}

async function createSettingsWindow(deps: SettingsWindowDeps, page?: SettingsPageName): Promise<void> {
    const lang = await deps.getUiLanguage();
    // The main window may have closed during the language read: never create a window that would outlive it.
    if (!canOpenSettingsWindow(appState.mainWindow)) return;
    const existing = appState.settingsWindow;
    if (existing && !existing.isDestroyed()) {
        bringSettingsToFront(existing);
        if (page) existing.webContents.send('settings:show-page', page);
        return;
    }

    const win = new BrowserWindow({
        ...settingsWindowFrameOptions({ iconPath: deps.appPaths.iconPng, title: 'KoBar' }),
        // T-606: the narrow Settings preload only (window.settingsBridge), never the main window preload (see the header).
        webPreferences: secureWebPreferences({ preload: deps.appPaths.settingsPreload }),
    });
    appState.settingsWindow = win;
    // Windows / Linux: no File/Edit/View menu and none of its accelerators (Reload, Toggle DevTools), packaged builds included.
    // macOS uses the app-wide menu from app/appMenu.cts (MAC-014), which has no Reload / DevTools item in packaged builds.
    win.removeMenu();

    // The window closes with the main window (the app's lifetime), so it never outlives the sidebar.
    const mainWindow = appState.mainWindow;
    const closeWithMain = () => {
        if (!win.isDestroyed()) win.close();
    };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.once('closed', closeWithMain);

    win.once('ready-to-show', () => {
        if (!win.isDestroyed()) bringSettingsToFront(win);
    });
    // Another window of the app (the bar) was raised or clicked: the Settings window goes back in front.
    win.on('show', raiseOpenSettingsWindow);
    win.on('restore', raiseOpenSettingsWindow);

    win.on('closed', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeListener('closed', closeWithMain);
        if (appState.settingsWindow === win) appState.settingsWindow = null;
    });

    // Dev only: the same KOBAR_DEVTOOLS=1 opt-in as the main window.
    if (shouldOpenDevTools(app.isPackaged, process.env)) {
        win.webContents.once('did-finish-load', () => {
            if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' });
        });
    }

    const location = settingsPageLocation(
        { useDevServer: isDev && !deps.loadsFromDist, devOrigin: DEV_ORIGIN, platform: process.platform },
        lang,
        page
    );
    const loading =
        location.kind === 'url' ? win.loadURL(location.url) : win.loadFile(deps.appPaths.settingsHtml, { query: location.query });
    loading.catch((err) => console.error('[KoBar] Settings page failed to load:', err));
}

/**
 * Keeps the deps for openSettingsWindow(), registers `settings:open` (main window top frame only) and the T-606 state-sync
 * channels (windows/settingsSync.cts).
 */
export function registerSettingsWindowIpc(registry: IpcRegistry, deps: SettingsWindowDeps): void {
    settingsDeps = deps;
    registry.on('settings:open', SETTINGS_OPEN_OPTIONS, (_event, page) => {
        void openSettingsWindow(isSettingsPageName(page) ? page : undefined);
    });
    registerSettingsSyncIpc(registry);
}
