import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { translations } from '../i18n/translations';
import type { LanguageCode, TranslationKeys } from '../i18n/translations';
export type ThemeName = 'ember' | 'ocean' | 'sakura' | 'emerald' | 'midnight' | 'amethyst' | 'crimson' | 'nord' | 'coffee' | 'lavender' | 'custom';

// ─── Custom Theme Color → CSS Variables Generator ───
function hexToHSL(hex: string): { h: number; s: number; l: number } {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export function applyCustomThemeCSS(primaryHex: string) {
    const { h, s } = hexToHSL(primaryHex);
    const root = document.documentElement;
    root.style.setProperty('--theme-primary', primaryHex);
    root.style.setProperty('--theme-bg-dark', hslToHex(h, Math.min(s, 15), 8));
    root.style.setProperty('--theme-bg-base', hslToHex(h, Math.min(s, 15), 11));
    root.style.setProperty('--theme-bg-light', hslToHex(h, Math.min(s, 20), 96));
    root.style.setProperty('--theme-border', hslToHex(h, Math.min(s, 25), 22));
    root.style.setProperty('--theme-surface', hslToHex(h, Math.min(s, 15), 5));
    const { h: pH, s: pS, l: pL } = hexToHSL(primaryHex);
    root.style.setProperty('--theme-accent-glow', `hsla(${pH}, ${pS}%, ${pL}%, 0.15)`);
    root.style.setProperty('--theme-scrollbar', hslToHex(h, Math.min(s, 25), 22));
    root.style.setProperty('--theme-marker', primaryHex);
}

function clearCustomThemeCSS() {
    const root = document.documentElement;
    const props = ['--theme-primary', '--theme-bg-dark', '--theme-bg-base', '--theme-bg-light', '--theme-border', '--theme-surface', '--theme-accent-glow', '--theme-scrollbar', '--theme-marker'];
    props.forEach(p => root.style.removeProperty(p));
}

export interface Note {
    id: number;
    title: string;
    icon: string;
    emoji: string | null;
    content: string;
    isSettings?: boolean;
    isPlugins?: boolean;
}

export interface PinnedApp {
    id: string;
    name: string;
    path: string;
    icon: string;
    tag?: string;
}

export interface FocusSettings {
    minutes: number;
    seconds: number;
    melody: string;
    loop: boolean;
}

export interface Todo {
    id: string;
    text: string;
    completed: boolean;
    dueDate?: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    meetingLink?: string;
    startTime: string; // ISO string
    endTime: string; // ISO string
    colorId?: string;
    notificationEnabled?: boolean;
    notificationMinutes?: number;
}

export interface Snippet {
    id: string;
    title: string;
    content: string;
    tags: string[];
    password?: string;
    color?: string;
}

export interface WorkspaceConfig {
    id: string;
    name: string;
    isShortcutsEnabled: boolean;
    isCopyPasteEnabled: boolean;
    isScreenshotEnabled: boolean;
    isFocusModeEnabled: boolean;
    isCalculatorEnabled: boolean;
    isColorPickerEnabled: boolean;
    isPinInjectorEnabled: boolean;
    isKoBoxEnabled: boolean;
    isSnippetVaultEnabled: boolean;
    isAiHubEnabled: boolean;
    isKoPlayerEnabled: boolean;
    isKoCalendarEnabled: boolean;
    isTodoListEnabled: boolean;
    maxShortcuts: number;
    slotCount: number;
    koBoxCleanupMode: '24h' | 'quit';
    autoCopyColor: boolean;
    hideOnScreenshot: boolean;
    toggleWidth: number;
    sidebarWidth: number;
    iconScale: number;
    featureSpacing: number;
    showTooltips: boolean;
    theme: ThemeName;
    customThemeColor: string;
    design: 'style1' | 'style2';
    glassOpacity: number;
    featureOrder: string[];
    edgePosition: 'left' | 'right' | 'top' | 'bottom';
    isPopupSmartPositioning: boolean;
    enableEyeAnimation: boolean;
    orientation: 'vertical' | 'horizontal';
}

interface AppState {
    isMac: boolean;
    edgePosition: 'left' | 'right' | 'top' | 'bottom';
    setEdgePosition: (edge: 'left' | 'right' | 'top' | 'bottom') => void;
    orientation: 'vertical' | 'horizontal';
    setOrientation: (orientation: 'vertical' | 'horizontal') => void;
    isNotePanelOpen: boolean;
    setNotePanelOpen: (isOpen: boolean) => void;
    toggleNotePanel: () => void;
    isHydrated: boolean;
    setHydrated: (isHydrated: boolean) => void;
    notePanelWidth: number;
    setNotePanelWidth: (width: number | ((prev: number) => number)) => void;
    notePanelHeight: number;
    setNotePanelHeight: (height: number | ((prev: number) => number)) => void;
    // Mini Mode
    isMiniMode: boolean;
    miniModePosition: { x: number, y: number } | null;
    setMiniMode: (isMini: boolean, pos?: { x: number, y: number }) => void;
    // Sidebar Position (null = auto edge-snap, {x,y} = free floating)
    sidebarPosition: { x: number, y: number } | null;
    setSidebarPosition: (pos: { x: number, y: number } | null) => void;
    // Note management
    notes: Note[];
    activeNoteId: number;
    nextNoteId: number;
    setActiveNoteId: (id: number) => void;
    addNote: () => void;
    deleteNote: (id: number) => void;
    updateNoteContent: (id: number, content: string) => void;
    updateNoteTitle: (id: number, title: string) => void;
    updateNoteEmoji: (id: number, emoji: string) => void;
    openSettingsTab: () => void;
    openPluginsTab: () => void;
    // App Launcher
    pinnedApps: PinnedApp[];
    pinApp: (app: PinnedApp) => void;
    unpinApp: (id: string) => void;
    reorderPinnedApps: (startIndex: number, endIndex: number) => void;
    updateAppTag: (id: string, tag: string | undefined) => void;
    // Theme
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
    customThemeColor: string;
    setCustomThemeColor: (color: string) => void;
    // Design System
    design: 'style1' | 'style2';
    setDesign: (design: 'style1' | 'style2') => void;
    glassOpacity: number;
    setGlassOpacity: (val: number) => void;
    // Settings
    showTooltips: boolean;
    setShowTooltips: (val: boolean) => void;
    sidebarWidth: number;
    setSidebarWidth: (val: number) => void;
    lastSidebarHeight: number;
    setLastSidebarHeight: (val: number) => void;
    lastSidebarWidth: number;
    setLastSidebarWidth: (val: number) => void;
    iconScale: number;
    setIconScale: (val: number) => void;

    isDraggingGlobal: boolean;
    setIsDraggingGlobal: (val: boolean) => void;

    // Teleport
    teleportShortcut: string;
    setTeleportShortcut: (val: string) => void;

    // Layout Context
    screenBounds: { x: number, y: number, width: number, height: number } | null;
    setScreenBounds: (bounds: any) => void;
    sidebarAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setSidebarAnchorRect: (rect: any) => void;

    // Feature Toggles
    isShortcutsEnabled: boolean;
    setIsShortcutsEnabled: (val: boolean) => void;
    maxShortcuts: number;
    setMaxShortcuts: (val: number) => void;

    isCopyPasteEnabled: boolean;
    setIsCopyPasteEnabled: (val: boolean) => void;

    isScreenshotEnabled: boolean;
    setIsScreenshotEnabled: (val: boolean) => void;
    hideOnScreenshot: boolean;
    setHideOnScreenshot: (val: boolean) => void;

    isFocusModeEnabled: boolean;
    setIsFocusModeEnabled: (val: boolean) => void;

    isCalculatorEnabled: boolean;
    setIsCalculatorEnabled: (val: boolean) => void;

    isColorPickerEnabled: boolean;
    setIsColorPickerEnabled: (val: boolean) => void;

    isColorPickerOpen: boolean;
    setIsColorPickerOpen: (val: boolean) => void;
    colorPickerAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setColorPickerAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    eyeDropperOffset: { x: number, y: number };
    setEyeDropperOffset: (offset: { x: number, y: number }) => void;

    isPinInjectorEnabled: boolean;
    setIsPinInjectorEnabled: (val: boolean) => void;
    isTargetingMode: boolean;
    setIsTargetingMode: (val: boolean) => void;
    pinnedWindowHwnd: number | null;
    setPinnedWindowHwnd: (hwnd: number | null) => void;

    // KoBox feature
    isKoBoxEnabled: boolean;
    setIsKoBoxEnabled: (val: boolean) => void;
    koBoxCleanupMode: '24h' | 'quit';
    setKoBoxCleanupMode: (val: '24h' | 'quit') => void;

    // Snippet Vault feature
    isSnippetVaultOpen: boolean;
    setIsSnippetVaultOpen: (val: boolean) => void;
    snippetVaultAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setSnippetVaultAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    isShortcutsOpen: boolean;
    setIsShortcutsOpen: (val: boolean) => void;
    shortcutsAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setShortcutsAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    isSnippetVaultEnabled: boolean;
    setIsSnippetVaultEnabled: (val: boolean) => void;
    isSnippetVaultCompact: boolean;
    setIsSnippetVaultCompact: (val: boolean) => void;
    snippets: Snippet[];
    addSnippet: (snippet: Omit<Snippet, 'id'>) => void;
    updateSnippet: (id: string, snippet: Partial<Snippet>) => void;
    deleteSnippet: (id: string) => void;

    // AI Hub Feature
    isAiHubOpen: boolean;
    setIsAiHubOpen: (val: boolean) => void;
    isAiHubEnabled: boolean;
    setIsAiHubEnabled: (val: boolean) => void;
    aiHubAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setAiHubAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    aiHubWidth: number;
    setAiHubWidth: (width: number | ((prev: number) => number)) => void;
    aiHubHeight: number;
    setAiHubHeight: (height: number | ((prev: number) => number)) => void;

    // KoCalendar Feature
    isKoCalendarEnabled: boolean;
    setIsKoCalendarEnabled: (val: boolean) => void;
    isKoCalendarOpen: boolean;
    setIsKoCalendarOpen: (val: boolean) => void;
    koCalendarAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setKoCalendarAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    localEvents: CalendarEvent[];
    setLocalEvents: (events: CalendarEvent[]) => void;
    addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => void;
    updateCalendarEvent: (id: string, updatedEvent: Partial<CalendarEvent>) => void;
    deleteCalendarEvent: (id: string) => void;
    koCalendarColor: string;
    setKoCalendarColor: (color: string) => void;

    // Todo List feature
    isTodoListOpen: boolean;
    setIsTodoListOpen: (val: boolean) => void;
    todoListAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setTodoListAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    isTodoListEnabled: boolean;
    setIsTodoListEnabled: (val: boolean) => void;
    isPopupSmartPositioning: boolean;
    setIsPopupSmartPositioning: (val: boolean) => void;
    todos: Todo[];
    addTodo: () => void;
    updateTodoText: (id: string, text: string) => void;
    updateTodoDate: (id: string, dueDate: string | undefined) => void;
    toggleTodo: (id: string) => void;
    deleteTodo: (id: string) => void;
    reorderTodos: (startIndex: number, endIndex: number) => void;

    currentColor: string;
    setCurrentColor: (hex: string) => void;
    colorPalettes: { id: string, name: string, colors: string[] }[];
    addPalette: (palette: { id: string, name: string, colors: string[] }) => void;
    updatePalette: (id: string, palette: Partial<{ name: string, colors: string[] }>) => void;
    deletePalette: (id: string) => void;
    duplicatePalette: (id: string) => void;
    autoCopyColor: boolean;
    setAutoCopyColor: (val: boolean) => void;

    featureOrder: string[];
    setFeatureOrder: (order: string[]) => void;

    settingsFeatureViewMode: 'list' | 'cards';
    setSettingsFeatureViewMode: (mode: 'list' | 'cards') => void;
    settingsWorkspaceViewMode: 'list' | 'cards';
    setSettingsWorkspaceViewMode: (mode: 'list' | 'cards') => void;

    // UI Spacing & Sizing
    toggleWidth: number;
    setToggleWidth: (val: number) => void;
    featureSpacing: number;
    setFeatureSpacing: (val: number) => void;

    // Clipboard Settings
    slotCount: number;
    setSlotCount: (val: number) => void;

    // Launch at Startup
    launchAtStartup: boolean;
    setLaunchAtStartup: (val: boolean) => void;
    enableEyeAnimation: boolean;
    setEnableEyeAnimation: (val: boolean) => void;
    // Language
    language: LanguageCode;
    setLanguage: (lang: LanguageCode) => void;
    t: (key: TranslationKeys) => string;

    // Focus Mode
    isFocusPopupOpen: boolean;
    setIsFocusPopupOpen: (val: boolean) => void;
    focusAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setFocusAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    focusSettings: FocusSettings;
    setFocusSettings: (settings: Partial<FocusSettings>) => void;
    isFocusActive: boolean;
    focusRemainingTime: number;
    startFocusMode: () => void;
    stopFocusMode: () => void;
    tickFocusTracker: () => void;

    // Calculator Popup State
    isCalculatorOpen: boolean;
    setIsCalculatorOpen: (val: boolean) => void;
    isCalculatorScientific: boolean;
    setIsCalculatorScientific: (val: boolean) => void;
    calculatorAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setCalculatorAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;

    // KoPlayer Media Controller
    isKoPlayerEnabled: boolean;
    setIsKoPlayerEnabled: (val: boolean) => void;
    isKoPlayerOpen: boolean;
    setIsKoPlayerOpen: (val: boolean) => void;
    koPlayerAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setKoPlayerAnchorRect: (rect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null) => void;
    currentMedia: MediaData | null;
    setCurrentMedia: (data: MediaData | null) => void;
    // Video PiP — cached from SMTC background browser detection
    activeVideoUrls: string[];
    setActiveVideoUrls: (urls: string[]) => void;
    currentMediaSourceApp: string;
    setCurrentMediaSourceApp: (app: string) => void;

    isLicensed: boolean;
    setLicensed: (val: boolean) => void;

    // Scroll Memory (volatile)
    scrollPositions: Record<string, number>;
    setScrollPosition: (key: string, pos: number) => void;
    // Helper to enforce exclusivity
    closeAllUtilityPopups: () => void;

    // Dynamic Extensions State
    activeExtensionPanelId: string | null;
    activeExtensionAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    extensionReloadTrigger: number;
    triggerExtensionReload: () => void;
    pluginsTabSubMenu: 'store' | 'installed' | 'updates' | 'workspaces' | 'features';
    setPluginsTabSubMenu: (tab: 'store' | 'installed' | 'updates' | 'workspaces' | 'features') => void;
    extensionsSubTab: 'installed' | 'marketplace';
    setExtensionsSubTab: (tab: 'installed' | 'marketplace') => void;
    pluginsViewMode: 'grid' | 'list';
    setPluginsViewMode: (mode: 'grid' | 'list') => void;
    selectedPluginId: string | null;
    setSelectedPluginId: (id: string | null) => void;
    externalPluginsList: any[];
    setExternalPluginsList: (list: any[]) => void;
    pluginsSearchQuery: string;
    setPluginsSearchQuery: (query: string) => void;
    pluginsSelectedTags: string[];
    setPluginsSelectedTags: (tags: string[]) => void;

    // Workspaces
    workspaces: WorkspaceConfig[];
    saveCurrentAsWorkspace: (name: string) => void;
    loadWorkspace: (id: string) => void;
    deleteWorkspace: (id: string) => void;
    updateWorkspaceName: (id: string, newName: string) => void;
    updateWorkspaceSettings: (id: string) => void;
}

const defaultNotes: Note[] = [
    {
        id: 1,
        title: 'Welcome to KoBar!',
        icon: 'waving_hand',
        emoji: '👋',
        content: `
<p><strong>Your modular, always-on-top desktop utility sidebar.</strong></p>
<p>A multi-threaded creative assistant that lives on the edge of your screen.</p>
<br>
<p><strong>🌟 Open Source & Support</strong></p>
<p>KoBar is a completely open-source project! We welcome your feedback and contributions.</p>
<p>For bug reports, software support, feature requests, and financial support, please visit our GitHub repository: <a href="https://github.com/eedali/KoBar" target="_blank" rel="noopener noreferrer">https://github.com/eedali/KoBar</a></p>
<br>
<p><strong>🚀 KoBar Features</strong></p>
<ul>
    <li>⚡ <strong>App Launcher (Shortcuts):</strong> Pin and launch your favorite applications instantly from the sidebar. Drag and drop any file or app to create a quick shortcut.</li>
    <li>📋 <strong>Clipboard Manager (Copy & Paste):</strong> A multi-slot clipboard that automatically saves your copied text history. Access and paste your past clips with a single click.</li>
    <li>📅 <strong>KoCalendar:</strong> A quick-access calendar to easily view your schedule and important dates. Stay organized without leaving your current workflow.</li>
    <li>✅ <strong>To-Do List:</strong> Keep track of your daily tasks with a simple and effective checkable list. Manage your goals efficiently directly from the edge of your screen.</li>
    <li>📝 <strong>Snippet Vault:</strong> Store and manage your frequently used code blocks or text snippets. Copy them to your clipboard instantly whenever you need them.</li>
    <li>🎵 <strong>KoPlayer:</strong> A lightweight, floating media player to control your music and videos. Enjoy seamless media playback integration while working.</li>
    <li>📸 <strong>Screenshot Studio:</strong> Capture your screen instantly with built-in annotation and editing tools. Save or share your screen captures without opening external software.</li>
    <li>🎯 <strong>Focus Mode:</strong> Minimize distractions with an integrated Pomodoro timer. Track your work and break sessions to maintain high productivity.</li>
    <li>🧮 <strong>Calculator:</strong> A sleek, pop-up calculator for quick mathematical operations on the fly.</li>
    <li>🎨 <strong>Color Picker:</strong> Effortlessly pick any color from your screen to get its HEX or RGB values. Perfect for quick design and development tasks.</li>
    <li>🤖 <strong>AI Hub:</strong> Your integrated artificial intelligence assistant for quick queries and brainstorming. Harness the power of AI directly from your desktop.</li>
</ul>
<br>
<p><strong>⚙️ Settings & Customization</strong></p>
<p>To configure KoBar to your exact needs, simply click the <strong>Settings icon ⚙️</strong> located at the top right of this note panel.</p>
<ul>
    <li>📂 <strong>Workspaces:</strong> Save and load different sidebar feature layouts tailored for specific tasks (e.g., Coding, Designing, Casual). Switch between completely different KoBar setups with a single click.</li>
    <li>🎨 <strong>Personalization:</strong> Make KoBar truly yours! You can freely change the application's interface language and customize the theme colors to match your personal style.</li>
</ul>
<br>
<p>Enjoy using KoBar! 🚀</p>`
    }
];

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            isMac: window.api?.getPlatform ? window.api.getPlatform() === 'darwin' : false,
            closeAllUtilityPopups: () => set({ 
                isCalculatorOpen: false, 
                isColorPickerOpen: false, 
                isTodoListOpen: false, 
                isSnippetVaultOpen: false, 
                isFocusPopupOpen: false, 
                isKoCalendarOpen: false, 
                isKoPlayerOpen: false,
                isShortcutsOpen: false,
                activeExtensionPanelId: null
            }),
            activeExtensionPanelId: null,
            activeExtensionAnchorRect: null,
            extensionReloadTrigger: 0,
            triggerExtensionReload: () => set((state) => ({ extensionReloadTrigger: state.extensionReloadTrigger + 1 })),
            pluginsTabSubMenu: 'store',
            setPluginsTabSubMenu: (tab) => set({ pluginsTabSubMenu: tab }),
            extensionsSubTab: 'installed',
            setExtensionsSubTab: (tab) => set({ extensionsSubTab: tab }),
            pluginsViewMode: 'grid',
            setPluginsViewMode: (mode) => set({ pluginsViewMode: mode }),
            selectedPluginId: null,
            setSelectedPluginId: (id) => set({ selectedPluginId: id }),
            externalPluginsList: [],
            setExternalPluginsList: (list) => set({ externalPluginsList: list }),
            pluginsSearchQuery: '',
            setPluginsSearchQuery: (query) => set({ pluginsSearchQuery: query }),
            pluginsSelectedTags: [],
            setPluginsSelectedTags: (tags) => set({ pluginsSelectedTags: tags }),
            edgePosition: 'right',
            setEdgePosition: (edge) => set({ edgePosition: edge }),
            orientation: 'vertical',
            setOrientation: (orientation) => {
                const defaultEdge = orientation === 'horizontal' ? 'bottom' : 'right';
                set({ orientation, edgePosition: defaultEdge, sidebarPosition: null });
            },
            isNotePanelOpen: false,
            setNotePanelOpen: (isOpen) => set({ isNotePanelOpen: isOpen }),
            toggleNotePanel: () => set((state) => ({ isNotePanelOpen: !state.isNotePanelOpen })),
            isHydrated: false,
            setHydrated: (isHydrated) => set({ isHydrated }),
            notePanelWidth: 400,
            setNotePanelWidth: (width) => set((state) => ({ notePanelWidth: typeof width === 'function' ? width(state.notePanelWidth) : width })),
            notePanelHeight: 600,
            setNotePanelHeight: (height) => set((state) => ({ notePanelHeight: typeof height === 'function' ? height(state.notePanelHeight) : height })),

            // Sidebar Position (null = auto edge-snap, {x,y} = free floating)
            sidebarPosition: null,
            setSidebarPosition: (pos) => set({ sidebarPosition: pos }),

            // App Launcher State
            pinnedApps: [],
            pinApp: (app) => set((state) => ({
                pinnedApps: [...state.pinnedApps, app]
            })),
            unpinApp: (id) => set((state) => ({
                pinnedApps: state.pinnedApps.filter((a) => a.id !== id),
            })),
            reorderPinnedApps: (startIndex, endIndex) => set((state) => {
                const result = Array.from(state.pinnedApps);
                const [removed] = result.splice(startIndex, 1);
                result.splice(endIndex, 0, removed);
                return { pinnedApps: result };
            }),
            updateAppTag: (id, tag) => set((state) => ({
                pinnedApps: state.pinnedApps.map((a) =>
                    a.id === id ? { ...a, tag: tag && tag.trim() !== '' ? tag.trim() : undefined } : a
                ),
            })),

            // Theme
            theme: 'midnight',
            customThemeColor: '#f4a125',
            setTheme: (theme) => {
                if (theme === 'custom') {
                    document.documentElement.setAttribute('data-theme', 'custom');
                    applyCustomThemeCSS(get().customThemeColor);
                } else {
                    clearCustomThemeCSS();
                    document.documentElement.setAttribute('data-theme', theme);
                }
                set({ theme });
            },
            setCustomThemeColor: (color: string) => {
                const hex = color.startsWith('#') ? color : `#${color}`;
                // Double safety: Manual sync write to bypass any async persist issues
                localStorage.setItem('kobar_force_theme_color', hex);
                
                document.documentElement.setAttribute('data-theme', 'custom');
                applyCustomThemeCSS(hex);
                set({ 
                    customThemeColor: hex,
                    theme: 'custom'
                });
            },

            // Design System
            design: 'style1',
            setDesign: (design) => {
                document.documentElement.setAttribute('data-design', design);
                set({ design });
            },
            glassOpacity: 60,
            setGlassOpacity: (val) => set({ glassOpacity: val }),

            // Settings
            showTooltips: true,
            setShowTooltips: (val) => set({ showTooltips: val }),
            sidebarWidth: 46,
            setSidebarWidth: (val) => set({ sidebarWidth: val }),
            lastSidebarHeight: 800,
            setLastSidebarHeight: (val) => set({ lastSidebarHeight: val }),
            lastSidebarWidth: 200,
            setLastSidebarWidth: (val) => set({ lastSidebarWidth: val }),
            iconScale: 0.8,
            setIconScale: (val) => set({ iconScale: val }),

            isDraggingGlobal: false,
            setIsDraggingGlobal: (val) => set({ isDraggingGlobal: val }),

            teleportShortcut: 'CommandOrControl+Shift+K',
            setTeleportShortcut: (val) => {
                set({ teleportShortcut: val });
                window.api?.registerTeleportShortcut?.(val);
            },

            screenBounds: null,
            setScreenBounds: (bounds) => set({ screenBounds: bounds }),
            sidebarAnchorRect: null,
            setSidebarAnchorRect: (rect) => set({ sidebarAnchorRect: rect }),

            // Feature Toggles (Initial State)
            isShortcutsEnabled: false,
            setIsShortcutsEnabled: (val) => set({ isShortcutsEnabled: val }),
            maxShortcuts: 6,
            setMaxShortcuts: (val) => set({ maxShortcuts: val }),

            isCopyPasteEnabled: true,
            setIsCopyPasteEnabled: (val) => set({ isCopyPasteEnabled: val }),

            isScreenshotEnabled: false,
            setIsScreenshotEnabled: (val) => set({ isScreenshotEnabled: val }),
            hideOnScreenshot: true,
            setHideOnScreenshot: (val) => set({ hideOnScreenshot: val }),

            isFocusModeEnabled: false,
            setIsFocusModeEnabled: (val: boolean) => set({ isFocusModeEnabled: val }),

            isCalculatorEnabled: false,
            setIsCalculatorEnabled: (val: boolean) => set({ isCalculatorEnabled: val }),

            isColorPickerEnabled: false,
            setIsColorPickerEnabled: (val: boolean) => set({ isColorPickerEnabled: val }),

            isColorPickerOpen: false,
            setIsColorPickerOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isColorPickerOpen: val });
            },
            colorPickerAnchorRect: null,
            setColorPickerAnchorRect: (rect) => set({ colorPickerAnchorRect: rect }),
            eyeDropperOffset: { x: 0, y: 0 },
            setEyeDropperOffset: (offset) => set({ eyeDropperOffset: offset }),

            isPinInjectorEnabled: false,
            setIsPinInjectorEnabled: (val: boolean) => set({ isPinInjectorEnabled: val }),
            isTargetingMode: false,
            setIsTargetingMode: (val: boolean) => set({ isTargetingMode: val }),
            pinnedWindowHwnd: null,
            setPinnedWindowHwnd: (hwnd: number | null) => set({ pinnedWindowHwnd: hwnd }),

            isKoBoxEnabled: false,
            setIsKoBoxEnabled: (val: boolean) => set({ isKoBoxEnabled: val }),
            koBoxCleanupMode: '24h',
            setKoBoxCleanupMode: (val: '24h' | 'quit') => set({ koBoxCleanupMode: val }),

            isSnippetVaultOpen: false,
            setIsSnippetVaultOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isSnippetVaultOpen: val });
            },
            snippetVaultAnchorRect: null,
            setSnippetVaultAnchorRect: (rect) => set({ snippetVaultAnchorRect: rect }),
            isShortcutsOpen: false,
            setIsShortcutsOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isShortcutsOpen: val });
            },
            shortcutsAnchorRect: null,
            setShortcutsAnchorRect: (rect) => set({ shortcutsAnchorRect: rect }),
            isSnippetVaultEnabled: true,
            setIsSnippetVaultEnabled: (val: boolean) => set({ isSnippetVaultEnabled: val }),
            isSnippetVaultCompact: false,
            setIsSnippetVaultCompact: (val: boolean) => set({ isSnippetVaultCompact: val }),
            snippets: [],
            addSnippet: (snippet) => set((state) => ({ snippets: [{ ...snippet, id: crypto.randomUUID() }, ...state.snippets] })),
            updateSnippet: (id, snippet) => set((state) => ({ snippets: state.snippets.map(s => s.id === id ? { ...s, ...snippet } : s) })),
            deleteSnippet: (id) => set((state) => ({ snippets: state.snippets.filter(s => s.id !== id) })),

            isAiHubOpen: false,
            setIsAiHubOpen: (val: boolean) => set({ isAiHubOpen: val }),
            isAiHubEnabled: false,
            setIsAiHubEnabled: (val: boolean) => set({ isAiHubEnabled: val }),
            aiHubAnchorRect: null,
            setAiHubAnchorRect: (rect) => set({ aiHubAnchorRect: rect }),
            aiHubWidth: 800,
            setAiHubWidth: (width) => set((state) => ({ aiHubWidth: typeof width === 'function' ? width(state.aiHubWidth) : width })),
            aiHubHeight: 600,
            setAiHubHeight: (height) => set((state) => ({ aiHubHeight: typeof height === 'function' ? height(state.aiHubHeight) : height })),

            isKoCalendarEnabled: true,
            setIsKoCalendarEnabled: (val: boolean) => set({ isKoCalendarEnabled: val }),
            isKoCalendarOpen: false,
            setIsKoCalendarOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isKoCalendarOpen: val });
            },
            koCalendarAnchorRect: null,
            setKoCalendarAnchorRect: (rect) => set({ koCalendarAnchorRect: rect }),
            localEvents: [],
            setLocalEvents: (events: CalendarEvent[]) => set({ localEvents: events }),
            addCalendarEvent: (event) => set((state) => ({ 
                localEvents: [...state.localEvents, { 
                    ...event, 
                    id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
                    colorId: event.colorId || state.koCalendarColor
                }] 
            })),
            updateCalendarEvent: (id, updatedEvent) => set((state) => ({
                localEvents: state.localEvents.map(e => e.id === id ? { ...e, ...updatedEvent } : e)
            })),
            deleteCalendarEvent: (id) => set((state) => ({
                localEvents: state.localEvents.filter(e => e.id !== id)
            })),
            koCalendarColor: '#60a5fa', // Global default/fallback
            setKoCalendarColor: (color: string) => set({ koCalendarColor: color }),

            isTodoListOpen: false,
            setIsTodoListOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isTodoListOpen: val });
            },
            todoListAnchorRect: null,
            setTodoListAnchorRect: (rect) => set({ todoListAnchorRect: rect }),
            isTodoListEnabled: true,
            isPopupSmartPositioning: true,
            setIsTodoListEnabled: (val: boolean) => set({ isTodoListEnabled: val }),
            setIsPopupSmartPositioning: (val: boolean) => set({ isPopupSmartPositioning: val }),
            todos: [],
            addTodo: () => set((state) => ({ 
                todos: [{ id: Date.now().toString(), text: '', completed: false }, ...state.todos] 
            })),
            updateTodoText: (id, text) => set((state) => ({
                todos: state.todos.map(t => t.id === id ? { ...t, text } : t)
            })),
            updateTodoDate: (id, dueDate) => set((state) => ({
                todos: state.todos.map(t => t.id === id ? { ...t, dueDate } : t)
            })),
            toggleTodo: (id) => set((state) => ({
                todos: state.todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
            })),
            deleteTodo: (id) => set((state) => ({
                todos: state.todos.filter(t => t.id !== id)
            })),
            reorderTodos: (startIndex, endIndex) => set((state) => {
                const result = Array.from(state.todos);
                const [removed] = result.splice(startIndex, 1);
                result.splice(endIndex, 0, removed);
                return { todos: result };
            }),

            currentColor: '#237B5E',
            setCurrentColor: (hex: string) => set({ currentColor: hex }),
            colorPalettes: [],
            addPalette: (palette) => set((state) => ({ colorPalettes: [...state.colorPalettes, palette] })),
            updatePalette: (id, palette) => set((state) => ({
                colorPalettes: state.colorPalettes.map(p => p.id === id ? { ...p, ...palette } : p)
            })),
            deletePalette: (id) => set((state) => ({
                colorPalettes: state.colorPalettes.filter(p => p.id !== id)
            })),
            duplicatePalette: (id) => set((state) => {
                const palette = state.colorPalettes.find(p => p.id === id);
                if (!palette) return state;
                const newPalette = { ...palette, id: Date.now().toString(), name: `${palette.name} (Copy)` };
                return { colorPalettes: [...state.colorPalettes, newPalette] };
            }),
            autoCopyColor: true,
            setAutoCopyColor: (val: boolean) => set({ autoCopyColor: val }),

            featureOrder: ['shortcuts', 'aihub', 'copypaste', 'kocalendar', 'todolist', 'snippetvault', 'pininjector', 'screenshot', 'kobox', 'focusmode', 'colorpicker', 'calculator', 'koplayer'],
            setFeatureOrder: (order) => set({ featureOrder: order }),

            settingsFeatureViewMode: 'cards',
            setSettingsFeatureViewMode: (mode) => set({ settingsFeatureViewMode: mode }),
            settingsWorkspaceViewMode: 'cards',
            setSettingsWorkspaceViewMode: (mode) => set({ settingsWorkspaceViewMode: mode }),

            // UI Spacing & Sizing (defaults)
            toggleWidth: 22, // Note Notch Protrusion
            setToggleWidth: (val) => set({ toggleWidth: val }),
            featureSpacing: 8, // Feature Spacing
            setFeatureSpacing: (val) => set({ featureSpacing: val }),

            // Clipboard Settings
            slotCount: 8,
            setSlotCount: (val) => set({ slotCount: val }),

            // Launch at Startup
            launchAtStartup: true,
            setLaunchAtStartup: (val) => {
                set({ launchAtStartup: val });
                window.api?.setAutoLaunch?.(val);
            },
            enableEyeAnimation: true,
            setEnableEyeAnimation: (val) => set({ enableEyeAnimation: val }),

            // Language
            language: 'en',
            setLanguage: (language) => set({ language }),
            t: (key) => {
                const state = get();
                const lang = state.language || 'tr';
                return (translations as Record<string, Record<string, string>>)[lang]?.[key]
                    || (translations as Record<string, Record<string, string>>)['en'][key]
                    || key;
            },

            // Focus Mode
            isFocusPopupOpen: false,
            setIsFocusPopupOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isFocusPopupOpen: val });
            },
            focusAnchorRect: null,
            setFocusAnchorRect: (rect) => set({ focusAnchorRect: rect }),
            focusSettings: { minutes: 25, seconds: 0, melody: 'Calming', loop: false },
            setFocusSettings: (settings) => set((state) => ({ focusSettings: { ...state.focusSettings, ...settings } })),
            isFocusActive: false,
            focusRemainingTime: 0,
            startFocusMode: () => {
                const state = get();
                const totalSeconds = (state.focusSettings.minutes * 60) + state.focusSettings.seconds;
                if (totalSeconds > 0) {
                    set({ isFocusActive: true, focusRemainingTime: totalSeconds });
                }
            },
            stopFocusMode: () => set({ isFocusActive: false, focusRemainingTime: 0 }),
            tickFocusTracker: () => {
                set((state) => {
                    if (!state.isFocusActive) return state;
                    if (state.focusRemainingTime <= 1) {
                        // Don't set isFocusActive false here! Let FocusButton detect
                        // focusRemainingTime === 0 while isFocusActive is still true,
                        // so it can trigger the alarm.
                        return { focusRemainingTime: 0 };
                    }
                    return { focusRemainingTime: state.focusRemainingTime - 1 };
                });
            },

            // Mini Mode
            isMiniMode: false,
            miniModePosition: null,
            setMiniMode: (isMini, pos) => set((state) => {
                const updates: Partial<AppState> = { isMiniMode: isMini };
                if (pos) {
                    updates.miniModePosition = pos;
                    if (!isMini) {
                        if (state.orientation === 'horizontal') {
                            // In horizontal mode, the static utilities (like the Eye button) are on the far right.
                            // The eye button itself has a width of 48px, so its half-width is 24 * iconScale.
                            // The horizontal container has a right padding of pr-2 (8px).
                            // Thus, the distance from the center of the eye to the rightmost edge of the sidebar is:
                            const centerToRight = (24 * state.iconScale) + 8;
                            const sidebarY = pos.y - (state.sidebarWidth / 2);
                            updates.sidebarPosition = {
                                x: pos.x - state.lastSidebarWidth + centerToRight,
                                y: sidebarY
                            };

                            // Recalculate edgePosition so NotePanel/SettingsPanel opens on the correct side
                            const screenH = state.screenBounds?.height ?? 800;
                            const sidebarCenterY = sidebarY + (state.sidebarWidth / 2);
                            updates.edgePosition = sidebarCenterY < (screenH / 2) ? 'top' : 'bottom';
                        } else {
                            // Position the sidebar's bottom handle precisely where the eye was located
                            // We subtract lastSidebarHeight so the bottom of the sidebar rests at the eye's Y pos
                            // The eye button itself has a height of 48px, so its half-height is 24 * iconScale.
                            // We add the bottom padding (8px from pb-2) to get the exact distance from the center of the button to the bottom of the sidebar.
                            const centerToBottom = (24 * state.iconScale) + 8;
                            const sidebarX = pos.x - (state.sidebarWidth / 2);
                            updates.sidebarPosition = {
                                x: sidebarX,
                                y: pos.y - state.lastSidebarHeight + centerToBottom
                            };

                            // Recalculate edgePosition so NotePanel/SettingsPanel opens on the correct side
                            const screenW = state.screenBounds?.width ?? 1920;
                            const isMacPlatform = state.isMac;
                            const screenCenter = isMacPlatform ? (screenW / 2) : 3000;
                            const sidebarCenterX = sidebarX + (state.sidebarWidth / 2);
                            updates.edgePosition = sidebarCenterX < screenCenter ? 'left' : 'right';
                        }
                    }
                } else if (!pos && isMini) {
                    updates.miniModePosition = null;
                }
                return updates;
            }),
            // Note management
            notes: defaultNotes,
            activeNoteId: 1,
            nextNoteId: 2,
            setActiveNoteId: (id) => set({ activeNoteId: id }),
            addNote: () => set((state) => {
                const newNote: Note = {
                    id: state.nextNoteId,
                    title: state.t('addNewNote'),
                    icon: 'note',
                    emoji: null,
                    content: '',
                };
                return {
                    notes: [...state.notes, newNote],
                    activeNoteId: newNote.id,
                    nextNoteId: state.nextNoteId + 1,
                };
            }),
            deleteNote: (id) => set((state) => {
                const filtered = state.notes.filter(n => n.id !== id);
                if (filtered.length === 0) return state;
                const newActiveId = state.activeNoteId === id
                    ? filtered[0].id
                    : state.activeNoteId;
                return { notes: filtered, activeNoteId: newActiveId };
            }),
            updateNoteContent: (id, content) => set((state) => ({
                notes: state.notes.map(n => n.id === id ? { ...n, content } : n),
            })),
            updateNoteTitle: (id, title) => set((state) => ({
                notes: state.notes.map(n => n.id === id ? { ...n, title } : n),
            })),
            updateNoteEmoji: (id, emoji) => set((state) => ({
                notes: state.notes.map(n => n.id === id ? { ...n, emoji } : n),
            })),
            openSettingsTab: () => set((state) => {
                let settingsNote = state.notes.find(n => n.isSettings);
                let nextNotes = state.notes;
                let nextId = state.nextNoteId;

                if (!settingsNote) {
                    settingsNote = {
                        id: state.nextNoteId,
                        title: state.t('settings'),
                        icon: 'settings',
                        emoji: null,
                        content: '',
                        isSettings: true,
                    };
                    nextNotes = [...state.notes, settingsNote];
                    nextId++;
                }

                return {
                    isNotePanelOpen: true,
                    notes: nextNotes,
                    activeNoteId: settingsNote.id,
                    nextNoteId: nextId,
                };
            }),
            openPluginsTab: () => set((state) => {
                let pluginsNote = state.notes.find(n => n.isPlugins);
                let nextNotes = state.notes;
                let nextId = state.nextNoteId;

                if (!pluginsNote) {
                    pluginsNote = {
                        id: state.nextNoteId,
                        title: state.t ? (state.t as any)('plugins') || 'Plugins' : 'Plugins',
                        icon: 'extension',
                        emoji: null,
                        content: '',
                        isPlugins: true,
                    };
                    nextNotes = [...state.notes, pluginsNote];
                    nextId++;
                }

                return {
                    isNotePanelOpen: true,
                    notes: nextNotes,
                    activeNoteId: pluginsNote.id,
                    nextNoteId: nextId,
                };
            }),

            // Calculator Popup State
            isCalculatorOpen: false,
            setIsCalculatorOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isCalculatorOpen: val });
            },
            isCalculatorScientific: false,
            setIsCalculatorScientific: (val: boolean) => set({ isCalculatorScientific: val }),
            calculatorAnchorRect: null,
            setCalculatorAnchorRect: (rect) => set({ calculatorAnchorRect: rect }),

            // KoPlayer Media Controller
            isKoPlayerEnabled: true,
            setIsKoPlayerEnabled: (val: boolean) => set({ isKoPlayerEnabled: val }),
            isKoPlayerOpen: false,
            setIsKoPlayerOpen: (val: boolean) => {
                if (val) get().closeAllUtilityPopups();
                set({ isKoPlayerOpen: val });
            },
            koPlayerAnchorRect: null,
            setKoPlayerAnchorRect: (rect) => set({ koPlayerAnchorRect: rect }),
            currentMedia: null,
            setCurrentMedia: (data) => set({ currentMedia: data }),
            // Video PiP — cached browser video URLs from background SMTC scan
            activeVideoUrls: [],
            setActiveVideoUrls: (urls) => set({ activeVideoUrls: urls }),
            currentMediaSourceApp: '',
            setCurrentMediaSourceApp: (app) => set({ currentMediaSourceApp: app }),

            // License
            isLicensed: false,
            setLicensed: (val) => set({ isLicensed: val }),

            // Scroll Memory
            scrollPositions: {},
            setScrollPosition: (key: string, pos: number) => set((state) => ({ 
                scrollPositions: { ...state.scrollPositions, [key]: pos } 
            })),

            // Workspaces
            workspaces: [],
            saveCurrentAsWorkspace: (name) => set((state) => {
                const newWorkspace: WorkspaceConfig = {
                    id: Date.now().toString(),
                    name,
                    isShortcutsEnabled: state.isShortcutsEnabled,
                    isCopyPasteEnabled: state.isCopyPasteEnabled,
                    isScreenshotEnabled: state.isScreenshotEnabled,
                    isFocusModeEnabled: state.isFocusModeEnabled,
                    isCalculatorEnabled: state.isCalculatorEnabled,
                    isColorPickerEnabled: state.isColorPickerEnabled,
                    isPinInjectorEnabled: state.isPinInjectorEnabled,
                    isKoBoxEnabled: state.isKoBoxEnabled,
                    isSnippetVaultEnabled: state.isSnippetVaultEnabled,
                    isAiHubEnabled: state.isAiHubEnabled,
                    isKoPlayerEnabled: state.isKoPlayerEnabled,
                    isKoCalendarEnabled: state.isKoCalendarEnabled,
                    isTodoListEnabled: state.isTodoListEnabled,
                    maxShortcuts: state.maxShortcuts,
                    slotCount: state.slotCount,
                    koBoxCleanupMode: state.koBoxCleanupMode,
                    autoCopyColor: state.autoCopyColor,
                    hideOnScreenshot: state.hideOnScreenshot,
                    toggleWidth: state.toggleWidth,
                    sidebarWidth: state.sidebarWidth,
                    iconScale: state.iconScale,
                    featureSpacing: state.featureSpacing,
                    showTooltips: state.showTooltips,
                    theme: state.theme,
                    customThemeColor: state.customThemeColor,
                    design: state.design,
                    glassOpacity: state.glassOpacity,
                    featureOrder: [...state.featureOrder],
                    edgePosition: state.edgePosition,
                    isPopupSmartPositioning: state.isPopupSmartPositioning,
                    enableEyeAnimation: state.enableEyeAnimation,
                    orientation: state.orientation
                };
                return { workspaces: [...state.workspaces, newWorkspace] };
            }),
            loadWorkspace: (id) => set((state) => {
                const ws = state.workspaces.find(w => w.id === id);
                if (!ws) return state;
                document.documentElement.setAttribute('data-theme', ws.theme);
                document.documentElement.setAttribute('data-design', ws.design);
                if (ws.theme === 'custom' && ws.customThemeColor) {
                    applyCustomThemeCSS(ws.customThemeColor);
                } else {
                    clearCustomThemeCSS();
                }
                return {
                    isShortcutsEnabled: ws.isShortcutsEnabled,
                    isCopyPasteEnabled: ws.isCopyPasteEnabled,
                    isScreenshotEnabled: ws.isScreenshotEnabled,
                    isFocusModeEnabled: ws.isFocusModeEnabled,
                    isCalculatorEnabled: ws.isCalculatorEnabled,
                    isColorPickerEnabled: ws.isColorPickerEnabled,
                    isPinInjectorEnabled: ws.isPinInjectorEnabled,
                    isKoBoxEnabled: ws.isKoBoxEnabled,
                    isSnippetVaultEnabled: ws.isSnippetVaultEnabled,
                    isAiHubEnabled: ws.isAiHubEnabled,
                    isKoPlayerEnabled: ws.isKoPlayerEnabled,
                    isKoCalendarEnabled: ws.isKoCalendarEnabled,
                    isTodoListEnabled: ws.isTodoListEnabled,
                    maxShortcuts: ws.maxShortcuts,
                    slotCount: ws.slotCount,
                    koBoxCleanupMode: ws.koBoxCleanupMode,
                    autoCopyColor: ws.autoCopyColor,
                    hideOnScreenshot: ws.hideOnScreenshot,
                    toggleWidth: ws.toggleWidth,
                    sidebarWidth: ws.sidebarWidth,
                    iconScale: ws.iconScale,
                    featureSpacing: ws.featureSpacing,
                    showTooltips: ws.showTooltips,
                    theme: ws.theme,
                    customThemeColor: ws.customThemeColor || state.customThemeColor,
                    design: ws.design,
                    glassOpacity: ws.glassOpacity,
                    featureOrder: [...ws.featureOrder],
                    edgePosition: ws.edgePosition,
                    isPopupSmartPositioning: ws.isPopupSmartPositioning || false,
                    enableEyeAnimation: ws.enableEyeAnimation !== undefined ? ws.enableEyeAnimation : true,
                    orientation: ws.orientation || 'vertical'
                };
            }),
            deleteWorkspace: (id) => set((state) => ({
                workspaces: state.workspaces.filter(w => w.id !== id)
            })),
            updateWorkspaceName: (id, newName) => set((state) => ({
                workspaces: state.workspaces.map(w => w.id === id ? { ...w, name: newName } : w)
            })),
            updateWorkspaceSettings: (id) => set((state) => ({
                workspaces: state.workspaces.map(w => w.id === id ? {
                    ...w,
                    isShortcutsEnabled: state.isShortcutsEnabled,
                    isCopyPasteEnabled: state.isCopyPasteEnabled,
                    isScreenshotEnabled: state.isScreenshotEnabled,
                    isFocusModeEnabled: state.isFocusModeEnabled,
                    isCalculatorEnabled: state.isCalculatorEnabled,
                    isColorPickerEnabled: state.isColorPickerEnabled,
                    isPinInjectorEnabled: state.isPinInjectorEnabled,
                    isKoBoxEnabled: state.isKoBoxEnabled,
                    isSnippetVaultEnabled: state.isSnippetVaultEnabled,
                    isAiHubEnabled: state.isAiHubEnabled,
                    isKoPlayerEnabled: state.isKoPlayerEnabled,
                    isKoCalendarEnabled: state.isKoCalendarEnabled,
                    isTodoListEnabled: state.isTodoListEnabled,
                    isPopupSmartPositioning: state.isPopupSmartPositioning,
                    maxShortcuts: state.maxShortcuts,
                    slotCount: state.slotCount,
                    koBoxCleanupMode: state.koBoxCleanupMode,
                    autoCopyColor: state.autoCopyColor,
                    hideOnScreenshot: state.hideOnScreenshot,
                    toggleWidth: state.toggleWidth,
                    sidebarWidth: state.sidebarWidth,
                    iconScale: state.iconScale,
                    featureSpacing: state.featureSpacing,
                    showTooltips: state.showTooltips,
                    theme: state.theme,
                    customThemeColor: state.customThemeColor,
                    design: state.design,
                    glassOpacity: state.glassOpacity,
                    featureOrder: [...state.featureOrder],
                    edgePosition: state.edgePosition,
                    enableEyeAnimation: state.enableEyeAnimation,
                    orientation: state.orientation
                } : w)
            })),
        }),
        {
            name: 'kobar-storage',
            version: 18,
            migrate: (persistedState: any, version: number) => {
                // version 18 migration for orientation
                if (version <= 17) {
                    if (persistedState.orientation === undefined) {
                        persistedState.orientation = 'vertical';
                    }
                    if (persistedState.edgePosition === undefined) {
                        persistedState.edgePosition = 'right';
                    }
                }
                // version 17 migration for enableEyeAnimation
                if (version <= 16) {
                    if (persistedState.enableEyeAnimation === undefined) {
                        persistedState.enableEyeAnimation = true;
                    }
                }
                if (version <= 12) {
                    if (persistedState.workspaces === undefined) {
                        persistedState.workspaces = [];
                    }
                }
                if (version === 0) {
                    // Ensure 'calculator' is in the order if it's missing
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('calculator')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'calculator'];
                    }
                    // Ensure it's enabled by default if not set
                    if (persistedState.isCalculatorEnabled === undefined) {
                        persistedState.isCalculatorEnabled = true;
                    }
                }
                
                // version 1 migration for colorpicker
                if (version <= 1) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('colorpicker')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'colorpicker'];
                    }
                    if (persistedState.isColorPickerEnabled === undefined) {
                        persistedState.isColorPickerEnabled = true;
                    }
                    if (!persistedState.colorPalettes) {
                        persistedState.colorPalettes = [];
                    }
                }

                // version 2 migration for todolist
                if (version <= 2) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('todolist')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'todolist'];
                    }
                    if (persistedState.isTodoListEnabled === undefined) {
                        persistedState.isTodoListEnabled = true;
                    }
                    if (!persistedState.todos) {
                        persistedState.todos = [];
                    }
                }

                // version 3 migration for pininjector
                if (version <= 3) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('pininjector')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'pininjector'];
                    }
                    if (persistedState.isPinInjectorEnabled === undefined) {
                        persistedState.isPinInjectorEnabled = true;
                    }
                }

                if (version <= 10) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('kocalendar')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'kocalendar'];
                    }
                    if (persistedState.isKoCalendarEnabled === undefined) {
                        persistedState.isKoCalendarEnabled = true;
                    }
                    // Migrate old calendarEvents to localEvents if any exist
                    if (persistedState.calendarEvents && !persistedState.localEvents) {
                        persistedState.localEvents = persistedState.calendarEvents;
                    }
                    if (persistedState.localEvents === undefined) {
                        persistedState.localEvents = [];
                    }
                }

                if (version <= 11) {
                    if (persistedState.koCalendarColor === undefined) {
                        persistedState.koCalendarColor = '#60a5fa';
                    }
                    if (!persistedState.localEvents) {
                        persistedState.localEvents = [];
                    }
                }

                // version 4 migration for kobox
                if (version <= 4) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('kobox')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'kobox'];
                    }
                    if (persistedState.isKoBoxEnabled === undefined) {
                        persistedState.isKoBoxEnabled = true;
                    }
                    if (persistedState.koBoxCleanupMode === undefined) {
                        persistedState.koBoxCleanupMode = '24h';
                    }
                }

                // version 5/6 migration for snippetvault
                if (version <= 5) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('snippetvault')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'snippetvault'];
                    }
                    if (persistedState.isSnippetVaultEnabled === undefined) {
                        persistedState.isSnippetVaultEnabled = true;
                    }
                    if (persistedState.snippets === undefined) {
                        persistedState.snippets = [];
                    }
                }

                // version 14 migration for snippet passwords
                if (version <= 13) {
                    if (persistedState.snippets) {
                        persistedState.snippets = persistedState.snippets.map((s: any) => ({
                            ...s,
                            password: s.password || undefined
                        }));
                    }
                }

                // version 15 migration for snippet colors
                if (version <= 14) {
                    if (persistedState.snippets) {
                        persistedState.snippets = persistedState.snippets.map((s: any) => ({
                            ...s,
                            color: s.color || undefined
                        }));
                    }
                }

                // AI hub migration
                if (version <= 6) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('aihub')) {
                        // Force it to be the second item (after shortcuts)
                        persistedState.featureOrder = ['shortcuts', 'aihub', ...persistedState.featureOrder.filter((f: string) => f !== 'shortcuts' && f !== 'aihub')];
                    }
                    if (persistedState.isAiHubEnabled === undefined) {
                        persistedState.isAiHubEnabled = true;
                    }
                    // Final sanity check for featureOrder array
                    if (!persistedState.featureOrder) {
                        persistedState.featureOrder = ['shortcuts', 'aihub', 'copypaste', 'todolist', 'snippetvault', 'pininjector', 'screenshot', 'kobox', 'focusmode', 'colorpicker', 'calculator'];
                    }
                }

                // version 8 migration for KoPlayer
                if (version <= 7) {
                    if (persistedState.featureOrder && !persistedState.featureOrder.includes('koplayer')) {
                        persistedState.featureOrder = [...persistedState.featureOrder, 'koplayer'];
                    }
                    if (persistedState.isKoPlayerEnabled === undefined) {
                        persistedState.isKoPlayerEnabled = true;
                    }
                }

                // version 16 migration for custom theme
                if (version <= 15) {
                    if (persistedState.customThemeColor === undefined) {
                        persistedState.customThemeColor = '#f4a125';
                    }
                }

                return persistedState;
            },
            partialize: (state) => ({
                notes: state.notes,
                activeNoteId: state.activeNoteId,
                nextNoteId: state.nextNoteId,
                notePanelWidth: state.notePanelWidth,
                notePanelHeight: state.notePanelHeight,
                pinnedApps: state.pinnedApps,
                theme: state.theme,
                customThemeColor: state.customThemeColor,
                language: state.language,
                focusSettings: state.focusSettings,
                showTooltips: state.showTooltips,
                sidebarWidth: state.sidebarWidth,
                iconScale: state.iconScale,
                teleportShortcut: state.teleportShortcut,
                launchAtStartup: state.launchAtStartup,
                enableEyeAnimation: state.enableEyeAnimation,
                isShortcutsEnabled: state.isShortcutsEnabled,
                maxShortcuts: state.maxShortcuts,
                isCopyPasteEnabled: state.isCopyPasteEnabled,
                isScreenshotEnabled: state.isScreenshotEnabled,
                hideOnScreenshot: state.hideOnScreenshot,
                isFocusModeEnabled: state.isFocusModeEnabled,
                isCalculatorEnabled: state.isCalculatorEnabled,
                isColorPickerEnabled: state.isColorPickerEnabled,
                isKoCalendarEnabled: state.isKoCalendarEnabled,
                isTodoListEnabled: state.isTodoListEnabled,
                isPinInjectorEnabled: state.isPinInjectorEnabled,
                isKoBoxEnabled: state.isKoBoxEnabled,
                isSnippetVaultEnabled: state.isSnippetVaultEnabled,
                isAiHubEnabled: state.isAiHubEnabled,
                isKoPlayerEnabled: state.isKoPlayerEnabled,
                koBoxCleanupMode: state.koBoxCleanupMode,
                autoCopyColor: state.autoCopyColor,
                colorPalettes: state.colorPalettes,
                todos: state.todos,
                snippets: state.snippets,
                localEvents: state.localEvents,
                featureOrder: state.featureOrder,
                design: state.design,
                glassOpacity: state.glassOpacity,
                slotCount: state.slotCount,
                aiHubHeight: state.aiHubHeight,
                koCalendarColor: state.koCalendarColor,
                workspaces: state.workspaces,
                isSnippetVaultCompact: state.isSnippetVaultCompact,
                isCalculatorScientific: state.isCalculatorScientific,
                settingsFeatureViewMode: state.settingsFeatureViewMode,
                settingsWorkspaceViewMode: state.settingsWorkspaceViewMode,
                orientation: state.orientation,
                edgePosition: state.edgePosition,
            }),
            onRehydrateStorage: (_) => {
                console.log('[Store] Hydration starting...');
                return (fetchedState, error) => {
                    if (error) {
                        console.error('[Store] Hydration failed:', error);
                    } else if (fetchedState) {
                        fetchedState.setHydrated(true);

                        // Priority 1: Force color from emergency sync storage
                        const forcedColor = localStorage.getItem('kobar_force_theme_color');
                        
                        if (fetchedState.theme === 'custom') {
                            const finalColor = forcedColor || fetchedState.customThemeColor;
                            if (finalColor) {
                                applyCustomThemeCSS(finalColor);
                            }
                        }
                        console.log('[Store] Hydration complete. Theme:', fetchedState.theme);
                    }
                };
            },
        }
    )
);

