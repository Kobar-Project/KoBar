// T-314: get-installed-extensions (the plugin list with entry code the renderer injects), moved unchanged out of main.cts.
// T-318: manifests and entry scripts are read asynchronously, under the install lock so the list never shows a plugin halfway through an
// install, update or uninstall (and the legacy-origins snapshot write cannot interleave with one).
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AsyncLock } from '../../../lib/asyncLock.cjs';
import { isFsPathInside, pathExists } from '../../../lib/fsGuards.cjs';
import { resolveInside } from '../../../lib/paths.cjs';
import { isSafeEntry } from '../../../lib/pluginInstall.cjs';
import { listPluginDirsAsync } from '../../../lib/pluginScan.cjs';
import type { IpcRegistry } from '../../ipc/registry.cjs';
import type { AppPaths } from '../../lib/appPaths.cjs';
import { buildInstalledPlugin } from '../../lib/pluginManifest.cjs';
import type { ExtensionOrigins } from './origins.cjs';
import type { ExtensionsConfigStore } from './config.cjs';

export interface InstalledExtensionsDeps {
    registry: IpcRegistry;
    isDev: boolean;
    appPaths: AppPaths;
    extensionsDir: string;
    getExtensionsConfig: ExtensionsConfigStore['getExtensionsConfig'];
    loadExtensionOrigins: ExtensionOrigins['loadExtensionOrigins'];
    /** T-318: the shared plugin install lock (see bootstrap createExtensionServices). */
    withInstallLock: AsyncLock['run'];
}

export function registerInstalledExtensionsIpc(deps: InstalledExtensionsDeps): void {
    const { registry, isDev, appPaths, extensionsDir, getExtensionsConfig, loadExtensionOrigins, withInstallLock } = deps;

    registry.handle('get-installed-extensions', async () => {
        return await withInstallLock(listInstalledExtensions);
    });

    // Never throws: every failure is logged and degrades to a shorter list (or []), as before.
    async function listInstalledExtensions() {
        try {
            // Freeze legacy origins as early as possible (before a plugin gets a chance to edit its manifest).
            loadExtensionOrigins();
        } catch (e) {
            console.error('[Extensions] Failed to load extension origins:', e);
        }
        try {
            const config = getExtensionsConfig();
            const installed: any[] = [];

            const loadFromDir = async (baseDir: string, isPlayground: boolean) => {
                // userData/extensions never accepts links; the dev playground may (developer working copies).
                const dirs = await listPluginDirsAsync(baseDir, { allowLinks: isPlayground });
                for (const dirName of dirs) {
                    const dirPath = path.join(baseDir, dirName);

                    const manifestPath = path.join(dirPath, 'manifest.json');
                    if (await pathExists(manifestPath)) {
                        try {
                            const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                            // manifest.entry must stay inside the plugin folder (no "..", absolute path or link out).
                            const entryPath = isSafeEntry(manifest.entry) ? resolveInside(dirPath, manifest.entry || 'index.js') : null;
                            let code = '';
                            if (!entryPath || !isFsPathInside(dirPath, entryPath)) {
                                console.error(`[Extensions] Rejected entry of extension ${dirName}: path leaves the plugin folder.`);
                            } else if (await pathExists(entryPath)) {
                                code = await fs.promises.readFile(entryPath, 'utf8');
                            }

                            installed.push(buildInstalledPlugin(manifest, dirName, isPlayground, config, code));
                        } catch (err) {
                            console.error(`Failed to load manifest for extension ${dirName} in ${baseDir}:`, err);
                        }
                    }
                }
            };

            // 1. Load regular extensions
            await loadFromDir(extensionsDir, false);

            // 2. Load playground extensions
            const playgroundDir = isDev ? appPaths.pluginsPlayground : path.join(app.getAppPath(), 'pluginsPlayground');
            await loadFromDir(playgroundDir, true);

            return installed;
        } catch (e) {
            console.error('Failed to get installed extensions:', e);
            return [];
        }
    }
}
