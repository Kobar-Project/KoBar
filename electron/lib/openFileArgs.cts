// "Open with KoBar": picks the text files out of a command line (the first launch's process.argv or a second instance's argv). Only
// plain absolute paths with an importable extension qualify; flags, "." and the electron/app paths of a dev run fall out by themselves.
// The files are then read and checked by readTextFileForImport. No Electron imports.
import { isPlainAbsolutePath } from './fileArgs.cjs';
import { isImportableTextName } from '../../shared/textImport.js';

/** At most this many files are taken from one command line (Explorer passes every selected file to a single launch). */
export const OPEN_FILE_ARGS_LIMIT = 20;

export function textFileArgs(argv: readonly string[], platform: string = process.platform): string[] {
    const found: string[] = [];
    for (const arg of argv.slice(1)) {
        if (typeof arg !== 'string' || arg.startsWith('-')) continue;
        if (!isPlainAbsolutePath(arg, platform)) continue;
        const base = arg.split(/[\\/]/).pop() ?? '';
        if (!isImportableTextName(base)) continue;
        if (!found.includes(arg)) found.push(arg);
        if (found.length >= OPEN_FILE_ARGS_LIMIT) break;
    }
    return found;
}
