import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { translate } from '../i18n/translate';
import type { LanguageCode, TranslationKeys } from '../i18n';
import { FORCED_THEME_COLOR_KEY, KOBAR_STORAGE_VERSION, migratePersistedKobarStorage } from './migrations';
import { appPersistStorage, flushAppPersist } from './persistStorage';
import { handleHydrationFailure } from './hydrationError';
import { findActiveWorkspace, patchActiveWorkspace } from './workspace/activeWorkspace';
import { computeNextNoteId, resolveActiveNoteId, resolveContextNotes } from './workspace/context';
import { writeActiveContextNotes } from './workspace/contextNotes';
import { shouldSwitchDataContext, type WorkspaceContextReason } from './workspace/dataContext';
import { extensionsConfigForActiveContext, needsFullPluginReload, planExtensionsContextSwitch } from './workspace/enabledExtensions';
import { type DeleteWorkspaceResult, defaultDeleteWorkspaceDeps, deleteWorkspaceWithBackup } from './workspace/deleteWorkspace';
import { REPO_URL } from '../config/links';
import { openSettingsPage } from './settingsOpener';
import { getWindowGeometry } from '../utils/windowGeometry';
import { computeVisibleArea } from '../utils/visibleArea';
import { DEFAULT_FEATURE_ORDER } from '../config/defaults';
import { applyCustomThemeCSS, clearLegacyThemeCSS } from '../utils/color';
import type { Accent, Scheme } from '../theme';
import {
    DEFAULT_ACCENT,
    DEFAULT_CUSTOM_THEME_COLOR,
    DEFAULT_GLASS_OPACITY,
    DEFAULT_MATERIAL,
    DEFAULT_SCHEME,
    THEME_FOR_ACCENT,
    accentFromLegacy,
    legacyMaterialFields,
    legacyThemeFields,
    materialFromLegacy,
    profileAccent,
    profileMaterial,
    type Material,
} from './appearance';
import { DEFAULT_DENSITY, densityFromSidebarWidth, isDensity, legacySidebarWidth, profileDensity, type Density } from './density';
import { clampNoteListWidth, NOTE_LIST_WIDTH_DEFAULT } from '../notes/noteListWidth';
import { sanitizePanelOffset, type PanelAxis, type PanelOffsets } from '../components/plugins/panelPosition';
import { DEFAULT_ONBOARDING, isOnboardingState, type OnboardingState } from './onboarding';
export type ThemeName = 'ember' | 'ocean' | 'sakura' | 'emerald' | 'midnight' | 'amethyst' | 'crimson' | 'nord' | 'coffee' | 'lavender' | 'custom';

// Re-exported for existing importers (older importers).
export { applyCustomThemeCSS };

