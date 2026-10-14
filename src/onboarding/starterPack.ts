// T-622: the starter pack offered on the last first-run card. Ids are the official plugin manifest ids (a test checks
// them against OFFICIAL_PLUGIN_ID_LIST). Installing goes through the main window's plugin sync (`plugin.install`), which
// installs from the registry entry and lets the MAIN process validate and ask for consent. Nothing here installs by itself.
import type { PluginSyncLike } from '../store/pluginSync';
import type { TranslationKeys } from '../i18n';

export interface StarterPlugin {
    id: string;
    name: string;
    icon: string;
    descriptionKey: TranslationKeys;
}

export const STARTER_PACK: readonly StarterPlugin[] = Object.freeze([
    { id: 'todolist-plugin', name: 'ToDo', icon: 'checklist', descriptionKey: 'onboardingDescTodo' },
    { id: 'com.kobar.clipboardmanager', name: 'Clipboard Manager', icon: 'content_paste', descriptionKey: 'onboardingDescClipboard' },
    { id: 'com.kobar.calculator.plugin', name: 'Calculator', icon: 'calculate', descriptionKey: 'onboardingDescCalculator' },
    { id: 'kobar.shortcuts', name: 'Shortcuts', icon: 'bolt', descriptionKey: 'onboardingDescShortcuts' },
]);

/** The part of the plugin sync the first-run flow uses. */
export type StarterSync = Pick<PluginSyncLike, 'getSummary' | 'subscribe' | 'handle'>;

export type CatalogPhase = 'loading' | 'ready' | 'offline' | 'failed';
export type InstallPhase = 'idle' | 'installing' | 'installed' | 'failed';

/** Fetches the registry; never rejects. */
export async function loadCatalog(sync: StarterSync): Promise<CatalogPhase> {
    try {
        const result = await sync.handle({ type: 'plugin.refreshCatalog', payload: {} });
        if (result.ok) return 'ready';
        return sync.getSummary()?.catalog?.error === 'offline' ? 'offline' : 'failed';
    } catch {
        return 'failed';
    }
}

/** One-click install of one starter plugin; never rejects. A cancelled consent dialog leaves the item `idle`. */
export async function installStarter(sync: StarterSync, id: string): Promise<InstallPhase> {
    try {
        const result = await sync.handle({ type: 'plugin.install', payload: { id } });
        if (!result.ok) return result.reason === 'already-installed' ? 'installed' : 'failed';
        const last = sync.getSummary()?.catalog?.lastInstall;
        return last && last.id === id && last.result === 'canceled' ? 'idle' : 'installed';
    } catch {
        return 'failed';
    }
}

/** True when the plugin is already installed (according to the installed list or the catalogue flag). */
export function isStarterInstalled(sync: StarterSync, id: string): boolean {
    const summary = sync.getSummary();
    if (!summary) return false;
    return summary.items.some((item) => item.id === id) || (summary.catalog?.items ?? []).some((item) => item.id === id && item.installed);
}
