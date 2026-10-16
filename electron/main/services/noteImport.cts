// "Import notes" button: a multi-select open dialog for .txt / .md files. The files are read and checked here (size, type) and the
// bytes go to the renderer, which decodes them and creates one note per file.
import { dialog, ipcMain } from 'electron';
import { dialogDefaultPath, readDialogPathsFile, recordDialogPick } from '../../lib/dialogPaths.cjs';
import { readTextFileForImport } from '../../lib/textImportFiles.cjs';
import type { IpcTextFile, IpcTextPickResult, IpcTextReject } from '../../../shared/textImport.js';
import { appState } from '../state.cjs';

export function registerNoteImportIpc(deps: { dialogPathsFile: string }): void {
    const { dialogPathsFile } = deps;
    const none: IpcTextPickResult = { canceled: true, files: [], rejected: [] };

    ipcMain.handle('pick-text-files', async (event): Promise<IpcTextPickResult> => {
        const win = appState.mainWindow;
        if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return none;
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            defaultPath: await dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'import-notes'),
            filters: [
                { name: 'Text / Markdown', extensions: ['txt', 'md'] },
                { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile', 'multiSelections'],
        });
        if (canceled || filePaths.length === 0) return none;
        recordDialogPick(dialogPathsFile, 'import-notes', filePaths[0]);
        const files: IpcTextFile[] = [];
        const rejected: IpcTextReject[] = [];
        for (const filePath of filePaths) {
            const read = await readTextFileForImport(filePath);
            if (read.ok) files.push(read.file);
            else rejected.push({ name: read.name, reason: read.reason });
        }
        return { canceled: false, files, rejected };
    });
}
