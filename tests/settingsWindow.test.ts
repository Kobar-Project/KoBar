import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedNavigation } from '../electron/lib/navigation.cjs';
import {
    SETTINGS_PAGE_IDS,
    SETTINGS_WINDOW_BACKGROUND,
    SETTINGS_WINDOW_MIN_HEIGHT,
    SETTINGS_WINDOW_MIN_WIDTH,
    canOpenSettingsWindow,
    focusExistingWindow,
    isSettingsPageName,
    settingsPageLocation,
    settingsWindowFrameOptions,
} from '../electron/lib/settingsWindow.cjs';
import { SETTINGS_PAGES } from '../src/settings/pages';
import { createAppPaths } from '../electron/main/lib/appPaths.cjs';
import { type IpcMainLike, createIpcRegistry } from '../electron/main/ipc/registry.cjs';
import { SETTINGS_OPEN_OPTIONS } from '../electron/main/ipc/schemas.cjs';
import { readMainModule } from './helpers/mainSource';

// T-605: the Settings window. Pure parts (frame options, page location, focus step), the settings:open sender policy and
// source checks for the wiring that needs Electron (the window itself is never launched in tests).

const DEV_ORIGIN = 'http://localhost:5173';

function readRepoFile(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

/** Source without whole-line comments. */
function withoutComments(text: string): string {
    return text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
}

describe('settingsWindowFrameOptions', () => {
    const options = settingsWindowFrameOptions({ iconPath: '/x/icon.png', title: 'KoBar' });

    it('is a normal window: framed, titled, resizable, in the taskbar, never always-on-top or transparent', () => {
        expect(options).toMatchObject({
            frame: true,
            transparent: false,
            resizable: true,
            minimizable: true,
            maximizable: true,
            alwaysOnTop: false,
            skipTaskbar: false,
            title: 'KoBar',
            icon: '/x/icon.png',
        });
        expect(options).not.toHaveProperty('type');
        expect(options).not.toHaveProperty('parent');
    });

    it('opens hidden until ready-to-show, centred, with a minimum size and the dark shell background', () => {
        expect(options.show).toBe(false);
        expect(options.center).toBe(true);
        expect(options).not.toHaveProperty('x');
        expect(options).not.toHaveProperty('y');
        expect(options.minWidth).toBe(SETTINGS_WINDOW_MIN_WIDTH);
        expect(options.minHeight).toBe(SETTINGS_WINDOW_MIN_HEIGHT);
        expect(options.width!).toBeGreaterThanOrEqual(SETTINGS_WINDOW_MIN_WIDTH);
        expect(options.height!).toBeGreaterThanOrEqual(SETTINGS_WINDOW_MIN_HEIGHT);
        expect(options.backgroundColor).toBe(SETTINGS_WINDOW_BACKGROUND);
    });

    it('carries no webPreferences (the BrowserWindow call adds the pinned secureWebPreferences itself)', () => {
        expect(options).not.toHaveProperty('webPreferences');
    });
});

describe('settingsPageLocation', () => {
    it('dev server: settings.html on the dev origin with the language in the query', () => {
        const location = settingsPageLocation({ useDevServer: true, devOrigin: DEV_ORIGIN }, 'tr');
        expect(location).toEqual({ kind: 'url', url: 'http://localhost:5173/settings.html?lang=tr' });
    });

    it('built page: the file with the language as query', () => {
        expect(settingsPageLocation({ useDevServer: false, devOrigin: DEV_ORIGIN }, 'de')).toEqual({ kind: 'file', query: { lang: 'de' } });
    });

    it('adds an optional start page (T-615), dev and built', () => {
        expect(settingsPageLocation({ useDevServer: true, devOrigin: DEV_ORIGIN }, 'tr', 'plugins')).toEqual({
            kind: 'url',
            url: 'http://localhost:5173/settings.html?lang=tr&page=plugins',
        });
        expect(settingsPageLocation({ useDevServer: false, devOrigin: DEV_ORIGIN }, 'de', 'about')).toEqual({
            kind: 'file',
            query: { lang: 'de', page: 'about' },
        });
    });

    it('SETTINGS_PAGE_IDS equals the renderer pages and rejects anything else', () => {
        expect([...SETTINGS_PAGE_IDS]).toEqual(SETTINGS_PAGES.map((page) => page.id));
        expect(isSettingsPageName('plugins')).toBe(true);
        for (const bad of ['', 'nope', 'PLUGINS', 1, null, undefined, {}]) expect(isSettingsPageName(bad)).toBe(false);
    });

    it('encodes the language value', () => {
        const location = settingsPageLocation({ useDevServer: true, devOrigin: DEV_ORIGIN }, 'a&b=c');
        expect(location.kind === 'url' && new URL(location.url).searchParams.get('lang')).toBe('a&b=c');
    });

    it('the dev URL passes the navigation guard', () => {
        const location = settingsPageLocation({ useDevServer: true, devOrigin: DEV_ORIGIN }, 'en');
        expect(location.kind).toBe('url');
        if (location.kind !== 'url') return;
        expect(isAllowedNavigation(location.url, { isDev: true, devOrigin: DEV_ORIGIN, appFileUrls: [] })).toBe(true);
    });
});

describe('settings.html in the app paths and the navigation guard', () => {
    const base = nodePath.join('X:', 'app', 'dist-electron');
    const paths = createAppPaths(base);

    it('the built page sits next to index.html and pip.html', () => {
        expect(paths.settingsHtml).toBe(nodePath.join(base, '../dist/settings.html'));
        expect(nodePath.dirname(paths.settingsHtml)).toBe(nodePath.dirname(paths.indexHtml));
    });

    it('a prod navigation to settings.html (with query) is allowed only when it is in the app file list', () => {
        const target = `${pathToFileURL(paths.settingsHtml).href}?lang=tr`;
        const withSettings = [paths.indexHtml, paths.pipHtml, paths.settingsHtml].map((file) => pathToFileURL(file).href);
        const withoutSettings = withSettings.slice(0, 2);
        expect(isAllowedNavigation(target, { isDev: false, devOrigin: DEV_ORIGIN, appFileUrls: withSettings })).toBe(true);
        expect(isAllowedNavigation(target, { isDev: false, devOrigin: DEV_ORIGIN, appFileUrls: withoutSettings })).toBe(false);
    });

    it('app/security.cts lists settings.html for the navigation guard and the CSP diagnostics', () => {
        const security = withoutComments(readMainModule('app/security.cts'));
        expect(security).toMatch(/NAV_APP_FILE_URLS = \[appPaths\.indexHtml, appPaths\.pipHtml, appPaths\.settingsHtml\]/);
        expect(security).toContain("base.endsWith('/dist/settings.html')");
    });

    it('vite builds settings.html as its own entry', () => {
        expect(readRepoFile('vite.config.ts')).toMatch(/settings: resolve\(rootDir, 'settings\.html'\)/);
        expect(readRepoFile('settings.html')).toContain('src="/src/settings/main.tsx"');
    });
});

describe('focusExistingWindow (single instance)', () => {
    const fakeWindow = (minimized: boolean) => ({
        isMinimized: vi.fn(() => minimized),
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
    });

    it('restores a minimized window, then shows and focuses it', () => {
        const win = fakeWindow(true);
        focusExistingWindow(win);
        expect(win.restore).toHaveBeenCalledTimes(1);
        expect(win.show).toHaveBeenCalledTimes(1);
        expect(win.focus).toHaveBeenCalledTimes(1);
    });

    it('does not restore a window that is not minimized', () => {
        const win = fakeWindow(false);
        focusExistingWindow(win);
        expect(win.restore).not.toHaveBeenCalled();
        expect(win.focus).toHaveBeenCalledTimes(1);
    });
});

describe('canOpenSettingsWindow (never outlives the main window)', () => {
    it('needs a live main window', () => {
        expect(canOpenSettingsWindow({ isDestroyed: () => false })).toBe(true);
        expect(canOpenSettingsWindow({ isDestroyed: () => true })).toBe(false);
        expect(canOpenSettingsWindow(null)).toBe(false);
        expect(canOpenSettingsWindow(undefined)).toBe(false);
    });

    it('is checked before opening and again after the async language read', () => {
        const source = withoutComments(readMainModule('windows/settingsWindow.cts'));
        const open = source.slice(
            source.indexOf('export function openSettingsWindow'),
            source.indexOf('async function createSettingsWindow')
        );
        expect(open).toContain('if (!canOpenSettingsWindow(appState.mainWindow)) return Promise.resolve();');
        const create = source.slice(source.indexOf('async function createSettingsWindow'));
        const awaitAt = create.indexOf('await deps.getUiLanguage()');
        const checkAt = create.indexOf('if (!canOpenSettingsWindow(appState.mainWindow)) return;');
        expect(awaitAt).toBeGreaterThan(0);
        expect(checkAt).toBeGreaterThan(awaitAt);
        expect(checkAt).toBeLessThan(create.indexOf('new BrowserWindow('));
    });
});

describe('settings:open (main window top frame only)', () => {
    function setup(allow: boolean) {
        const listeners = new Map<string, (event: never, ...args: unknown[]) => unknown>();
        const ipcMain: IpcMainLike = {
            handle: () => {},
            on: (channel, listener) => void listeners.set(channel, listener as never),
        };
        const policy = vi.fn(() => allow);
        const registry = createIpcRegistry({
            ipcMain,
            logger: { warn: vi.fn(), error: vi.fn() },
            senderPolicies: { 'main-window-top-frame': policy },
        });
        const handler = vi.fn();
        registry.on('settings:open', SETTINGS_OPEN_OPTIONS, handler);
        const send = (...args: unknown[]) => listeners.get('settings:open')!({ sender: {}, senderFrame: {} } as never, ...args);
        return { policy, handler, send };
    }

    it('uses the main-window-top-frame sender policy', () => {
        expect(SETTINGS_OPEN_OPTIONS.senderPolicy).toBe('main-window-top-frame');
    });

    it('opens for the main window top frame', () => {
        const { policy, handler, send } = setup(true);
        send();
        expect(policy).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('ignores every other sender (PiP, the Settings window itself, sub-frames)', () => {
        const { handler, send } = setup(false);
        send();
        expect(handler).not.toHaveBeenCalled();
    });

    it('accepts an optional short page string and rejects extra or non-string arguments', () => {
        const { handler, send } = setup(true);
        send('plugins');
        expect(handler).toHaveBeenCalledTimes(1);
        for (const args of [['plugins', 1], [1], [{}], ['x'.repeat(33)]]) {
            try {
                send(...args);
            } catch {
                // a rejected payload may throw or be dropped by the registry; either way the handler must not run
            }
        }
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('electron/main/windows/settingsWindow.cts (source)', () => {
    const source = withoutComments(readMainModule('windows/settingsWindow.cts'));

    it('pins secureWebPreferences with the narrow Settings preload only (T-606), never the main window preload', () => {
        expect(source).toMatch(/webPreferences: secureWebPreferences\(\{ preload: deps\.appPaths\.settingsPreload \}\)/);
        expect(source).not.toMatch(/appPaths\.(preload|pipPreload)\b/);
        expect(source.match(/preload/g)).toHaveLength(1);
    });

    it('removes the default menu (no Reload / DevTools accelerators) and uses the dev-only DevTools opt-in', () => {
        expect(source).toContain('win.removeMenu()');
        expect(source).toContain('shouldOpenDevTools(app.isPackaged, process.env)');
        expect(source).not.toMatch(/setAlwaysOnTop|setSkipTaskbar|setIgnoreMouseEvents/);
    });

    it('is a single instance and closes with the main window', () => {
        expect(source).toContain('focusExistingWindow(existing)');
        expect(source).toContain("mainWindow.once('closed', closeWithMain)");
        expect(source).toContain('if (appState.settingsWindow === win) appState.settingsWindow = null;');
    });

    it('registers settings:open through the typed registry with its schema, and the T-606 sync channels', () => {
        expect(source).toContain("registry.on('settings:open', SETTINGS_OPEN_OPTIONS,");
        expect(source).toContain('registerSettingsSyncIpc(registry);');
    });

    it('the tray entry exists only in dev runs', () => {
        const tray = withoutComments(readMainModule('tray.cts'));
        expect(tray).toMatch(/\.\.\.\(app\.isPackaged\s*\?\s*\[\]/);
        expect(tray).toContain('openSettingsWindow()');
    });

    it('no preload exposes the channel (plugin-visible surface unchanged)', () => {
        // T-615: the main preload sends it only from the claim-once host bridge, never from a window.api member.
        const preloadSrc = readRepoFile('electron/preload.cts');
        expect(preloadSrc.slice(preloadSrc.indexOf("contextBridge.exposeInMainWorld('api', {"))).not.toContain('settings:open');
        expect(readRepoFile('electron/pip-preload.cts')).not.toContain('settings:open');
    });
});
