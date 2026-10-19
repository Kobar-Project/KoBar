import { contextBridge, ipcRenderer as electronIpcRenderer, webUtils } from 'electron';
import type { MediaUpdate } from './lib/mediaTypes.cjs';
import { createSettingsSyncBridge } from './lib/settingsSyncBridge.cjs';
import { createStorageBridge } from './lib/storageBridge.cjs';
import type { EventArgs, EventChannel, IpcMediaResyncChannel, IpcWindowGeometry, TypedIpcRenderer } from '../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};

// T-304: every IPC call below goes through this typed view of Electron's ipcRenderer (same object, type annotation only),
// so a channel name, wire argument or result that disagrees with shared/ipc-contract.ts is a compile error. The import
// above is type-only and erased by the bundler: this sandboxed preload still requires nothing but `electron`.
const ipcRenderer: TypedIpcRenderer<Electron.IpcRendererEvent> = electronIpcRenderer;

// T-201 (PROD-02): before any page script runs (and therefore before the persist store can hydrate or migrate it), hand
// the raw `kobar-storage` value to main, which writes a masked backup to userData/backups/ when it changed. Synchronous
// so the backup is on disk before migration. Internal channel, not part of window.api. Must never throw or block startup
// on failure. globalThis is the isolated world's view of the page window (same origin, same localStorage).
try {
    const pageStorage = (globalThis as unknown as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    const rawPersisted = pageStorage?.getItem('kobar-storage');
    if (typeof rawPersisted === 'string') ipcRenderer.sendSync('backup-kobar-storage', rawPersisted);
} catch (err) {
    console.error('[KoBar] kobar-storage backup request failed:', err);
}

// T-403: the file-backed store transport (internal, NOT window.api). ONE boot snapshot is read here, synchronously, after the
// backup above and before any page script runs. `window.__kobarStorage.claim()` hands it and the write functions out exactly
// once (the host claims at renderer start, see electron/lib/storageBridge.cts), so neither the snapshot nor these channels
// stay reachable for plugins. Main checks the sender on every call.
contextBridge.exposeInMainWorld(
    '__kobarStorage',
    createStorageBridge({
        readSnapshot: () => ipcRenderer.sendSync('storage-snapshot', 'kobar-storage'),
        write: (request) => ipcRenderer.invoke('storage-write', request),
        writeSync: (request) => ipcRenderer.sendSync('storage-write-sync', request),
        // T-404: the one-time masked localStorage archive (sent after hydration, see src/storage/migrateFromLocalStorage.ts).
        archiveLocalStorage: (request) => ipcRenderer.invoke('storage-localstorage-snapshot', request),
    })
);

/**
 * Shared subscription helper for every `on*` API. Registers its OWN handler and returns an unsubscribe function that
 * removes exactly that handler (never `removeAllListeners`, which would also drop other subscribers' handlers).
 * The IPC event object is stripped; the callback receives only the payload arguments.
 */
function subscribe<C extends EventChannel>(channel: C, callback: (...args: EventArgs<C>) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, ...args: EventArgs<C>) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.removeListener(channel, handler);
    };
}

/**
 * `subscribe` for deduplicated main-process channels (T-128): after registering, ask main to resend the last payload
 * of this channel, because the unchanged-data filter would otherwise never deliver it to a late subscriber
 * (renderer reload, HMR, plugin subscribing later). Internal channel, not part of window.api.
 */
function subscribeWithResync<C extends EventChannel & IpcMediaResyncChannel>(
    channel: C,
    callback: (...args: EventArgs<C>) => void
): () => void {
    const unsubscribe = subscribe(channel, callback);
    ipcRenderer.send('media-resync', channel);
    return unsubscribe;
}

// T-129: main asks the renderer to write its debounced persist state before quit / session end. Re-dispatched as a DOM
// event (listeners run synchronously, see src/store/persistStorage.ts), then acknowledged. Internal: not in window.api.
subscribe('flush-persist', (id) => {
    try {
        // globalThis is the (isolated world's view of the) page window; the electron tsconfig has no DOM lib.
        (globalThis as unknown as EventTarget).dispatchEvent(new Event('kobar:flush-persist'));
    } finally {
        ipcRenderer.send('flush-persist-done', id);
    }
});

// T-606: the main window's half of the Settings window state sync (internal, NOT window.api). Claim-once like __kobarStorage: the
// host claims it at renderer start (src/store/sync.ts), so plugins never reach these channels. Main accepts `settings:publish-state`
// from the main window top frame only and pushes `settings:apply-action` to the main window only (electron/main/windows/settingsSync.cts).
contextBridge.exposeInMainWorld(
    '__kobarSettingsSync',
    createSettingsSyncBridge({
        publish: (message) => ipcRenderer.send('settings:publish-state', message),
        onAction: (callback) => subscribe('settings:apply-action', callback),
        // T-615: the host's opener (openSettingsTab / openPluginsTab); main accepts it from the main window top frame only.
        openSettings: (page) => (page === undefined ? ipcRenderer.send('settings:open') : ipcRenderer.send('settings:open', page)),
    })
);

