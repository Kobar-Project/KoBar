// T-605: the pure parts of the Settings window (UI-09, UI-16, K15): its frame options, the page it loads (Vite dev server URL or the
// bundled settings.html with a query) and the "focus the open one" step of the single-instance rule. No Electron runtime import
// (types only), so tests/settingsWindow.test.ts covers it without launching Electron. electron/main/windows/settingsWindow.cts wires it.
import type { BrowserWindowConstructorOptions } from 'electron';
import type { TopmostLevel } from './platform.cjs';

export const SETTINGS_WINDOW_WIDTH = 920;
export const SETTINGS_WINDOW_HEIGHT = 640;
export const SETTINGS_WINDOW_MIN_WIDTH = 640;
export const SETTINGS_WINDOW_MIN_HEIGHT = 440;
/** The dark shell token (--kb-bg-shell in src/index.css), so the first paint does not flash white. */
export const SETTINGS_WINDOW_BACKGROUND = '#1f1f1f';
/** The page of the Settings window: settings.html (Vite input `settings`, built to dist/settings.html). */
export const SETTINGS_PAGE_FILE = 'settings.html';

/** Everything but webPreferences: the BrowserWindow call adds `webPreferences: secureWebPreferences(...)` itself (tests/webPrefs.test.ts). */
export type SettingsWindowFrameOptions = Omit<BrowserWindowConstructorOptions, 'webPreferences'>;

/**
 * A normal application window: framed, titled, resizable, in the taskbar, never always-on-top, never transparent. Opens centred
 * (no position is remembered: neither the main window nor the PiP window restores a saved position or size). `show: false`
 * until ready-to-show avoids an empty frame.
 */
export function settingsWindowFrameOptions(input: { iconPath: string; title: string }): SettingsWindowFrameOptions {
    return {
        width: SETTINGS_WINDOW_WIDTH,
        height: SETTINGS_WINDOW_HEIGHT,
        minWidth: SETTINGS_WINDOW_MIN_WIDTH,
        minHeight: SETTINGS_WINDOW_MIN_HEIGHT,
        center: true,
        title: input.title,
        icon: input.iconPath,
        show: false,
        frame: true,
        transparent: false,
        resizable: true,
        minimizable: true,
        maximizable: true,
        fullscreenable: false,
        alwaysOnTop: false,
        skipTaskbar: false,
        backgroundColor: SETTINGS_WINDOW_BACKGROUND,
    };
}

export interface SettingsPageEnv {
    /** True only in a dev run that loads the Vite dev server (isDev && !loadsFromDist). */
    useDevServer: boolean;
    /** Vite dev server origin, e.g. http://localhost:5173. */
    devOrigin: string;
    /** MAC-022: process.platform, passed as `platform` so the page can set <html data-platform> before its first paint. Absent = not passed. */
    platform?: string;
}

export type SettingsPageLocation = { kind: 'url'; url: string } | { kind: 'file'; query: Record<string, string> };

/**
 * The pages the main window may ask the Settings window to show (T-615). Must equal SETTINGS_PAGES in src/settings/pages.ts
 * (tests/settingsWindow.test.ts compares them); the electron side cannot import the renderer.
 */
export const SETTINGS_PAGE_IDS = ['general', 'appearance', 'sidebar', 'plugins', 'workspaces', 'backup', 'integrations', 'about'] as const;
export type SettingsPageName = (typeof SETTINGS_PAGE_IDS)[number];

export function isSettingsPageName(value: unknown): value is SettingsPageName {
    return typeof value === 'string' && (SETTINGS_PAGE_IDS as readonly string[]).includes(value);
}

/**
 * Where the window loads its page. The UI language goes in the query (`lang`), and an optional start page (`page`, T-615); the
 * page validates both again.
 */
export function settingsPageLocation(env: SettingsPageEnv, lang: string, page?: SettingsPageName): SettingsPageLocation {
    if (env.useDevServer) {
        const url = new URL(`/${SETTINGS_PAGE_FILE}`, env.devOrigin);
        url.searchParams.set('lang', lang);
        if (page) url.searchParams.set('page', page);
        if (env.platform) url.searchParams.set('platform', env.platform);
        return { kind: 'url', url: url.href };
    }
    return { kind: 'file', query: { lang, ...(page ? { page } : {}), ...(env.platform ? { platform: env.platform } : {}) } };
}

/** The part of a BrowserWindow the lifetime check uses. */
export interface LifetimeWindow {
    isDestroyed(): boolean;
}

/**
 * The Settings window may only exist while the main window does (it closes with it), so it is never created without a live main
 * window: checked before and again after the async language read.
 */
export function canOpenSettingsWindow(mainWindow: LifetimeWindow | null | undefined): boolean {
    return !!mainWindow && !mainWindow.isDestroyed();
}

/** The part of a BrowserWindow the single-instance step uses. */
export interface FocusableWindow {
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
}

/** The part of a BrowserWindow the always-in-front step uses. */
export interface RaisableWindow {
    isDestroyed(): boolean;
    isVisible(): boolean;
    isMinimized(): boolean;
    setAlwaysOnTop(flag: boolean, level?: TopmostLevel, relativeLevel?: number): void;
    moveTop(): void;
}

/**
 * While the Settings window is open it stays in front of the bar, the notes panel and the plugin panels (all of them live in or
 * above the always-on-top band of the main window). Same level as the main window, one relative level above it, and moveTop()
 * (never focus(), so no focus is stolen) because Windows orders windows of one band by recency. Hidden or minimized windows are
 * left alone. Returns true when it touched the window.
 */
export function raiseSettingsWindow(win: RaisableWindow | null | undefined, level: TopmostLevel): boolean {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
    win.setAlwaysOnTop(true, level, 2);
    win.moveTop();
    return true;
}

/** Re-opening the Settings window brings the existing one to the front instead of creating a second one. */
export function focusExistingWindow(win: FocusableWindow): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}