/** 1.2.x compatibility (T-601): <= v25 read this key on startup for a custom theme. A failing write is not an error. */
function writeForcedThemeColor(hex: string) {
    try {
        localStorage.setItem(FORCED_THEME_COLOR_KEY, hex);
    } catch (err) {
        console.warn('[Store] Could not write the custom theme colour key:', err);
    }
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

export interface EyeNotificationButton {
    label: string;
    color: string;
    onClick: () => void;
}

export interface EyeNotificationData {
    isVisible: boolean;
    message: string;
    buttons?: EyeNotificationButton[];
}

export interface PinnedApp {
    id: string;
    name: string;
    path: string;
    icon: string;
    tag?: string;
}

export interface TutorialState {
    version: string;
    status: 'pending' | 'completed' | 'snoozed';
    snoozeUntil?: number;
}


export interface WorkspaceIsolatedData {
    notes?: Note[];
    activeNoteId?: number;
    nextNoteId?: number;
    pluginData?: Record<string, any>;
}

export interface WorkspaceConfig {
    id: string;
    name: string;
    isIsolated: boolean;
    isolatedData?: WorkspaceIsolatedData;
    enabledExtensions?: Record<string, boolean>;

    isPinInjectorEnabled: boolean;
    isKoBoxEnabled: boolean;

    koBoxCleanupMode: '24h' | 'quit';

    toggleWidth: number;
    sidebarWidth: number;
    iconScale: number;
    featureSpacing: number;
    showTooltips: boolean;
    theme: ThemeName;
    customThemeColor: string;
    design: 'style1' | 'style2';
    glassOpacity: number;
    /** v26 (T-601): per-workspace accent; missing on records written before v26 (derive with `profileAccent`). */
    accent?: Accent;
    /** v26 (T-601): per-workspace material; missing on records written before v26 (derive with `profileMaterial`). */
    material?: Material;
    /** v27 (T-602): per-workspace density; missing on records written before v27 (derive with `profileDensity`). */
    density?: Density;
    featureOrder: string[];
    edgePosition: 'left' | 'right' | 'top' | 'bottom';
    isPopupSmartPositioning: boolean;
    enableEyeAnimation: boolean;
    orientation: 'vertical' | 'horizontal';
}

export interface AppState {
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
    /** R-11: width of the note list column (px, clamped to NOTE_LIST_WIDTH_MIN..MAX). */
    noteListWidth: number;
    setNoteListWidth: (width: number) => void;
    /** R-15: per plugin id, the panel's offset (px) from its default position along the bar's free axis (x: horizontal bar, y: vertical bar). */
    pluginPanelOffsets: Record<string, PanelOffsets>;
    /** Sets (or, with `null`, clears) one axis of a plugin's panel offset. */
    setPluginPanelOffset: (pluginId: string, axis: PanelAxis, offset: number | null) => void;
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

    // Tutorial State
    tutorialState: TutorialState;
    /** v23 (T-027): retired legacy fields (colorPalettes, todos, ...) kept after migration instead of being deleted.
     *  v24 (T-408): `workspaceModelV24` holds the raw workspace values the workspace-model migration replaced. */
    legacyBackup?: Record<string, unknown>;
    setTutorialState: (state: Partial<TutorialState>) => void;
    /** v29 (T-604): first-run state (src/store/onboarding.ts); independent of the v1 `tutorialState`. Device-level. */
    onboarding: OnboardingState;
    setOnboarding: (updates: Partial<OnboardingState>) => void;
    isManualTutorialTrigger: boolean;
    setIsManualTutorialTrigger: (val: boolean) => void;
    isHighlightingToggleNotes: boolean;
    setIsHighlightingToggleNotes: (val: boolean) => void;
    isHighlightingSettingsBtn: boolean;
    setIsHighlightingSettingsBtn: (val: boolean) => void;
    isHighlightingPluginsBtn: boolean;
    setIsHighlightingPluginsBtn: (val: boolean) => void;

    // Eye Notification
    eyeNotification: EyeNotificationData | null;
    showEyeNotification: (data: Omit<EyeNotificationData, 'isVisible'>) => void;
    hideEyeNotification: () => void;
    addNote: () => void;
    /** Appends notes (new ids) to the active data context; the active note does not change. Used by data import. */
    addNotes: (notes: Omit<Note, 'id'>[]) => void;
    deleteNote: (id: number) => void;
    updateNoteContent: (id: number, content: string) => void;
    updateNoteTitle: (id: number, title: string) => void;
    updateNoteEmoji: (id: number, emoji: string) => void;
    openSettingsTab: () => void;
    openPluginsTab: () => void;
    /** T-615: main-window host tab for a plugin's v1 settings panel (`id`) or the GitHub link install (`null`). */
    openPluginSettings: (id: string | null) => void;
    // App Launcher

    // Appearance (v26, T-601): the UI follows scheme/accent/material; the v1 fields below stay consistent with them.
    /** Global; 'system' follows the OS. */
    scheme: Scheme;
    setScheme: (scheme: Scheme) => void;
    /** Per workspace. 'custom' uses `customThemeColor`. */
    accent: Accent;
    /** `customHex` (for 'custom') becomes `customThemeColor`; a hex equal to a preset selects that preset. */
    setAccent: (accent: Accent, customHex?: string) => void;
    /** Per workspace. */
    material: Material;
    setMaterial: (material: Material) => void;
    /** v27 (T-602), per workspace. App.tsx writes it to the root `data-density`; `sidebarWidth` is its v1 view. */
    density: Density;
    setDensity: (density: Density) => void;
    // Theme (v1 view of `accent`; plugins read it)
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
    customThemeColor: string;
    setCustomThemeColor: (color: string) => void;
    // Design System (v1 view of `material`; plugins read it)
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

    // Layout Context
    screenBounds: { x: number, y: number, width: number, height: number } | null;
    setScreenBounds: (bounds: any) => void;
    sidebarAnchorRect: { top: number, left: number, bottom: number, right: number, width: number, height: number } | null;
    setSidebarAnchorRect: (rect: any) => void;

    // Feature Toggles



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







    isPopupSmartPositioning: boolean;
    setIsPopupSmartPositioning: (val: boolean) => void;




    featureOrder: string[];
    setFeatureOrder: (order: string[]) => void;

    settingsFeatureViewMode: 'list' | 'cards';
    setSettingsFeatureViewMode: (mode: 'list' | 'cards') => void;

    // UI Spacing & Sizing
    toggleWidth: number;
    setToggleWidth: (val: number) => void;
    featureSpacing: number;
    setFeatureSpacing: (val: number) => void;



    // Launch at Startup
    launchAtStartup: boolean;
    setLaunchAtStartup: (val: boolean) => void;
    enableEyeAnimation: boolean;
    setEnableEyeAnimation: (val: boolean) => void;
    // Language
    language: LanguageCode;
    setLanguage: (lang: LanguageCode) => void;
    t: (key: TranslationKeys) => string;

    currentMedia: MediaData | null;
    setCurrentMedia: (data: MediaData | null) => void;
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
    /** Bumped by every plugin load request (full or diff); the host loader and plugin lists follow it. Volatile. */
    extensionReloadTrigger: number;
    /** Full reload: every plugin script runs again (install, update, data namespace switch). */
    triggerExtensionReload: () => void;
    /** T-409: bumped only by full reload requests (see src/components/extensions/pluginLoader.ts). Volatile. */
    extensionFullReloadTrigger: number;
    /** T-409: loads/unloads only the plugins whose enabled flag changed or that were uninstalled (toggle, uninstall,
     * workspace switch in the same data namespace); running plugins are left alone. */
    syncEnabledExtensions: () => void;
    /** T-206: bumped on every plugin data context switch; React key for plugin roots. Volatile (not persisted). */
    dataContextId: number;
    extensionsSubTab: 'installed' | 'marketplace';
    setExtensionsSubTab: (tab: 'installed' | 'marketplace') => void;
    pluginsViewMode: 'grid' | 'list';
    setPluginsViewMode: (mode: 'grid' | 'list') => void;
    selectedPluginId: string | null;
    setSelectedPluginId: (id: string | null) => void;
    externalPluginsList: any[];
    setExternalPluginsList: (list: any[]) => void;
    pluginsSelectedTags: string[];
    setPluginsSelectedTags: (tags: string[]) => void;
    /** Mirror of extensions-config.json = the enabled set of the active context (see ./workspace/enabledExtensions). */
    currentExtensionsConfig: Record<string, boolean>;
    /** T-409 (v25): the Default workspace's list, saved while a workspace is active; null = Default active, or unknown. */
    defaultExtensionsConfig: Record<string, boolean> | null;
    setCurrentExtensionsConfig: (config: Record<string, boolean>) => void;
    setExtensionEnabledInWorkspace: (extensionId: string, enabled: boolean) => void;

    // Workspace & Data Isolation
    activeWorkspaceId: string | null;
    setActiveWorkspaceId: (id: string | null) => void;
    globalNotes: Note[];
    globalPluginData: Record<string, any>;
    toggleWorkspaceIsolation: (id: string) => void;
    getPluginData: <T = any>(pluginId: string, defaultValue?: T) => T;
    setPluginData: (pluginId: string, data: any) => void;

    // Workspaces
    workspaces: WorkspaceConfig[];
    saveCurrentAsWorkspace: (name: string, isIsolated?: boolean) => void;
    loadWorkspace: (id: string) => void;
    deleteWorkspace: (id: string) => void;
    /** T-214: automatic backup, then deleteWorkspace, then removal of the workspace's `_iso_<id>` keys. */
    deleteWorkspaceWithBackup: (id: string) => Promise<DeleteWorkspaceResult>;
    updateWorkspaceName: (id: string, newName: string) => void;
    updateWorkspaceSettings: (id: string) => void;
}

// ─── T-206 (WS-03): single entry point for workspace actions that may switch the plugin data context ───
interface WorkspaceContextOptions {
    /** DOM/localStorage side effects of the action; runs once the patch is committed (never inside the `set` callback). */
    afterCommit?: (committed: AppState) => void;
}

type AppStoreSet = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

/** T-409: only the latest return to the Default workspace may drop the saved Default list (see applyWorkspaceContext). */
let defaultRestoreToken = 0;

/** T-418: counts data-context switches; a retried extensions-config write of an older switch never runs after a newer one. */
let extensionsSwitchSeq = 0;

/** T-418: delays before the retries of a failed extensions-config write of a workspace switch (bounded: two retries). */
const EXTENSIONS_WRITE_RETRY_DELAYS_MS = [500, 2000] as const;

/** T-409: the file owns the Default list again once main wrote it, unless a newer return to the Default or a switch came. */
function dropSavedDefaultIfCurrent(set: AppStoreSet, get: () => AppState, token: number): void {
    if (token === defaultRestoreToken && !findActiveWorkspace(get())) set(() => ({ defaultExtensionsConfig: null }));
}

/**
 * T-418: retries a failed `setExtensionsConfig` of switch `seq` after a short delay, at most twice. Each attempt sends the
 * set of the context that is active THEN (extensionsConfigForActiveContext), so a plugin toggled meanwhile keeps its new
 * value. The retry stops quietly when a newer context switch happened (that switch planned against the reloaded mirror and is responsible for the file from now on)
 * or while the persist storage is locked (a backup restore is writing). On success the saved Default list is dropped as
 * after a first-try success, and the plugins are synced to the written set (diff load). Never throws.
 */
function retryExtensionsConfigWrite(
    set: AppStoreSet,
    get: () => AppState,
    seq: number,
    defaultToken: number,
    clearDefaultAfterWrite: boolean,
    attempt = 0
): void {
    const delay = EXTENSIONS_WRITE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
        console.error('setExtensionsConfig retries failed; extensions-config.json keeps the previous set until the next switch');
        return;
    }
    setTimeout(() => {
        if (seq !== extensionsSwitchSeq) return;
        if (appPersistStorage.lockReason() !== null) {
            console.warn('setExtensionsConfig retry skipped: persist storage locked');
            return;
        }
        if (typeof window === 'undefined' || !window.api?.setExtensionsConfig) return;
        let request: Promise<unknown>;
        try {
            request = Promise.resolve(window.api.setExtensionsConfig(extensionsConfigForActiveContext(get())));
        } catch (err) {
            request = Promise.reject(err);
        }
        request
            .then(
                (ok) => ok === true,
                () => false
            )
            .then((ok) => {
                if (seq !== extensionsSwitchSeq) return;
                if (!ok) {
                    retryExtensionsConfigWrite(set, get, seq, defaultToken, clearDefaultAfterWrite, attempt + 1);
                    return;
                }
                if (clearDefaultAfterWrite) dropSavedDefaultIfCurrent(set, get, defaultToken);
                // The loader reads the file again: the mirror and the loaded plugins follow the written set.
                get().syncEnabledExtensions();
            })
            .catch((err: unknown) => console.error('setExtensionsConfig retry failed', err));
    }, delay);
}

/** Plugin v1 contract: plugins (and usePluginData) listen to this event on window. Payload must stay `{ workspaceId }`. */
function notifyWorkspaceChanged(workspaceId: string | null): void {
    setTimeout(() => {
        if (typeof window !== 'undefined') {
            window.KoBarExtensions?.notify?.();
            window.dispatchEvent(new CustomEvent('kobar:workspace-changed', { detail: { workspaceId: workspaceId } }));
        }
    }, 0);
}

