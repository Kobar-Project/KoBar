import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readTextFileForImport } from '../electron/lib/textImportFiles.cjs';
import { TEXT_IMPORT_MAX_BYTES, decodeTextBytes, isImportableTextName, noteTitleFromFileName, textToNoteHtml } from '../shared/textImport';

// The real store touches window at import time; only the pure helpers are under test here.
vi.mock('../src/store/useAppStore', () => ({ useAppStore: { getState: () => ({ addNotes: () => {} }) } }));
const { describeImport, notesFromTextFiles, readDroppedTextFiles } = await import('../src/notes/importTextFiles');

const bytes = (...n: number[]) => new Uint8Array(n);
const utf16le = (s: string, bom: boolean) => {
    const out = new Uint8Array((s.length + (bom ? 1 : 0)) * 2);
    const view = new DataView(out.buffer);
    let o = 0;
    if (bom) view.setUint16(o++ * 2, 0xfeff, true);
    for (let i = 0; i < s.length; i++) view.setUint16(o++ * 2, s.charCodeAt(i), true);
    return out;
};

describe('decodeTextBytes', () => {
    it('reads UTF-8 with and without a BOM', () => {
        const text = 'Şğüıöç İ - 日本';
        const plain = new TextEncoder().encode(text);
        expect(decodeTextBytes(plain)).toBe(text);
        expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...plain]))).toBe(text);
    });

    it('reads UTF-16 LE with a BOM, UTF-16 BE with a BOM and UTF-16 LE without a BOM', () => {
        expect(decodeTextBytes(utf16le('Merhaba dünya', true))).toBe('Merhaba dünya');
        const be = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
        expect(decodeTextBytes(be)).toBe('Hi');
        expect(decodeTextBytes(utf16le('Plain ascii text in utf16', false))).toBe('Plain ascii text in utf16');
    });

    it('falls back to Windows-1254 for Turkish ANSI files', () => {
        // "Şğüıöç İ" in Windows-1254: Ş=DE ğ=F0 ü=FC ı=FD ö=F6 ç=E7 space İ=DD
        expect(decodeTextBytes(bytes(0xde, 0xf0, 0xfc, 0xfd, 0xf6, 0xe7, 0x20, 0xdd))).toBe('Şğüıöç İ');
    });

    it('decodes an empty file to an empty string', () => {
        expect(decodeTextBytes(new Uint8Array())).toBe('');
    });
});

describe('names and html', () => {
    it('accepts .txt and .md only', () => {
        expect(isImportableTextName('a.txt')).toBe(true);
        expect(isImportableTextName('README.MD')).toBe(true);
        expect(isImportableTextName('a.txt.exe')).toBe(false);
        expect(isImportableTextName('.txt')).toBe(false);
        expect(isImportableTextName('a.zip')).toBe(false);
    });

    it('titles the note by the file name without the extension', () => {
        expect(noteTitleFromFileName('Alışveriş listesi.txt')).toBe('Alışveriş listesi');
        expect(noteTitleFromFileName('C:\\x\\notes.v2.md')).toBe('notes.v2');
    });

    it('turns text into escaped paragraphs and keeps blank lines', () => {
        expect(textToNoteHtml('a <b> & c\r\n\r\nz')).toBe('<p>a &lt;b&gt; &amp; c</p><p></p><p>z</p>');
    });

    it('builds one note per file', () => {
        const notes = notesFromTextFiles([
            { name: 'one.txt', data: new TextEncoder().encode('x') },
            { name: 'two.md', data: new TextEncoder().encode('y') },
        ]);
        expect(notes.map((n) => n.title)).toEqual(['one', 'two']);
        expect(notes[0]).toMatchObject({ icon: 'note', emoji: null, content: '<p>x</p>' });
    });
});

describe('describeImport', () => {
    const t = (key: string) =>
        ({
            noteImportDone: '{count} imported',
            noteImportTooLarge: '{name} is over {limit} MB',
            noteImportUnsupported: '{name} unsupported',
            noteImportUnreadable: '{name} unreadable',
        })[key] ?? key;

    it('lists the count and one line per skipped file with the limit in MB', () => {
        const text = describeImport(t as never, 2, [
            { name: 'big.txt', reason: 'too-large' },
            { name: 'a.zip', reason: 'unsupported' },
        ]);
        expect(text).toBe('2 imported\nbig.txt is over 5 MB\na.zip unsupported');
        expect(describeImport(t as never, 0, [])).toBe('');
    });
});

describe('readDroppedTextFiles', () => {
    it('reads text files, rejects other types and files over the limit without reading them', async () => {
        const ok = new File(['hello'], 'a.txt');
        const zip = new File(['x'], 'a.zip');
        const big = new File(['x'], 'big.md');
        Object.defineProperty(big, 'size', { value: TEXT_IMPORT_MAX_BYTES + 1 });
        const result = await readDroppedTextFiles([ok, zip, big]);
        expect(result.files.map((f) => f.name)).toEqual(['a.txt']);
        expect(result.rejected).toEqual([
            { name: 'a.zip', reason: 'unsupported' },
            { name: 'big.md', reason: 'too-large' },
        ]);
    });
});

describe('readTextFileForImport (main process checks)', () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'kobar-import-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const file = (name: string, content: string | Buffer) => {
        const p = nodePath.join(dir, name);
        writeFileSync(p, content);
        return p;
    };

    it('reads a valid .txt', async () => {
        const result = await readTextFileForImport(file('ok.txt', 'hi'));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.file).toMatchObject({ name: 'ok.txt', data: new Uint8Array([104, 105]) });
    });

    it('rejects a wrong extension, a folder, a missing file, a relative path and a non-string', async () => {
        expect(await readTextFileForImport(file('a.exe', 'x'))).toMatchObject({ ok: false, reason: 'unsupported' });
        const folder = nodePath.join(dir, 'folder.txt');
        mkdirSync(folder);
        expect(await readTextFileForImport(folder)).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(await readTextFileForImport(nodePath.join(dir, 'missing.txt'))).toMatchObject({ ok: false, reason: 'unreadable' });
        expect(await readTextFileForImport('relative.txt')).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(await readTextFileForImport(42)).toMatchObject({ ok: false, reason: 'unsupported' });
    });

    it('rejects a file over the limit', async () => {
        const p = file('big.txt', Buffer.alloc(11));
        expect(await readTextFileForImport(p, 10)).toMatchObject({ ok: false, name: 'big.txt', reason: 'too-large' });
        expect((await readTextFileForImport(p, 11)).ok).toBe(true);
    });
});