console.log('Preload loaded successfully');
contextBridge.exposeInMainWorld('api', {
    hideApp: () => ipcRenderer.send('hide-app'),
    quitApp: () => ipcRenderer.send('quit-app'),
    onForceCenterMiniMode: (callback: () => void) => subscribe('force-center-mini-mode', () => callback()),
    onEdgeChanged: (callback: (edge: 'left' | 'right', bounds?: any) => void) => subscribe('edge-changed', callback),
    getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
    getDisplaysInfo: () => ipcRenderer.invoke('get-displays-info'),
    updateSidebarRect: (rect: { width: number, height: number, offsetX: number, offsetY: number }) => ipcRenderer.send('update-sidebar-rect', rect),
    // Teleport Shortcut
    registerTeleportShortcut: (shortcut: string) => ipcRenderer.send('register-teleport-shortcut', shortcut),
    onTeleportTriggered: (callback: (data: { x: number, y: number }) => void) => subscribe('teleport-triggered', callback),
    // Clipboard Manager
    startClipboardListener: () => ipcRenderer.send('start-clipboard-listener'),
    stopClipboardListener: () => ipcRenderer.send('stop-clipboard-listener'),
    onClipboardUpdate: (callback: (data: { type: string; content: string }) => void) => subscribe('clipboard-updated', callback),
    writeToClipboard: (data: { type: string; content: string }) => {
        ipcRenderer.send('write-to-clipboard', data);
    },
    // Mouse click-through for transparent window
    setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('set-ignore-mouse-events', ignore),
    // v1 plugin contract (colorPicker): the host has no eyedropper service. startEyeDropper stays a no-op offset. The system
    // eyedropper takes over the mouse, so no mousemove reaches the window afterwards and the click-through state set before
    // it would stay stuck at "solid" (MAC-032). stopEyeDropper therefore hands the window back to click-through (main applies
    // { forward: true }) and tells the host renderer to drop its cached state; the next mousemove recomputes it.
    // The event name is mirrored in src/App.tsx (CLICK_THROUGH_RESET_EVENT).
    startEyeDropper: () => Promise.resolve({ x: 0, y: 0 }),
    stopEyeDropper: () => {
        ipcRenderer.send('set-ignore-mouse-events', true);
        (globalThis as unknown as EventTarget).dispatchEvent(new Event('kobar:click-through-reset'));
        return Promise.resolve();
    },
    onOpenSettings: (callback: () => void) => subscribe('open-settings', () => callback()),
    // Global Paste Support
    setGlobalPasteMode: (isActive: boolean) => ipcRenderer.send('set-global-paste-mode', isActive),
    onRequestNextPaste: (callback: () => void) => subscribe('request-next-paste', () => callback()),
    executeGlobalPaste: (data: { type: string; content: string }) => ipcRenderer.send('execute-global-paste', data),
    // R4 (additive, owner-approved): 2 = the host serialises global paste presses itself, so plugins need no debounce. Absent = 1.
    globalPasteVersion: 2,
    onClipboardPasteError: (callback: (data: { error: string; message: string }) => void) => subscribe('clipboard-paste-error', callback),
    triggerScreenshot: () => ipcRenderer.send('trigger-screenshot'),
    takeScreenshot: (hideApp: boolean) => ipcRenderer.send('take-screenshot', hideApp),
    moveWindow: (dx: number, dy: number) => ipcRenderer.send('move-window', { dx, dy }),
    recenterWindowOnWidget: (x: number, y: number, width: number, height: number) => ipcRenderer.invoke('recenter-window-on-widget', x, y, width, height),
    getWindowPositionSync: () => ipcRenderer.sendSync('get-window-position-sync'),
    // Window model from main (T-320, host addition; not part of the v1 plugin contract). Read once by src/utils/windowGeometry.ts.
    getWindowGeometry: () => ipcRenderer.sendSync('get-window-geometry'),
    // Pushed when main re-fits the window to a display (T-321, host addition; not part of the v1 plugin contract).
    onWindowGeometryChanged: (callback: (geometry: IpcWindowGeometry) => void) => subscribe('window-geometry-changed', callback),

    // App Launcher Native
    getFileIcon: (path: string) => ipcRenderer.invoke('get-file-icon', path),
    launchFile: (path: string) => ipcRenderer.send('launch-file', path),
    getFilePath: (file: File) => {
        const filePath = webUtils.getPathForFile(file);
        // T-042: a real path is only returned for a File the user dropped or picked, so report it to main as a
        // user-selected path grant (internal channel, not part of window.api). Main checks the sender.
        if (typeof filePath === 'string' && filePath !== '') ipcRenderer.send('grant-path', filePath);
        return filePath;
    },

    // Auto-launch
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enabled: boolean) => ipcRenderer.send('set-auto-launch', enabled),
    syncAutoLaunch: (desired: boolean) => ipcRenderer.invoke('sync-auto-launch', desired),
    pickTextFiles: () => ipcRenderer.invoke('pick-text-files'),
    takeOpenTextFiles: () => ipcRenderer.invoke('take-open-text-files'),
    onOpenTextFilesAvailable: (callback: () => void) => subscribe('open-text-files-available', () => callback()),

    // Focus Audio
    getMelodyAudio: (name: string) => ipcRenderer.invoke('get-melody-audio', name),

    // Legacy v1 plugin contract no-op (licensing removed); removed in 2.0
    getHwid: () => Promise.resolve(null) as Promise<string | null>,

    // AI Hub Context
    parseFile: (filePath: string) => ipcRenderer.invoke('parse-file', filePath),
    llmRequest: (data: any) => ipcRenderer.invoke('llm-request', data),
    cancelLlmRequest: (messageId: string) => ipcRenderer.invoke('cancel-llm-request', messageId),
    onLlmStreamChunk: (callback: (data: { chatId: string, messageId: string, chunk: string }) => void) => subscribe('llm-stream-chunk', callback),
    onLlmStreamEnd: (callback: (data: { chatId: string, messageId: string }) => void) => subscribe('llm-stream-end', callback),
    onLlmStreamError: (callback: (data: { chatId: string, messageId: string, error: string }) => void) => subscribe('llm-stream-error', callback),

    // Notes
    saveNoteAsText: (title: string, content: string) => ipcRenderer.invoke('save-note-as-text', { title, content }),

    // Full backup export (T-211, host addition; not part of the v1 plugin contract)
    getBackupSources: () => ipcRenderer.invoke('get-backup-sources'),
    saveFullBackup: (text: string) => ipcRenderer.invoke('save-full-backup', text),
    // Full backup restore (T-213, host addition; not part of the v1 plugin contract)
    createPreRestoreBackup: (text: string) => ipcRenderer.invoke('create-pre-restore-backup', text),
    applyRestoreAndRelaunch: (extensionsConfig: Record<string, boolean>) => ipcRenderer.invoke('apply-restore-and-relaunch', extensionsConfig),
    // Automatic backup before a workspace delete (T-214, host addition; not part of the v1 plugin contract)
    createPreDeleteBackup: (text: string) => ipcRenderer.invoke('create-pre-delete-backup', text),

    // Pin Injector
    enterPinTargetingMode: () => ipcRenderer.send('enter-pin-targeting'),
    unpinCurrentWindow: () => ipcRenderer.send('unpin-current-window'),
    unpinAll: () => ipcRenderer.send('unpin-all-windows'),
    onPinnedWindowChanged: (callback: (hwnd: number | null) => void) => subscribe('pinned-window-changed', callback),
    onPinTargetingComplete: (cb: () => void) => subscribe('pin-targeting-complete', () => cb()),
    // Pin border style (T-146, host addition; not part of the v1 plugin contract)
    getPinBorderStyle: () => ipcRenderer.invoke('get-pin-border-style'),
    setPinBorderStyle: (style: { color: string; width: number }) => ipcRenderer.invoke('set-pin-border-style', style),
    // Encrypted secrets (T-411, host addition; not part of the v1 plugin contract). A value goes in once and never comes back:
    // the answers carry { exists, last4 } only (main encrypts with safeStorage and refuses when encryption is unavailable).
    // T-417: only `plugin-<plugin id>-<key>` names are accepted here; other names answer `reserved-name` (core, main-only).
    getSecretStatus: (name: string) => ipcRenderer.invoke('secret-status', name),
    setSecret: (name: string, value: string) => ipcRenderer.invoke('secret-set', name, value),
    deleteSecret: (name: string) => ipcRenderer.invoke('secret-delete', name),
    // Google Calendar v1 (R2-15, host addition, EXPERIMENTAL, read-only; not part of the v1 plugin contract). Tokens never come back:
    // statuses and events only. gcalListEvents answers [] while the user's switch (Settings > Integrations) is off.
    gcalStatus: () => ipcRenderer.invoke('gcal-status'),
    gcalConnect: () => ipcRenderer.invoke('gcal-connect'),
    gcalDisconnect: () => ipcRenderer.invoke('gcal-disconnect'),
    gcalListEvents: (range: { from: string; to: string }) => ipcRenderer.invoke('gcal-list-events', range),

    // KoBox
    dropToKoBox: (paths: string[]) => ipcRenderer.send('kobox-drop', paths),
    openKoBox: () => ipcRenderer.send('kobox-open'),
    cleanKoBox: (mode: '24h' | 'quit') => ipcRenderer.send('kobox-clean', mode),

    // Screenshot Studio
    startScreenshotCapture: () => ipcRenderer.invoke('start-screenshot-capture'),
    cancelScreenshot: () => ipcRenderer.send('cancel-screenshot'),
    saveScreenshot: (data: { buffer: string; format: string; destinationPath?: string; defaultPath?: string }) =>
        ipcRenderer.invoke('save-screenshot', data),
    copyScreenshotToClipboard: (dataUrl: string) => ipcRenderer.send('copy-screenshot-to-clipboard', dataUrl),
    screenshotSessionComplete: () => ipcRenderer.send('screenshot-session-complete'),

    // OS Context
    getPlatform: () => process.platform,
    sendNotification: (title: string, body: string) => ipcRenderer.send('send-notification', { title, body }),

    // KoPlayer Media Controller
    onMediaUpdate: (callback: (data: MediaUpdate) => void) => subscribeWithResync('media-update', callback),
    sendMediaCommand: (command: 'play' | 'pause' | 'next' | 'prev') => ipcRenderer.send('media-command', command),

    // PIP Video Player (webview-based mini browser)
    // Detects video URLs currently open in Chrome/Edge/Brave/Firefox
    getActiveVideoUrls: () => ipcRenderer.invoke('get-active-video-urls'),
    // Opens a PIP window that plays the given URL in an embedded browser
    openPip: (url: string, title: string, albumArt?: string) => ipcRenderer.send('open-pip', { url, title, albumArt }),
    closePip: () => ipcRenderer.send('close-pip'),
    onPipClosed: (callback: () => void) => subscribe('pip-closed', () => callback()),

    // KoPlayer video URL cache — updated automatically when SMTC detects a browser source
    onVideoUrlsUpdate: (callback: (urls: string[]) => void) => subscribeWithResync('video-urls-update', callback),
    getSmtcSource: () => ipcRenderer.invoke('get-smtc-source'),

    // Auto Updater
    onUpdateAvailable: (callback: (version: string) => void) => subscribe('update-available', callback),
    onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => subscribe('update-download-progress', callback),
    onUpdateDownloadComplete: (callback: (version: string) => void) => subscribe('update-download-complete', callback),
    onUpdateError: (callback: (error: string) => void) => subscribe('update-error', callback),
    // The four arguments are ignored by the main process, which shows fixed text (SEC-15).
    askForUpdate: (title: string, message: string, yesLabel: string, noLabel: string) => 
        ipcRenderer.invoke('ask-for-update', { title, message, yesLabel, noLabel }),
    downloadAndInstallUpdate: () => ipcRenderer.send('download-and-install-update'),
    quitAndInstallUpdate: () => ipcRenderer.send('quit-and-install-update'),
    checkForUpdatesManual: () => ipcRenderer.invoke('check-for-updates-manual'),

    // About section support
    openExternal: (url: string) => ipcRenderer.send('open-external', url),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    isDev: () => ipcRenderer.invoke('is-dev'),

    // Extensions API Support
    getInstalledExtensions: () => ipcRenderer.invoke('get-installed-extensions'),
    checkPluginUpdates: () => ipcRenderer.invoke('check-plugin-updates'),
    // Legacy v1 plugin contract no-ops (bundled/dev install path and empty marketplace were removed); removed in 2.0
    getAvailableExtensions: () => Promise.resolve([] as Array<{ id: string; name: string; version: string; description: string; icon: string; downloadUrl: string }>),
    installExtension: (_id: string) => Promise.resolve(false),
    uninstallExtension: (id: string) => ipcRenderer.invoke('uninstall-extension', id),
    toggleExtensionEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('toggle-extension-enabled', id, enabled),
    setExtensionsConfig: (config: Record<string, boolean>) => ipcRenderer.invoke('set-extensions-config', config),
    installExtensionFromFile: () => ipcRenderer.invoke('install-extension-from-file'),
    installExtensionFromPath: (filePath: string) => ipcRenderer.invoke('install-extension-from-path', filePath),
    installExtensionFromGithub: (id: string, repo: string) => ipcRenderer.invoke('install-extension-from-github', id, repo),
    onPluginInstallProgress: (callback: (id: string, percent: number) => void) =>
        subscribe('plugin-install-progress', (data) => callback(data.id, data.percent)),
});
