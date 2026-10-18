// T-305: every path the main process builds from its own location (icons, built pages, preloads, worker, sounds, the dev playground).
// Pure module: no Electron imports. The base directory is injected because after the T-301 esbuild bundle every module lives in
// dist-electron/ and `__dirname` there is the bundle directory; a module of its own must not use its own `__dirname`.
// main.cts passes ITS `__dirname`, so each path resolves exactly like the former inline `path.join(__dirname, ...)` calls.
import * as path from 'path';

export interface AppPaths {
    /** Window / tray icon (PNG). */
    readonly iconPng: string;
    /** Tray icon on Windows (256x256 ICO). */
    readonly iconIco256: string;
    /** macOS menu bar template icon (18x18 black + alpha, `@2x` sibling picked up by Electron). */
    readonly trayTemplate: string;
    /** Preload of the main window. */
    readonly preload: string;
    /** Preload of the PiP window. */
    readonly pipPreload: string;
    /** Preload of the Settings window (T-606): exposes only window.settingsBridge. */
    readonly settingsPreload: string;
    /** Built renderer entry page. */
    readonly indexHtml: string;
    /** Built PiP page. */
    readonly pipHtml: string;
    /** Built Settings window page (T-605). */
    readonly settingsHtml: string;
    /** Worker thread that talks to the Windows media session. */
    readonly smtcWorker: string;
    /** Folder with the bundled notification sounds. */
    readonly melodyDir: string;
    /** Dev-only plugin playground folder inside the repository. */
    readonly pluginsPlayground: string;
}

/** `dirname` is the directory of the bundle (dist-electron), i.e. `__dirname` of main.cts. */
export function createAppPaths(dirname: string): AppPaths {
    return {
        iconPng: path.join(dirname, '../build/icon.png'),
        iconIco256: path.join(dirname, '../build/icon-256x256.ico'),
        trayTemplate: path.join(dirname, '../build/trayTemplate.png'),
        preload: path.join(dirname, 'preload.cjs'),
        pipPreload: path.join(dirname, 'pip-preload.cjs'),
        settingsPreload: path.join(dirname, 'settings-preload.cjs'),
        indexHtml: path.join(dirname, '../dist/index.html'),
        pipHtml: path.join(dirname, '../dist/pip.html'),
        settingsHtml: path.join(dirname, '../dist/settings.html'),
        smtcWorker: path.join(dirname, 'smtc-worker.cjs'),
        melodyDir: path.join(dirname, '../Assets/Melody'),
        pluginsPlayground: path.join(dirname, '../pluginsPlayground'),
    };
}
