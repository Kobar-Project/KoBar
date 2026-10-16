// Import of .txt / .md files as notes (the "Import" button next to "+" and drag and drop onto the note panel). One note per file,
// titled by the file name. Decoding and the HTML conversion are in shared/textImport.ts; the notes are added with the store's addNotes.
import {
    TEXT_IMPORT_MAX_BYTES,
    decodeTextBytes,
    isImportableTextName,
    noteTitleFromFileName,
    textToNoteHtml,
    type IpcTextFile,
    type IpcTextReject,
} from '../../shared/textImport';
import type { TranslationKeys } from '../i18n';
import { useAppStore, type Note } from '../store/useAppStore';

export type NewNote = Omit<Note, 'id'>;

export function notesFromTextFiles(files: readonly IpcTextFile[]): NewNote[] {
    return files.map((file) => ({
        title: noteTitleFromFileName(file.name),
        icon: 'note',
        emoji: null,
        content: textToNoteHtml(decodeTextBytes(file.data)),
    }));
}

/** Drop: reads the importable files of a drop; the others are reported, nothing outside .txt / .md and the size limit is read. */
export async function readDroppedTextFiles(files: readonly File[]): Promise<{ files: IpcTextFile[]; rejected: IpcTextReject[] }> {
    const out: IpcTextFile[] = [];
    const rejected: IpcTextReject[] = [];
    for (const file of files) {
        if (!isImportableTextName(file.name)) rejected.push({ name: file.name, reason: 'unsupported' });
        else if (file.size > TEXT_IMPORT_MAX_BYTES) rejected.push({ name: file.name, reason: 'too-large' });
        else {
            try {
                out.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
            } catch {
                rejected.push({ name: file.name, reason: 'unreadable' });
            }
        }
    }
    return { files: out, rejected };
}

type Translate = (key: TranslationKeys) => string;

const REJECT_KEY = {
    'too-large': 'noteImportTooLarge',
    unsupported: 'noteImportUnsupported',
    unreadable: 'noteImportUnreadable',
} as const satisfies Record<IpcTextReject['reason'], TranslationKeys>;

/** The notification text: how many notes were added, then one line per skipped file with the reason. */
export function describeImport(t: Translate, imported: number, rejected: readonly IpcTextReject[]): string {
    const lines: string[] = [];
    if (imported > 0) lines.push(t('noteImportDone').replace('{count}', String(imported)));
    for (const r of rejected)
        lines.push(
            t(REJECT_KEY[r.reason])
                .replace('{name}', () => r.name)
                .replace('{limit}', String(TEXT_IMPORT_MAX_BYTES / (1024 * 1024)))
        );
    return lines.join('\n');
}

/** Adds the notes, tells the user what happened. Returns the number of notes added. */
export function finishTextImport(t: Translate, files: readonly IpcTextFile[], rejected: readonly IpcTextReject[]): number {
    const notes = notesFromTextFiles(files);
    if (notes.length > 0) useAppStore.getState().addNotes(notes);
    const body = describeImport(t, notes.length, rejected);
    if (body) window.api?.sendNotification?.(t('noteImport'), body);
    return notes.length;
}

/** The Import button: the main process shows the multi-select dialog and returns the checked files. */
export async function importTextFilesFromDialog(t: Translate): Promise<void> {
    const result = await window.api?.pickTextFiles?.();
    if (!result || result.canceled) return;
    finishTextImport(t, result.files, result.rejected);
}
