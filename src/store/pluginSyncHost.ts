// T-610: the main window's one plugin-sync instance, wired to the real window.api, app store and plugin registry. main.tsx hands it to
// startSettingsSync; App.tsx feeds it the installed list the plugin loader already fetches. Host-internal, not part of the plugin contract.
import { PLUGIN_REGISTRY_URL } from '../config/links';
import { createPluginSync, type PluginSyncApi } from './pluginSync';
import { useAppStore } from './useAppStore';

interface RegistryLike {
    getSettingsPanel?: (id: string) => unknown;
    subscribe?: (listener: () => void) => () => void;
}

const registry = (): RegistryLike | undefined => (globalThis as { KoBarExtensions?: RegistryLike }).KoBarExtensions;

const REGISTRY_TIMEOUT_MS = 15_000;

/** The same registry read as the former store screen, with a timeout. */
async function fetchRegistry(): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    try {
        // A timestamp query parameter prevents aggressive caching (as in the old store).
        const res = await fetch(`${PLUGIN_REGISTRY_URL}?t=${Date.now()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`registry status ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

export const pluginSync = createPluginSync({
    api: () => (globalThis as { api?: PluginSyncApi }).api,
    store: () => useAppStore.getState(),
    hasSettingsPanel: (id) => !!registry()?.getSettingsPanel?.(id),
    fetchRegistry,
    isOnline: () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
    subscribeRegistry: (listener) => registry()?.subscribe?.(listener) ?? (() => {}),
});
