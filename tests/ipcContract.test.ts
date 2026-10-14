import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
    EventArgs,
    EventChannel,
    EventMethod,
    InvokeArgs,
    InvokeChannel,
    InvokeMethod,
    InvokeResult,
    IpcChannel,
    IpcGcalConnectFailure,
    IpcEventMap,
    IpcInvokeMap,
    SendArgs,
    SendChannel,
    SendMethod,
    SyncArgs,
    SyncChannel,
    SyncMethod,
    SyncResult,
    TypedIpcRenderer,
} from '../shared/ipc-contract';
import { readMainSources } from './helpers/mainSource';

// T-302: shared/ipc-contract.ts is the typed description of every main <-> renderer IPC channel. This test parses
// electron/main.cts and both preloads (like tests/plugin-contract-v1.test.ts does) and compares the channel names with
// the contract, so adding, renaming or removing a channel without updating the contract fails here. The second half
// checks (at compile time, through `tsc -b`) that the contract's shapes agree with the `window.api` typings.

function readRepoFile(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

/** Source without whole-line comments (so a channel named in a comment is not counted). */
function withoutComments(text: string): string {
    return text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
}

function code(relativePath: string): string {
    return withoutComments(readRepoFile(relativePath));
}

/** Every first string argument of calls matching `callPattern` (a regex source ending right before the quote). */
function channelsOf(source: string, callPattern: string): Set<string> {
    const found = new Set<string>();
    for (const match of source.matchAll(new RegExp(`${callPattern}\\(\\s*'([^']+)'`, 'g'))) found.add(match[1]);
    return found;
}

function union(...sets: Array<Set<string>>): Set<string> {
    return new Set(sets.flatMap((s) => [...s]));
}

function minus(a: Set<string>, b: Set<string>): Set<string> {
    return new Set([...a].filter((x) => !b.has(x)));
}

function sorted(set: Set<string>): string[] {
    return [...set].sort();
}

/** The top-level channel keys of `export interface <name> { ... }` in the contract file. */
function contractKeys(name: string): Set<string> {
    const source = readRepoFile('shared/ipc-contract.ts');
    const start = source.indexOf(`export interface ${name} {`);
    expect(start, `${name} exists in the contract`).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start);
    const end = rest.search(/^\}/m);
    expect(end).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const match of rest.slice(0, end).matchAll(/^ {4}'([^']+)':/gm)) {
        expect(keys.has(match[1]), `${name}: duplicate key ${match[1]}`).toBe(false);
        keys.add(match[1]);
    }
    return keys;
}

// T-306: main.cts plus everything under electron/main/ (windows, tray, later splits). ipc/registry.cts (the generic channel dispatcher)
// is left out on purpose: its `ipcMain.handle(channel, ...)` calls are the registry itself, not channel registrations.
const main = withoutComments(readMainSources(['ipc/registry.cts']));
const preload = code('electron/preload.cts');
const pipPreload = code('electron/pip-preload.cts');
// T-606: the Settings window's narrow preload (window.settingsBridge only).
const settingsPreload = code('electron/settings-preload.cts');

// Main side (T-303: channels move from ipcMain.handle/on to the typed registry.handle/on one group at a time).
const mainHandle = union(channelsOf(main, 'ipcMain\\.handle'), channelsOf(main, 'registry\\.handle'));
const mainOn = union(channelsOf(main, 'ipcMain\\.on'), channelsOf(main, 'ipcMain\\.once'), channelsOf(main, 'registry\\.on'));
// `webContents.send(channel, ...)` with a literal, plus the two channels pushed through the sendMediaChannel() helper.
const mainPushes = union(channelsOf(main, '\\.send'), channelsOf(main, 'sendMediaChannel'));

// Renderer side (`subscribe` / `subscribeWithResync` are the preload's wrappers around ipcRenderer.on).
const subscribeCall = 'subscribe(?:WithResync)?(?:<[^>]*>)?';
const preloadInvoke = channelsOf(preload, 'ipcRenderer\\.invoke');
const preloadSend = channelsOf(preload, 'ipcRenderer\\.send');
const preloadSendSync = channelsOf(preload, 'ipcRenderer\\.sendSync');
const preloadListen = union(channelsOf(preload, 'ipcRenderer\\.on'), channelsOf(preload, subscribeCall));
const pipSend = channelsOf(pipPreload, 'ipcRenderer\\.send');
const pipListen = channelsOf(pipPreload, 'ipcRenderer\\.on');
const settingsSend = channelsOf(settingsPreload, 'ipcRenderer\\.send');
const settingsListen = channelsOf(settingsPreload, 'ipcRenderer\\.on');
// R2-15: the Settings preload's only invokes are the gcal-settings-* status/control channels.
const settingsInvoke = channelsOf(settingsPreload, 'ipcRenderer\\.invoke');
// Every renderer-side sender / listener (main window preload, PiP preload, Settings preload).
const anySend = union(preloadSend, pipSend, settingsSend);
const anyListen = union(preloadListen, pipListen, settingsListen);

const contract = {
    invoke: contractKeys('IpcInvokeMap'),
    send: contractKeys('IpcSendMap'),
    sync: contractKeys('IpcSyncMap'),
    event: contractKeys('IpcEventMap'),
};

// Channels that exist on ONE side only, on purpose. Anything else one-sided is drift and fails below.
const ONE_SIDED = {
    // Legacy v1 plugin API no-ops: the preload still sends/subscribes, but main has no handler / never pushes.
    sendWithoutHandler: ['register-teleport-shortcut'],
    eventNeverSent: ['teleport-triggered'],
    // (none: T-615 added the host-only sender of settings:open, see INTERNAL_CHANNELS)
    handledWithoutSender: [] as string[],
};

