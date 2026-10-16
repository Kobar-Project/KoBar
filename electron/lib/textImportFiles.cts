// Reads one file for "import as note" / "Open with KoBar" after checking it: a plain absolute path, a .txt/.md name, a regular file
// (not a folder, device or broken link) within the size limit. Only the checked bytes go to the renderer. No Electron imports.
import * as fs from 'fs';
import * as nodePath from 'path';
import { isPlainAbsolutePath } from './fileArgs.cjs';
import { TEXT_IMPORT_MAX_BYTES, isImportableTextName, type IpcTextFile, type IpcTextReject } from '../../shared/textImport.js';

export type ReadTextFileResult = { ok: true; file: IpcTextFile } | ({ ok: false } & IpcTextReject);

export async function readTextFileForImport(filePath: unknown, maxBytes: number = TEXT_IMPORT_MAX_BYTES): Promise<ReadTextFileResult> {
    const name = typeof filePath === 'string' ? nodePath.basename(filePath) : '';
    const fail = (reason: IpcTextReject['reason']): ReadTextFileResult => ({ ok: false, name, reason });
    if (!isPlainAbsolutePath(filePath) || !isImportableTextName(name)) return fail('unsupported');
    try {
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) return fail('unsupported');
        if (stat.size > maxBytes) return fail('too-large');
        const data = await fs.promises.readFile(filePath);
        // The size can change between stat and read; the limit applies to what was actually read.
        if (data.length > maxBytes) return fail('too-large');
        return { ok: true, file: { name, data: new Uint8Array(data.buffer, data.byteOffset, data.length) } };
    } catch {
        return fail('unreadable');
    }
}
