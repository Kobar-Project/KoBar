import { describe, expect, it } from 'vitest';
import { noteFileBaseName, toCrlf } from '../electron/lib/noteFileName.cjs';

describe('noteFileBaseName', () => {
    it('keeps the note title, including non-ASCII letters', () => {
        expect(noteFileBaseName('Alışveriş Listesi')).toBe('Alışveriş Listesi');
        expect(noteFileBaseName('日本語のメモ')).toBe('日本語のメモ');
    });

    it('replaces only characters Windows forbids and trims trailing dots and spaces', () => {
        expect(noteFileBaseName('a/b:c*d?"e<f>g|h\\i')).toBe('a b c d e f g h i');
        expect(noteFileBaseName('  report... ')).toBe('report');
    });

    it('falls back for empty, reserved and non-string titles and caps the length', () => {
        expect(noteFileBaseName('')).toBe('note');
        expect(noteFileBaseName('///')).toBe('note');
        expect(noteFileBaseName('CON')).toBe('note');
        expect(noteFileBaseName(undefined)).toBe('note');
        expect(noteFileBaseName('x'.repeat(300))).toHaveLength(100);
    });
});

describe('toCrlf', () => {
    it('normalises every line break to CRLF once', () => {
        expect(toCrlf('a\nb\r\nc')).toBe('a\r\nb\r\nc');
    });
});
