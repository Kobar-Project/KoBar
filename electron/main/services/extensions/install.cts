// T-314: the plugin install pipeline, moved unchanged out of main.cts. SECURITY-CRITICAL: installExtensionFromZipPath (safe extraction, manifest
// validation, the T-220 plugin API gate, the T-137 replace decision with its second confirmation and TOCTOU re-check) always runs BEFORE the first
// write to extensions/, extensions-config.json or the origins file; install-extension-from-file / -path / -github (path grant, confirmation,
// GitHub download) all end in it. The collaborators that live in main.cts (path grants, UI language, the confirm dialog) are injected live.
// T-318: the heavy file work is asynchronous (ZIP stat, manifest read, temp folder removal, removal of the replaced plugin folder). Because the
// write sequence now contains `await`s, the installed-state re-check and every write run under the shared install lock (withInstallLock),
// which uninstall / toggle / set-extensions-config take too; the decision and the confirmation stay BEFORE the lock and every write. The move
// into extensions/ and the config + origin writes after it stay synchronous with no await in between. adm-zip has no asynchronous API: the
// extraction stays synchronous, bounded by DEFAULT_ZIP_LIMITS.
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { app, BrowserWindow, dialog } from 'electron';
import type { AsyncLock } from '../../../lib/asyncLock.cjs';
import { dialogDefaultPath, readDialogPathsFile, recordDialogPick } from '../../../lib/dialogPaths.cjs';
import { isFsPathInside } from '../../../lib/fsGuards.cjs';
import { type MainLang, t } from '../../../lib/mainStrings.cjs';
import { isOfficialPluginId } from '../../../lib/officialPlugins.cjs';
import { resolveInside } from '../../../lib/paths.cjs';
import type { PathGrants } from '../../../lib/pathGrants.cjs';
import { checkPluginApiGate } from '../../../lib/pluginApiGate.cjs';
import { PLUGIN_CANCELED_REASON, buildReplaceRefusal } from '../../../lib/pluginConfirm.cjs';
import { parseGithubRepo, validateManifestForInstall, withoutMacMetadata } from '../../../lib/pluginInstall.cjs';
import { decideReplaceInstalled, sourceForRepo } from '../../../lib/pluginOrigins.cjs';
import { findManifestDir } from '../../../lib/pluginScan.cjs';
import { DEFAULT_ZIP_LIMITS, extractZipSafely } from '../../../lib/zipGuards.cjs';
import type { IpcRegistry } from '../../ipc/registry.cjs';
import { INSTALL_EXTENSION_FROM_GITHUB_OPTIONS, INSTALL_EXTENSION_FROM_PATH_OPTIONS } from '../../ipc/schemas.cjs';
import { appState } from '../../state.cjs';
import { currentDialogParent } from '../../app/helpers.cjs';
import { notifyBlockedFileAccess } from '../notifications.cjs';
import type { ExtensionsConfigStore } from './config.cjs';
import { type PluginConfirm, declinedReason } from './confirm.cjs';
import type { ExtensionOrigins } from './origins.cjs';

export interface ExtensionInstallDeps {
    registry: IpcRegistry;
    pathGrants: PathGrants;
    /** The 'not-user-selected' reason string shared with the other path-grant checks in main.cts. */
    notUserSelected: string;
    isDev: boolean;
    dialogPathsFile: string;
    getUiLanguage: () => Promise<MainLang>;
    extensionsDir: string;
    getExtensionsConfig: ExtensionsConfigStore['getExtensionsConfig'];
    saveExtensionsConfig: ExtensionsConfigStore['saveExtensionsConfig'];
    recordExtensionOrigin: ExtensionOrigins['recordExtensionOrigin'];
    findUpdateTarget: ExtensionOrigins['findUpdateTarget'];
    readInstalledPluginState: ExtensionOrigins['readInstalledPluginState'];
    sameInstalledState: ExtensionOrigins['sameInstalledState'];
    confirmPluginAction: PluginConfirm['confirmPluginAction'];
    /** T-316: called after an install enabled the plugin in the extensions config (media polling demand). Must not throw. */
    onExtensionsConfigChanged: () => void;
    /** T-318: the shared plugin install lock (see bootstrap createExtensionServices). */
    withInstallLock: AsyncLock['run'];
}

