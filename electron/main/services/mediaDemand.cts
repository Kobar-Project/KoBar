// T-316 (ARC-13, ARC-04): lazy host media services. OS media polling (Windows SMTC worker, macOS osascript) and the background
// video-URL scan (PowerShell UIAutomation) cost CPU and spawn processes, and only the media plugin (KoPlayer) and the PiP window
// use them. This module is the pure policy and the start/stop controller; services/media.cts wires it to the real polling.
// No Electron imports: tested with fakes in tests/mediaDemand.test.ts.

/**
 * The media plugin. The official KoPlayer id is 'koplayer-plugin' (electron/lib/officialPlugins.cts); the plugin itself lives in a
 * separate repository. Any extension id that contains "koplayer" (case-insensitive) counts, so the dev playground copy
 * ('dev-koplayer-plugin') and older folder names keep working. A false positive only means polling runs; it never blocks a plugin.
 */
export const MEDIA_PLUGIN_ID_PATTERN = /koplayer/i;

export function isMediaPluginId(id: unknown): boolean {
    return typeof id === 'string' && MEDIA_PLUGIN_ID_PATTERN.test(id);
}

/**
 * True when an installed media plugin is enabled. `installedIds` are the extension ids exactly as get-installed-extensions reports
 * them (manifest id or folder name, "dev-" prefix for playground plugins) and `config` is extensions-config.json; like the
 * renderer, anything but an explicit `false` counts as enabled.
 */
export function isMediaPluginEnabled(installedIds: readonly string[], config: Readonly<Record<string, unknown>>): boolean {
    return installedIds.some((id) => isMediaPluginId(id) && config[id] !== false);
}

export interface MediaDemandInput {
    mediaPluginEnabled: boolean;
    pipOpen: boolean;
}

/** Media polling (and with it the video-URL scan) runs only while the media plugin is enabled or a PiP window is open. */
export function shouldPollMedia(input: MediaDemandInput): boolean {
    return input.mediaPluginEnabled === true || input.pipOpen === true;
}

export interface MediaDemandControllerDeps {
    isMediaPluginEnabled: () => boolean;
    isPipOpen: () => boolean;
    /** Whether the polling loop is currently running (the real interval, so a self-stopped worker can be restarted). */
    isRunning: () => boolean;
    start: () => void;
    stop: () => void;
    /** Called once when the demand goes away: tells the renderer there is no media any more (no stale track in the UI). */
    clearMedia: () => void;
}

export interface MediaDemandController {
    /** Re-evaluates the policy and starts/stops polling accordingly. Idempotent. Returns whether polling is wanted. */
    update: () => boolean;
    /** Whether the last update() wanted polling. */
    isWanted: () => boolean;
}

export function createMediaDemandController(deps: MediaDemandControllerDeps): MediaDemandController {
    let wanted = false;

    function readPluginEnabled(): boolean {
        try {
            return deps.isMediaPluginEnabled() === true;
        } catch {
            return false;
        }
    }

    return {
        update() {
            const want = shouldPollMedia({ mediaPluginEnabled: readPluginEnabled(), pipOpen: deps.isPipOpen() === true });
            if (want) {
                if (!deps.isRunning()) deps.start();
            } else {
                if (deps.isRunning()) deps.stop();
                if (wanted) deps.clearMedia();
            }
            wanted = want;
            return want;
        },
        isWanted: () => wanted,
    };
}
