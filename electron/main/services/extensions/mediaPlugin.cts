// T-316: does the user have an enabled media plugin (KoPlayer)? Read from disk on demand (startup and after every extensions config
// change), with the same ids get-installed-extensions reports: manifest id or folder name, "dev-" prefix for playground plugins.
// No Electron imports (the playground folder is passed in), so it is tested with a temporary folder.
import * as path from 'path';
import { listPluginDirs } from '../../../lib/pluginScan.cjs';
import { readManifestSafe } from '../../lib/pluginManifest.cjs';
import { isMediaPluginEnabled } from '../mediaDemand.cjs';
import type { ExtensionsConfigStore } from './config.cjs';

export interface MediaPluginProbeDeps {
    extensionsDir: string;
    /** The dev playground folder (links allowed there, ids get a "dev-" prefix), like get-installed-extensions. */
    playgroundDir: string;
    getExtensionsConfig: ExtensionsConfigStore['getExtensionsConfig'];
}

/** Extension ids of the installed plugins with a readable manifest, as get-installed-extensions builds them. Never throws. */
export function listInstalledExtensionIds(extensionsDir: string, playgroundDir: string): string[] {
    const ids: string[] = [];
    const collect = (baseDir: string, isPlayground: boolean) => {
        for (const dirName of listPluginDirs(baseDir, { allowLinks: isPlayground })) {
            const manifest = readManifestSafe(path.join(baseDir, dirName, 'manifest.json'));
            if (!manifest) continue;
            const id = typeof manifest.id === 'string' && manifest.id ? manifest.id : dirName;
            ids.push(isPlayground ? `dev-${id}` : id);
        }
    };
    try {
        collect(extensionsDir, false);
    } catch {
        /* unreadable folder: no plugins from it */
    }
    try {
        collect(playgroundDir, true);
    } catch {
        /* unreadable folder: no plugins from it */
    }
    return ids;
}

/** A function that tells whether an installed media plugin is enabled right now. Never throws (false on error). */
export function createMediaPluginProbe(deps: MediaPluginProbeDeps): () => boolean {
    const { extensionsDir, playgroundDir, getExtensionsConfig } = deps;
    return () => {
        try {
            return isMediaPluginEnabled(listInstalledExtensionIds(extensionsDir, playgroundDir), getExtensionsConfig());
        } catch (e) {
            console.error('[Extensions] Failed to check the media plugin state:', e);
            return false;
        }
    };
}
