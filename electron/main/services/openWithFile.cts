// "Open with KoBar" for .txt files: the paths come from the launch arguments (first start or second-instance). Each file is checked and
// read here (readTextFileForImport) and parked in a queue; the renderer collects the queue with `take-open-text-files` when it is ready
// (and is told with `open-text-files-available` when more arrive). The original file is never written: the renderer makes a new note.
import { ipcMain } from 'electron';
import { textFileArgs } from '../../lib/openFileArgs.cjs';
import { readTextFileForImport } from '../../lib/textImportFiles.cjs';
import type { IpcTextFile, IpcTextReject } from '../../../shared/textImport.js';
import { appState } from '../state.cjs';

let pendingFiles: IpcTextFile[] = [];
let pendingRejected: IpcTextReject[] = [];

/** Reads the text files named in `argv` and queues them for the renderer. Safe to call with any argv. */
export async function queueOpenFileArgs(argv: readonly string[]): Promise<void> {
    const paths = textFileArgs(argv);
    if (paths.length === 0) return;
    for (const filePath of paths) {
        const read = await readTextFileForImport(filePath);
        if (read.ok) pendingFiles.push(read.file);
        else pendingRejected.push({ name: read.name, reason: read.reason });
    }
    const win = appState.mainWindow;
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('open-text-files-available');
}

export function registerOpenWithFileIpc(): void {
    ipcMain.handle('take-open-text-files', (event) => {
        const win = appState.mainWindow;
        if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return { files: [], rejected: [] };
        const result = { files: pendingFiles, rejected: pendingRejected };
        pendingFiles = [];
        pendingRejected = [];
        return result;
    });
    void queueOpenFileArgs(process.argv);
}
