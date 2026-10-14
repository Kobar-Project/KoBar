/*
 * T-010: the de facto v1 plugin contract, as actually used by the official plugins.
 *
 * These lists were derived by grepping the plugin sources (READ-ONLY) under `KoBar Plugins\`:
 * ClipboardManager, Shortcuts, aiHub, calculator, colorPicker, focusMode, koBox, koCalender, koPlayer,
 * pinWindowToTop, screenshot, snippetVault, toDoList, plus the installed copy of EmojiPicker
 * (`%APPDATA%\KoBar\extensions\eedali-emoji-picker\index.js`; the repo is not cloned locally).
 *
 * The lists are embedded on purpose: the tests must not depend on the plugin repos existing on disk.
 * Removing an entry here is a contract change and needs an owner-approved item (CLAUDE.md rule 6).
 */

export type OfficialPlugin =
    | 'ClipboardManager'
    | 'Shortcuts'
    | 'aiHub'
    | 'calculator'
    | 'colorPicker'
    | 'focusMode'
    | 'koBox'
    | 'koCalender'
    | 'koPlayer'
    | 'pinWindowToTop'
    | 'screenshot'
    | 'snippetVault'
    | 'toDoList'
    | 'EmojiPicker';

type WindowApiKey = keyof Window['api'];

/**
 * `window.api` methods called by at least one official plugin -> plugins that call it.
 * The `satisfies` clause makes `tsc -b` fail if a method disappears from `src/types/global.d.ts`.
 */
export const PLUGIN_API_USAGE = {
    // Clipboard
    writeToClipboard: ['ClipboardManager', 'aiHub', 'calculator', 'colorPicker', 'snippetVault', 'EmojiPicker'],
    startClipboardListener: ['ClipboardManager'],
    stopClipboardListener: ['ClipboardManager'],
    onClipboardUpdate: ['ClipboardManager'],
    setGlobalPasteMode: ['ClipboardManager'],
    onRequestNextPaste: ['ClipboardManager'],
    executeGlobalPaste: ['ClipboardManager'],
    // Files
    getFilePath: ['Shortcuts', 'aiHub', 'koBox'],
    getFileIcon: ['Shortcuts'],
    launchFile: ['Shortcuts'],
    parseFile: ['aiHub'],
    // LLM
    llmRequest: ['aiHub'],
    cancelLlmRequest: ['aiHub'],
    onLlmStreamChunk: ['aiHub'],
    onLlmStreamEnd: ['aiHub'],
    onLlmStreamError: ['aiHub'],
    // Window
    setIgnoreMouseEvents: ['aiHub', 'snippetVault'],
    // Notifications / external links
    sendNotification: ['aiHub', 'focusMode', 'screenshot'],
    openExternal: ['koCalender'],
    // Eyedropper
    startEyeDropper: ['colorPicker'],
    stopEyeDropper: ['colorPicker'],
    // Audio
    getMelodyAudio: ['focusMode'],
    // KoBox
    dropToKoBox: ['koBox'],
    openKoBox: ['koBox'],
    cleanKoBox: ['koBox'],
    // Media / PiP
    sendMediaCommand: ['koPlayer'],
    getActiveVideoUrls: ['koPlayer'],
    openPip: ['koPlayer'],
    closePip: ['koPlayer'],
    onPipClosed: ['koPlayer'],
    // Pin window
    enterPinTargetingMode: ['pinWindowToTop'],
    unpinCurrentWindow: ['pinWindowToTop'],
    unpinAll: ['pinWindowToTop'],
    onPinnedWindowChanged: ['pinWindowToTop'],
    onPinTargetingComplete: ['pinWindowToTop'],
    // Screenshot Studio
    startScreenshotCapture: ['screenshot'],
    cancelScreenshot: ['screenshot'],
    saveScreenshot: ['screenshot'],
    copyScreenshotToClipboard: ['screenshot'],
} as const satisfies Partial<Record<WindowApiKey, readonly OfficialPlugin[]>>;

export type PluginApiMethod = keyof typeof PLUGIN_API_USAGE;
export const PLUGIN_API_METHODS = Object.keys(PLUGIN_API_USAGE) as PluginApiMethod[];

