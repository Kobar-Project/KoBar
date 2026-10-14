// T-409 (WS-09): injects plugin scripts by the enabled-set DIFF instead of re-running every plugin on every reload.
// Moved out of App.tsx (the old inline loader cleared the registry and re-injected all scripts on every trigger).
//
// - A FULL load (first load, every `triggerExtensionReload()`: install, update, and a workspace switch that changes the
//   plugins' data namespace) does what the old loader did: clear the registry, remove every plugin script and inject
//   all enabled plugins again. A full load that failed is retried as a full one by the next request.
// - A DIFF load (`syncEnabledExtensions()`: enable/disable toggle, uninstall, and a workspace switch inside the same data
//   namespace) only injects plugins that became enabled and unloads plugins that became disabled or were uninstalled;
//   unchanged plugins keep running with their in-memory state.
//   Unloading needs to know what a plugin registered (registry.unregisterExtension); when that is not known the load
//   falls back to a full one.
// Loads run one after another (never interleaved), so a diff always sees the result of the load before it.
// A plugin's code cannot be "unloaded": removing its <script> and its registrations hides it, but timers or listeners
// it started keep running until the window reloads (the old full reload had the same limit).

export interface LoadableExtension {
    id: string;
    enabled: boolean;
    code?: string;
}

export interface PluginLoadPlan<E extends LoadableExtension = LoadableExtension> {
    full: boolean;
    /** Ids to unload (all loaded ids for a full load). */
    unload: string[];
    /** Plugins to inject. */
    load: E[];
}

/** Which scripts to remove and inject. `loaded` = ids whose script is injected now. */
export function planPluginLoad<E extends LoadableExtension>(
    loaded: ReadonlySet<string>,
    installed: readonly E[],
    full: boolean
): PluginLoadPlan<E> {
    const wanted = installed.filter((ext) => ext.enabled && !!ext.code);
    if (full) return { full: true, unload: Array.from(loaded), load: wanted };
    const wantedIds = new Set(wanted.map((ext) => ext.id));
    return {
        full: false,
        unload: Array.from(loaded).filter((id) => !wantedIds.has(id)),
        load: wanted.filter((ext) => !loaded.has(ext.id)),
    };
}

/** The registry members the loader uses (all optional: an older registry instance kept by dev HMR may lack some). */
export interface LoaderRegistry {
    clear?: () => void;
    registerManifest?: (id: string, manifest: unknown) => void;
    unregisterExtension?: (id: string) => boolean;
    suspendNotifications?: () => void;
    resumeNotifications?: () => void;
}

export interface PluginLoaderDeps<E extends LoadableExtension = LoadableExtension> {
    getInstalledExtensions: () => Promise<E[]>;
    getRegistry: () => LoaderRegistry | undefined;
    /** Receives every fetched list (the store mirrors the enabled flags of extensions-config.json from it). */
    onInstalledList: (installed: E[]) => void;
    /** Injects one plugin script; resolves when it ran or failed (never rejects). */
    injectScript: (ext: E) => Promise<void>;
    /** Removes the injected scripts of `id`, or every plugin script when `id` is undefined. */
    removeScripts: (id?: string) => void;
}

export interface PluginLoader {
    /**
     * Queues a load. Full when `fullReloadSeq` differs from the value of the previous request (or on the first request),
     * otherwise a diff. Resolves when this load finished; never rejects.
     */
    request: (fullReloadSeq: number) => Promise<void>;
    /** Ids whose script is injected (for tests and diagnostics). */
    loadedIds: () => string[];
}

export function createPluginLoader<E extends LoadableExtension>(deps: PluginLoaderDeps<E>): PluginLoader {
    const loaded = new Set<string>();
    let lastFullSeq: number | null = null;
    let queue: Promise<void> = Promise.resolve();

    async function run(full: boolean): Promise<void> {
        const registry = deps.getRegistry();
        // Suspend UI updates during the load process.
        registry?.suspendNotifications?.();
        try {
            const installed = await deps.getInstalledExtensions();
            deps.onInstalledList(installed);

            let plan = planPluginLoad(loaded, installed, full);
            if (!plan.full && plan.unload.length > 0) {
                const canUnload = typeof registry?.unregisterExtension === 'function';
                const unloaded = canUnload && plan.unload.every((id) => registry!.unregisterExtension!(id));
                if (unloaded) {
                    for (const id of plan.unload) {
                        deps.removeScripts(id);
                        loaded.delete(id);
                    }
                } else {
                    plan = planPluginLoad(loaded, installed, true);
                }
            }
            if (plan.full) {
                // Clear old extensions state right before injecting new ones.
                registry?.clear?.();
                deps.removeScripts();
                loaded.clear();
            }

            await Promise.all(
                plan.load.map((ext) => {
                    try {
                        registry?.registerManifest?.(ext.id, ext);
                    } catch (err) {
                        // Not counted as loaded: the next load tries this plugin again.
                        console.error(`Failed to register manifest of extension ${ext.id}:`, err);
                        return Promise.resolve();
                    }
                    loaded.add(ext.id);
                    return deps.injectScript(ext);
                })
            );
        } catch (err) {
            // A failed full load must not turn the next request into a diff on top of a half-cleared state.
            if (full) lastFullSeq = null;
            console.error('Failed to query extensions:', err);
        } finally {
            // Resume notifications after all scripts have executed.
            registry?.resumeNotifications?.();
        }
    }

    return {
        request(fullReloadSeq) {
            const full = lastFullSeq === null || fullReloadSeq !== lastFullSeq;
            lastFullSeq = fullReloadSeq;
            const done = queue.then(() => run(full));
            queue = done.catch(() => undefined);
            return queue;
        },
        loadedIds: () => Array.from(loaded),
    };
}

/** Injects a plugin as a blob <script data-extension-id> (same wrapper as before T-409). */
export function injectExtensionScript(ext: LoadableExtension): Promise<void> {
    return new Promise<void>((resolve) => {
        try {
            const blob = new Blob([`(() => {\n${ext.code}\n})();`], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const script = document.createElement('script');
            script.src = url;
            script.dataset.extensionId = ext.id;
            script.onload = () => {
                URL.revokeObjectURL(url);
                resolve();
            };
            script.onerror = () => {
                URL.revokeObjectURL(url);
                console.error(`Failed to load extension script ${ext.id}`);
                resolve();
            };
            document.head.appendChild(script);
        } catch (err) {
            console.error(`Failed to inject extension ${ext.id}:`, err);
            resolve();
        }
    });
}

/** Removes the injected scripts of one plugin, or of every plugin. */
export function removeExtensionScripts(id?: string): void {
    document.querySelectorAll<HTMLScriptElement>('script[data-extension-id]').forEach((script) => {
        if (id === undefined || script.dataset.extensionId === id) script.remove();
    });
}
