// T-315: the save-note-as-text handler, moved unchanged out of main.cts.
import { dialog, ipcMain } from 'electron';
import * as fs from 'fs';
import { dialogDefaultPath, readDialogPathsFile, recordDialogPick } from '../../lib/dialogPaths.cjs';
import { noteFileBaseName, toCrlf } from '../../lib/noteFileName.cjs';
import { appState } from '../state.cjs';

export function registerNoteExportIpc(deps: { dialogPathsFile: string }): void {
    const { dialogPathsFile } = deps;

    ipcMain.handle('save-note-as-text', async (_event, { title, content }) => {
        if (!appState.mainWindow) return { success: false, reason: 'No main window' };

        // The default file name is the note title (only characters Windows forbids are replaced).
        const safeTitle = noteFileBaseName(title);

        try {
            const { canceled, filePath } = await dialog.showSaveDialog(appState.mainWindow, {
                title: 'Save Note As Text',
                // T-037: reopen in the folder used last time (falls back to the bare file name).
                defaultPath: await dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'save-note-text', `${safeTitle}.txt`),
                filters: [
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] },
                ],
            });

            if (canceled || !filePath) {
                return { success: false, reason: 'Canceled' };
            }

            await fs.promises.writeFile(filePath, toCrlf(String(content ?? '')), 'utf8');
            recordDialogPick(dialogPathsFile, 'save-note-text', filePath);
            return { success: true, path: filePath };
        } catch (err: any) {
            console.error('Failed to save note:', err);
            return { success: false, reason: err.message || 'Unknown error' };
        }
    });
}
