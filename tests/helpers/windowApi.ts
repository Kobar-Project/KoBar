import { vi, type Mock } from 'vitest';
import * as geometry from '../../shared/geometry';

/*
 * Test double for the `window.api` bridge that `electron/preload.cts` exposes via
 * `contextBridge.exposeInMainWorld('api', { ... })`.
 *
 * The method lists below are hardcoded copies of the keys in electron/preload.cts,
 * grouped by how the real implementation behaves. `tests/smoke.test.ts` parses the
 * preload file and fails if these lists drift from it, so when you add/remove a
 * preload method, update the matching list here.
 */

/** `ipcRenderer.send(...)` — fire-and-forget, returns `undefined`. */
const SEND_METHODS = [
    'hideApp',
    'quitApp',
    'updateSidebarRect',
    'registerTeleportShortcut',
    'startClipboardListener',
    'stopClipboardListener',
    'writeToClipboard',
    'setIgnoreMouseEvents',
    'setGlobalPasteMode',
    'executeGlobalPaste',
    'triggerScreenshot',
    'takeScreenshot',
    'moveWindow',
    'launchFile',
    'setAutoLaunch',
    'enterPinTargetingMode',
    'unpinCurrentWindow',
    'unpinAll',
    'dropToKoBox',
    'openKoBox',
    'cleanKoBox',
    'cancelScreenshot',
    'copyScreenshotToClipboard',
    'screenshotSessionComplete',
    'sendNotification',
    'sendMediaCommand',
    'openPip',
    'closePip',
    'downloadAndInstallUpdate',
    'quitAndInstallUpdate',
    'openExternal',
] as const;

/** `ipcRenderer.invoke(...)` — returns a Promise; the mock resolves to `undefined` by default. */
const INVOKE_METHODS = [
    'getScreenBounds',
    'getDisplaysInfo',
    'startEyeDropper',
    'stopEyeDropper',
    'recenterWindowOnWidget',
    'getFileIcon',
    'getAutoLaunch',
    'syncAutoLaunch',
    'pickTextFiles',
    'takeOpenTextFiles',
    'getMelodyAudio',
    'getHwid',
    'parseFile',
    'llmRequest',
    'cancelLlmRequest',
    'saveNoteAsText',
    'getBackupSources',
    'saveFullBackup',
    'createPreRestoreBackup',
    'applyRestoreAndRelaunch',
    'createPreDeleteBackup',
    'startScreenshotCapture',
    'saveScreenshot',
    'getActiveVideoUrls',
    'getSmtcSource',
    'askForUpdate',
    'checkForUpdatesManual',
    'getAppVersion',
    'isDev',
    'getInstalledExtensions',
    'checkPluginUpdates',
    'getAvailableExtensions',
    'installExtension',
    'uninstallExtension',
    'toggleExtensionEnabled',
    'setExtensionsConfig',
    'installExtensionFromFile',
    'installExtensionFromPath',
    'installExtensionFromGithub',
    'getPinBorderStyle',
    'setPinBorderStyle',
    'getSecretStatus',
    'setSecret',
    'deleteSecret',
    'gcalStatus',
    'gcalConnect',
    'gcalDisconnect',
    'gcalListEvents',
] as const;

/** Event subscribers — the mock returns an unsubscribe function `() => {}`. */
const EVENT_METHODS = [
    'onForceCenterMiniMode',
    'onEdgeChanged',
    'onWindowGeometryChanged',
    'onTeleportTriggered',
    'onClipboardUpdate',
    'onOpenSettings',
    'onOpenTextFilesAvailable',
    'onRequestNextPaste',
    'onClipboardPasteError',
    'onLlmStreamChunk',
    'onLlmStreamEnd',
    'onLlmStreamError',
    'onPinnedWindowChanged',
    'onPinTargetingComplete',
    'onMediaUpdate',
    'onPipClosed',
    'onVideoUrlsUpdate',
    'onUpdateAvailable',
    'onUpdateDownloadProgress',
    'onUpdateDownloadComplete',
    'onUpdateError',
    'onPluginInstallProgress',
] as const;

