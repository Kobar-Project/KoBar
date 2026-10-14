// T-314: uninstall-extension, toggle-extension-enabled and set-extensions-config (plus the installed-id list behind the last one), moved unchanged
// out of main.cts. The uninstall confirmation, the re-check after it and the config/origin clean-up keep their order.
// T-318: the plugin folder is deleted asynchronously, so the re-check, the delete and the config/origin clean-up run under the shared
// install lock (as do toggle-extension-enabled and set-extensions-config): no install, update or other change can interleave with them.
// The confirmation dialog itself stays outside the lock, so an open dialog never blocks the other channels.
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AsyncLock } from '../../../lib/asyncLock.cjs';
import { pathExists } from '../../../lib/fsGuards.cjs';
import { canDeletePluginFolder } from '../../../lib/pluginDelete.cjs';
import { mergeExtensionsConfig } from '../../../lib/pluginConfirm.cjs';
import { listPluginDirsAsync } from '../../../lib/pluginScan.cjs';
import type { IpcRegistry } from '../../ipc/registry.cjs';
import { SET_EXTENSIONS_CONFIG_OPTIONS, TOGGLE_EXTENSION_ENABLED_OPTIONS, UNINSTALL_EXTENSION_OPTIONS } from '../../ipc/schemas.cjs';
import type { AppPaths } from '../../lib/appPaths.cjs';
import type { ExtensionsConfigStore } from './config.cjs';
import type { PluginConfirm } from './confirm.cjs';
import type { ExtensionOrigins } from './origins.cjs';

export interface ExtensionManagementDeps {
    registry: IpcRegistry;
    isDev: boolean;
    appPaths: AppPaths;
    extensionsDir: string;
    getExtensionsConfig: ExtensionsConfigStore['getExtensionsConfig'];
    saveExtensionsConfig: ExtensionsConfigStore['saveExtensionsConfig'];
    forgetExtensionOrigin: ExtensionOrigins['forgetExtensionOrigin'];
    confirmPluginAction: PluginConfirm['confirmPluginAction'];
    /** T-316: called after the extensions config was saved (the media plugin may have been enabled or disabled). Must not throw. */
    onExtensionsConfigChanged: () => void;
    /** T-318: the shared plugin install lock (see bootstrap createExtensionServices). */
    withInstallLock: AsyncLock['run'];
}

export function registerExtensionManagementIpc(deps: ExtensionManagementDeps): void {
    const {
        registry,
        isDev,
        appPaths,
        extensionsDir,
        getExtensionsConfig,
        saveExtensionsConfig,
        forgetExtensionOrigin,
        confirmPluginAction,
        onExtensionsConfigChanged,
        withInstallLock,
    } = deps;

    // Ids the renderer may keep in the extensions config: manifest ids and folder names of installed
    // plugins, plus "dev-<id>" for playground plugins.
    async function getInstalledExtensionIds(): Promise<string[]> {
        const ids: string[] = [];
        const collect = async (baseDir: string, prefix: string) => {
            for (const dirName of await listPluginDirsAsync(baseDir, { allowLinks: prefix !== '' })) {
                const manifestPath = path.join(baseDir, dirName, 'manifest.json');
                if (!(await pathExists(manifestPath))) continue;
                ids.push(prefix + dirName);
                try {
                    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                    if (typeof manifest.id === 'string' && manifest.id) ids.push(prefix + manifest.id);
                } catch {
                    /* unreadable manifest: the folder name still counts */
                }
            }
        };
        try {
            await collect(extensionsDir, '');
        } catch (e) {
            console.error('Failed to list installed extensions:', e);
        }
        try {
            await collect(isDev ? appPaths.pluginsPlayground : path.join(app.getAppPath(), 'pluginsPlayground'), 'dev-');
        } catch (e) {
            console.error('Failed to list playground extensions:', e);
        }
        return ids;
    }

    registry.handle('uninstall-extension', UNINSTALL_EXTENSION_OPTIONS, async (_event, id: string) => {
        try {
            const check = canDeletePluginFolder(extensionsDir, id, { allowLegacyEntry: true });
            // A folder that is already gone only needs its config/origin cleaned up; everything else is refused.
            if (!check.ok && check.reason !== 'not-found') {
                console.error(`[Extensions] uninstall-extension refused ${String(id)}: ${check.reason}.`);
                return false;
            }
            if ((await confirmPluginAction({ kind: 'uninstall', id })) !== 'ok') return false;
            return await withInstallLock(async () => {
                // Re-check after the dialog (under the lock): the folder may have been swapped for a link while it was open.
                const recheck = canDeletePluginFolder(extensionsDir, id, { allowLegacyEntry: true });
                if (!recheck.ok && recheck.reason !== 'not-found') {
                    console.error(`[Extensions] uninstall-extension refused ${String(id)} after confirmation: ${recheck.reason}.`);
                    return false;
                }
                if (recheck.ok) {
                    // Only delete a real plugin folder (no link/junction); it must contain manifest.json.
                    const destDir = recheck.dir;
                    const manifestPath = path.join(destDir, 'manifest.json');
                    if (!fs.existsSync(manifestPath) || !fs.lstatSync(manifestPath).isFile()) {
                        console.error(`[Extensions] uninstall-extension refused to delete ${id}: no manifest.json.`);
                        return false;
                    }
                    await fs.promises.rm(destDir, { recursive: true, force: true });
                }
                const config = getExtensionsConfig();
                delete config[id];
                saveExtensionsConfig(config);
                onExtensionsConfigChanged();
                forgetExtensionOrigin(id);
                return true;
            });
        } catch (e) {
            console.error(`Failed to uninstall extension ${id}:`, e);
            return false;
        }
    });

    const RESERVED_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    registry.handle('toggle-extension-enabled', TOGGLE_EXTENSION_ENABLED_OPTIONS, async (_event, id: string, enabled: boolean) => {
        try {
            // Config key only (no path is built from it). Dev playground ids ("dev-<id>") and older
            // third-party ids are not always isSafeId-compatible, so validate the shape only.
            if (typeof id !== 'string' || id === '' || id.length > 256 || RESERVED_CONFIG_KEYS.has(id)) {
                return false;
            }
            return await withInstallLock(() => {
                const config = getExtensionsConfig();
                // Store a real boolean; the reader treats anything but `false` as enabled, so this keeps the meaning.
                config[id] = enabled !== false;
                saveExtensionsConfig(config);
                onExtensionsConfigChanged();
                return true;
            });
        } catch (e) {
            console.error(`Failed to toggle extension enabled state:`, e);
            return false;
        }
    });

    registry.handle('set-extensions-config', SET_EXTENSIONS_CONFIG_OPTIONS, async (_event, config: Record<string, boolean>) => {
        try {
            if (config && typeof config === 'object' && !Array.isArray(config)) {
                return await withInstallLock(async () => {
                    // Installed ids take exactly the caller's valid entries; entries of ids that are not
                    // installed are left untouched. The ids are listed first; the config is then read, merged and
                    // saved with no await in between.
                    const installedIds = await getInstalledExtensionIds();
                    saveExtensionsConfig(mergeExtensionsConfig(getExtensionsConfig(), config, installedIds));
                    onExtensionsConfigChanged();
                    return true;
                });
            }
            return false;
        } catch (e) {
            console.error(`Failed to set extensions config:`, e);
            return false;
        }
    });
}
