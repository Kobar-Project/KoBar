// T-315: the backup IPC handlers that sat in main.cts, moved unchanged: the pre-migration `kobar-storage` backup (PROD-02, T-201),
// the full backup export (T-211), the pre-restore / pre-delete backups and the restore + relaunch (T-213, T-214).
// main.cts registers the sendSync storage backup early (registerStorageBackupIpc) and the rest after the plugin config exists (registerFullBackupIpc).
import { app, dialog, ipcMain, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { dialogDefaultPath, readDialogPathsFile, recordDialogPick } from '../../lib/dialogPaths.cjs';
import { isProtectedPath } from '../../lib/fileArgs.cjs';
import {
    type BackupSources,
    collectInstalledPlugins,
    fullBackupFileName,
    sanitizeExtensionsConfig,
    validateFullBackupText,
} from '../../lib/fullBackup.cjs';
import { type MainLang, t } from '../../lib/mainStrings.cjs';
import { createRestoreGate, restrictExtensionsConfig, writeJsonFileAtomic, writePreRestoreBackup } from '../../lib/restoreBackup.cjs';
import { BACKUP_DIR_NAME, type StorageBackupResult, createBackupIfChanged, isAcceptableBackupInput } from '../../lib/storageBackup.cjs';
import { isMainWindowTopFrame } from '../app/helpers.cjs';
import { readManifestSafe } from '../lib/pluginManifest.cjs';
import { appState } from '../state.cjs';
import { currentDialogParent } from '../app/helpers.cjs';

// Pre-migration backup of `kobar-storage` (PROD-02, T-201). The preload sends the raw localStorage string with sendSync
// at page load, before the renderer's persist store hydrates or migrates it. Internal channel, not part of window.api.
// Only the main window's top frame is accepted. Always sets returnValue (a sync sender blocks until it is set) and
// never returns the backup path to the renderer.
export function registerStorageBackupIpc(): void {
    ipcMain.on('backup-kobar-storage', (event, raw: unknown) => {
        let result: StorageBackupResult = { created: false, reason: 'rejected' };
        try {
            const fromMainFrame =
                !!appState.mainWindow &&
                !appState.mainWindow.isDestroyed() &&
                event.sender === appState.mainWindow.webContents &&
                event.senderFrame === appState.mainWindow.webContents.mainFrame;
            if (!fromMainFrame) {
                console.warn('[KoBar] kobar-storage backup rejected:', 'sender');
            } else if (!isAcceptableBackupInput(raw)) {
                console.warn('[KoBar] kobar-storage backup rejected:', 'size');
            } else {
                result = createBackupIfChanged({
                    backupsDir: path.join(app.getPath('userData'), BACKUP_DIR_NAME),
                    raw,
                    now: new Date(),
                    fs,
                });
                if (result.created) console.log('[KoBar] kobar-storage backup created:', result.path);
                else if (result.reason !== 'unchanged') console.warn('[KoBar] kobar-storage backup skipped:', result.reason);
            }
        } catch (err) {
            console.error('[KoBar] kobar-storage backup failed:', err);
            result = { created: false, reason: 'error' };
        } finally {
            event.returnValue = { created: result.created, reason: result.reason ?? null };
        }
    });
}

export interface FullBackupDeps {
    dialogPathsFile: string;
    extensionsDir: string;
    extensionsConfigPath: string;
    getExtensionsConfig: () => Record<string, boolean>;
    getUiLanguage: () => Promise<MainLang>;
    getProtectedAppRoots: () => string[];
}

export function registerFullBackupIpc(deps: FullBackupDeps): void {
    const { dialogPathsFile, extensionsDir, extensionsConfigPath, getExtensionsConfig, getUiLanguage, getProtectedAppRoots } = deps;

    // ─── Full backup export (T-211, PROD-14) ────────────────────────────
    // The renderer builds the `kobar-backup` JSON from its localStorage (secrets removed unless the user opted in) and
    // these sources; main only supplies extensions-config.json + the installed plugin list and writes the finished file
    // to the path picked in its own save dialog. KoBox, plugin code and the automatic backups are never included.
    // Only the main window's top frame may call either channel.
    ipcMain.handle('get-backup-sources', (event): BackupSources => {
        if (!isMainWindowTopFrame(event)) return { extensionsConfig: {}, plugins: [] };
        const extensionsConfig = sanitizeExtensionsConfig(getExtensionsConfig());
        // Only userData/extensions: dev playground plugins are not part of a user's backup.
        const plugins = collectInstalledPlugins(extensionsDir, extensionsConfig, readManifestSafe);
        return { extensionsConfig, plugins };
    });

    ipcMain.handle('save-full-backup', async (event, text: unknown) => {
        if (!isMainWindowTopFrame(event) || !appState.mainWindow) return { success: false, reason: 'rejected' };
        const check = validateFullBackupText(text);
        if (!check.ok) {
            console.warn('[KoBar] Full backup rejected:', check.reason);
            return { success: false, reason: check.reason };
        }
        try {
            const lang = await getUiLanguage();
            if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return { success: false, reason: 'rejected' };
            const fileName = fullBackupFileName(new Date());
            // T-037 pattern: reopen in the folder used last time, otherwise in Documents.
            const remembered = await dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'save-full-backup', fileName);
            if (!appState.mainWindow || appState.mainWindow.isDestroyed()) return { success: false, reason: 'rejected' };
            const { canceled, filePath } = await dialog.showSaveDialog(currentDialogParent() ?? appState.mainWindow, {
                title: t(lang, 'saveFullBackup'),
                defaultPath: remembered && remembered !== fileName ? remembered : path.join(app.getPath('documents'), fileName),
                filters: [{ name: 'KoBar Backup', extensions: ['json'] }],
            });
            if (canceled || !filePath) return { success: false, reason: 'canceled' };
            // Never write into the app's own data folders (userData, extensions, KoBox included).
            if (isProtectedPath(filePath, getProtectedAppRoots())) {
                console.error('[KoBar] Full backup rejected: target inside application data');
                return { success: false, reason: 'target-inside-app-data' };
            }
            // Atomic: write a temp file next to the target, then rename over it (an existing file is never half-written).
            const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
            try {
                await fs.promises.writeFile(tempPath, text as string, { encoding: 'utf8', flag: 'wx' });
                await fs.promises.rename(tempPath, filePath);
            } catch (err) {
                await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
                throw err;
            }
            recordDialogPick(dialogPathsFile, 'save-full-backup', filePath);
            return { success: true, path: filePath };
        } catch (err) {
            console.error('[KoBar] Full backup save failed:', err);
            return { success: false, reason: 'write-failed' };
        }
    });

    // ─── Full backup restore (T-213, PROD-14) ───────────────────────────
    // The renderer validates the backup, makes the automatic pre-restore backup through `create-pre-restore-backup`,
    // write-locks its persist storage, writes localStorage and then calls `apply-restore-and-relaunch`. Main accepts the
    // relaunch only after a recent successful pre-restore backup, applies the plugin flags by restrictExtensionsConfig
    // (installed plugins only; never enables, never installs) and restarts. Main-window top frame only.
    const restoreGate = createRestoreGate();

    ipcMain.handle('create-pre-restore-backup', (event, text: unknown) => {
        if (!isMainWindowTopFrame(event)) return { success: false, reason: 'rejected' };
        const result = writePreRestoreBackup({ backupsDir: path.join(app.getPath('userData'), BACKUP_DIR_NAME), text });
        if (!result.created) {
            console.warn('[KoBar] Pre-restore backup failed:', result.reason);
            return { success: false, reason: result.reason ?? 'write-failed' };
        }
        console.log('[KoBar] Pre-restore backup created:', result.path);
        restoreGate.markBackup();
        return { success: true };
    });

    // T-214 (WS-05): automatic full backup before a workspace is deleted. Same validation and secret-free check as the
    // pre-restore backup, own file names, and it never opens the restore/relaunch gate.
    ipcMain.handle('create-pre-delete-backup', (event, text: unknown) => {
        if (!isMainWindowTopFrame(event)) return { success: false, reason: 'rejected' };
        const result = writePreRestoreBackup({ backupsDir: path.join(app.getPath('userData'), BACKUP_DIR_NAME), text, kind: 'pre-delete' });
        if (!result.created) {
            console.warn('[KoBar] Pre-delete backup failed:', result.reason);
            return { success: false, reason: result.reason ?? 'write-failed' };
        }
        console.log('[KoBar] Pre-delete backup created:', result.path);
        return { success: true };
    });

    ipcMain.handle('apply-restore-and-relaunch', (event, extensionsConfig: unknown) => {
        if (!isMainWindowTopFrame(event)) return { success: false, reason: 'rejected' };
        if (!restoreGate.consume()) {
            console.warn('[KoBar] Restore rejected: no recent pre-restore backup');
            return { success: false, reason: 'no-pre-restore-backup' };
        }
        try {
            const installedIds = collectInstalledPlugins(extensionsDir, {}, readManifestSafe).map((plugin) => plugin.id);
            const next = restrictExtensionsConfig(getExtensionsConfig(), sanitizeExtensionsConfig(extensionsConfig), installedIds);
            if (next.changed) writeJsonFileAtomic(extensionsConfigPath, next.config);
        } catch (err) {
            console.error('[KoBar] Restore: extensions config write failed:', err);
            return { success: false, reason: 'config-write-failed' };
        }
        try {
            session.defaultSession.flushStorageData();
        } catch (err) {
            console.error('[KoBar] flushStorageData failed:', err);
        }
        // After the reply is sent: relaunch, then quit through the normal quit path (the renderer's persist is locked).
        setTimeout(() => {
            app.relaunch();
            app.quit();
        }, 100);
        return { success: true };
    });
}