/**
 * Preload methods kept only for compatibility: they must stay callable, but the main process has no
 * IPC handler for them today (calling them is a no-op). `stopClipboardListener` got a real handler in T-114.
 * T-133 turned the eyedropper pair, `getAvailableExtensions` and `installExtension` into no-ops.
 */
export const NO_OP_API_STUBS = [
    'registerTeleportShortcut',
    'startEyeDropper',
    'stopEyeDropper',
    'getAvailableExtensions',
    'installExtension',
] as const satisfies readonly WindowApiKey[];

/** `window.api` methods that are synchronous and not IPC-backed (`webUtils`). */
export const NON_IPC_API_METHODS = ['getFilePath'] as const satisfies readonly PluginApiMethod[];

/** `useAppStore` state fields plugins READ (selectors, `getState()`, `subscribe`). */
export const STORE_READ_USAGE = {
    edgePosition: ['ClipboardManager', 'Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koBox', 'koCalender', 'koPlayer', 'pinWindowToTop', 'snippetVault', 'toDoList', 'EmojiPicker'],
    language: ['ClipboardManager', 'Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koBox', 'koPlayer', 'snippetVault', 'toDoList', 'EmojiPicker'],
    orientation: ['ClipboardManager', 'Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList', 'EmojiPicker'],
    screenBounds: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList', 'EmojiPicker'],
    sidebarPosition: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList', 'EmojiPicker'],
    design: ['ClipboardManager', 'Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList'],
    glassOpacity: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList'],
    isMac: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList'],
    isPopupSmartPositioning: ['calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList'],
    t: ['aiHub', 'colorPicker', 'koCalender'],
    iconScale: ['Shortcuts'],
    currentMedia: ['koPlayer'],
    currentMediaSourceApp: ['koPlayer'],
    activeVideoUrls: ['koPlayer'],
    // Read to toggle the plugin's own panel open/closed.
    activeExtensionPanelId: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'snippetVault', 'toDoList', 'EmojiPicker'],
} as const satisfies Record<string, readonly OfficialPlugin[]>;

/** `useAppStore` state fields plugins WRITE via `useAppStore.setState({...})`. */
export const STORE_WRITE_USAGE = {
    activeExtensionPanelId: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
    activeExtensionAnchorRect: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
} as const satisfies Record<string, readonly OfficialPlugin[]>;

/** `useAppStore` actions plugins call. */
export const STORE_ACTION_USAGE = {
    closeAllUtilityPopups: ['aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList'],
} as const satisfies Record<string, readonly OfficialPlugin[]>;

/** Zustand store API used on `window.useAppStore` itself (besides calling it as a hook). */
export const STORE_API_USAGE = {
    getState: ['ClipboardManager', 'Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koBox', 'koCalender', 'koPlayer', 'pinWindowToTop', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
    setState: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
    subscribe: ['ClipboardManager', 'calculator', 'focusMode'],
} as const satisfies Record<string, readonly OfficialPlugin[]>;

/** Store fields read by the host's localStorage isolation layer (`src/utils/localStorageIsolation.ts`). */
export const ISOLATION_STORE_FIELDS = ['workspaces', 'activeWorkspaceId'] as const;

/** `window.KoBarExtensions` members used by plugins. */
export const EXTENSIONS_USAGE = {
    registerSidebarButton: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
    registerPanel: ['Shortcuts', 'aiHub', 'calculator', 'colorPicker', 'focusMode', 'koCalender', 'koPlayer', 'screenshot', 'snippetVault', 'toDoList', 'EmojiPicker'],
    registerSettingsPanel: ['ClipboardManager', 'Shortcuts', 'aiHub', 'koBox', 'screenshot'],
    registerInlineWidget: ['ClipboardManager', 'focusMode', 'koBox', 'pinWindowToTop'],
    // Runtime-visible TypeScript `private` fields that Clipboard Manager mutates directly.
    buttons: ['ClipboardManager'],
    panels: ['ClipboardManager'],
} as const satisfies Record<string, readonly OfficialPlugin[]>;

/** `--theme-*` CSS variables referenced by plugins that the host must keep defining. */
export const THEME_CSS_VARS = ['--theme-primary', '--theme-surface', '--theme-border', '--theme-bg-dark', '--theme-bg-base'] as const;

/** Host CSS utility classes plugins rely on (defined in `src/index.css`). */
export const HOST_CSS_CLASSES = ['no-drag-region', 'custom-scrollbar'] as const;
