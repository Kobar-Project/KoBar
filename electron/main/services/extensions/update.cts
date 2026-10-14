// T-314: check-plugin-updates, moved unchanged out of main.cts. The update source is always the main-process origin record, never the plugin's manifest.
// T-318: the folder list and the manifests are read asynchronously; the origins load (which may write the legacy snapshot) runs under the
// install lock, the network checks do not (an install never waits for GitHub).
import * as fs from 'fs';
import * as path from 'path';
import type { AsyncLock } from '../../../lib/asyncLock.cjs';
import { pathExists } from '../../../lib/fsGuards.cjs';
import { isSafeId } from '../../../lib/paths.cjs';
import { parseGithubRepo } from '../../../lib/pluginInstall.cjs';
import { type OriginRecord, findOriginKey, updateCheckVersion } from '../../../lib/pluginOrigins.cjs';
import { listPluginDirsAsync } from '../../../lib/pluginScan.cjs';
import { isNewerVersion } from '../../../lib/semver.cjs';
import type { IpcRegistry } from '../../ipc/registry.cjs';
import { ORIGIN_KEYS_IGNORE_CASE, type ExtensionOrigins } from './origins.cjs';

export interface PluginUpdatesDeps {
    registry: IpcRegistry;
    extensionsDir: string;
    loadExtensionOrigins: ExtensionOrigins['loadExtensionOrigins'];
    /** T-318: the shared plugin install lock (see bootstrap createExtensionServices). */
    withInstallLock: AsyncLock['run'];
}

export function registerPluginUpdatesIpc(deps: PluginUpdatesDeps): void {
    const { registry, extensionsDir, loadExtensionOrigins, withInstallLock } = deps;

    registry.handle('check-plugin-updates', async () => {
        try {
            if (!(await pathExists(extensionsDir))) return [];
            const dirs = await listPluginDirsAsync(extensionsDir);
            const updates: any[] = [];
            // Update sources come from the main-process origin records, never from the plugin's own manifest.
            const origins = await withInstallLock(() => loadExtensionOrigins());

            for (const dirName of dirs) {
                const dirPath = path.join(extensionsDir, dirName);

                const manifestPath = path.join(dirPath, 'manifest.json');
                if (await pathExists(manifestPath)) {
                    try {
                        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
                        // An update with an unsafe id could never be installed: do not offer it forever.
                        if (!isSafeId(manifest.id || dirName)) {
                            console.warn(`[Extensions] Skipping update check for ${dirName}: invalid plugin id.`);
                            continue;
                        }
                        const originKey = findOriginKey(origins, dirName, ORIGIN_KEYS_IGNORE_CASE);
                        const origin: OriginRecord | undefined = originKey !== null ? origins[originKey] : undefined;
                        const repo = origin?.repo;
                        // Same rule as the install path: without a valid installed version no update can be
                        // installed, so none is offered.
                        const currentVersion = updateCheckVersion(origin, manifest);
                        // Strict "owner/name" only: the value goes into the API URL and into the update install.
                        if (origin && parseGithubRepo(repo) && currentVersion) {
                            const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
                                headers: {
                                    Accept: 'application/vnd.github.v3+json',
                                    'User-Agent': 'KoBar-App',
                                },
                            });

                            if (releaseRes.ok) {
                                const releaseData = (await releaseRes.json()) as any;
                                const latestVersion = releaseData.tag_name || releaseData.name;

                                const cleanLatest = (typeof latestVersion === 'string' ? latestVersion : '').replace(/^v/, '');

                                // Only a strictly greater semver is an update (no downgrades, invalid = not newer).
                                if (isNewerVersion(cleanLatest, currentVersion)) {
                                    updates.push({
                                        id: manifest.id || dirName,
                                        name: manifest.name || dirName,
                                        currentVersion,
                                        latestVersion: cleanLatest,
                                        releaseNotes: releaseData.body || '',
                                        repo: repo,
                                        source: origin.source,
                                        legacyOrigin: origin.source === 'legacy',
                                    });
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to check updates for ${dirName}:`, err);
                    }
                }
            }
            return updates;
        } catch (e) {
            console.error('Failed to check plugin updates:', e);
            return [];
        }
    });
}
