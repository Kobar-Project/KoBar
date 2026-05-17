export { };

declare global {
    interface MediaData {
        title: string;
        artist: string;
        albumArt: string | null;
        isPlaying: boolean;
    }

    interface Window {
        api: {
            hideApp: () => void;
            quitApp: () => void;
            onForceCenterMiniMode: (callback: () => void) => (() => void);
            onEdgeChanged: (callback: (edge: 'left' | 'right', bounds?: any) => void) => void;
            getScreenBounds: () => Promise<any>;
            getDisplaysInfo: () => Promise<{ primaryDisplay: any, allDisplays: any[] }>;
            updateSidebarRect: (rect: { width: number, height: number, offsetX: number, offsetY: number }) => void;
            registerTeleportShortcut: (shortcut: string) => void;
            onTeleportTriggered: (callback: (data: { x: number, y: number }) => void) => (() => void);
            // Clipboard Manager
            startClipboardListener: () => void;
            stopClipboardListener: () => void;
            onClipboardUpdate: (callback: (data: { type: string; content: string }) => void) => (() => void);
            writeToClipboard: (data: { type: string; content: string }) => void;
            // Mouse click-through
            setIgnoreMouseEvents: (ignore: boolean) => void;
            onOpenSettings: (callback: () => void) => (() => void);
            // Global Paste Support
            setGlobalPasteMode: (isActive: boolean) => void;
            onRequestNextPaste: (callback: () => void) => (() => void);
            executeGlobalPaste: (data: { type: string; content: string }) => void;
            onClipboardPasteError: (callback: (data: { error: string; message: string }) => void) => (() => void);
            triggerScreenshot: () => void;
            takeScreenshot: (hideApp: boolean) => void;
            moveWindow: (dx: number, dy: number) => void;
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
            getHwid: () => Promise<string>;
            // Pin Injector
            enterPinTargetingMode: () => void;
            unpinCurrentWindow: () => void;
            unpinAll: () => void;
            onPinnedWindowChanged: (callback: (hwnd: number | null) => void) => (() => void);
            onPinTargetingComplete: (cb: () => void) => (() => void);
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
            }>;
            cancelScreenshot: () => void;
            saveScreenshot: (data: { buffer: string; format: string; destinationPath?: string }) =>
                Promise<{ success: boolean; path?: string; reason?: string }>;
            copyScreenshotToClipboard: (dataUrl: string) => void;
            screenshotSessionComplete: () => void;

            // Platform
            getPlatform: () => string;
            sendNotification: (title: string, body: string) => void;

            // KoPlayer Media Controller
            onMediaUpdate: (callback: (data: MediaData | null) => void) => (() => void);
            sendMediaCommand: (command: 'play' | 'pause' | 'next' | 'prev') => void;

            // KoCalendar
            fetchCalendarEvents: (timeMin: string, timeMax: string) => Promise<any[]>;
            createCalendarEvent: (eventData: any) => Promise<boolean>;
            onUpcomingEventNotification: (callback: (event: any) => void) => (() => void);

            // AI Hub Context
            parseFile: (filePath: string) => Promise<{ type: 'text'|'image'|'error', content: string }>;
            llmRequest: (data: { chatId: string, messageId: string, provider: string, model: string, messages: any[], apiKeys?: any, systemPrompt?: string }) => Promise<void>;
            cancelLlmRequest: (messageId: string) => Promise<void>;
            onLlmStreamChunk: (callback: (data: { chatId: string, messageId: string, chunk: string }) => void) => () => void;
            onLlmStreamEnd: (callback: (data: { chatId: string, messageId: string }) => void) => () => void;
            onLlmStreamError: (callback: (data: { chatId: string, messageId: string, error: string }) => void) => () => void;
            // Auto Updater
            onUpdateAvailable: (callback: (version: string) => void) => (() => void);
            askForUpdate: (title: string, message: string, yesLabel: string, noLabel: string) => Promise<boolean>;
            downloadAndInstallUpdate: () => void;

            openExternal: (url: string) => void;
            getAppVersion: () => Promise<string>;
        };
    }
}