export function registerExtensionInstallIpc(deps: ExtensionInstallDeps): void {
    const {
        registry,
        pathGrants,
        notUserSelected: NOT_USER_SELECTED,
        isDev,
        dialogPathsFile,
        getUiLanguage,
        extensionsDir,
        getExtensionsConfig,
        saveExtensionsConfig,
        recordExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
        confirmPluginAction,
        onExtensionsConfigChanged,
        withInstallLock,
    } = deps;

    // Shared helper: installs an extension from a ZIP file path
    async function installExtensionFromZipPath(
        zipPath: string,
        sourceRepo?: string,
        versionOverride?: string
    ): Promise<{ success: boolean; reason?: string }> {
        // Extract to a temporary folder inside userData first to inspect manifest.json
        // T-318: the random suffix keeps two installs that start in the same millisecond apart now that the steps below yield.
        const tempExtractDir = path.join(app.getPath('userData'), 'temp_ext_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10));
        try {
            // A compressed archive larger than the extracted-size limit is never legitimate.
            if ((await fs.promises.stat(zipPath)).size > DEFAULT_ZIP_LIMITS.maxTotalBytes) throw new Error('ZIP file is too large.');
            // adm-zip reads and inflates synchronously (it has no async API); the size check above and the limits below bound it.
            const zip = new AdmZip(zipPath);
            // Enforces entry/size limits, rejects symlink/absolute/traversal entries (SEC-12).
            // MAC-020: macOS Finder metadata (__MACOSX/, ._*, .DS_Store) is dropped before validation, never extracted.
            extractZipSafely(withoutMacMetadata(zip), tempExtractDir);
        } catch (err: unknown) {
            // Corrupt zip or rejected entry (e.g. symlink, zip bomb): do not leave the temp folder behind
            console.error('[Extensions] Failed to extract ZIP archive:', err);
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true }).catch(() => {
                /* ignore */
            });
            return { success: false, reason: 'Failed to extract ZIP archive.' };
        }

        // Check if manifest.json exists
        // Check both the root directory and the first level subdirectories for manifest.json
        let found: ReturnType<typeof findManifestDir> = null;
        try {
            found = findManifestDir(tempExtractDir);
        } catch (err) {
            console.error('[Extensions] Failed to inspect the extracted package:', err);
        }
        if (!found) {
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
            return { success: false, reason: 'manifest.json not found in ZIP archive.' };
        }
        const { dir: searchDir, manifestPath } = found;

        let manifest: any;
        try {
            manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        } catch {
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
            return { success: false, reason: 'Invalid manifest.json file.' };
        }

        // Required fields, safe id (it becomes a folder name), safe entry, official id reservation.
        const source = sourceRepo ? { kind: 'github' as const, repo: sourceRepo } : { kind: 'local' as const };
        const validation = validateManifestForInstall(manifest, source, { allowOfficialFromLocal: isDev });
        if (!validation.ok) {
            console.error('[Extensions] Rejected plugin package:', validation.reason);
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
            return { success: false, reason: validation.reason };
        }
        // T-220: this host runs plugin API v1 only. A plugin that needs a newer API or app is refused here, before anything
        // is moved into extensions/ (every install and update path goes through this function).
        const gate = checkPluginApiGate(manifest, app.getVersion());
        if (!gate.ok) {
            console.error(`[Extensions] Refused plugin ${validation.id}: ${gate.code} (${gate.reason})`);
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
            return { success: false, reason: gate.reason };
        }
        if (isDev && source.kind === 'local' && isOfficialPluginId(validation.id)) {
            console.warn(`[Extensions] Dev run: allowing official id ${validation.id} from a local ZIP.`);
        }

        const extensionId = validation.id;
        const targetDir = resolveInside(extensionsDir, extensionId);
        if (!targetDir || !isFsPathInside(extensionsDir, targetDir)) {
            await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
            return { success: false, reason: 'The plugin folder is not a plain folder inside extensions (link?).' };
        }

        // T-137: the id is already installed. Decided (and for a local ZIP confirmed a second time) before anything is
        // written to extensions/, extensions-config.json or the origins file; every refusal leaves the plugin untouched.
        // GitHub = update path: recorded repository only, strictly newer, no extra prompt (the user confirmed the update).
        // Local ZIP: no downgrade, versions must be comparable, and a second confirmation naming id, versions and origins.
        const newVersion = versionOverride || (typeof manifest.version === 'string' ? manifest.version : null);
        const installedBefore = readInstalledPluginState(extensionId, targetDir);
        let confirmedReplace = false;
        if (installedBefore) {
            const replace = decideReplaceInstalled({
                incoming: sourceRepo ? { kind: 'github', repo: sourceRepo } : { kind: 'zip' },
                origin: installedBefore.effective,
                installedVersion: installedBefore.installedVersion,
                newVersion,
            });
            if (replace.action === 'refuse') {
                console.error(`[Extensions] Refused to replace ${extensionId}: ${replace.code} (${replace.reason})`);
                await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
                const reason =
                    replace.code === 'github-refused'
                        ? replace.reason
                        : buildReplaceRefusal(
                              replace.code,
                              { id: extensionId, installedVersion: installedBefore.installedVersion, newVersion },
                              await getUiLanguage()
                          );
                return { success: false, reason };
            }
            if (replace.action === 'confirm') {
                const outcome = await confirmPluginAction({
                    kind: 'replace',
                    id: extensionId,
                    change: replace.change,
                    installedVersion: installedBefore.installedVersion ?? '',
                    newVersion: newVersion ?? '',
                    origin: installedBefore.recorded,
                    // Only a local ZIP gets here: a GitHub package either proceeds or is refused above.
                    incoming: { kind: 'zip', fileName: path.basename(zipPath) },
                });
                if (outcome !== 'ok') {
                    await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
                    return { success: false, reason: declinedReason(outcome) };
                }
                confirmedReplace = true;
            }
        }

        // T-318: from here on nothing else may touch extensions/, extensions-config.json or the origins file until this install is done.
        const locked = await withInstallLock(async () => {
            // The installed plugin may have changed while the dialog was open (or, now that the writes are asynchronous, while another
            // install or uninstall held the lock): then nothing is installed. Without a concurrent change the state is the one decided on.
            const installedNow = readInstalledPluginState(extensionId, targetDir);
            if (installedBefore ? !sameInstalledState(installedBefore, installedNow) : installedNow !== null) {
                const what = installedBefore ? `replace ${extensionId}` : `install ${extensionId}`;
                const when = confirmedReplace ? 'during the confirmation' : 'before the install could start';
                console.error(`[Extensions] Refused to ${what}: the installed plugin changed ${when}.`);
                await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
                // The localized reason is built after the lock is released (no UI-language lookup while the lock is held).
                return 'changed' as const;
            }

            // T-316: once the old folder is touched, a failed install may have removed the media plugin: re-evaluate the demand then too.
            let targetTouched = false;
            let targetMoved = false;
            try {
                if (sourceRepo || versionOverride) {
                    if (sourceRepo) manifest.githubRepo = sourceRepo;
                    if (versionOverride) manifest.version = versionOverride;
                    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 4), 'utf8');
                }

                // If target directory already exists, clear it first
                if (fs.existsSync(targetDir)) {
                    targetTouched = true;
                    await fs.promises.rm(targetDir, { recursive: true, force: true });
                }

                // Ensure parent extensions folder exists
                if (!fs.existsSync(extensionsDir)) {
                    fs.mkdirSync(extensionsDir, { recursive: true });
                }

                // Copy/move searchDir (which contains manifest.json at its root) to targetDir. Synchronous on purpose (a rename is a
                // metadata change): the config and origin writes below follow it with no await in between.
                targetTouched = true;
                fs.renameSync(searchDir, targetDir);
                targetMoved = true;
            } finally {
                // Clean up the temp extract root when the move failed (after a successful move it is removed below, after the writes)
                if (!targetMoved) {
                    await fs.promises.rm(tempExtractDir, { recursive: true, force: true }).catch(() => {
                        /* ignore */
                    });
                }
                if (targetTouched && !targetMoved) onExtensionsConfigChanged();
            }

            try {
                // Update config to enable this extension
                const config = getExtensionsConfig();
                config[extensionId] = true;
                saveExtensionsConfig(config);
                onExtensionsConfigChanged();

                // Record where it came from (main-process file, the plugin cannot change it). A local ZIP gets no
                // update repository: the repo its manifest names is unverified.
                const installedVersion = typeof manifest.version === 'string' ? manifest.version : undefined;
                recordExtensionOrigin(extensionId, {
                    repo: sourceRepo ?? null,
                    source: sourceRepo ? sourceForRepo(sourceRepo) : 'zip',
                    installedAt: new Date().toISOString(),
                    ...(installedVersion ? { version: installedVersion } : {}),
                });
            } finally {
                // Clean up the temp extract root (only what was left beside the moved plugin folder)
                await fs.promises.rm(tempExtractDir, { recursive: true, force: true }).catch(() => {
                    /* ignore */
                });
            }

            return { success: true };
        });
        if (locked === 'changed') {
            return { success: false, reason: t(await getUiLanguage(), 'pluginChangedDuringConfirm', { name: extensionId }) };
        }
        return locked;
    }

    registry.handle('install-extension-from-file', async () => {
        try {
            // Pass mainWindow as parent so the dialog opens above the always-on-top window
            const parentWin = currentDialogParent() || appState.mainWindow || BrowserWindow.getAllWindows()[0];
            const dialogOptions = {
                title: 'Select Extension ZIP Archive',
                // T-037: reopen in the folder used last time.
                defaultPath: await dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'install-zip'),
                filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
                properties: ['openFile' as const],
            };

            const { canceled, filePaths } = parentWin
                ? await dialog.showOpenDialog(parentWin, dialogOptions)
                : await dialog.showOpenDialog(dialogOptions);

            if (canceled || filePaths.length === 0) {
                return { success: false, reason: PLUGIN_CANCELED_REASON };
            }
            recordDialogPick(dialogPathsFile, 'install-zip', filePaths[0]);

            const outcome = await confirmPluginAction({ kind: 'zip', fileName: path.basename(filePaths[0]) });
            if (outcome !== 'ok') {
                return { success: false, reason: declinedReason(outcome) };
            }
            return await installExtensionFromZipPath(filePaths[0]);
        } catch (e: any) {
            console.error('Failed to install extension from file:', e);
            return { success: false, reason: e.message || 'Unknown error occurred.' };
        }
    });

    // Install extension from a file path directly (used by drag & drop)
    registry.handle('install-extension-from-path', INSTALL_EXTENSION_FROM_PATH_OPTIONS, async (_event, filePath: string) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                return { success: false, reason: 'Invalid file path.' };
            }
            if (!filePath.toLowerCase().endsWith('.zip')) {
                return { success: false, reason: 'Only .zip files are supported.' };
            }
            // T-150: only a ZIP the user dropped (PluginStore resolves it with getFilePath, which grants it). In-memory
            // check before any fs access; the confirmation dialog below stays as the second gate.
            if (!pathGrants.isGranted(filePath)) {
                notifyBlockedFileAccess('install-extension-from-path');
                return { success: false, reason: NOT_USER_SELECTED };
            }
            if (!fs.existsSync(filePath)) {
                return { success: false, reason: 'File not found.' };
            }
            const outcome = await confirmPluginAction({ kind: 'zip', fileName: path.basename(filePath) });
            if (outcome !== 'ok') {
                return { success: false, reason: declinedReason(outcome) };
            }
            return await installExtensionFromZipPath(filePath);
        } catch (e: any) {
            console.error('Failed to install extension from path:', e);
            return { success: false, reason: e.message || 'Unknown error occurred.' };
        }
    });

    registry.handle('install-extension-from-github', INSTALL_EXTENSION_FROM_GITHUB_OPTIONS, async (_event, id: string, repo: string) => {
        try {
            // Strict "owner/name": the value goes into API URLs and decides whether an official id is allowed.
            if (!parseGithubRepo(repo)) {
                return { success: false, reason: 'Invalid GitHub repository format.' };
            }
            // When the repo is the recorded origin of an installed plugin, the dialog says "update" and warns
            // if that origin was only taken from the plugin's own manifest (legacy install).
            const update = await withInstallLock(() => findUpdateTarget(repo));
            const outcome = await confirmPluginAction(update ? { kind: 'github', repo, update } : { kind: 'github', repo });
            if (outcome !== 'ok') {
                return { success: false, reason: declinedReason(outcome) };
            }

            // 1. Fetch latest release metadata
            const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'KoBar-App',
                },
            });

            if (!releaseRes.ok) {
                return { success: false, reason: `Failed to fetch latest release metadata (${releaseRes.status}).` };
            }

            const releaseData = (await releaseRes.json()) as any;
            const asset = releaseData.assets?.find((a: any) => a.name.endsWith('.zip'));

            if (!asset && !releaseData.zipball_url) {
                return { success: false, reason: 'No .zip asset or source code found in the latest release.' };
            }

            // 2. Download the asset stream
            const downloadUrl = asset ? asset.url : releaseData.zipball_url;
            const headers: Record<string, string> = { 'User-Agent': 'KoBar-App' };
            if (asset) {
                headers['Accept'] = 'application/octet-stream';
            }

            const assetRes = await fetch(downloadUrl, { headers });

            if (!assetRes.ok || !assetRes.body) {
                return { success: false, reason: `Failed to download asset (${assetRes.status}).` };
            }

            const totalBytes = Number(assetRes.headers.get('content-length') || 0);
            let loadedBytes = 0;

            // 3. Pipe stream to temporary file and emit progress
            // `id` is only a display/progress key here (callers pass ids, repo names or plugin names), so it
            // is not used in the file name.
            const tempZipPath = path.join(app.getPath('temp'), `plugin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.zip`);
            const { Readable } = require('stream');
            const readableStream = Readable.fromWeb(assetRes.body as any);
            const writeStream = fs.createWriteStream(tempZipPath);

            readableStream.on('data', (chunk: Buffer) => {
                loadedBytes += chunk.length;
                if (totalBytes > 0 && appState.mainWindow) {
                    const percent = Math.round((loadedBytes / totalBytes) * 100);
                    appState.mainWindow.webContents.send('plugin-install-progress', { id, percent });
                }
            });

            try {
                await new Promise((resolve, reject) => {
                    readableStream.pipe(writeStream).on('finish', resolve).on('error', reject);
                });

                // 4. Pass to existing installer, overriding the version with the release tag to prevent infinite update loops
                const latestVersion = (releaseData.tag_name || releaseData.name || '').replace(/^v/, '');
                return await installExtensionFromZipPath(tempZipPath, repo, latestVersion);
            } finally {
                // 5. Cleanup (also when download or install failed)
                await fs.promises.unlink(tempZipPath).catch(() => {
                    /* ignore (also when it was never created) */
                });
            }
        } catch (e: any) {
            console.error('Failed to install from GitHub:', e);
            return { success: false, reason: e.message || 'Unknown error occurred.' };
        }
    });
}
