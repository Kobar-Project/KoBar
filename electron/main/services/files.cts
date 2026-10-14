// T-312: file parsing for AI Hub (parse-file), file icons for Shortcuts (get-file-icon) and launch-file, moved unchanged out of main.cts.
// The path-grant, protected-path and size checks keep their order. The live collaborators (path grants, protected roots, UI language,
// the confirm dialog and the external-URL gate, the IPC registry) are injected by main.cts so there is one source of truth.
import * as path from 'path';
import { app, ipcMain, shell } from 'electron';
import { validateIconPath, pickShortcutIconSource } from '../../lib/fileIcon.cjs';
import { type ExternalDecision, classifyLaunchTarget, truncateForDialog } from '../../lib/external.cjs';
import {
    PARSE_FILE_MAX_BYTES,
    classifyParseFile,
    isPlainAbsolutePath,
    isProtectedPath,
    readRegularFileLimitedAsync,
} from '../../lib/fileArgs.cjs';
import { type MainLang, t } from '../../lib/mainStrings.cjs';
import { extractPdfText } from '../../lib/pdfText.cjs';
import type { PathGrants } from '../../lib/pathGrants.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import { GET_FILE_ICON_OPTIONS, PARSE_FILE_OPTIONS } from '../ipc/schemas.cjs';
import { notifyBlockedFileAccess } from './notifications.cjs';

const isWin = process.platform === 'win32';

export interface FilesDeps {
    registry: IpcRegistry;
    pathGrants: PathGrants;
    /** The 'not-user-selected' reason string shared with the other path-grant checks in main.cts. */
    notUserSelected: string;
    getUiLanguage: () => Promise<MainLang>;
    getProtectedAppRoots: () => string[];
    getKoBoxRoots: () => string[];
    confirmWithUser: (message: string, detail?: string, confirmLabel?: string) => Promise<boolean>;
    openExternalChecked: (raw: unknown, decision?: ExternalDecision) => Promise<void>;
}

export function registerFilesIpc(deps: FilesDeps): void {
    const {
        registry,
        pathGrants,
        notUserSelected: NOT_USER_SELECTED,
        getUiLanguage,
        getProtectedAppRoots,
        getKoBoxRoots,
        confirmWithUser,
        openExternalChecked,
    } = deps;

    // AI Hub Fetch API & File Parsing
    registry.handle('parse-file', PARSE_FILE_OPTIONS, async (_event, filePath: string) => {
        try {
            // Read-only, allow-listed extensions, size-capped, regular files outside app data only (SEC-02).
            if (!isPlainAbsolutePath(filePath)) throw new Error('Invalid file path');
            const kind = classifyParseFile(filePath);
            if (!kind) throw new Error('Unsupported file type');
            if (isProtectedPath(filePath, getProtectedAppRoots(), getKoBoxRoots()))
                throw new Error('Access to application data is not allowed');
            // T-042: exactly this file must have been dropped / picked by the user (a dropped folder grants nothing beneath it).
            if (!pathGrants.isGranted(filePath)) {
                notifyBlockedFileAccess('parse-file');
                // `error` is an additive machine-readable field; `type`/`content` keep the v1 error shape.
                return { type: 'error', content: `Error: ${NOT_USER_SELECTED}`, error: NOT_USER_SELECTED };
            }
            // T-318: read without blocking the main process (up to PARSE_FILE_MAX_BYTES), same checks and errors as before.
            const dataBuffer = await readRegularFileLimitedAsync(filePath, PARSE_FILE_MAX_BYTES);
            const ext = path.extname(filePath).toLowerCase();
            if (kind === 'pdf') {
                return { type: 'text', content: await extractPdfText(dataBuffer) };
            } else if (kind === 'image') {
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                return { type: 'image', content: `data:${mime};base64,${dataBuffer.toString('base64')}` };
            } else {
                return { type: 'text', content: dataBuffer.toString('utf-8') };
            }
        } catch (e) {
            console.error('Parse file error:', e);
            return { type: 'error', content: String(e) };
        }
    });

    registry.handle('get-file-icon', GET_FILE_ICON_OPTIONS, async (_event, filePath: unknown) => {
        try {
            const validPath = validateIconPath(filePath);
            if (!validPath) return null;
            // For .lnk files resolve the icon source with Electron's built-in API (no shell involved).
            let iconSource = validPath;
            if (isWin && validPath.toLowerCase().endsWith('.lnk')) {
                try {
                    iconSource = pickShortcutIconSource(validPath, shell.readShortcutLink(validPath));
                } catch {
                    iconSource = validPath; // Unreadable shortcut: fall back to the .lnk's own icon
                }
            }
            // Only asks the OS for an icon; file contents are never read.
            const icon = await app.getFileIcon(iconSource, { size: 'large' });
            return icon.toDataURL();
        } catch (e) {
            console.error('Failed to get file icon:', e);
            return null;
        }
    });

    ipcMain.on('launch-file', async (_event, filePath) => {
        try {
            const target = classifyLaunchTarget(filePath);
            if (target.kind === 'deny') {
                console.error('Launch refused:', target.reason);
                return;
            }
            if (target.kind === 'url') {
                await openExternalChecked(filePath, target.decision);
                return;
            }
            if (target.kind === 'confirm-path') {
                const lang = await getUiLanguage();
                const message = t(lang, 'openNetworkLocation', { target: truncateForDialog(target.path) });
                const detail = t(lang, 'networkCredentialsRisk');
                if (!(await confirmWithUser(message, detail))) return;
            }
            const errorMessage = await shell.openPath(target.path);
            if (errorMessage) {
                console.error('Shell error opening path:', errorMessage);
            }
        } catch (e) {
            console.error('Failed to launch application / open link:', e);
        }
    });
}
