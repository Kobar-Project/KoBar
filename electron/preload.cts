import { contextBridge, ipcRenderer, webUtils } from 'electron';

console.log('Preload loaded successfully');
contextBridge.exposeInMainWorld('api', {
    hideApp: () => ipcRenderer.send('hide-app'),
    quitApp: () => ipcRenderer.send('quit-app'),
    onForceCenterMiniMode: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('force-center-mini-mode', handler);
        return () => ipcRenderer.removeListener('force-center-mini-mode', handler);
    },
    onEdgeChanged: (callback: (edge: 'left' | 'right', bounds?: any) => void) => {
        ipcRenderer.on('edge-changed', (_event, edge, bounds) => callback(edge, bounds));
    },
    getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
    getDisplaysInfo: () => ipcRenderer.invoke('get-displays-info'),
    updateSidebarRect: (rect: { width: number, height: number, offsetX: number, offsetY: number }) => ipcRenderer.send('update-sidebar-rect', rect),
    // Teleport Shortcut
    registerTeleportShortcut: (shortcut: string) => ipcRenderer.send('register-teleport-shortcut', shortcut),
    onTeleportTriggered: (callback: (data: { x: number, y: number }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { x: number, y: number }) => callback(data);
        ipcRenderer.on('teleport-triggered', handler);
        return () => ipcRenderer.removeListener('teleport-triggered', handler);
    },
    // Clipboard Manager
    startClipboardListener: () => ipcRenderer.send('start-clipboard-listener'),
    stopClipboardListener: () => ipcRenderer.send('stop-clipboard-listener'),
    onClipboardUpdate: (callback: (data: { type: string; content: string }) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { type: string; content: string }) => callback(data);
        ipcRenderer.on('clipboard-updated', handler);
        // Return cleanup function
        return () => {
            ipcRenderer.removeListener('clipboard-updated', handler);
        };
    },
    writeToClipboard: (data: { type: string; content: string }) => {
        ipcRenderer.send('write-to-clipboard', data);
    },
    // Mouse click-through for transparent window
    setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('set-ignore-mouse-events', ignore),
    startEyeDropper: () => ipcRenderer.invoke('start-eyedropper'),
    stopEyeDropper: () => ipcRenderer.invoke('stop-eyedropper'),
    onOpenSettings: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('open-settings', handler);
        return () => {
            ipcRenderer.removeListener('open-settings', handler);
        };
    },
    // Global Paste Support
    setGlobalPasteMode: (isActive: boolean) => ipcRenderer.send('set-global-paste-mode', isActive),
    onRequestNextPaste: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('request-next-paste', handler);
        return () => {
            ipcRenderer.removeListener('request-next-paste', handler);
        };
    },
    executeGlobalPaste: (data: { type: string; content: string }) => ipcRenderer.send('execute-global-paste', data),
    onClipboardPasteError: (callback: (data: { error: string; message: string }) => void) => {
        const handler = (_event: any, data: { error: string; message: string }) => callback(data);
        ipcRenderer.on('clipboard-paste-error', handler);
        return () => ipcRenderer.removeListener('clipboard-paste-error', handler);
    },
    triggerScreenshot: () => ipcRenderer.send('trigger-screenshot'),
    takeScreenshot: (hideApp: boolean) => ipcRenderer.send('take-screenshot', hideApp),
    moveWindow: (dx: number, dy: number) => ipcRenderer.send('move-window', { dx, dy }),
    recenterWindowOnWidget: (x: number, y: number, width: number, height: number) => ipcRenderer.invoke('recenter-window-on-widget', x, y, width, height),
    getWindowPositionSync: () => ipcRenderer.sendSync('get-window-position-sync') as [number, number],

    // App Launcher Native
    getFileIcon: (path: string) => ipcRenderer.invoke('get-file-icon', path),
    launchFile: (path: string) => ipcRenderer.send('launch-file', path),
    getFilePath: (file: File) => webUtils.getPathForFile(file),

    // Auto-launch
    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch') as Promise<boolean>,
    setAutoLaunch: (enabled: boolean) => ipcRenderer.send('set-auto-launch', enabled),

    // Focus Audio
    getMelodyAudio: (name: string) => ipcRenderer.invoke('get-melody-audio', name) as Promise<string | null>,

    getHwid: () => ipcRenderer.invoke('get-hwid') as Promise<string>,

    // AI Hub Context
    parseFile: (filePath: string) => ipcRenderer.invoke('parse-file', filePath),
    llmRequest: (data: any) => ipcRenderer.invoke('llm-request', data),
    cancelLlmRequest: (messageId: string) => ipcRenderer.invoke('cancel-llm-request', messageId),
    onLlmStreamChunk: (callback: (data: { chatId: string, messageId: string, chunk: string }) => void) => {
        ipcRenderer.on('llm-stream-chunk', (_event, data) => callback(data));
        return () => ipcRenderer.removeAllListeners('llm-stream-chunk');
    },
    onLlmStreamEnd: (callback: (data: { chatId: string, messageId: string }) => void) => {
        ipcRenderer.on('llm-stream-end', (_event, data) => callback(data));
        return () => ipcRenderer.removeAllListeners('llm-stream-end');
    },
    onLlmStreamError: (callback: (data: { chatId: string, messageId: string, error: string }) => void) => {
        ipcRenderer.on('llm-stream-error', (_event, data) => callback(data));
        return () => ipcRenderer.removeAllListeners('llm-stream-error');
    },

    // Pin Injector
    enterPinTargetingMode: () => ipcRenderer.send('enter-pin-targeting'),
    unpinCurrentWindow: () => ipcRenderer.send('unpin-current-window'),
    unpinAll: () => ipcRenderer.send('unpin-all-windows'),
    onPinnedWindowChanged: (callback: (hwnd: number | null) => void) => {
        const handler = (_event: any, hwnd: number | null) => callback(hwnd);
        ipcRenderer.on('pinned-window-changed', handler);
        return () => ipcRenderer.removeListener('pinned-window-changed', handler);
    },
    onPinTargetingComplete: (cb: () => void) => {
        const handler = () => cb();
        ipcRenderer.on('pin-targeting-complete', handler);
        return () => {
            ipcRenderer.removeListener('pin-targeting-complete', handler);
        };
    },

    // KoBox
    dropToKoBox: (paths: string[]) => ipcRenderer.send('kobox-drop', paths),
    openKoBox: () => ipcRenderer.send('kobox-open'),
    cleanKoBox: (mode: '24h' | 'quit') => ipcRenderer.send('kobox-clean', mode),

    // Screenshot Studio
    startScreenshotCapture: () => ipcRenderer.invoke('start-screenshot-capture') as Promise<{
        captures: Array<{
            displayId: string;
            bounds: { x: number; y: number; width: number; height: number };
            scaleFactor: number;
            imageDataUrl: string;
        }>;
        windowPosition: { x: number; y: number };
    }>,
    cancelScreenshot: () => ipcRenderer.send('cancel-screenshot'),
    saveScreenshot: (data: { buffer: string; format: string; destinationPath?: string }) =>
        ipcRenderer.invoke('save-screenshot', data) as Promise<{ success: boolean; path?: string; reason?: string }>,
    copyScreenshotToClipboard: (dataUrl: string) => ipcRenderer.send('copy-screenshot-to-clipboard', dataUrl),
    screenshotSessionComplete: () => ipcRenderer.send('screenshot-session-complete'),

    // OS Context
    getPlatform: () => process.platform,
    sendNotification: (title: string, body: string) => ipcRenderer.send('send-notification', { title, body }),

    // KoPlayer Media Controller
    onMediaUpdate: (callback: (data: { title: string; artist: string; albumArt: string | null; isPlaying: boolean } | null) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: { title: string; artist: string; albumArt: string | null; isPlaying: boolean } | null) => callback(data);
        ipcRenderer.on('media-update', handler);
        return () => {
            ipcRenderer.removeListener('media-update', handler);
        };
    },
    sendMediaCommand: (command: 'play' | 'pause' | 'next' | 'prev') => ipcRenderer.send('media-command', command),

    // PIP Video Player (webview-based mini browser)
    // Detects video URLs currently open in Chrome/Edge/Brave/Firefox
    getActiveVideoUrls: () => ipcRenderer.invoke('get-active-video-urls') as Promise<string[]>,
    // Opens a PIP window that plays the given URL in an embedded browser
    openPip: (url: string, title: string, albumArt?: string) => ipcRenderer.send('open-pip', { url, title, albumArt }),
    closePip: () => ipcRenderer.send('close-pip'),
    onPipClosed: (callback: () => void) => {
        const handler = () => callback();
        ipcRenderer.on('pip-closed', handler);
        return () => ipcRenderer.removeListener('pip-closed', handler);
    },

    // KoPlayer video URL cache — updated automatically when SMTC detects a browser source
    onVideoUrlsUpdate: (callback: (urls: string[]) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, urls: string[]) => callback(urls);
        ipcRenderer.on('video-urls-update', handler);
        return () => ipcRenderer.removeListener('video-urls-update', handler);
    },
    getSmtcSource: () => ipcRenderer.invoke('get-smtc-source') as Promise<string>,


    // KoCalendar

    // Auto Updater
    onUpdateAvailable: (callback: (version: string) => void) => {
        const handler = (_event: any, version: string) => callback(version);
        ipcRenderer.on('update-available', handler);
        return () => ipcRenderer.removeListener('update-available', handler);
    },
    onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
        const handler = (_event: any, progress: any) => callback(progress);
        ipcRenderer.on('update-download-progress', handler);
        return () => {
            ipcRenderer.removeListener('update-download-progress', handler);
        };
    },
    onUpdateDownloadComplete: (callback: (version: string) => void) => {
        const handler = (_event: any, version: string) => callback(version);
        ipcRenderer.on('update-download-complete', handler);
        return () => {
            ipcRenderer.removeListener('update-download-complete', handler);
        };
    },
    onUpdateError: (callback: (error: string) => void) => {
        const handler = (_event: any, error: string) => callback(error);
        ipcRenderer.on('update-error', handler);
        return () => {
            ipcRenderer.removeListener('update-error', handler);
        };
    },
    askForUpdate: (title: string, message: string, yesLabel: string, noLabel: string) => 
        ipcRenderer.invoke('ask-for-update', { title, message, yesLabel, noLabel }) as Promise<boolean>,
    downloadAndInstallUpdate: () => ipcRenderer.send('download-and-install-update'),
    quitAndInstallUpdate: () => ipcRenderer.send('quit-and-install-update'),
    checkForUpdatesManual: () => ipcRenderer.invoke('check-for-updates-manual') as Promise<{ status: 'success' | 'error' | 'disabled'; updateAvailable?: boolean; version?: string; message?: string }>,

    // About section support
    openExternal: (url: string) => ipcRenderer.send('open-external', url),
    getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,
    isDev: () => ipcRenderer.invoke('is-dev') as Promise<boolean>,

    // Extensions API Support
    getInstalledExtensions: () => ipcRenderer.invoke('get-installed-extensions'),
    getAvailableExtensions: () => ipcRenderer.invoke('get-available-extensions'),
    installExtension: (id: string) => ipcRenderer.invoke('install-extension', id),
    uninstallExtension: (id: string) => ipcRenderer.invoke('uninstall-extension', id),
    toggleExtensionEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('toggle-extension-enabled', id, enabled),
    installExtensionFromFile: () => ipcRenderer.invoke('install-extension-from-file'),
    installExtensionFromPath: (filePath: string) => ipcRenderer.invoke('install-extension-from-path', filePath),
    installExtensionFromGithub: (id: string, repo: string) => ipcRenderer.invoke('install-extension-from-github', id, repo),
    onPluginInstallProgress: (callback: (id: string, percent: number) => void) => {
        const handler = (_event: any, data: { id: string, percent: number }) => callback(data.id, data.percent);
        ipcRenderer.on('plugin-install-progress', handler);
        return () => ipcRenderer.removeListener('plugin-install-progress', handler);
    }
});
