import { describe, expect, it } from 'vitest';
import { readMainCts, readMainModule } from './helpers/mainSource';

// T-315: electron/main.cts is a thin entry. These source-level checks pin that it only imports and calls, and the ORDER of those calls:
// the order is the old single-file evaluation order (dev userData redirect before anything reads userData, the context built once,
// the IPC registrations and security guards in their old sequence).

function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The statements of main.cts after the imports, one per ';'-terminated entry (no statement in main.cts contains a nested block). */
function bodyStatements(main: string): string[] {
    const code = withoutComments(main).replace(/^import[\s\S]*?;\s*$/gm, '');
    return code
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

const EXPECTED_MAIN_SEQUENCE = [
    'const env = createRuntimeEnv(createAppPaths(__dirname))',
    'redirectDevUserData(env)',
    'applyChromiumSwitches()',
    'const ctx = createMainContext(env)',
    'configureStartupServices(ctx)',
    'claimSingleInstance(env)',
    'registerAppLifecycle(ctx)',
    'registerCoreIpc(ctx)',
    'registerFileAccessIpc(ctx)',
    'registerWindowServicesIpc(ctx)',
    'registerNavigationGuards(env)',
    'registerMediaAndExternalIpc(ctx)',
    'const extensions = createExtensionServices(ctx)',
    'registerInstalledExtensions(ctx, extensions)',
    'registerFullBackup(ctx, extensions)',
    'registerExtensionChannels(ctx, extensions)',
    'registerAppInfoIpc(env)',
];

/** Asserts that every needle occurs in `source` and that the first occurrences are in the given order. */
function expectInOrder(source: string, needles: string[]): void {
    const positions = needles.map((needle) => source.indexOf(needle));
    needles.forEach((needle, index) => expect(positions[index], needle).toBeGreaterThanOrEqual(0));
    expect(positions, needles.join(' < ')).toEqual([...positions].sort((a, b) => a - b));
}

describe('electron/main.cts is a thin entry (T-315)', () => {
    const main = readMainCts();
    const code = withoutComments(main);

    it('is short and only wires: no Electron import, no handler or event registration of its own', () => {
        expect(main.split('\n').length).toBeLessThan(150);
        expect(code).not.toMatch(/from 'electron'/);
        expect(code).not.toMatch(/\bipcMain\./);
        expect(code).not.toMatch(/\bregistry\.(handle|on)\(/);
        expect(code).not.toMatch(/\bapp\./);
        expect(code).not.toMatch(/\bfunction\b|=>|\bif\s*\(/);
    });

    it('every statement after the imports is a plain call (optionally bound to a const)', () => {
        const statements = bodyStatements(main);
        expect(statements.length).toBeGreaterThan(0);
        for (const statement of statements) expect(statement).toMatch(/^(?:const \w+ = )?\w+\([\w, ()]*\)$/);
    });

    it('calls the bootstrap phases in the documented order', () => {
        expect(bodyStatements(main).map((statement) => statement.replace(/\s+/g, ' '))).toEqual(EXPECTED_MAIN_SEQUENCE);
    });

    it('the bundle directory is handed over as main.cts own __dirname (esbuild entry stays electron/main.cts)', () => {
        expect(main).toMatch(/createAppPaths\(__dirname\)/);
    });
});

describe('process setup order (T-315)', () => {
    it('the dev userData redirect runs before any call that reads userData', () => {
        const runtime = readMainModule('app/runtime.cts');
        const from = runtime.indexOf('export function redirectDevUserData');
        const to = runtime.indexOf('export function applyChromiumSwitches');
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeGreaterThan(from);
        expectInOrder(runtime.slice(from, to), [
            "app.setName('KoBarDev')",
            "app.commandLine.getSwitchValue('user-data-dir')",
            "app.setPath('userData'",
        ]);
        expectInOrder(readMainCts(), [
            'redirectDevUserData(env)',
            'createMainContext(env)',
            'configureStartupServices(ctx)',
            'createExtensionServices(ctx)',
        ]);
    });

    it('the app identity and the single instance lock follow the old order', () => {
        const runtime = readMainModule('app/runtime.cts');
        expectInOrder(runtime, ['app.setAppUserModelId(AUMID)', 'app.requestSingleInstanceLock()', "app.on('second-instance'"]);
    });

    it('the Chromium switches are applied after the log line and before the context exists', () => {
        const runtime = readMainModule('app/runtime.cts');
        expectInOrder(runtime, ['Hardware Acceleration: FORCED ENABLED', "'disable-features'", "'autoplay-policy'"]);
        expectInOrder(readMainCts(), ['applyChromiumSwitches()', 'createMainContext(env)']);
    });

    it('startup services are configured in the old order (pin style, then notifications)', () => {
        expectInOrder(readMainModule('bootstrap.cts'), [
            "initPinBorderStyle(app.getPath('userData'))",
            'configureNotifications({ getUiLanguage, iconPath: ctx.appPaths.iconPng })',
        ]);
    });
});

describe('whenReady sequence and registration order (T-315)', () => {
    it('whenReady runs KoBox, the bridge, CSP diagnostics, windows, tray, permissions, media, quit hooks, pin targeting, updater', () => {
        const lifecycle = withoutComments(readMainModule('app/lifecycle.cts'));
        expectInOrder(lifecycle, [
            'app.whenReady()',
            "path.join(app.getPath('userData'), 'KoBox')",
            'startPsBridge()',
            'setupCspDiagnostics(ctx)',
            'createWindow(windowDeps())',
            'createTray(appPaths, getUiLanguage)',
            'installPermissionHandlers(ctx)',
            // T-316: the unconditional start became the demand check at the same position (polls only for the media plugin / PiP).
            'updateMediaDemand({ appPaths })',
            "app.on('activate'",
            "app.on('before-quit'",
            "app.on('will-quit'",
            'registerPinTargetingHandler()',
            'setupUpdater()',
            "app.on('window-all-closed'",
        ]);
        // T-316: nothing in the startup sequence starts media polling unconditionally any more.
        expect(lifecycle).not.toContain('startMediaPolling(');
    });

    it('registerCoreIpc keeps the old channel order', () => {
        const bootstrap = readMainModule('bootstrap.cts');
        const start = bootstrap.indexOf('export function registerCoreIpc');
        const end = bootstrap.indexOf('export function registerFileAccessIpc');
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expectInOrder(bootstrap.slice(start, end), [
            'registerAppControlIpc(ctx)',
            'registerStorageBackupIpc()',
            'registerUpdaterIpc({ getUiLanguage })',
            'registerNoteExportIpc({ dialogPathsFile })',
            'registerPinIpc()',
            'registerNotificationIpc()',
        ]);
    });

    it('the file access and window service registrations keep the old order', () => {
        const bootstrap = readMainModule('bootstrap.cts');
        const start = bootstrap.indexOf('export function registerFileAccessIpc');
        const end = bootstrap.indexOf('export function registerMediaAndExternalIpc');
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        expectInOrder(bootstrap.slice(start, end), [
            'registerKoboxIpc({',
            'registerFilesIpc({',
            'registerLlmIpc()',
            'registerAutoLaunchIpc({',
            'registerClipboardIpc()',
            'registerMouseEventsIpc()',
            'registerGlobalPasteIpc({',
            'registerScreenshotIpc({',
            'registerPipIpc({',
            'registerWindowIpc()',
        ]);
    });

    it('the live state and the security guards each exist exactly once', () => {
        const helpers = readMainModule('app/helpers.cts');
        expect(helpers.match(/let confirmInFlight\b/g)).toHaveLength(1);
        expect(helpers.match(/let uiLanguageCache\b/g)).toHaveLength(1);
        const security = readMainModule('app/security.cts');
        for (const guard of ['setWindowOpenHandler(', "'will-navigate'", "'will-redirect'", "'will-attach-webview'"]) {
            expect(security.split(guard).length - 1, guard).toBe(1);
        }
        expect(security).toContain('setPermissionCheckHandler(');
        expect(security).toContain('setPermissionRequestHandler(');
        expect(security).toContain('setDisplayMediaRequestHandler(');
    });
});
