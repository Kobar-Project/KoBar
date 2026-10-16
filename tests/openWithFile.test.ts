import { describe, expect, it } from 'vitest';
import { OPEN_FILE_ARGS_LIMIT, textFileArgs } from '../electron/lib/openFileArgs.cjs';

describe('textFileArgs', () => {
    const exe = 'C:\\Program Files\\KoBar\\KoBar.exe';

    it('takes absolute .txt paths and skips the executable, flags and other files', () => {
        expect(textFileArgs([exe, '--hidden', 'C:\\Users\\a\\notes.txt', 'C:\\Users\\a\\pic.png'], 'win32')).toEqual([
            'C:\\Users\\a\\notes.txt',
        ]);
    });

    it('skips relative paths, bare extensions, device paths, alternate data streams and device names', () => {
        const bad = ['notes.txt', '.', 'C:\\x\\.txt', '\\\\.\\C:\\a.txt', 'C:\\x\\a.txt:evil', 'C:\\x\\CON.txt'];
        expect(textFileArgs([exe, ...bad], 'win32')).toEqual([]);
    });

    it('dev run: electron and the app folder are not files', () => {
        expect(textFileArgs(['C:\\electron.exe', '.', 'D:\\docs\\a.md'], 'win32')).toEqual(['D:\\docs\\a.md']);
    });

    it('removes duplicates and caps the count', () => {
        expect(textFileArgs([exe, 'C:\\a.txt', 'C:\\a.txt'], 'win32')).toEqual(['C:\\a.txt']);
        const many = Array.from({ length: OPEN_FILE_ARGS_LIMIT + 5 }, (_, i) => `C:\\f${i}.txt`);
        expect(textFileArgs([exe, ...many], 'win32')).toHaveLength(OPEN_FILE_ARGS_LIMIT);
    });
});
