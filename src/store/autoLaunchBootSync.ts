// 1.4.3: once per start, after the persisted state is loaded, hand the `launchAtStartup` setting to main, which reconciles it with
// the real Windows login items (stale/duplicate Run entries, wrong install path, Task Manager switch-off) and answers what the
// setting should show. Plain setState on purpose: the setter would send the value back to main (and ask for confirmation).

export interface AutoLaunchBootSyncDeps {
    persist: { hasHydrated(): boolean; onFinishHydration(listener: () => void): () => void };
    getDesired: () => boolean;
    /** `window.api.syncAutoLaunch`, or undefined outside Electron. */
    sync: ((desired: boolean) => Promise<{ enabled: boolean } | null>) | undefined;
    apply: (enabled: boolean) => void;
}

export function startAutoLaunchBootSync(deps: AutoLaunchBootSyncDeps): void {
    const { persist, getDesired, sync, apply } = deps;
    if (!sync) return;
    let started = false;
    const run = () => {
        if (started) return;
        started = true;
        const desired = getDesired();
        sync(desired)
            .then((result) => {
                if (result && typeof result.enabled === 'boolean' && result.enabled !== getDesired()) apply(result.enabled);
            })
            .catch(() => undefined);
    };
    if (persist.hasHydrated()) run();
    else persist.onFinishHydration(run);
}