/**
 * Runs a workspace action. `recipe` computes the state patch from the current state (return null for a no-op).
 * When the action switches the data context (see shouldSwitchDataContext), in this order:
 * 1. the patch, `dataContextId + 1` and (T-409) the enabled-plugin set of the context that becomes active are committed
 *    together (plugin roots keyed on dataContextId remount on the new context, and localStorageIsolation reads the new
 *    namespace from then on; see ./workspace/enabledExtensions for the merge rule and the saved Default list);
 * 2. when that set changed, main derives extensions-config.json from it (`setExtensionsConfig`), then plugins are
 *    loaded: a full reload when the plugins' data namespace changed, otherwise only the enabled-set diff (T-409);
 * 3. `kobar:workspace-changed` is dispatched on the next tick (same timing as the old loadWorkspace).
 * Otherwise only the patch is committed. No persist flush is needed before the switch: plugins write localStorage
 * synchronously, so their writes made before the commit already landed in the old namespace, and `kobar-storage`
 * is a system key (never suffixed).
 */
function applyWorkspaceContext(
    set: AppStoreSet,
    get: () => AppState,
    reason: WorkspaceContextReason,
    recipe: (state: AppState) => Partial<AppState> | null,
    options: WorkspaceContextOptions = {}
): void {
    const outcome: {
        applied: boolean;
        switched: boolean;
        next: AppState | null;
        sendConfig: Record<string, boolean> | null;
        fullReload: boolean;
        flushBeforeSend: boolean;
        clearDefaultAfterWrite: boolean;
    } = {
        applied: false,
        switched: false,
        next: null,
        sendConfig: null,
        fullReload: true,
        flushBeforeSend: false,
        clearDefaultAfterWrite: false,
    };
    set((state) => {
        const patch = recipe(state);
        if (!patch) return state;
        outcome.applied = true;
        const next = { ...state, ...patch };
        if (!shouldSwitchDataContext(reason, state, next)) return patch;
        outcome.switched = true;
        outcome.next = next;
        outcome.fullReload = needsFullPluginReload(state, next);
        const extensions = planExtensionsContextSwitch(state, next);
        outcome.sendConfig = extensions?.changed ? extensions.currentExtensionsConfig : null;
        outcome.flushBeforeSend = !!extensions?.savedNewDefault;
        outcome.clearDefaultAfterWrite = !!extensions?.clearDefaultAfterWrite;
        // Close the open plugin panel in the same commit: otherwise it would remount (new key) on the OLD plugin
        // module before re-injection, and a mount effect could write the old state into the new namespace.
        return {
            ...patch,
            ...(extensions
                ? {
                      currentExtensionsConfig: extensions.currentExtensionsConfig,
                      defaultExtensionsConfig: extensions.defaultExtensionsConfig,
                  }
                : {}),
            dataContextId: state.dataContextId + 1,
            activeExtensionPanelId: null,
            activeExtensionAnchorRect: null,
        };
    });
    if (outcome.applied) {
        try {
            options.afterCommit?.(get());
        } catch (err) {
            // A failing side effect must never skip the plugin reload and the workspace-changed event below.
            console.error('workspace afterCommit failed', err);
        }
    }
    if (!outcome.switched || !outcome.next) return;
    const switchSeq = ++extensionsSwitchSeq;

    // KNOWN GAP (T-153, out of scope): between the commit above and the re-injection of the plugin scripts the OLD
    // plugin instances are still alive and could write their in-memory state into the NEW namespace (localStorage
    // isolation already points at it). Mitigated only by closing the open panel and remounting roots (dataContextId).
    // A full fix (suspend plugin writes until the reload finishes) needs a plugin-side contract and is not done here.
    const reload = outcome.fullReload ? () => get().triggerExtensionReload() : () => get().syncEnabledExtensions();
    const token = outcome.clearDefaultAfterWrite ? ++defaultRestoreToken : 0;
    if (outcome.sendConfig && window.api?.setExtensionsConfig) {
        // A newly saved Default list must be on disk before main overwrites extensions-config.json (its only other copy).
        if (outcome.flushBeforeSend) flushAppPersist();
        // Load even if the config IPC fails: plugins must never keep the old context's in-memory state.
        // (The loader then reads the file as it is, and the mirror follows it.) A failed write is retried later (T-418).
        const retry = () => retryExtensionsConfigWrite(set, get, switchSeq, token, outcome.clearDefaultAfterWrite);
        window.api
            .setExtensionsConfig(outcome.sendConfig)
            .then(
                (ok: unknown) => {
                    if (ok === true) {
                        // The file owns the Default list again only once main wrote it and the Default is still active.
                        if (outcome.clearDefaultAfterWrite) dropSavedDefaultIfCurrent(set, get, token);
                        return;
                    }
                    if (outcome.clearDefaultAfterWrite) console.error('setExtensionsConfig did not write the Default list; the saved copy is kept');
                    retry();
                },
                (err: unknown) => {
                    console.error('setExtensionsConfig failed during workspace switch', err);
                    retry();
                }
            )
            .then(reload);
    } else {
        reload();
    }
    notifyWorkspaceChanged(outcome.next.activeWorkspaceId);
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
<p>For bug reports, software support, feature requests, and financial support, please visit our GitHub repository: <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${REPO_URL}</a></p>
<br>
<p><strong>🚀 KoBar Features</strong></p>
<ul>
    <li>⚡ <strong>App Launcher (Shortcuts):</strong> Pin and launch your favorite applications instantly from the sidebar. Drag and drop any file or app to create a quick shortcut.</li>
    <li>📋 <strong>Clipboard Manager (Copy & Paste):</strong> A multi-slot clipboard that automatically saves your copied text history. Access and paste your past clips with a single click.</li>
    <li>📅 <strong>KoCalendar:</strong> A quick-access calendar to easily view your schedule and important dates. Stay organized without leaving your current workflow.</li>
    <li>✅ <strong>To-Do List:</strong> Keep track of your daily tasks with a simple and effective checkable list. Manage your goals efficiently directly from the edge of your screen.</li>
    <li>📝 <strong>Snippet Vault:</strong> Store and manage your frequently used code blocks or text snippets. Copy them to your clipboard instantly whenever you need them.</li>

    <li>📸 <strong>Screenshot Studio:</strong> Capture your screen instantly with built-in annotation and editing tools. Save or share your screen captures without opening external software.</li>

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

// T-201 (PROD-02): no `kobar-storage` write may reach disk until hydration (incl. migration) has succeeded. The lock is
// released in onRehydrateStorage below; after a failed hydration it stays for the whole session.
// Dev HMR re-evaluation only: write what the previous instance left pending (on a fresh page load nothing is pending).
appPersistStorage.flush();
appPersistStorage.lockWrites('hydration-pending');

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            isMac: window.api?.getPlatform ? window.api.getPlatform() === 'darwin' : false,
            closeAllUtilityPopups: () => set({


                activeExtensionPanelId: null
            }),
            activeExtensionPanelId: null,
            activeExtensionAnchorRect: null,
            extensionReloadTrigger: 0,
            extensionFullReloadTrigger: 0,
            triggerExtensionReload: () => set((state) => ({
                extensionReloadTrigger: state.extensionReloadTrigger + 1,
                extensionFullReloadTrigger: state.extensionFullReloadTrigger + 1,
            })),
            syncEnabledExtensions: () => set((state) => ({ extensionReloadTrigger: state.extensionReloadTrigger + 1 })),
            dataContextId: 0,
            extensionsSubTab: 'installed',
            setExtensionsSubTab: (tab) => set({ extensionsSubTab: tab }),
            pluginsViewMode: 'grid',
            setPluginsViewMode: (mode) => set({ pluginsViewMode: mode }),
            selectedPluginId: null,
            setSelectedPluginId: (id) => set({ selectedPluginId: id }),
            externalPluginsList: [],
            setExternalPluginsList: (list) => set({ externalPluginsList: list }),
            pluginsSelectedTags: [],
            setPluginsSelectedTags: (tags) => set({ pluginsSelectedTags: tags }),
            currentExtensionsConfig: {},
            defaultExtensionsConfig: null,
            setCurrentExtensionsConfig: (config) => set({ currentExtensionsConfig: config }),
            setExtensionEnabledInWorkspace: (extensionId, enabled) => set((state) => {
                const nextConfig = { ...state.currentExtensionsConfig, [extensionId]: enabled };
                // T-409: in the Default workspace a saved Default list still exists only when its restore was not
                // confirmed by main; keep it in sync with the toggle so it never brings back an older value.
                const pendingDefault = !findActiveWorkspace(state) && state.defaultExtensionsConfig
                    ? { defaultExtensionsConfig: { ...state.defaultExtensionsConfig, [extensionId]: enabled } }
                    : {};
                return {
                    ...pendingDefault,
                    currentExtensionsConfig: nextConfig,
                    workspaces: patchActiveWorkspace(state, (w) => ({
                        ...w,
                        enabledExtensions: { ...(w.enabledExtensions || {}), [extensionId]: enabled },
                    })),
                };
            }),
            edgePosition: 'right',
            setEdgePosition: (edge) => set((state) => ({
                edgePosition: edge,
                workspaces: patchActiveWorkspace(state, { edgePosition: edge })
            })),
            orientation: 'vertical',
            setOrientation: (orientation) => {
                const defaultEdge = orientation === 'horizontal' ? 'bottom' : 'right';
                set((state) => ({
                    orientation,
                    edgePosition: defaultEdge,
                    sidebarPosition: null,
                    workspaces: patchActiveWorkspace(state, { orientation, edgePosition: defaultEdge })
                }));
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
            noteListWidth: NOTE_LIST_WIDTH_DEFAULT,
            setNoteListWidth: (width) => set({ noteListWidth: clampNoteListWidth(width) }),
            pluginPanelOffsets: {},
            setPluginPanelOffset: (pluginId, axis, offset) =>
                set((state) => {
                    if (!pluginId || pluginId === '__proto__') return {};
                    const value = offset === null ? null : sanitizePanelOffset(offset);
                    const entry: PanelOffsets = { ...state.pluginPanelOffsets[pluginId] };
                    if (value === null) delete entry[axis];
                    else entry[axis] = value;
                    const next = { ...state.pluginPanelOffsets };
                    if (entry.x === undefined && entry.y === undefined) delete next[pluginId];
                    else next[pluginId] = entry;
                    return { pluginPanelOffsets: next };
                }),

            // Sidebar Position (null = auto edge-snap, {x,y} = free floating)
            sidebarPosition: null,
            setSidebarPosition: (pos) => set({ sidebarPosition: pos }),



            // Appearance (v26, T-601). App.tsx writes the root attributes (data-scheme/-accent/-material/-theme/-design)
            // from the state; the setters only update the state (and the active workspace record for per-workspace fields).
            scheme: DEFAULT_SCHEME,
            setScheme: (scheme) => set({ scheme }),
            accent: DEFAULT_ACCENT,
            setAccent: (accent, customHex) => {
                const state = get();
                const hex = accent === 'custom' && typeof customHex === 'string'
                    ? (customHex.startsWith('#') ? customHex : `#${customHex}`)
                    : state.customThemeColor;
                // 'custom' with a preset hex selects the preset; an invalid hex falls back to amber.
                const nextAccent = accent === 'custom' ? accentFromLegacy('custom', hex) : accent;
                const legacy = accent === 'custom'
                    ? { theme: 'custom' as const, customThemeColor: hex }
                    : legacyThemeFields(nextAccent, state);
                if (legacy.theme === 'custom') writeForcedThemeColor(legacy.customThemeColor);
                set((s) => ({
                    accent: nextAccent,
                    ...legacy,
                    workspaces: patchActiveWorkspace(s, { accent: nextAccent, ...legacy })
                }));
            },
            material: DEFAULT_MATERIAL,
            setMaterial: (material) => set((state) => {
                const legacy = legacyMaterialFields(material, state);
                return {
                    material,
                    ...legacy,
                    workspaces: patchActiveWorkspace(state, { material, ...legacy })
                };
            }),
            // Density (v27, T-602). `sidebarWidth` follows it only when the stored width does not describe it already.
            density: DEFAULT_DENSITY,
            setDensity: (density) => {
                // Plugins can call it (window.useAppStore): an invalid value is ignored.
                if (!isDensity(density)) return;
                set((state) => {
                    const sidebarWidth = legacySidebarWidth(density, state.sidebarWidth);
                    return {
                        density,
                        sidebarWidth,
                        workspaces: patchActiveWorkspace(state, { density, sidebarWidth })
                    };
                });
            },

            // Theme (v1 view of `accent`)
            theme: THEME_FOR_ACCENT[DEFAULT_ACCENT],
            customThemeColor: DEFAULT_CUSTOM_THEME_COLOR,
            setTheme: (theme) => set((state) => {
                const accent = accentFromLegacy(theme, state.customThemeColor);
                return {
                    theme,
                    accent,
                    workspaces: patchActiveWorkspace(state, { theme, accent })
                };
            }),
            setCustomThemeColor: (color: string) => {
                const hex = color.startsWith('#') ? color : `#${color}`;
                // Double safety: Manual sync write to bypass any async persist issues
                writeForcedThemeColor(hex);
                const accent = accentFromLegacy('custom', hex);
                set((state) => ({
                    customThemeColor: hex,
                    theme: 'custom',
                    accent,
                    workspaces: patchActiveWorkspace(state, { customThemeColor: hex, theme: 'custom', accent })
                }));
            },

            // Design System (v1 view of `material`)
            design: 'style1',
            setDesign: (design) => set((state) => {
                const material = materialFromLegacy(design, state.glassOpacity);
                return {
                    design,
                    material,
                    workspaces: patchActiveWorkspace(state, { design, material })
                };
            }),
            glassOpacity: DEFAULT_GLASS_OPACITY,
            setGlassOpacity: (val) => set((state) => {
                const material = materialFromLegacy(state.design, val);
                return {
                    glassOpacity: val,
                    material,
                    workspaces: patchActiveWorkspace(state, { glassOpacity: val, material })
                };
            }),

            // Settings
            showTooltips: true,
            setShowTooltips: (val) => set((state) => ({
                showTooltips: val,
                workspaces: patchActiveWorkspace(state, { showTooltips: val })
            })),
            sidebarWidth: 46,
            setSidebarWidth: (val) => set((state) => {
                // v27 (T-602): the density follows the v1 width.
                const density = densityFromSidebarWidth(val);
                return {
                    sidebarWidth: val,
                    density,
                    workspaces: patchActiveWorkspace(state, { sidebarWidth: val, density })
                };
            }),
            lastSidebarHeight: 800,
            setLastSidebarHeight: (val) => set({ lastSidebarHeight: val }),
            lastSidebarWidth: 200,
            setLastSidebarWidth: (val) => set({ lastSidebarWidth: val }),
            iconScale: 0.8,
            setIconScale: (val) => set((state) => ({
                iconScale: val,
                workspaces: patchActiveWorkspace(state, { iconScale: val })
            })),

            isDraggingGlobal: false,
            setIsDraggingGlobal: (val) => set({ isDraggingGlobal: val }),

            screenBounds: null,
            setScreenBounds: (bounds) => set({ screenBounds: bounds }),
            sidebarAnchorRect: null,
            setSidebarAnchorRect: (rect) => set({ sidebarAnchorRect: rect }),

            // Feature Toggles (Initial State)

            isPinInjectorEnabled: false,
            setIsPinInjectorEnabled: (val: boolean) => set((state) => ({
                isPinInjectorEnabled: val,
                workspaces: patchActiveWorkspace(state, { isPinInjectorEnabled: val })
            })),

            isTargetingMode: false,
            setIsTargetingMode: (val: boolean) => set({ isTargetingMode: val }),
            pinnedWindowHwnd: null,
            setPinnedWindowHwnd: (hwnd: number | null) => set({ pinnedWindowHwnd: hwnd }),

            isKoBoxEnabled: false,
            setIsKoBoxEnabled: (val: boolean) => set((state) => ({
                isKoBoxEnabled: val,
                workspaces: patchActiveWorkspace(state, { isKoBoxEnabled: val })
            })),
            koBoxCleanupMode: '24h',
            setKoBoxCleanupMode: (val: '24h' | 'quit') => set((state) => ({
                koBoxCleanupMode: val,
                workspaces: patchActiveWorkspace(state, { koBoxCleanupMode: val })
            })),

            // v27 (T-602): the new shell always places popups smartly; v1 plugins read `true` (the setter still works).
            isPopupSmartPositioning: true,
            setIsPopupSmartPositioning: (val: boolean) => set((state) => ({
                isPopupSmartPositioning: val,
                workspaces: patchActiveWorkspace(state, { isPopupSmartPositioning: val })
            })),

            featureOrder: [...DEFAULT_FEATURE_ORDER],
            setFeatureOrder: (order) => set((state) => ({
                featureOrder: order,
                workspaces: patchActiveWorkspace(state, { featureOrder: [...order] })
            })),

            settingsFeatureViewMode: 'cards',
            setSettingsFeatureViewMode: (mode) => set({ settingsFeatureViewMode: mode }),

            // UI Spacing & Sizing (defaults)
            toggleWidth: 22, // Note Notch Protrusion
            setToggleWidth: (val) => set((state) => ({
                toggleWidth: val,
                workspaces: patchActiveWorkspace(state, { toggleWidth: val })
            })),
            featureSpacing: 8, // Feature Spacing
            setFeatureSpacing: (val) => set((state) => ({
                featureSpacing: val,
                workspaces: patchActiveWorkspace(state, { featureSpacing: val })
            })),

            // Launch at Startup
            launchAtStartup: true,
            setLaunchAtStartup: (val) => {
                set({ launchAtStartup: val });
                window.api?.setAutoLaunch?.(val);
            },
            enableEyeAnimation: false, // T-621: off for new installs; existing users keep their persisted value (v17 migration + partialize)
            setEnableEyeAnimation: (val) => set((state) => ({
                enableEyeAnimation: val,
                workspaces: patchActiveWorkspace(state, { enableEyeAnimation: val })
            })),

            // Language
            language: 'en',
            setLanguage: (language) => set({ language }),
            t: (key) => translate(get().language, key),

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

                            // Recalculate edgePosition so NotePanel opens on the correct side
                            const screenH = state.screenBounds?.height ?? getWindowGeometry().fallbackScreenHeight;
                            // T-322: off macOS, the vertical centre of the usable screen area in window coordinates (taskbar at top).
                            const screenCenterY = state.isMac ? (screenH / 2) : computeVisibleArea(getWindowGeometry(), state.screenBounds).centerY;
                            const sidebarCenterY = sidebarY + (state.sidebarWidth / 2);
                            updates.edgePosition = sidebarCenterY < screenCenterY ? 'top' : 'bottom';
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

                            // Recalculate edgePosition so NotePanel opens on the correct side
                            const screenW = state.screenBounds?.width ?? getWindowGeometry().fallbackScreenWidth;
                            const isMacPlatform = state.isMac;
                            // T-322: off macOS, the horizontal centre of the usable screen area in window coordinates.
                            const screenCenter = isMacPlatform ? (screenW / 2) : computeVisibleArea(getWindowGeometry(), state.screenBounds).centerX;
                            const sidebarCenterX = sidebarX + (state.sidebarWidth / 2);
                            updates.edgePosition = sidebarCenterX < screenCenter ? 'left' : 'right';
                        }
                    }
                } else if (!pos && isMini) {
                    updates.miniModePosition = null;
                }
                return updates;
            }),
            notes: [],
            activeNoteId: 1, // T-623: no seeded note; the panel shows an empty state until the first note is added
            nextNoteId: 1,
            activeWorkspaceId: null,
            // T-153: the context may only change through applyWorkspaceContext. A known id is a full workspace load
            // (snapshot of the previous workspace, notes/settings of the target, plugin reload); unknown ids are ignored.
            setActiveWorkspaceId: (id) => {
                if (id !== null) {
                    if (id !== get().activeWorkspaceId) get().loadWorkspace(id);
                    return;
                }
                // null = leave the active workspace; the shared context becomes live again. Live settings (theme, widths...)
                // are intentionally NOT snapshotted into the workspace here, same as saveCurrentAsWorkspace.
                applyWorkspaceContext(set, get, 'set-active', (state) => {
                    if (state.activeWorkspaceId === null) return null;
                    const prevWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                    if (!prevWs || !prevWs.isIsolated) return { activeWorkspaceId: null };
                    const sharedCtx = resolveContextNotes(state, null);
                    const sharedNotes: Note[] = JSON.parse(JSON.stringify(sharedCtx.notes));
                    return {
                        workspaces: state.workspaces.map(w => w.id === prevWs.id ? {
                            ...w,
                            isolatedData: {
                                ...(w.isolatedData || {}),
                                notes: JSON.parse(JSON.stringify(state.notes)),
                                activeNoteId: state.activeNoteId,
                                nextNoteId: state.nextNoteId,
                            },
                        } : w),
                        activeWorkspaceId: null,
                        globalNotes: sharedNotes,
                        notes: JSON.parse(JSON.stringify(sharedNotes)),
                        activeNoteId: resolveActiveNoteId(sharedNotes, sharedCtx.activeNoteId) ?? 1,
                        nextNoteId: computeNextNoteId(sharedNotes),
                    };
                });
            },
            globalNotes: [],
            globalPluginData: {},

            getPluginData: <T = any>(pluginId: string, defaultValue?: T): T => {
                const state = get();
                const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                if (activeWs && activeWs.isIsolated) {
                    return (activeWs.isolatedData?.pluginData?.[pluginId] ?? defaultValue) as T;
                }
                return (state.globalPluginData?.[pluginId] ?? defaultValue) as T;
            },

            setPluginData: (pluginId: string, data: any) => set((state) => {
                const activeWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                if (activeWs && activeWs.isIsolated) {
                    const currentIsolated = activeWs.isolatedData || {};
                    const currentPluginData = currentIsolated.pluginData || {};
                    const updatedWorkspaces = state.workspaces.map(w => {
                        if (w.id === activeWs.id) {
                            return {
                                ...w,
                                isolatedData: {
                                    ...currentIsolated,
                                    pluginData: { ...currentPluginData, [pluginId]: data }
                                }
                            };
                        }
                        return w;
                    });
                    return { workspaces: updatedWorkspaces };
                } else {
                    return { globalPluginData: { ...(state.globalPluginData || {}), [pluginId]: data } };
                }
            }),
            setActiveNoteId: (id) => set((state) => writeActiveContextNotes(state, { activeNoteId: id })),

            // Tutorial State
            tutorialState: { version: '1.0.0', status: 'pending' },
            setTutorialState: (updates) => set((state) => {
                return { tutorialState: { ...state.tutorialState, ...updates } };
            }),
            // First-run state (v29, T-604). Fresh installs start `pending`; the v29 migration marks existing users `completed`.
            onboarding: { ...DEFAULT_ONBOARDING },
            setOnboarding: (updates) => set((state) => {
                // Plugins can call it (window.useAppStore): a result that is not a valid record is ignored.
                const base = isOnboardingState(state.onboarding) ? state.onboarding : DEFAULT_ONBOARDING;
                const merged = { ...base, ...updates };
                // Built field by field, so unknown keys from the caller never reach the persisted record.
                const next: OnboardingState = { status: merged.status, version: merged.version };
                if (merged.migrated !== undefined) next.migrated = merged.migrated;
                return isOnboardingState(next) ? { onboarding: next } : {};
            }),
            isManualTutorialTrigger: false,
            setIsManualTutorialTrigger: (val) => set({ isManualTutorialTrigger: val }),
            isHighlightingToggleNotes: false,
            setIsHighlightingToggleNotes: (val) => set({ isHighlightingToggleNotes: val }),
            isHighlightingSettingsBtn: false,
            setIsHighlightingSettingsBtn: (val) => set({ isHighlightingSettingsBtn: val }),
            isHighlightingPluginsBtn: false,
            setIsHighlightingPluginsBtn: (val) => set({ isHighlightingPluginsBtn: val }),

            // Eye Notification
            eyeNotification: null,
            showEyeNotification: (data) => set({ eyeNotification: { ...data, isVisible: true } }),
            hideEyeNotification: () => set((state) => ({ 
                eyeNotification: state.eyeNotification ? { ...state.eyeNotification, isVisible: false } : null 
            })),

            addNote: () => set((state) => {
                const newNote: Note = {
                    id: state.nextNoteId,
                    title: state.t('untitledNote'),
                    icon: 'note',
                    emoji: null,
                    content: '',
                };
                const nextNotes = [...state.notes, newNote];
                return writeActiveContextNotes(state, { notes: nextNotes, activeNoteId: newNote.id, nextNoteId: state.nextNoteId + 1 });
            }),
            addNotes: (incoming) => set((state) => {
                if (incoming.length === 0) return state;
                let nextId = computeNextNoteId(state.notes, state.nextNoteId);
                const nextNotes = [...state.notes, ...incoming.map((n) => ({ ...n, id: nextId++ }))];
                return writeActiveContextNotes(state, { notes: nextNotes, nextNoteId: nextId });
            }),
            deleteNote: (id) => set((state) => {
                const filtered = state.notes.filter(n => n.id !== id);
                if (filtered.length === 0) return state;
                const newActiveId = state.activeNoteId === id
                    ? filtered[0].id
                    : state.activeNoteId;
                return writeActiveContextNotes(state, { notes: filtered, activeNoteId: newActiveId });
            }),
            updateNoteContent: (id, content) => set((state) => {
                const nextNotes = state.notes.map(n => n.id === id ? { ...n, content } : n);
                return writeActiveContextNotes(state, { notes: nextNotes });
            }),
            updateNoteTitle: (id, title) => set((state) => {
                const nextNotes = state.notes.map(n => n.id === id ? { ...n, title } : n);
                return writeActiveContextNotes(state, { notes: nextNotes });
            }),
            updateNoteEmoji: (id, emoji) => set((state) => {
                const nextNotes = state.notes.map(n => n.id === id ? { ...n, emoji } : n);
                return writeActiveContextNotes(state, { notes: nextNotes });
            }),
            // T-615: both names stay on window.useAppStore (v1 plugin contract). They open the Settings window at the matching page
            // (src/store/settingsOpener.ts); outside Electron there is nothing to open.
            openSettingsTab: () => {
                openSettingsPage('general');
            },
            openPluginsTab: () => {
                openSettingsPage('plugins');
            },
            // T-615: the main window's minimal plugin host tab (plugins/PluginSettingsHost.tsx): a plugin's v1 settings panel, or the
            // GitHub link install when `id` is null. It needs the plugin runtime, which only the main window has.
            openPluginSettings: (id) => set((state) => {
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
                    selectedPluginId: id,
                    ...writeActiveContextNotes(state, { notes: nextNotes, activeNoteId: pluginsNote.id, nextNoteId: nextId }),
                };
            }),

            currentMedia: null,
            setCurrentMedia: (data) => set({ currentMedia: data }),
            activeVideoUrls: [],
            setActiveVideoUrls: (urls) => set({ activeVideoUrls: urls }),
            currentMediaSourceApp: '',
            setCurrentMediaSourceApp: (app) => set({ currentMediaSourceApp: app }),

            // Kept for v1 plugin contract, removed in 2.0 (not persisted, always true)
            isLicensed: true,
            setLicensed: (val) => set({ isLicensed: val }),

            // Scroll Memory
            scrollPositions: {},
            setScrollPosition: (key: string, pos: number) => set((state) => ({
                scrollPositions: { ...state.scrollPositions, [key]: pos }
            })),

            // Workspaces
            workspaces: [],
            saveCurrentAsWorkspace: (name, isIsolated = false) => applyWorkspaceContext(set, get, 'save', (state) => {
                const newId = Date.now().toString();
                // T-204 (WS-02): the live notes belong to the previous ACTIVE context. An isolated save copies them;
                // a shared save must switch to the shared context (globalNotes while an isolated workspace is active).
                const prevActiveWs = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                const liveCtx = resolveContextNotes(state, prevActiveWs ?? null);
                const liveActiveNoteId = liveCtx.activeNoteId ?? state.activeNoteId;
                const newWorkspace: WorkspaceConfig = {
                    id: newId,
                    name,
                    isIsolated,
                    isolatedData: isIsolated ? {
                        notes: JSON.parse(JSON.stringify(liveCtx.notes)),
                        activeNoteId: liveActiveNoteId,
                        nextNoteId: liveCtx.nextNoteId,
                        pluginData: JSON.parse(JSON.stringify(prevActiveWs?.isolatedData?.pluginData || {})),
                    } : undefined,
                    enabledExtensions: { ...state.currentExtensionsConfig },

                    isPinInjectorEnabled: state.isPinInjectorEnabled,
                    isKoBoxEnabled: state.isKoBoxEnabled,
                    koBoxCleanupMode: state.koBoxCleanupMode,

                    toggleWidth: state.toggleWidth,
                    sidebarWidth: state.sidebarWidth,
                    iconScale: state.iconScale,
                    featureSpacing: state.featureSpacing,
                    showTooltips: state.showTooltips,
                    theme: state.theme,
                    customThemeColor: state.customThemeColor,
                    design: state.design,
                    glassOpacity: state.glassOpacity,
                    accent: state.accent,
                    material: state.material,
                    density: state.density,
                    featureOrder: [...state.featureOrder],
                    edgePosition: state.edgePosition,
                    isPopupSmartPositioning: state.isPopupSmartPositioning,
                    enableEyeAnimation: state.enableEyeAnimation,
                    orientation: state.orientation
                };

                const prevIsIsolated = !!prevActiveWs?.isIsolated;
                // Keep the previous isolated workspace's own copy in sync with the live notes before leaving it.
                const keptWorkspaces = prevIsIsolated
                    ? state.workspaces.map(w => w.id === prevActiveWs!.id ? {
                        ...w,
                        isolatedData: {
                            ...(w.isolatedData || {}),
                            notes: JSON.parse(JSON.stringify(liveCtx.notes)),
                            activeNoteId: liveActiveNoteId,
                            nextNoteId: liveCtx.nextNoteId,
                        },
                    } : w)
                    : state.workspaces;

                if (isIsolated) {
                    return {
                        workspaces: [...keptWorkspaces, newWorkspace],
                        activeWorkspaceId: newId,
                        // Leaving a shared context: its live notes become the canonical shared copy.
                        ...(prevIsIsolated ? {} : { globalNotes: JSON.parse(JSON.stringify(liveCtx.notes)) }),
                        activeNoteId: liveActiveNoteId,
                        nextNoteId: liveCtx.nextNoteId,
                    };
                }

                if (prevIsIsolated) {
                    const sharedCtx = resolveContextNotes(state, null);
                    const sharedNotes: Note[] = JSON.parse(JSON.stringify(sharedCtx.notes));
                    return {
                        workspaces: [...keptWorkspaces, newWorkspace],
                        activeWorkspaceId: newId,
                        notes: sharedNotes,
                        activeNoteId: resolveActiveNoteId(sharedNotes, sharedCtx.activeNoteId) ?? 1,
                        nextNoteId: computeNextNoteId(sharedNotes),
                    };
                }

                return {
                    workspaces: [...keptWorkspaces, newWorkspace],
                    activeWorkspaceId: newId,
                };
            }),
            loadWorkspace: (id) => applyWorkspaceContext(set, get, 'load', (state) => {
                const targetWs = state.workspaces.find(w => w.id === id);
                if (!targetWs) return null;

                // 1. Snapshot previous active workspace before switching
                let updatedWorkspaces = [...state.workspaces];
                let nextGlobalNotes = state.globalNotes;
                const nextGlobalPluginData = state.globalPluginData;

                const prevActiveWs = updatedWorkspaces.find(w => w.id === state.activeWorkspaceId);
                if (prevActiveWs) {
                    updatedWorkspaces = updatedWorkspaces.map(w => {
                        if (w.id === prevActiveWs.id) {
                            return {
                                ...w,
                                enabledExtensions: { ...state.currentExtensionsConfig },
                                isPinInjectorEnabled: state.isPinInjectorEnabled,
                                isKoBoxEnabled: state.isKoBoxEnabled,
                                koBoxCleanupMode: state.koBoxCleanupMode,
                                toggleWidth: state.toggleWidth,
                                sidebarWidth: state.sidebarWidth,
                                iconScale: state.iconScale,
                                featureSpacing: state.featureSpacing,
                                showTooltips: state.showTooltips,
                                theme: state.theme,
                                customThemeColor: state.customThemeColor,
                                design: state.design,
                                glassOpacity: state.glassOpacity,
                                accent: state.accent,
                                material: state.material,
                                density: state.density,
                                featureOrder: [...state.featureOrder],
                                edgePosition: state.edgePosition,
                                isPopupSmartPositioning: state.isPopupSmartPositioning,
                                enableEyeAnimation: state.enableEyeAnimation,
                                orientation: state.orientation,
                                isolatedData: w.isIsolated ? {
                                    ...(w.isolatedData || {}),
                                    notes: JSON.parse(JSON.stringify(state.notes)),
                                    activeNoteId: state.activeNoteId,
                                    nextNoteId: state.nextNoteId,
                                    pluginData: JSON.parse(JSON.stringify(w.isolatedData?.pluginData || {})),
                                } : w.isolatedData
                            };
                        }
                        return w;
                    });

                    if (!prevActiveWs.isIsolated) {
                        nextGlobalNotes = JSON.parse(JSON.stringify(state.notes));
                    }
                } else {
                    nextGlobalNotes = JSON.parse(JSON.stringify(state.notes));
                }

                // 2. Fetch fresh target workspace from updated workspaces
                const freshTargetWs = updatedWorkspaces.find(w => w.id === id) || targetWs;

                // 3. Target appearance (the DOM side effects run after the commit, see afterCommit below). v26 (T-601): a record
                // without accent/material (written before v26, or imported) derives them from its v1 fields; the v1 fields are
                // filled consistently (a missing theme becomes the accent's theme instead of the old 'midnight' default).
                const targetAccent = profileAccent(freshTargetWs);
                const targetMaterial = profileMaterial(freshTargetWs);
                const targetThemeFields = legacyThemeFields(targetAccent, {
                    theme: freshTargetWs.theme,
                    customThemeColor: freshTargetWs.customThemeColor || DEFAULT_CUSTOM_THEME_COLOR,
                });
                const targetMaterialFields = legacyMaterialFields(targetMaterial, freshTargetWs);
                // v27 (T-602): the stored width wins until the Sidebar renders from the density (T-618), so a switch never
                // changes the bar width; a record without a width uses its density (missing: normal, the old default 46).
                const storedWidth = freshTargetWs.sidebarWidth;
                const hasWidth = typeof storedWidth === 'number';
                const targetDensity = hasWidth ? densityFromSidebarWidth(storedWidth) : profileDensity(freshTargetWs);
                const targetSidebarWidth = hasWidth ? storedWidth : legacySidebarWidth(targetDensity, undefined);

                // 4. Resolve Notes & Active IDs for Target Workspace
                let nextNotes: Note[];
                let nextActiveId: number;
                let nextId: number;

                if (freshTargetWs.isIsolated) {
                    const isoData = freshTargetWs.isolatedData;
                    if (isoData && Array.isArray(isoData.notes) && isoData.notes.length > 0) {
                        nextNotes = JSON.parse(JSON.stringify(isoData.notes));
                        // T-204: never trust a stored counter below max(id)+1 or a dangling activeNoteId (WS-08 data).
                        nextActiveId = resolveActiveNoteId(nextNotes, isoData.activeNoteId) ?? nextNotes[0].id;
                        nextId = computeNextNoteId(nextNotes, isoData.nextNoteId);
                    } else {
                        nextNotes = JSON.parse(JSON.stringify(defaultNotes));
                        nextActiveId = 1;
                        nextId = 2;
                    }
                } else {
                    nextNotes = nextGlobalNotes && nextGlobalNotes.length > 0
                        ? JSON.parse(JSON.stringify(nextGlobalNotes))
                        : JSON.parse(JSON.stringify(defaultNotes));
                    nextActiveId = nextNotes[0]?.id ?? 1;
                    nextId = Math.max(...nextNotes.map(n => n.id), 0) + 1;
                }

                // 5. The target's enabled-plugin set (merge rule, saved Default list), sending it to the main process,
                // the plugin load and the workspace-changed event are handled by applyWorkspaceContext (T-409).

                const safeFeatureOrder = Array.isArray(freshTargetWs.featureOrder) && freshTargetWs.featureOrder.length > 0
                    ? [...freshTargetWs.featureOrder]
                    : (Array.isArray(state.featureOrder) && state.featureOrder.length > 0
                        // T-027: keep the current bar instead of re-adding the calendar button to an existing user.
                        ? [...state.featureOrder]
                        : [...DEFAULT_FEATURE_ORDER]);

                return {
                    workspaces: updatedWorkspaces,
                    activeWorkspaceId: id,
                    globalNotes: nextGlobalNotes,
                    globalPluginData: nextGlobalPluginData,
                    notes: nextNotes,
                    activeNoteId: nextActiveId,
                    nextNoteId: nextId,

                    isPinInjectorEnabled: freshTargetWs.isPinInjectorEnabled ?? false,
                    isKoBoxEnabled: freshTargetWs.isKoBoxEnabled ?? false,
                    koBoxCleanupMode: freshTargetWs.koBoxCleanupMode ?? '24h',

                    toggleWidth: freshTargetWs.toggleWidth ?? 22,
                    sidebarWidth: targetSidebarWidth,
                    iconScale: freshTargetWs.iconScale ?? 0.8,
                    featureSpacing: freshTargetWs.featureSpacing ?? 8,
                    showTooltips: freshTargetWs.showTooltips !== undefined ? freshTargetWs.showTooltips : true,
                    accent: targetAccent,
                    material: targetMaterial,
                    density: targetDensity,
                    theme: targetThemeFields.theme,
                    customThemeColor: targetThemeFields.customThemeColor,
                    design: targetMaterialFields.design,
                    glassOpacity: targetMaterialFields.glassOpacity,
                    featureOrder: safeFeatureOrder,
                    edgePosition: freshTargetWs.edgePosition || 'right',
                    isPopupSmartPositioning: freshTargetWs.isPopupSmartPositioning ?? true,
                    enableEyeAnimation: freshTargetWs.enableEyeAnimation !== undefined ? freshTargetWs.enableEyeAnimation : true,
                    orientation: freshTargetWs.orientation || 'vertical'
                };
            }, {
                // T-153: DOM attributes and theme CSS follow the committed state instead of being written inside `set`.
                afterCommit: (committed) => {
                    // T-601: App.tsx owns every root attribute (data-scheme/-accent/-material/-theme/-design) and sets them
                    // from the committed state; only stale inline overrides and the 1.2.x key are handled here.
                    clearLegacyThemeCSS();
                    if (committed.theme === 'custom') writeForcedThemeColor(committed.customThemeColor);
                },
            }),
            toggleWorkspaceIsolation: (id) => applyWorkspaceContext(set, get, 'toggle-isolation', (state) => {
                const targetWs = state.workspaces.find(w => w.id === id);
                if (!targetWs) return null;

                const willBeIsolated = !targetWs.isIsolated;
                const isActive = state.activeWorkspaceId === id;

                const updatedWorkspaces = state.workspaces.map(w => {
                    if (w.id === id) {
                        // T-204 (WS-08): notes, activeNoteId and nextNoteId must all come from the SAME context
                        // (live notes if active, otherwise the shared canonical copy).
                        const makeIso = () => {
                            // The target as it looks while NOT isolated: active -> live notes, inactive -> shared copy.
                            const sharedViewOfTarget = { id: w.id, isIsolated: false };
                            const source = resolveContextNotes(state, sharedViewOfTarget);
                            const isoNotes: Note[] = JSON.parse(JSON.stringify(source.notes.length > 0 ? source.notes : defaultNotes));
                            return {
                                notes: isoNotes,
                                activeNoteId: resolveActiveNoteId(isoNotes, source.activeNoteId) ?? 1,
                                nextNoteId: computeNextNoteId(isoNotes, source.nextNoteId),
                                pluginData: {}
                            };
                        };
                        const existingIso = w.isolatedData || makeIso();
                        return {
                            ...w,
                            isIsolated: willBeIsolated,
                            isolatedData: existingIso
                        };
                    }
                    return w;
                });

                // Only toggling the ACTIVE workspace switches the plugin namespace (reload + event via applyWorkspaceContext).
                if (isActive) {
                    if (willBeIsolated) {
                        const currentIso = updatedWorkspaces.find(w => w.id === id)?.isolatedData;
                        const isoNotes = currentIso?.notes && currentIso.notes.length > 0
                            ? currentIso.notes
                            : JSON.parse(JSON.stringify(state.notes));
                        return {
                            workspaces: updatedWorkspaces,
                            globalNotes: JSON.parse(JSON.stringify(state.notes)),
                            notes: isoNotes,
                            activeNoteId: resolveActiveNoteId(isoNotes, currentIso?.activeNoteId) ?? 1,
                            nextNoteId: computeNextNoteId(isoNotes, currentIso?.nextNoteId),
                        };
                    } else {
                        const fallbackNotes = state.globalNotes && state.globalNotes.length > 0
                            ? state.globalNotes
                            : JSON.parse(JSON.stringify(defaultNotes));
                        return {
                            workspaces: updatedWorkspaces,
                            notes: fallbackNotes,
                            activeNoteId: fallbackNotes[0]?.id ?? 1,
                            nextNoteId: Math.max(...fallbackNotes.map((n: { id: number }) => n.id), 0) + 1,
                        };
                    }
                }

                return { workspaces: updatedWorkspaces };
            }),
            deleteWorkspace: (id) => applyWorkspaceContext(set, get, 'delete', (state) => {
                const wasActive = state.activeWorkspaceId === id;
                const remaining = state.workspaces.filter(w => w.id !== id);
                if (wasActive) {
                    const fallbackNotes = state.globalNotes && state.globalNotes.length > 0
                        ? state.globalNotes
                        : JSON.parse(JSON.stringify(defaultNotes));
                    return {
                        workspaces: remaining,
                        activeWorkspaceId: null,
                        notes: fallbackNotes,
                        activeNoteId: fallbackNotes[0]?.id ?? 1,
                        nextNoteId: Math.max(...fallbackNotes.map((n: { id: number }) => n.id), 0) + 1,
                    };
                }
                return { workspaces: remaining };
            }),
            deleteWorkspaceWithBackup: (id) =>
                deleteWorkspaceWithBackup(
                    id,
                    defaultDeleteWorkspaceDeps({
                        getWorkspaceIds: () => get().workspaces.map((w) => w.id),
                        deleteWorkspace: (target) => get().deleteWorkspace(target),
                    })
                ),
            updateWorkspaceName: (id, newName) => set((state) => ({
                workspaces: state.workspaces.map(w => w.id === id ? { ...w, name: newName } : w)
            })),
            updateWorkspaceSettings: (id) => set((state) => ({
                workspaces: state.workspaces.map(w => w.id === id ? {
                    ...w,
                    enabledExtensions: { ...state.currentExtensionsConfig },
                    isPinInjectorEnabled: state.isPinInjectorEnabled,
                    isKoBoxEnabled: state.isKoBoxEnabled,
                    isPopupSmartPositioning: state.isPopupSmartPositioning,
                    koBoxCleanupMode: state.koBoxCleanupMode,
                    toggleWidth: state.toggleWidth,
                    sidebarWidth: state.sidebarWidth,
                    iconScale: state.iconScale,
                    featureSpacing: state.featureSpacing,
                    showTooltips: state.showTooltips,
                    theme: state.theme,
                    customThemeColor: state.customThemeColor,
                    design: state.design,
                    glassOpacity: state.glassOpacity,
                    accent: state.accent,
                    material: state.material,
                    density: state.density,
                    featureOrder: [...state.featureOrder],
                    edgePosition: state.edgePosition,
                    enableEyeAnimation: state.enableEyeAnimation,
                    orientation: state.orientation,
                    // WS-01: live notes belong to the ACTIVE context only; never copy them into another workspace.
                    isolatedData: w.isIsolated && w.id === state.activeWorkspaceId ? {
                        ...(w.isolatedData || {}),
                        notes: JSON.parse(JSON.stringify(state.notes)),
                        activeNoteId: state.activeNoteId,
                        nextNoteId: state.nextNoteId,
                        pluginData: JSON.parse(JSON.stringify(w.isolatedData?.pluginData || {})),
                    } : w.isolatedData,
                } : w)
            })),
        }),
        {
            name: 'kobar-storage',
            // Same JSON format as the default storage; writes are debounced and flushed on unload/quit (T-129).
            storage: createJSONStorage(() => appPersistStorage),
            version: KOBAR_STORAGE_VERSION,
            migrate: migratePersistedKobarStorage,
            partialize: (state) => ({
                notes: state.notes,
                activeNoteId: state.activeNoteId,
                nextNoteId: state.nextNoteId,
                globalNotes: state.globalNotes,
                globalPluginData: state.globalPluginData,
                currentExtensionsConfig: state.currentExtensionsConfig,
                defaultExtensionsConfig: state.defaultExtensionsConfig,
                activeWorkspaceId: state.activeWorkspaceId,
                notePanelWidth: state.notePanelWidth,
                notePanelHeight: state.notePanelHeight,
                // v31 (R-11): note list column width.
                noteListWidth: state.noteListWidth,
                // v32 (R-15): per-plugin panel offsets.
                pluginPanelOffsets: state.pluginPanelOffsets,
                tutorialState: state.tutorialState,
                // v29 (T-604): first-run state; `tutorialState` stays persisted (the old tutorial and 1.2.x read it).
                onboarding: state.onboarding,
                legacyBackup: state.legacyBackup,

                // v26 (T-601): appearance model; the v1 fields stay persisted (plugins and 1.2.x read them).
                scheme: state.scheme,
                accent: state.accent,
                material: state.material,
                // v27 (T-602): density; the v1 layout fields stay persisted (plugins and 1.2.x read them).
                density: state.density,
                theme: state.theme,
                customThemeColor: state.customThemeColor,
                language: state.language,
                showTooltips: state.showTooltips,
                sidebarWidth: state.sidebarWidth,
                iconScale: state.iconScale,
                launchAtStartup: state.launchAtStartup,
                enableEyeAnimation: state.enableEyeAnimation,







                isPinInjectorEnabled: state.isPinInjectorEnabled,
                isKoBoxEnabled: state.isKoBoxEnabled,

                koBoxCleanupMode: state.koBoxCleanupMode,
                // v22 (T-205, WS-06): previously lost on restart.
                toggleWidth: state.toggleWidth,
                featureSpacing: state.featureSpacing,
                isPopupSmartPositioning: state.isPopupSmartPositioning,




                featureOrder: state.featureOrder,
                design: state.design,
                glassOpacity: state.glassOpacity,



                workspaces: state.workspaces,

                settingsFeatureViewMode: state.settingsFeatureViewMode,
                orientation: state.orientation,
                edgePosition: state.edgePosition,
            }),
            onRehydrateStorage: () => {
                return (fetchedState, error) => {
                    // zustand reports read/parse errors and a throwing `migrate` here with `error` set.
                    if (error || !fetchedState) {
                        // Keeps the write lock for the session and tells the user; the stored value stays untouched.
                        handleHydrationFailure(error ?? new Error('hydration returned no state'));
                        return;
                    }
                    appPersistStorage.unlockWrites();
                    // First write after unlock: the persist middleware's own post-migration write ran while writes were
                    // still locked and was dropped, so this setter (which always calls persist's setItem with the
                    // current, already migrated state) is what puts the migrated state and current version on disk.
                    fetchedState.setHydrated(true);
                    // T-601: no startup override from `kobar_force_theme_color` any more; the v26 migration folded that value
                    // into `customThemeColor`, and App.tsx applies the appearance from the state.
                };
            },
        }
    )
);

