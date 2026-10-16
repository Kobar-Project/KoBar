import type { EventMethod, InvokeMethod, InvokeResult, SendMethod, SyncMethod } from '../../shared/ipc-contract';

// T-304: a `window.api` member whose arguments go to its channel unchanged is derived from shared/ipc-contract.ts
// (InvokeMethod / SendMethod / SyncMethod / EventMethod). The others stay hand-written: the wire arguments differ from the
// method arguments (moveWindow, sendNotification, openPip, saveNoteAsText, askForUpdate, onPluginInstallProgress), the v1
// type is looser than the contract (`any` or a wider union), or the method has no IPC behind it. tests/ipcContract.test.ts
// pins the whole `window.api` type to its v1 shape, so a contract change that would alter a plugin-visible type fails tsc.

declare global {
    interface MediaData {
        title: string;
        artist: string;
        albumArt: string | null;
        isPlaying: boolean;
        sourceAppId?: string;
    }

    /** Payload of the `media-update` channel (null = nothing playing). Mirrors electron/lib/mediaTypes.cts. */
    type MediaUpdate = MediaData | null;

    interface Window {
        api: {
            hideApp: SendMethod<'hide-app'>;
            quitApp: SendMethod<'quit-app'>;
            onForceCenterMiniMode: EventMethod<'force-center-mini-mode'>;
            onEdgeChanged: (callback: (edge: 'left' | 'right', bounds?: any) => void) => (() => void);
            getScreenBounds: () => Promise<any>;
            getDisplaysInfo: () => Promise<{ primaryDisplay: any, allDisplays: any[] }>;
            updateSidebarRect: SendMethod<'update-sidebar-rect'>;
            registerTeleportShortcut: SendMethod<'register-teleport-shortcut'>;
            onTeleportTriggered: EventMethod<'teleport-triggered'>;
            // Clipboard Manager
            startClipboardListener: SendMethod<'start-clipboard-listener'>;
            stopClipboardListener: SendMethod<'stop-clipboard-listener'>;
            onClipboardUpdate: (callback: (data: { type: string; content: string }) => void) => (() => void);
            writeToClipboard: SendMethod<'write-to-clipboard'>;
            // Mouse click-through
            setIgnoreMouseEvents: SendMethod<'set-ignore-mouse-events'>;
            // EyeDropper: v1 compatibility no-ops (the host has no eyedropper service)
            startEyeDropper: () => Promise<{ x: number; y: number }>;
            stopEyeDropper: () => Promise<void>;
            onOpenSettings: EventMethod<'open-settings'>;
            // Global Paste Support
            setGlobalPasteMode: SendMethod<'set-global-paste-mode'>;
            onRequestNextPaste: EventMethod<'request-next-paste'>;
            executeGlobalPaste: SendMethod<'execute-global-paste'>;
            // R4: 2 = the host serialises presses (one executeGlobalPaste per request-next-paste, no plugin debounce needed); absent on older hosts.
            globalPasteVersion: number;
            onClipboardPasteError: EventMethod<'clipboard-paste-error'>;
            triggerScreenshot: SendMethod<'trigger-screenshot'>;
            takeScreenshot: SendMethod<'take-screenshot'>;
            moveWindow: (dx: number, dy: number) => void;
            recenterWindowOnWidget: (x: number, y: number, width: number, height: number) => Promise<{ x: number; y: number; displayBounds: any } | null>;
            getWindowPositionSync: SyncMethod<'get-window-position-sync'>;
            // Window model from main (T-320; host addition, not part of the v1 plugin contract)
            getWindowGeometry: SyncMethod<'get-window-geometry'>;
            // Window re-fitted to a display (T-321; host addition, not part of the v1 plugin contract)
            onWindowGeometryChanged: EventMethod<'window-geometry-changed'>;
            // Native App Launcher
            getFileIcon: InvokeMethod<'get-file-icon'>;
            launchFile: SendMethod<'launch-file'>;
            getFilePath: (file: File) => string;
            // Auto-launch
            getAutoLaunch: InvokeMethod<'get-auto-launch'>;
            setAutoLaunch: SendMethod<'set-auto-launch'>;
            syncAutoLaunch: InvokeMethod<'sync-auto-launch'>;
            // Notes: import .txt / .md files
            pickTextFiles: InvokeMethod<'pick-text-files'>;
            takeOpenTextFiles: InvokeMethod<'take-open-text-files'>;
            onOpenTextFilesAvailable: EventMethod<'open-text-files-available'>;
            // Focus Audio
            getMelodyAudio: InvokeMethod<'get-melody-audio'>;
            // License API
            getHwid: () => Promise<string | null>;
            // Pin Injector
            enterPinTargetingMode: SendMethod<'enter-pin-targeting'>;
            unpinCurrentWindow: SendMethod<'unpin-current-window'>;
            unpinAll: SendMethod<'unpin-all-windows'>;
            onPinnedWindowChanged: EventMethod<'pinned-window-changed'>;
            onPinTargetingComplete: EventMethod<'pin-targeting-complete'>;
            // Pin border style (T-146, host addition): color `#RRGGBB`, width integer 1-4 (CSS px)
            getPinBorderStyle: () => Promise<{ color: string; width: number }>;
            setPinBorderStyle: (style: { color: string; width: number }) => Promise<{ success: boolean; error?: string }>;
            // Encrypted secrets (T-411; host addition, not part of the v1 plugin contract): only { exists, last4 } ever comes back.
            // T-417: names must be `plugin-<plugin id>-<key>`; other names answer `reserved-name`.
            getSecretStatus: InvokeMethod<'secret-status'>;
            setSecret: InvokeMethod<'secret-set'>;
            deleteSecret: InvokeMethod<'secret-delete'>;
            // Google Calendar v1 (R2-15; host addition, EXPERIMENTAL, read-only, not part of the v1 plugin contract): statuses and events only,
            // never a token. gcalListEvents answers [] while the user's switch is off. Will be gated by calendar.read (M7).
            gcalStatus: InvokeMethod<'gcal-status'>;
            gcalConnect: InvokeMethod<'gcal-connect'>;
            gcalDisconnect: InvokeMethod<'gcal-disconnect'>;
            gcalListEvents: InvokeMethod<'gcal-list-events'>;
            // KoBox
            dropToKoBox: SendMethod<'kobox-drop'>;
            openKoBox: SendMethod<'kobox-open'>;
            cleanKoBox: SendMethod<'kobox-clean'>;

            // Screenshot Studio
            startScreenshotCapture: InvokeMethod<'start-screenshot-capture'>;
            cancelScreenshot: SendMethod<'cancel-screenshot'>;
            saveScreenshot: InvokeMethod<'save-screenshot'>;
            copyScreenshotToClipboard: SendMethod<'copy-screenshot-to-clipboard'>;
            screenshotSessionComplete: SendMethod<'screenshot-session-complete'>;

            // Platform
            getPlatform: () => string;
            sendNotification: (title: string, body: string) => void;

            // KoPlayer Media Controller
            onMediaUpdate: EventMethod<'media-update'>;
            sendMediaCommand: SendMethod<'media-command'>;

            // PIP Video Player (webview-based mini browser)
            getActiveVideoUrls: InvokeMethod<'get-active-video-urls'>;
            openPip: (url: string, title: string, albumArt?: string) => void;
            closePip: SendMethod<'close-pip'>;
            onPipClosed: EventMethod<'pip-closed'>;
            onVideoUrlsUpdate: EventMethod<'video-urls-update'>;
            getSmtcSource: InvokeMethod<'get-smtc-source'>;

            // AI Hub Context
            parseFile: InvokeMethod<'parse-file'>;
            llmRequest: (data: { chatId: string, messageId: string, provider: string, model: string, messages: any[], apiKeys?: any, systemPrompt?: string }) => Promise<void>;
            cancelLlmRequest: InvokeMethod<'cancel-llm-request'>;
            onLlmStreamChunk: (callback: (data: { chatId: string, messageId: string, chunk: string }) => void) => () => void;
            onLlmStreamEnd: (callback: (data: { chatId: string, messageId: string }) => void) => () => void;
            onLlmStreamError: (callback: (data: { chatId: string, messageId: string, error: string }) => void) => () => void;

            // Notes (the preload sends `{ title, content }` as one object)
            saveNoteAsText: (title: string, content: string) => Promise<InvokeResult<'save-note-as-text'>>;

            // Full backup export (T-211; host addition, not part of the v1 plugin contract)
            getBackupSources: InvokeMethod<'get-backup-sources'>;
            saveFullBackup: InvokeMethod<'save-full-backup'>;
            // Full backup restore (T-213; host addition, not part of the v1 plugin contract)
            createPreRestoreBackup: InvokeMethod<'create-pre-restore-backup'>;
            applyRestoreAndRelaunch: InvokeMethod<'apply-restore-and-relaunch'>;
            // Automatic backup before a workspace delete (T-214; host addition, not part of the v1 plugin contract)
            createPreDeleteBackup: InvokeMethod<'create-pre-delete-backup'>;

            // Auto Updater
            onUpdateAvailable: EventMethod<'update-available'>;
            onUpdateDownloadProgress: EventMethod<'update-download-progress'>;
            onUpdateDownloadComplete: EventMethod<'update-download-complete'>;
            onUpdateError: EventMethod<'update-error'>;
            // The preload sends the four strings as one object (main ignores them, SEC-15).
            askForUpdate: (title: string, message: string, yesLabel: string, noLabel: string) => Promise<InvokeResult<'ask-for-update'>>;
            downloadAndInstallUpdate: SendMethod<'download-and-install-update'>;
            quitAndInstallUpdate: SendMethod<'quit-and-install-update'>;
            checkForUpdatesManual: InvokeMethod<'check-for-updates-manual'>;

            openExternal: SendMethod<'open-external'>;
            getAppVersion: InvokeMethod<'get-app-version'>;
            isDev: InvokeMethod<'is-dev'>;

            // Extensions API
            getInstalledExtensions: () => Promise<Array<{ id: string; name: string; version: string; description: string; icon: string; enabled: boolean; code?: string; image?: string; categories?: string[]; versionNote?: string; githubRepo?: string }>>;
            checkPluginUpdates: InvokeMethod<'check-plugin-updates'>;
            getAvailableExtensions: () => Promise<Array<{ id: string; name: string; version: string; description: string; icon: string; downloadUrl: string }>>;
            installExtension: (id: string) => Promise<boolean>;
            uninstallExtension: InvokeMethod<'uninstall-extension'>;
            toggleExtensionEnabled: InvokeMethod<'toggle-extension-enabled'>;
            setExtensionsConfig: InvokeMethod<'set-extensions-config'>;
            installExtensionFromFile: InvokeMethod<'install-extension-from-file'>;
            installExtensionFromPath: InvokeMethod<'install-extension-from-path'>;
            installExtensionFromGithub: InvokeMethod<'install-extension-from-github'>;
            // The preload unpacks the `{ id, percent }` payload into two callback arguments.
            onPluginInstallProgress: (callback: (id: string, percent: number) => void) => () => void;
        };
    }
}