describe('IPC contract vs. the sources', () => {
    it('the scan finds the channels (guards against a regex that silently matches nothing)', () => {
        expect(mainHandle.size).toBeGreaterThan(25);
        expect(mainOn.size).toBeGreaterThan(25);
        expect(mainPushes.size).toBeGreaterThan(15);
        expect(preloadInvoke.size).toBeGreaterThan(25);
        expect(preloadListen.size).toBeGreaterThan(15);
        expect(mainHandle.has('get-app-version')).toBe(true);
        expect(mainPushes.has('video-urls-update')).toBe(true);
        expect(preloadSendSync.has('get-window-position-sync')).toBe(true);
    });

    it('invoke: contract == every ipcMain.handle channel, and every preload invoke is in it', () => {
        expect(sorted(contract.invoke)).toEqual(sorted(mainHandle));
        expect(sorted(minus(union(preloadInvoke, settingsInvoke), contract.invoke))).toEqual([]);
    });

    it('sync: contract == every preload sendSync channel, and main answers each with ipcMain.on', () => {
        expect(sorted(contract.sync)).toEqual(sorted(preloadSendSync));
        expect(sorted(minus(contract.sync, mainOn))).toEqual([]);
    });

    it('send: contract == every fire-and-forget channel of main (ipcMain.on) and of the preloads', () => {
        const mainSend = minus(mainOn, contract.sync);
        expect(sorted(contract.send)).toEqual(sorted(union(mainSend, anySend)));
    });

    it('event: contract == every main push and every preload listener', () => {
        expect(sorted(contract.event)).toEqual(sorted(union(mainPushes, anyListen)));
    });

    it('no channel name is in two groups', () => {
        const all = [...contract.invoke, ...contract.send, ...contract.sync, ...contract.event];
        expect(all.length).toBe(new Set(all).size);
    });

    it('one-sided channels are exactly the documented legacy no-ops', () => {
        // sent by a renderer side, never handled by main
        const sentNotHandled = minus(anySend, mainOn);
        expect(sorted(sentNotHandled)).toEqual(sorted(new Set(ONE_SIDED.sendWithoutHandler)));
        // handled by main, never sent by any preload
        expect(sorted(minus(minus(mainOn, contract.sync), anySend))).toEqual(sorted(new Set(ONE_SIDED.handledWithoutSender)));
        expect(sorted(minus(mainHandle, union(preloadInvoke, settingsInvoke)))).toEqual([]);
        // listened to in a preload, never pushed by main
        expect(sorted(minus(anyListen, mainPushes))).toEqual(sorted(new Set(ONE_SIDED.eventNeverSent)));
        // pushed by main, never listened to in a preload
        expect(sorted(minus(mainPushes, anyListen))).toEqual([]);
    });

    it('every IPC call names its channel with a string literal, except the known generic helpers', () => {
        // A call with a variable channel is invisible to the scans above, so it must be listed here on purpose.
        const nonLiteral =
            /(?:(?:ipcMain|registry)\.(?:handle|on|once)|ipcRenderer\.(?:invoke|send|sendSync|on)|(?:webContents|\bwc)\.send)\(\s*[^'\s]/;
        const found = (file: string, source: string) =>
            source
                .split('\n')
                .filter((line) => nonLiteral.test(line))
                .map((line) => `${file}: ${line.trim()}`);
        expect([
            ...found('main', main),
            ...found('preload', preload),
            ...found('pip-preload', pipPreload),
            ...found('settings-preload', settingsPreload),
        ]).toEqual([
            // sendMediaChannel() / media-resync: the channel is limited to 'media-update' | 'video-urls-update' (covered above).
            'main: appState.mainWindow.webContents.send(channel, payload);',
            'main: appState.pipWindow.webContents.send(channel, payload);',
            'main: if (last) appState.mainWindow.webContents.send(channel, last.payload);',
            // subscribe(): the generic helper behind every on* API (its callers are scanned above).
            'preload: ipcRenderer.on(channel, handler);',
        ]);
    });

    it('the contract does not name a channel that neither main nor a preload uses', () => {
        const used = union(
            mainHandle,
            mainOn,
            mainPushes,
            preloadInvoke,
            settingsInvoke,
            preloadSend,
            preloadSendSync,
            preloadListen,
            anySend,
            anyListen
        );
        const all = union(contract.invoke, contract.send, contract.sync, contract.event);
        expect(sorted(minus(all, used))).toEqual([]);
    });
});

// Compile-time checks (no runtime effect; they are verified by `tsc -b` through tsconfig.test.json).
describe('IPC contract vs. window.api typings', () => {
    type Api = Window['api'];
    type Resolved<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

    it('invoke results agree with the window.api promises', () => {
        expectTypeOf<InvokeResult<'get-app-version'>>().toEqualTypeOf<Resolved<Api['getAppVersion']>>();
        expectTypeOf<InvokeResult<'is-dev'>>().toEqualTypeOf<Resolved<Api['isDev']>>();
        expectTypeOf<InvokeResult<'get-auto-launch'>>().toEqualTypeOf<Resolved<Api['getAutoLaunch']>>();
        expectTypeOf<InvokeResult<'get-melody-audio'>>().toEqualTypeOf<Resolved<Api['getMelodyAudio']>>();
        expectTypeOf<InvokeResult<'get-smtc-source'>>().toEqualTypeOf<Resolved<Api['getSmtcSource']>>();
        expectTypeOf<InvokeResult<'get-active-video-urls'>>().toEqualTypeOf<Resolved<Api['getActiveVideoUrls']>>();
        expectTypeOf<InvokeResult<'get-file-icon'>>().toEqualTypeOf<Resolved<Api['getFileIcon']>>();
        expectTypeOf<InvokeResult<'check-for-updates-manual'>>().toEqualTypeOf<Resolved<Api['checkForUpdatesManual']>>();
        expectTypeOf<InvokeResult<'start-screenshot-capture'>>().toEqualTypeOf<Resolved<Api['startScreenshotCapture']>>();
        expectTypeOf<InvokeResult<'get-backup-sources'>>().toEqualTypeOf<Resolved<Api['getBackupSources']>>();
        expectTypeOf<InvokeResult<'get-pin-border-style'>>().toEqualTypeOf<Resolved<Api['getPinBorderStyle']>>();
        expectTypeOf<InvokeResult<'parse-file'>>().toEqualTypeOf<Resolved<Api['parseFile']>>();
        expectTypeOf<InvokeResult<'save-note-as-text'>>().toEqualTypeOf<Resolved<Api['saveNoteAsText']>>();
        expectTypeOf<InvokeResult<'save-screenshot'>>().toEqualTypeOf<Resolved<Api['saveScreenshot']>>();
        expectTypeOf<InvokeResult<'save-full-backup'>>().toEqualTypeOf<Resolved<Api['saveFullBackup']>>();
        expectTypeOf<InvokeResult<'create-pre-restore-backup'>>().toEqualTypeOf<Resolved<Api['createPreRestoreBackup']>>();
        expectTypeOf<InvokeResult<'create-pre-delete-backup'>>().toEqualTypeOf<Resolved<Api['createPreDeleteBackup']>>();
        expectTypeOf<InvokeResult<'apply-restore-and-relaunch'>>().toEqualTypeOf<Resolved<Api['applyRestoreAndRelaunch']>>();
        expectTypeOf<InvokeResult<'uninstall-extension'>>().toEqualTypeOf<Resolved<Api['uninstallExtension']>>();
        expectTypeOf<InvokeResult<'toggle-extension-enabled'>>().toEqualTypeOf<Resolved<Api['toggleExtensionEnabled']>>();
        expectTypeOf<InvokeResult<'set-extensions-config'>>().toEqualTypeOf<Resolved<Api['setExtensionsConfig']>>();
        expectTypeOf<InvokeResult<'install-extension-from-file'>>().toEqualTypeOf<Resolved<Api['installExtensionFromFile']>>();
        expectTypeOf<InvokeResult<'install-extension-from-path'>>().toEqualTypeOf<Resolved<Api['installExtensionFromPath']>>();
        expectTypeOf<InvokeResult<'install-extension-from-github'>>().toEqualTypeOf<Resolved<Api['installExtensionFromGithub']>>();
        expectTypeOf<InvokeResult<'check-plugin-updates'>>().toEqualTypeOf<Resolved<Api['checkPluginUpdates']>>();
        // More precise in the contract than in window.api (which says `any` or a plainer union): assignable, not equal.
        expectTypeOf<InvokeResult<'set-pin-border-style'>>().toExtend<Resolved<Api['setPinBorderStyle']>>();
        expectTypeOf<InvokeResult<'get-screen-bounds'>>().toExtend<Resolved<Api['getScreenBounds']>>();
        expectTypeOf<InvokeResult<'get-displays-info'>>().toExtend<Resolved<Api['getDisplaysInfo']>>();
        expectTypeOf<InvokeResult<'recenter-window-on-widget'>>().toExtend<Resolved<Api['recenterWindowOnWidget']>>();
        expectTypeOf<InvokeResult<'get-installed-extensions'>>().toExtend<Resolved<Api['getInstalledExtensions']>>();
    });

    it('wire argument tuples follow the preload (not always the window.api parameters)', () => {
        expectTypeOf<InvokeArgs<'get-app-version'>>().toEqualTypeOf<[]>();
        expectTypeOf<InvokeArgs<'recenter-window-on-widget'>>().toEqualTypeOf<
            [relativeX: number, relativeY: number, width: number, height: number]
        >();
        expectTypeOf<InvokeArgs<'save-note-as-text'>>().toEqualTypeOf<[payload: { title: string; content: string }]>();
        expectTypeOf<SendArgs<'move-window'>>().toEqualTypeOf<[delta: { dx: number; dy: number }]>();
        expectTypeOf<SendArgs<'media-command'>>().toEqualTypeOf<Parameters<Window['api']['sendMediaCommand']>>();
        expectTypeOf<SyncResult<'get-window-position-sync'>>().toEqualTypeOf<ReturnType<Window['api']['getWindowPositionSync']>>();
        expectTypeOf<SyncArgs<'get-window-geometry'>>().toEqualTypeOf<[]>();
        expectTypeOf<SyncResult<'get-window-geometry'>>().toEqualTypeOf<ReturnType<Window['api']['getWindowGeometry']>>();
        // T-321: the pushed model has the shape of the sync answer (never null).
        expectTypeOf<EventArgs<'window-geometry-changed'>>().toEqualTypeOf<[geometry: NonNullable<SyncResult<'get-window-geometry'>>]>();
    });

    it('event payloads agree with the window.api callbacks', () => {
        type CallbackArgs<F> = F extends (callback: (...args: infer A) => void) => unknown ? A : never;
        expectTypeOf<EventArgs<'media-update'>>().toEqualTypeOf<CallbackArgs<Window['api']['onMediaUpdate']>>();
        expectTypeOf<EventArgs<'video-urls-update'>>().toEqualTypeOf<CallbackArgs<Window['api']['onVideoUrlsUpdate']>>();
        expectTypeOf<EventArgs<'pinned-window-changed'>>().toEqualTypeOf<CallbackArgs<Window['api']['onPinnedWindowChanged']>>();
        expectTypeOf<EventArgs<'update-available'>>().toEqualTypeOf<CallbackArgs<Window['api']['onUpdateAvailable']>>();
        expectTypeOf<EventArgs<'update-download-progress'>>().toEqualTypeOf<CallbackArgs<Window['api']['onUpdateDownloadProgress']>>();
        expectTypeOf<EventArgs<'clipboard-paste-error'>>().toEqualTypeOf<CallbackArgs<Window['api']['onClipboardPasteError']>>();
        expectTypeOf<EventArgs<'llm-stream-end'>>().toExtend<CallbackArgs<Window['api']['onLlmStreamEnd']>>();
        expectTypeOf<EventArgs<'llm-stream-chunk'>>().toExtend<CallbackArgs<Window['api']['onLlmStreamChunk']>>();
        expectTypeOf<EventArgs<'llm-stream-error'>>().toExtend<CallbackArgs<Window['api']['onLlmStreamError']>>();
        expectTypeOf<EventArgs<'teleport-triggered'>>().toEqualTypeOf<CallbackArgs<Window['api']['onTeleportTriggered']>>();
    });

    it('helper types cover every group', () => {
        expectTypeOf<InvokeChannel>().toEqualTypeOf<keyof IpcInvokeMap>();
        expectTypeOf<IpcChannel>().toExtend<string>();
        expectTypeOf<keyof IpcEventMap>().toExtend<IpcChannel>();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// T-304: window.api in electron/preload.cts vs src/types/global.d.ts vs the contract (no drift between the three)
// ---------------------------------------------------------------------------------------------------------------------

type WindowApi = Window['api'];

/** A channel used by a preload method: `<ipcRenderer call>:<channel>` (`on` = through the subscribe() helpers). */
type ChannelRef = `invoke:${InvokeChannel}` | `send:${SendChannel}` | `sendSync:${SyncChannel}` | `on:${EventChannel}`;

/**
 * Every window.api method -> the channels its preload implementation uses. Empty = no IPC (v1 no-op stub or a local
 * value). `satisfies` makes tsc fail when a global.d.ts method is missing here or a channel is not in the contract; the
 * tests below compare this table with the preload source and with global.d.ts.
 */
const API_CHANNELS = {
    hideApp: ['send:hide-app'],
    quitApp: ['send:quit-app'],
    onForceCenterMiniMode: ['on:force-center-mini-mode'],
    onEdgeChanged: ['on:edge-changed'],
    getScreenBounds: ['invoke:get-screen-bounds'],
    getDisplaysInfo: ['invoke:get-displays-info'],
    updateSidebarRect: ['send:update-sidebar-rect'],
    registerTeleportShortcut: ['send:register-teleport-shortcut'],
    onTeleportTriggered: ['on:teleport-triggered'],
    startClipboardListener: ['send:start-clipboard-listener'],
    stopClipboardListener: ['send:stop-clipboard-listener'],
    onClipboardUpdate: ['on:clipboard-updated'],
    writeToClipboard: ['send:write-to-clipboard'],
    setIgnoreMouseEvents: ['send:set-ignore-mouse-events'],
    startEyeDropper: [],
    stopEyeDropper: [],
    onOpenSettings: ['on:open-settings'],
    setGlobalPasteMode: ['send:set-global-paste-mode'],
    onRequestNextPaste: ['on:request-next-paste'],
    executeGlobalPaste: ['send:execute-global-paste'],
    globalPasteVersion: [],
    onClipboardPasteError: ['on:clipboard-paste-error'],
    triggerScreenshot: ['send:trigger-screenshot'],
    takeScreenshot: ['send:take-screenshot'],
    moveWindow: ['send:move-window'],
    recenterWindowOnWidget: ['invoke:recenter-window-on-widget'],
    getWindowPositionSync: ['sendSync:get-window-position-sync'],
    getWindowGeometry: ['sendSync:get-window-geometry'],
    onWindowGeometryChanged: ['on:window-geometry-changed'],
    getFileIcon: ['invoke:get-file-icon'],
    launchFile: ['send:launch-file'],
    getFilePath: ['send:grant-path'],
    getAutoLaunch: ['invoke:get-auto-launch'],
    setAutoLaunch: ['send:set-auto-launch'],
    getMelodyAudio: ['invoke:get-melody-audio'],
    getHwid: [],
    parseFile: ['invoke:parse-file'],
    llmRequest: ['invoke:llm-request'],
    cancelLlmRequest: ['invoke:cancel-llm-request'],
    onLlmStreamChunk: ['on:llm-stream-chunk'],
    onLlmStreamEnd: ['on:llm-stream-end'],
    onLlmStreamError: ['on:llm-stream-error'],
    saveNoteAsText: ['invoke:save-note-as-text'],
    getBackupSources: ['invoke:get-backup-sources'],
    saveFullBackup: ['invoke:save-full-backup'],
    createPreRestoreBackup: ['invoke:create-pre-restore-backup'],
    applyRestoreAndRelaunch: ['invoke:apply-restore-and-relaunch'],
    createPreDeleteBackup: ['invoke:create-pre-delete-backup'],
    enterPinTargetingMode: ['send:enter-pin-targeting'],
    unpinCurrentWindow: ['send:unpin-current-window'],
    unpinAll: ['send:unpin-all-windows'],
    onPinnedWindowChanged: ['on:pinned-window-changed'],
    onPinTargetingComplete: ['on:pin-targeting-complete'],
    getPinBorderStyle: ['invoke:get-pin-border-style'],
    setPinBorderStyle: ['invoke:set-pin-border-style'],
    getSecretStatus: ['invoke:secret-status'],
    setSecret: ['invoke:secret-set'],
    deleteSecret: ['invoke:secret-delete'],
    gcalStatus: ['invoke:gcal-status'],
    gcalConnect: ['invoke:gcal-connect'],
    gcalDisconnect: ['invoke:gcal-disconnect'],
    gcalListEvents: ['invoke:gcal-list-events'],
    dropToKoBox: ['send:kobox-drop'],
    openKoBox: ['send:kobox-open'],
    cleanKoBox: ['send:kobox-clean'],
    startScreenshotCapture: ['invoke:start-screenshot-capture'],
    cancelScreenshot: ['send:cancel-screenshot'],
    saveScreenshot: ['invoke:save-screenshot'],
    copyScreenshotToClipboard: ['send:copy-screenshot-to-clipboard'],
    screenshotSessionComplete: ['send:screenshot-session-complete'],
    getPlatform: [],
    sendNotification: ['send:send-notification'],
    onMediaUpdate: ['on:media-update'],
    sendMediaCommand: ['send:media-command'],
    getActiveVideoUrls: ['invoke:get-active-video-urls'],
    openPip: ['send:open-pip'],
    closePip: ['send:close-pip'],
    onPipClosed: ['on:pip-closed'],
    onVideoUrlsUpdate: ['on:video-urls-update'],
    getSmtcSource: ['invoke:get-smtc-source'],
    onUpdateAvailable: ['on:update-available'],
    onUpdateDownloadProgress: ['on:update-download-progress'],
    onUpdateDownloadComplete: ['on:update-download-complete'],
    onUpdateError: ['on:update-error'],
    askForUpdate: ['invoke:ask-for-update'],
    downloadAndInstallUpdate: ['send:download-and-install-update'],
    quitAndInstallUpdate: ['send:quit-and-install-update'],
    checkForUpdatesManual: ['invoke:check-for-updates-manual'],
    openExternal: ['send:open-external'],
    getAppVersion: ['invoke:get-app-version'],
    isDev: ['invoke:is-dev'],
    getInstalledExtensions: ['invoke:get-installed-extensions'],
    checkPluginUpdates: ['invoke:check-plugin-updates'],
    getAvailableExtensions: [],
    installExtension: [],
    uninstallExtension: ['invoke:uninstall-extension'],
    toggleExtensionEnabled: ['invoke:toggle-extension-enabled'],
    setExtensionsConfig: ['invoke:set-extensions-config'],
    installExtensionFromFile: ['invoke:install-extension-from-file'],
    installExtensionFromPath: ['invoke:install-extension-from-path'],
    installExtensionFromGithub: ['invoke:install-extension-from-github'],
    onPluginInstallProgress: ['on:plugin-install-progress'],
} as const satisfies Record<keyof WindowApi, readonly ChannelRef[]>;

/**
 * The window.api members global.d.ts keeps hand-written instead of deriving them from the contract, and why:
 *   wire        the preload reshapes the arguments (positional args <-> one object); the mapping is checked below
 *   looser      the v1 type is looser than the contract (`any` or a wider type), so deriving would change a plugin-visible type
 *   pinned-text identical to the contract, but tests/pinBorder.test.ts pins the declaration text
 *   local       no IPC result behind it (v1 no-op stub, or a local value; getFilePath only reports a path grant on the side)
 */
const HAND_WRITTEN = {
    moveWindow: 'wire',
    sendNotification: 'wire',
    openPip: 'wire',
    saveNoteAsText: 'wire',
    askForUpdate: 'wire',
    onPluginInstallProgress: 'wire',
    onEdgeChanged: 'looser',
    getScreenBounds: 'looser',
    getDisplaysInfo: 'looser',
    recenterWindowOnWidget: 'looser',
    llmRequest: 'looser',
    onClipboardUpdate: 'looser',
    setPinBorderStyle: 'looser',
    getInstalledExtensions: 'looser',
    onLlmStreamChunk: 'looser',
    onLlmStreamEnd: 'looser',
    onLlmStreamError: 'looser',
    getPinBorderStyle: 'pinned-text',
    startEyeDropper: 'local',
    stopEyeDropper: 'local',
    getHwid: 'local',
    getAvailableExtensions: 'local',
    installExtension: 'local',
    getFilePath: 'local',
    getPlatform: 'local',
    globalPasteVersion: 'local',
} as const satisfies Partial<Record<keyof WindowApi, 'wire' | 'looser' | 'pinned-text' | 'local'>>;

/** Contract channels no window.api method uses: the preload's internal channels (named outside the api object). */
const INTERNAL_CHANNELS = {
    'backup-kobar-storage': 'sendSync at preload start (T-201)',
    'flush-persist': 'subscribed at preload start (T-129)',
    'flush-persist-done': 'ack of flush-persist (T-129)',
    'media-resync': 'sent by the subscribeWithResync() helper (T-128)',
    'storage-snapshot': 'boot snapshot read at preload start, handed out once through window.__kobarStorage (T-403)',
    'storage-write': 'file-backed store write, claim-once bridge only (T-403)',
    'storage-write-sync': 'file-backed store unload write, claim-once bridge only (T-403)',
    'storage-localstorage-snapshot': 'one-time masked localStorage archive, claim-once bridge only (T-404)',
    'settings:publish-state': 'Settings window sync: the main window publishes its settings, claim-once bridge only (T-606)',
    'settings:apply-action': 'Settings window sync: actions pushed to the main window, claim-once bridge only (T-606)',
    'settings:open': 'Settings window opener (optional page), claim-once bridge only, never window.api (T-615)',
} as const satisfies Partial<Record<IpcChannel, string>>;

/** Contract channels used ONLY by the Settings window's narrow preload (window.settingsBridge, T-606); never by the main preload. */
const SETTINGS_PRELOAD_CHANNELS = {
    'settings:action': 'send: an action for the main window',
    'settings:request-state': 'send: ask for the current snapshot',
    'settings:state': 'on: the snapshots main relays',
    'settings:show-page': 'on: the main window asked for a page of the already open window (T-615)',
    'gcal-settings-status': 'invoke: Google Calendar status for Settings > Integrations (R2-15)',
    'gcal-settings-connect': 'invoke: start the Google sign-in (R2-15)',
    'gcal-settings-disconnect': 'invoke: revoke and forget the Google sign-in (R2-15)',
    'gcal-settings-set-enabled': 'invoke: the Experimental feature switch (R2-15)',
    'gcal-settings-refresh': 'invoke: refresh the cached events (R2-15)',
} as const satisfies Partial<Record<IpcChannel, string>>;

/** `name -> source` of every top-level member of `contextBridge.exposeInMainWorld('api', { ... })` (comments stripped). */
function preloadApiMembers(): Map<string, string> {
    const start = preload.indexOf("contextBridge.exposeInMainWorld('api', {");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = preload.slice(start);
    const end = rest.search(/^\}\);/m);
    expect(end).toBeGreaterThan(0);
    return membersOf(rest.slice(0, end), 4);
}

/** `name -> declaration` of every member of `api: { ... }` in src/types/global.d.ts (comments stripped). */
function globalApiMembers(): Map<string, string> {
    const source = code('src/types/global.d.ts');
    const start = source.indexOf('        api: {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start);
    const end = rest.search(/^ {8}\};/m);
    expect(end).toBeGreaterThan(0);
    return membersOf(rest.slice(0, end), 12);
}

function membersOf(body: string, indent: number): Map<string, string> {
    const members = new Map<string, string>();
    const keys = [...body.matchAll(new RegExp(`^ {${indent}}([A-Za-z]\\w*):`, 'gm'))];
    keys.forEach((match, i) => {
        expect(members.has(match[1]), `duplicate member ${match[1]}`).toBe(false);
        members.set(match[1], body.slice(match.index + match[0].length, keys[i + 1]?.index ?? body.length).trim());
    });
    return members;
}

/** The channels one preload method uses, as `kind:channel`. */
function channelRefsOf(source: string): string[] {
    const refs = [...source.matchAll(/ipcRenderer\.(invoke|send|sendSync)\(\s*'([^']+)'/g)].map((m) => `${m[1]}:${m[2]}`);
    for (const m of source.matchAll(/\bsubscribe(?:WithResync)?(?:<[^>]*>)?\(\s*'([^']+)'/g)) refs.push(`on:${m[1]}`);
    return refs.sort();
}

const DERIVED_KIND: Record<string, string> = { InvokeMethod: 'invoke', SendMethod: 'send', SyncMethod: 'sendSync', EventMethod: 'on' };

describe('window.api: preload vs global.d.ts vs contract (T-304)', () => {
    const preloadMembers = preloadApiMembers();
    const globalMembers = globalApiMembers();

    it('the preload and global.d.ts declare exactly the same window.api methods (no allow-list)', () => {
        expect(preloadMembers.size).toBeGreaterThan(60);
        expect(sorted(new Set(globalMembers.keys()))).toEqual(sorted(new Set(preloadMembers.keys())));
        expect(sorted(new Set(Object.keys(API_CHANNELS)))).toEqual(sorted(new Set(preloadMembers.keys())));
    });

    it('each preload method uses exactly the channels listed in API_CHANNELS', () => {
        for (const [name, source] of preloadMembers) {
            expect(channelRefsOf(source), name).toEqual([...API_CHANNELS[name as keyof typeof API_CHANNELS]].sort());
        }
    });

    it('every contract channel is reachable from a window.api method, except the documented internal ones', () => {
        const reachable = new Set(Object.values(API_CHANNELS).flatMap((refs) => refs.map((ref) => ref.slice(ref.indexOf(':') + 1))));
        const all = union(contract.invoke, contract.send, contract.sync, contract.event);
        // T-605: the main-only channels (no preload sender yet) are not reachable either; T-606: nor the Settings preload's channels.
        const unreachable = union(
            new Set(Object.keys(INTERNAL_CHANNELS)),
            new Set(ONE_SIDED.handledWithoutSender),
            new Set(Object.keys(SETTINGS_PRELOAD_CHANNELS))
        );
        expect(sorted(minus(all, reachable))).toEqual(sorted(unreachable));
        for (const channel of ONE_SIDED.handledWithoutSender) expect(preload, channel).not.toContain(`'${channel}'`);
        // The Settings preload's channels exist there only (not in the plugin-visible main preload, not in the PiP preload).
        expect(sorted(union(settingsSend, settingsListen, settingsInvoke))).toEqual(
            sorted(new Set(Object.keys(SETTINGS_PRELOAD_CHANNELS)))
        );
        for (const channel of Object.keys(SETTINGS_PRELOAD_CHANNELS)) {
            expect(preload, channel).not.toContain(`'${channel}'`);
            expect(pipPreload, channel).not.toContain(`'${channel}'`);
        }
        // The internal channels are still used by the preload, outside the api object.
        const outsideApi = preload.slice(0, preload.indexOf("contextBridge.exposeInMainWorld('api', {"));
        for (const channel of Object.keys(INTERNAL_CHANNELS)) expect(outsideApi, channel).toContain(`'${channel}'`);
    });

    it('global.d.ts derives every member except HAND_WRITTEN, from the channel the preload uses', () => {
        const derivedPattern = /^(InvokeMethod|SendMethod|SyncMethod|EventMethod)<'([^']+)'>;$/;
        for (const [name, declaration] of globalMembers) {
            const match = declaration.match(derivedPattern);
            if (Object.hasOwn(HAND_WRITTEN, name)) {
                expect(match, `${name} is listed as hand-written`).toBeNull();
            } else {
                expect(match, `${name} should be derived from the contract`).not.toBeNull();
                expect([`${DERIVED_KIND[match![1]]}:${match![2]}`], name).toEqual(API_CHANNELS[name as keyof typeof API_CHANNELS]);
            }
        }
    });

    it.each([
        ['electron/preload.cts', readRepoFile('electron/preload.cts')],
        ['electron/pip-preload.cts', readRepoFile('electron/pip-preload.cts')],
        ['electron/settings-preload.cts', readRepoFile('electron/settings-preload.cts')],
    ])('%s calls IPC only through the typed ipcRenderer view', (_file, source) => {
        // Electron's untyped ipcRenderer is imported under another name and used exactly once: annotated as the contract's
        // TypedIpcRenderer, so every ipcRenderer.invoke/send/sendSync/on call is checked against the contract by tsc.
        expect(source).toMatch(/^import \{[^}]*\bipcRenderer as electronIpcRenderer\b[^}]*\} from 'electron';$/m);
        expect(source).toMatch(/^const ipcRenderer: TypedIpcRenderer<Electron\.IpcRendererEvent> = electronIpcRenderer;$/m);
        expect(source.match(/\belectronIpcRenderer\b/g)).toHaveLength(2);
        expect(source).toMatch(/^import type \{[^}]*\bTypedIpcRenderer\b[^}]*\} from '\.\.\/shared\/ipc-contract\.js' with \{/m);
        // No escape hatches: no cast of ipcRenderer, no other electron import, no require (sandboxed preload), and
        // nothing but type imports from shared/.
        expect(source).not.toMatch(/\(\s*ipcRenderer\s+as\b|\bipcRenderer\s+as\s+(?!electronIpcRenderer\b)/);
        expect(source).not.toMatch(/\brequire\(/);
        expect(source.match(/from 'electron'/g)).toHaveLength(1);
        expect(source).not.toMatch(/^import (?!type )[^;]*from '\.\.\/shared\//m);
    });
});

// Compile-time checks for T-304 (verified by `tsc -b` through tsconfig.test.json).
describe('window.api typings derived from the contract (T-304)', () => {
    type CallbackArgs<F> = F extends (callback: (...args: infer A) => void) => unknown ? A : never;
    type MethodOf<R> = R extends `invoke:${infer C extends InvokeChannel}`
        ? InvokeMethod<C>
        : R extends `send:${infer C extends SendChannel}`
          ? SendMethod<C>
          : R extends `sendSync:${infer C extends SyncChannel}`
            ? SyncMethod<C>
            : R extends `on:${infer C extends EventChannel}`
              ? EventMethod<C>
              : never;

    it('window.api is still exactly the v1 type (plugin contract v1: the derivation changed no plugin-visible type)', () => {
        expectTypeOf<WindowApi>().toEqualTypeOf<V1WindowApi>();
    });

    it('every derived member is the contract method of the channel the preload uses', () => {
        type Derived = Exclude<keyof typeof API_CHANNELS, keyof typeof HAND_WRITTEN>;
        type Implied = { [K in Derived]: MethodOf<(typeof API_CHANNELS)[K][0]> };
        expectTypeOf<Pick<WindowApi, Derived>>().toEqualTypeOf<Implied>();
    });

    it('hand-written "wire" members: the preload reshapes the arguments exactly like this', () => {
        // Extract: window.api also has plain values (globalPasteVersion, R4), not only methods.
        type P<K extends keyof WindowApi> = Parameters<Extract<WindowApi[K], (...args: never[]) => unknown>>;
        expectTypeOf<SendArgs<'move-window'>>().toEqualTypeOf<[{ dx: P<'moveWindow'>[0]; dy: P<'moveWindow'>[1] }]>();
        expectTypeOf<SendArgs<'send-notification'>>().toEqualTypeOf<
            [{ title: P<'sendNotification'>[0]; body: P<'sendNotification'>[1] }]
        >();
        expectTypeOf<SendArgs<'open-pip'>>().toEqualTypeOf<
            [{ url: P<'openPip'>[0]; title: P<'openPip'>[1]; albumArt?: P<'openPip'>[2] }]
        >();
        expectTypeOf<InvokeArgs<'save-note-as-text'>>().toEqualTypeOf<
            [{ title: P<'saveNoteAsText'>[0]; content: P<'saveNoteAsText'>[1] }]
        >();
        expectTypeOf<InvokeArgs<'ask-for-update'>>().toEqualTypeOf<
            [{ title: P<'askForUpdate'>[0]; message: P<'askForUpdate'>[1]; yesLabel: P<'askForUpdate'>[2]; noLabel: P<'askForUpdate'>[3] }]
        >();
        type ProgressArgs = CallbackArgs<WindowApi['onPluginInstallProgress']>;
        expectTypeOf<EventArgs<'plugin-install-progress'>>().toEqualTypeOf<[{ id: ProgressArgs[0]; percent: ProgressArgs[1] }]>();
        // Results are passed through unchanged.
        expectTypeOf<ReturnType<WindowApi['saveNoteAsText']>>().toEqualTypeOf<Promise<InvokeResult<'save-note-as-text'>>>();
        expectTypeOf<ReturnType<WindowApi['askForUpdate']>>().toEqualTypeOf<Promise<InvokeResult<'ask-for-update'>>>();
    });

    it('hand-written "looser" members: the contract types fit into the v1 types', () => {
        // Extract: window.api also has plain values (globalPasteVersion, R4), not only methods.
        type P<K extends keyof WindowApi> = Parameters<Extract<WindowApi[K], (...args: never[]) => unknown>>;
        expectTypeOf<InvokeArgs<'recenter-window-on-widget'>>().toEqualTypeOf<P<'recenterWindowOnWidget'>>();
        expectTypeOf<InvokeArgs<'set-pin-border-style'>>().toEqualTypeOf<P<'setPinBorderStyle'>>();
        expectTypeOf<InvokeArgs<'llm-request'>>().toExtend<P<'llmRequest'>>();
        expectTypeOf<InvokeResult<'llm-request'>>().toEqualTypeOf<Awaited<ReturnType<WindowApi['llmRequest']>>>();
        expectTypeOf<EventArgs<'edge-changed'>>().toExtend<CallbackArgs<WindowApi['onEdgeChanged']>>();
        expectTypeOf<EventArgs<'clipboard-updated'>>().toExtend<CallbackArgs<WindowApi['onClipboardUpdate']>>();
        // The getScreenBounds, getDisplaysInfo, getInstalledExtensions, setPinBorderStyle results and the llm-stream-*
        // payloads are checked in 'IPC contract vs. window.api typings' above.
    });

    it('the typed ipcRenderer view rejects channels, arguments and listeners that disagree with the contract', () => {
        // Type-only: the function is never called, so nothing runs against the placeholder object.
        const typeOnly = (ipc: TypedIpcRenderer<unknown>) => {
            expectTypeOf(ipc.invoke('get-app-version')).toEqualTypeOf<Promise<string>>();
            expectTypeOf(ipc.sendSync('get-window-position-sync')).toEqualTypeOf<[number, number]>();
            // @ts-expect-error not an invoke channel (it is a send channel)
            void ipc.invoke('hide-app');
            // @ts-expect-error unknown channel
            ipc.send('no-such-channel');
            // @ts-expect-error wrong wire argument type
            ipc.send('set-ignore-mouse-events', 'yes');
            // @ts-expect-error missing wire argument
            void ipc.invoke('get-file-icon');
            // @ts-expect-error the update-available payload is a string, not a number
            ipc.on('update-available', (_event: unknown, version: number) => version);
        };
        expect(typeof typeOnly).toBe('function');
    });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- verbatim copy of the v1 declaration, `any`s included */
/**
 * The `window.api` type exactly as src/types/global.d.ts declared it by hand before T-304 (plugin contract v1). The test
 * above requires the derived declaration to stay identical; change it only together with an owner-approved
 * plugin-contract change (CLAUDE.md rule 6). Later host additions (methods only, nothing existing changed) are added here
 * explicitly and marked as such: getWindowGeometry (T-320; its result gained the active display in T-321),
 * onWindowGeometryChanged (T-321) and getSecretStatus / setSecret / deleteSecret (T-411).
 */
/** T-411 host addition: the answer of the three secret methods (never contains a secret's value). T-417 added `reserved-name`. */
type SecretResultV1 = {
    success: boolean;
    reason?:
        | 'invalid-request'
        | 'invalid-name'
        | 'reserved-name'
        | 'invalid-value'
        | 'too-large'
        | 'limit-reached'
        | 'encryption-unavailable'
        | 'encryption-failed'
        | 'io'
        | 'denied';
    status?: { name: string; exists: boolean; last4: string | null; encryptionAvailable: boolean; unreadable: boolean };
};
type GcalStatusV1 = {
    state: 'not-configured' | 'not-connected' | 'connected' | 'reconnect-needed';
    enabled: boolean;
    configured: boolean;
    connected: boolean;
    lastRefreshAt: number | null;
};
type V1WindowApi = {
    hideApp: () => void;
    quitApp: () => void;
    onForceCenterMiniMode: (callback: () => void) => () => void;
    onEdgeChanged: (callback: (edge: 'left' | 'right', bounds?: any) => void) => () => void;
    getScreenBounds: () => Promise<any>;
    getDisplaysInfo: () => Promise<{ primaryDisplay: any; allDisplays: any[] }>;
    updateSidebarRect: (rect: { width: number; height: number; offsetX: number; offsetY: number }) => void;
    registerTeleportShortcut: (shortcut: string) => void;
    onTeleportTriggered: (callback: (data: { x: number; y: number }) => void) => () => void;
    // Clipboard Manager
    startClipboardListener: () => void;
    stopClipboardListener: () => void;
    onClipboardUpdate: (callback: (data: { type: string; content: string }) => void) => () => void;
    writeToClipboard: (data: { type: string; content: string }) => void;
    // Mouse click-through
    setIgnoreMouseEvents: (ignore: boolean) => void;
    // EyeDropper: v1 compatibility no-ops (the host has no eyedropper service)
    startEyeDropper: () => Promise<{ x: number; y: number }>;
    stopEyeDropper: () => Promise<void>;
    onOpenSettings: (callback: () => void) => () => void;
    // Global Paste Support
    setGlobalPasteMode: (isActive: boolean) => void;
    onRequestNextPaste: (callback: () => void) => () => void;
    executeGlobalPaste: (data: { type: string; content: string }) => void;
    // R4: additive capability flag (owner-approved), not a v1 method.
    globalPasteVersion: number;
    onClipboardPasteError: (callback: (data: { error: string; message: string }) => void) => () => void;
    triggerScreenshot: () => void;
    takeScreenshot: (hideApp: boolean) => void;
    moveWindow: (dx: number, dy: number) => void;
    recenterWindowOnWidget: (
        x: number,
        y: number,
        width: number,
        height: number
    ) => Promise<{ x: number; y: number; displayBounds: any } | null>;
    getWindowPositionSync: () => [number, number];
    // Window model from main (T-320; host addition, not part of the v1 plugin contract; added to this pin explicitly)
    getWindowGeometry: () => {
        width: number;
        height: number;
        centerX: number;
        centerY: number;
        fallbackScreenWidth: number;
        fallbackScreenHeight: number;
        // T-321 (host addition): the active display the window covers, in screen DIP coordinates
        displayId: number;
        displayBounds: { x: number; y: number; width: number; height: number };
        workArea: { x: number; y: number; width: number; height: number };
        scaleFactor: number;
    } | null;
    // Window re-fitted to a display (T-321; host addition, not part of the v1 plugin contract)
    onWindowGeometryChanged: (
        callback: (geometry: {
            width: number;
            height: number;
            centerX: number;
            centerY: number;
            fallbackScreenWidth: number;
            fallbackScreenHeight: number;
            displayId: number;
            displayBounds: { x: number; y: number; width: number; height: number };
            workArea: { x: number; y: number; width: number; height: number };
            scaleFactor: number;
        }) => void
    ) => () => void;
    // Native App Launcher
    getFileIcon: (path: string) => Promise<string | null>;
    launchFile: (path: string) => void;
    getFilePath: (file: File) => string;
    // Auto-launch
    getAutoLaunch: () => Promise<boolean>;
    setAutoLaunch: (enabled: boolean) => void;
    // Focus Audio
    getMelodyAudio: (name: string) => Promise<string | null>;
    // License API
    getHwid: () => Promise<string | null>;
    // Pin Injector
    enterPinTargetingMode: () => void;
    unpinCurrentWindow: () => void;
    unpinAll: () => void;
    onPinnedWindowChanged: (callback: (hwnd: number | null) => void) => () => void;
    onPinTargetingComplete: (cb: () => void) => () => void;
    // Pin border style (T-146, host addition): color `#RRGGBB`, width integer 1-4 (CSS px)
    getPinBorderStyle: () => Promise<{ color: string; width: number }>;
    setPinBorderStyle: (style: { color: string; width: number }) => Promise<{ success: boolean; error?: string }>;
    // Encrypted secrets (T-411; host addition, not part of the v1 plugin contract): the value is never returned
    getSecretStatus: (name: string) => Promise<SecretResultV1>;
    setSecret: (name: string, value: string) => Promise<SecretResultV1>;
    deleteSecret: (name: string) => Promise<SecretResultV1>;
    // R2-15 host addition: Google Calendar v1 (Experimental, read-only)
    gcalStatus: () => Promise<GcalStatusV1>;
    gcalConnect: () => Promise<{ success: boolean; reason?: IpcGcalConnectFailure; status: GcalStatusV1 }>;
    gcalDisconnect: () => Promise<GcalStatusV1>;
    gcalListEvents: (range: {
        from: string;
        to: string;
    }) => Promise<Array<{ id: string; title: string; start: string; end: string; allDay: boolean; calendar: 'google' }>>;
    // KoBox
    dropToKoBox: (paths: string[]) => void;
    openKoBox: () => void;
    cleanKoBox: (mode: '24h' | 'quit') => void;

    // Screenshot Studio
    startScreenshotCapture: () => Promise<{
        captures: Array<{
            displayId: string;
            bounds: { x: number; y: number; width: number; height: number };
            scaleFactor: number;
            imageDataUrl: string;
        }>;
        windowPosition: { x: number; y: number };
        error?: 'permission_denied' | 'rate_limited';
        retryAfterMs?: number;
    }>;
    cancelScreenshot: () => void;
    saveScreenshot: (data: {
        buffer: string;
        format: string;
        destinationPath?: string;
        defaultPath?: string;
    }) => Promise<{ success: boolean; path?: string; reason?: string }>;
    copyScreenshotToClipboard: (dataUrl: string) => void;
    screenshotSessionComplete: () => void;

    // Platform
    getPlatform: () => string;
    sendNotification: (title: string, body: string) => void;

    // KoPlayer Media Controller
    onMediaUpdate: (callback: (data: MediaUpdate) => void) => () => void;
    sendMediaCommand: (command: 'play' | 'pause' | 'next' | 'prev') => void;

    // PIP Video Player (webview-based mini browser)
    getActiveVideoUrls: () => Promise<string[]>;
    openPip: (url: string, title: string, albumArt?: string) => void;
    closePip: () => void;
    onPipClosed: (callback: () => void) => () => void;
    onVideoUrlsUpdate: (callback: (urls: string[]) => void) => () => void;
    getSmtcSource: () => Promise<string>;

    // AI Hub Context
    parseFile: (filePath: string) => Promise<{ type: 'text' | 'image' | 'error'; content: string; error?: string }>;
    llmRequest: (data: {
        chatId: string;
        messageId: string;
        provider: string;
        model: string;
        messages: any[];
        apiKeys?: any;
        systemPrompt?: string;
    }) => Promise<void>;
    cancelLlmRequest: (messageId: string) => Promise<void>;
    onLlmStreamChunk: (callback: (data: { chatId: string; messageId: string; chunk: string }) => void) => () => void;
    onLlmStreamEnd: (callback: (data: { chatId: string; messageId: string }) => void) => () => void;
    onLlmStreamError: (callback: (data: { chatId: string; messageId: string; error: string }) => void) => () => void;

    // Notes
    saveNoteAsText: (title: string, content: string) => Promise<{ success: boolean; path?: string; reason?: string }>;

    // Full backup export (T-211; host addition, not part of the v1 plugin contract)
    getBackupSources: () => Promise<{
        extensionsConfig: Record<string, boolean>;
        plugins: Array<{ id: string; folder: string; name: string; version: string; enabled: boolean; githubRepo: string }>;
    }>;
    saveFullBackup: (text: string) => Promise<{ success: boolean; path?: string; reason?: string }>;
    // Full backup restore (T-213; host addition, not part of the v1 plugin contract)
    createPreRestoreBackup: (text: string) => Promise<{ success: boolean; reason?: string }>;
    applyRestoreAndRelaunch: (extensionsConfig: Record<string, boolean>) => Promise<{ success: boolean; reason?: string }>;
    // Automatic backup before a workspace delete (T-214; host addition, not part of the v1 plugin contract)
    createPreDeleteBackup: (text: string) => Promise<{ success: boolean; reason?: string }>;

    // Auto Updater
    onUpdateAvailable: (callback: (version: string) => void) => () => void;
    onUpdateDownloadProgress: (
        callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
    ) => () => void;
    onUpdateDownloadComplete: (callback: (version: string) => void) => () => void;
    onUpdateError: (callback: (error: string) => void) => () => void;
    askForUpdate: (title: string, message: string, yesLabel: string, noLabel: string) => Promise<boolean>;
    downloadAndInstallUpdate: () => void;
    quitAndInstallUpdate: () => void;
    checkForUpdatesManual: () => Promise<{
        status: 'success' | 'error' | 'disabled';
        updateAvailable?: boolean;
        version?: string;
        message?: string;
    }>;

    openExternal: (url: string) => void;
    getAppVersion: () => Promise<string>;
    isDev: () => Promise<boolean>;

    // Extensions API
    getInstalledExtensions: () => Promise<
        Array<{
            id: string;
            name: string;
            version: string;
            description: string;
            icon: string;
            enabled: boolean;
            code?: string;
            image?: string;
            categories?: string[];
            versionNote?: string;
            githubRepo?: string;
        }>
    >;
    checkPluginUpdates: () => Promise<
        Array<{
            id: string;
            name: string;
            currentVersion: string;
            latestVersion: string;
            releaseNotes: string;
            repo: string;
            source?: 'registry' | 'github' | 'zip' | 'bundled' | 'legacy';
            legacyOrigin?: boolean;
        }>
    >;
    getAvailableExtensions: () => Promise<
        Array<{ id: string; name: string; version: string; description: string; icon: string; downloadUrl: string }>
    >;
    installExtension: (id: string) => Promise<boolean>;
    uninstallExtension: (id: string) => Promise<boolean>;
    toggleExtensionEnabled: (id: string, enabled: boolean) => Promise<boolean>;
    setExtensionsConfig: (config: Record<string, boolean>) => Promise<boolean>;
    installExtensionFromFile: () => Promise<{ success: boolean; reason?: string }>;
    installExtensionFromPath: (filePath: string) => Promise<{ success: boolean; reason?: string }>;
    installExtensionFromGithub: (id: string, repo: string) => Promise<{ success: boolean; reason?: string }>;
    onPluginInstallProgress: (callback: (id: string, percent: number) => void) => () => void;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
