// T-315: the save-note-as-text handler, moved unchanged out of main.cts.
import { dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import { dialogDefaultPath, readDialogPathsFile, recordDialogPick } from '../../lib/dialogPaths.cjs';
import { appState } from '../state.cjs';

export function registerNoteExportIpc(deps: { dialogPathsFile: string }): void {
    const { dialogPathsFile } = deps;

    ipcMain.handle('save-note-as-text', async (_event, { title, content }) => {
        if (!appState.mainWindow) return { success: false, reason: 'No main window' };

        // Sanitize title for filename
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        try {
            const { canceled, filePath } = await dialog.showSaveDialog(appState.mainWindow, {
                title: 'Save Note As Text',
                // T-037: reopen in the folder used last time (falls back to the bare file name).
                defaultPath: await dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'save-note-text', `${safeTitle || 'note'}.txt`),
                filters: [
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });

            if (canceled || !filePath) {
                return { success: false, reason: 'Canceled' };
            }

            await fs.promises.writeFile(filePath, content, 'utf8');
            recordDialogPick(dialogPathsFile, 'save-note-text', filePath);
            return { success: true, path: filePath };
        } catch (err: any) {
            console.error('Failed to save note:', err);
            return { success: false, reason: err.message || 'Unknown error' };
        }
    });
}