/** Synchronous methods that return a value; the mock returns a neutral default. */
const SYNC_DEFAULTS = {
    getWindowPositionSync: (): [number, number] => [0, 0],
    // What main answers (electron/main/windows/windowIpc.cts, T-320/T-321): the window fitted to one display. The mock display is
    // as large as the legacy ghost window, so the six layout fields stay the renderer's built-in fallback values the layout tests
    // were written against (T-322 moves the renderer onto the dynamic model).
    getWindowGeometry: () => ({
        width: geometry.GHOST_WINDOW_WIDTH,
        height: geometry.GHOST_WINDOW_HEIGHT,
        centerX: geometry.GHOST_WINDOW_CENTER_X,
        centerY: geometry.GHOST_WINDOW_CENTER_Y,
        fallbackScreenWidth: geometry.FALLBACK_SCREEN_WIDTH,
        fallbackScreenHeight: geometry.FALLBACK_SCREEN_HEIGHT,
        displayId: 1,
        displayBounds: { x: 0, y: 0, width: geometry.GHOST_WINDOW_WIDTH, height: geometry.GHOST_WINDOW_HEIGHT },
        workArea: { x: 0, y: 0, width: geometry.GHOST_WINDOW_WIDTH, height: geometry.GHOST_WINDOW_HEIGHT },
        scaleFactor: 1,
    }),
    getFilePath: (): string => '',
    getPlatform: (): string => 'win32',
} as const;

/** Plain values (not methods) on window.api, with the value the preload exposes. */
const VALUE_DEFAULTS = {
    // R4: additive capability flag (2 = the host serialises global paste presses).
    globalPasteVersion: 2,
} as const;

export const WINDOW_API_METHODS = [
    ...SEND_METHODS,
    ...INVOKE_METHODS,
    ...EVENT_METHODS,
    ...(Object.keys(SYNC_DEFAULTS) as Array<keyof typeof SYNC_DEFAULTS>),
] as const;

export type WindowApiMethod = (typeof WINDOW_API_METHODS)[number];

/** Every top-level key of window.api: the methods above plus the plain values. */
export const WINDOW_API_KEYS = [...WINDOW_API_METHODS, ...(Object.keys(VALUE_DEFAULTS) as Array<keyof typeof VALUE_DEFAULTS>)] as const;

type WindowApi = Window['api'];
/**
 * Compile-time guard: every preload method listed above must also be declared in
 * `src/types/global.d.ts`, otherwise `tsc -b` fails here.
 */
type DeclaredInGlobalTypes<K extends keyof WindowApi> = K;

/** Every preload method as a `vi.fn()`, typed after `src/types/global.d.ts`. */
export type WindowApiMock = {
    [K in DeclaredInGlobalTypes<WindowApiMethod>]: Mock<WindowApi[K]>;
} & {
    [K in DeclaredInGlobalTypes<keyof typeof VALUE_DEFAULTS>]: WindowApi[K];
};

export function createWindowApiMock(): WindowApiMock {
    const api: Record<string, Mock> = {};
    for (const name of SEND_METHODS) api[name] = vi.fn();
    for (const name of INVOKE_METHODS) api[name] = vi.fn(async () => undefined);
    for (const name of EVENT_METHODS) api[name] = vi.fn(() => () => {});
    for (const [name, impl] of Object.entries(SYNC_DEFAULTS)) api[name] = vi.fn(impl);
    const values: Record<string, unknown> = { ...VALUE_DEFAULTS };
    // The object is built dynamically from the name lists (with neutral default
    // implementations that don't match each exact signature), so TypeScript cannot
    // infer the per-key mock types; the drift test in tests/smoke.test.ts verifies
    // the key set at runtime.
    return { ...api, ...values } as unknown as WindowApiMock;
}

/**
 * Assigns a fresh mock to `window.api` and returns it so a test can tweak it, e.g.
 * `installWindowApiMock().getAppVersion.mockResolvedValue('1.2.3')`.
 * Only usable in a DOM environment (`*.dom.test.ts`).
 */
export function installWindowApiMock(): WindowApiMock {
    const api = createWindowApiMock();
    window.api = api;
    return api;
}
