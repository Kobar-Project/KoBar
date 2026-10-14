import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSafeId, resolveInside, resolveInsideWith } from '../electron/lib/paths.cjs';

// The 13 official plugin folder ids (extension manifest ids as installed in userData/extensions).
const OFFICIAL_IDS = [
    'com.kobar.aihub',
    'com.kobar.calculator.plugin',
    'com.kobar.clipboardmanager',
    'com.kobar.kobox',
    'focus-mode-plugin',
    'ko-calender-plugin',
    'kobar-colorpicker-plugin',
    'kobar.shortcuts',
    'koplayer-plugin',
    'pin-window-to-top',
    'screenshot-studio-overlay',
    'snippetvault-plugin',
    'todolist-plugin',
];
// Not official, but must stay valid.
const EXTRA_IDS = ['eedali-emoji-picker'];

describe('isSafeId', () => {
    it('accepts the 13 official plugin ids', () => {
        expect(OFFICIAL_IDS).toHaveLength(13);
        for (const id of OFFICIAL_IDS) expect(isSafeId(id), id).toBe(true);
    });
    it('accepts the Emoji Picker id', () => {
        for (const id of EXTRA_IDS) expect(isSafeId(id), id).toBe(true);
    });
    it('accepts boundary lengths', () => {
        expect(isSafeId('ab')).toBe(true);
        expect(isSafeId('a'.repeat(64))).toBe(true);
    });
    it.each([
        ['empty', ''],
        ['1 char', 'a'],
        ['65 chars', 'a'.repeat(65)],
        ['uppercase', 'Abc'],
        ['dotdot', 'a..b'],
        ['only dotdot', '..'],
        ['slash', 'a/b'],
        ['backslash', 'a\\b'],
        ['leading dot', '.abc'],
        ['leading dash', '-abc'],
        ['unicode', 'ab\u00e7'],
        ['space', 'a b'],
        ['newline', 'ab\n'],
        ['NUL', 'ab\0c'],
        ['trailing dot', 'abc.'],
        ['reserved con', 'con'],
        ['reserved con.txt', 'con.txt'],
        ['reserved com1', 'com1'],
        ['reserved lpt9.x', 'lpt9.x'],
        ['reserved nul', 'nul'],
        ['reserved aux', 'aux'],
        ['reserved prn', 'prn'],
    ])('rejects %s', (_n, id) => {
        expect(isSafeId(id)).toBe(false);
    });
    it('rejects non-strings', () => {
        for (const v of [undefined, null, 1, {}, [], ['ab'], true]) expect(isSafeId(v)).toBe(false);
    });
});

describe('resolveInside (host path)', () => {
    const base = path.resolve('/tmp/kobar-base');
    it('treats base itself as inside', () => {
        expect(resolveInside(base)).toBe(base);
        expect(resolveInside(base, '.')).toBe(base);
        expect(resolveInside(base, 'a', '..')).toBe(base);
    });
    it('resolves nested children, with trailing separators', () => {
        expect(resolveInside(base, 'a', 'b.txt')).toBe(path.join(base, 'a', 'b.txt'));
        expect(resolveInside(base + path.sep, 'a' + path.sep)).toBe(path.join(base, 'a'));
    });
    it('rejects traversal and absolute children', () => {
        expect(resolveInside(base, '..')).toBeNull();
        expect(resolveInside(base, '../x')).toBeNull();
        expect(resolveInside(base, 'a/../../x')).toBeNull();
        expect(resolveInside(base, path.resolve('/etc/passwd'))).toBeNull();
    });
    it('rejects sibling with shared prefix', () => {
        expect(resolveInside(base, '..', 'kobar-base2')).toBeNull();
    });
    it('rejects a relative base', () => {
        expect(resolveInside('rel/base', 'a')).toBeNull();
    });
    it('rejects NUL bytes and bad input', () => {
        expect(resolveInside(base, 'a\0b')).toBeNull();
        expect(resolveInside('', 'a')).toBeNull();
    });
});

describe('resolveInsideWith (win32 semantics)', () => {
    const w = path.win32;
    const base = 'C:\\Users\\me\\ext';
    const r = (...c: string[]) => resolveInsideWith(w, base, c);
    it('allows children and base itself, case-insensitively', () => {
        expect(r()).toBe(base);
        expect(r('a', 'b')).toBe('C:\\Users\\me\\ext\\a\\b');
        expect(resolveInsideWith(w, 'c:\\users\\ME\\EXT\\', ['A'])).toBe('c:\\users\\ME\\EXT\\A');
    });
    it('rejects traversal in both slash styles', () => {
        expect(r('..')).toBeNull();
        expect(r('..\\x')).toBeNull();
        expect(r('a/../../x')).toBeNull();
    });
    it('rejects absolute, drive-relative, rooted and UNC children', () => {
        expect(r('C:\\Windows')).toBeNull();
        expect(r('D:\\x')).toBeNull();
        expect(r('C:foo')).toBeNull();
        expect(r('\\foo')).toBeNull();
        expect(r('\\\\host\\share\\x')).toBeNull();
        expect(r('//host/share/x')).toBeNull();
    });
    it('rejects a sibling sharing a prefix and walking above the root', () => {
        expect(r('..', 'ext2')).toBeNull();
        expect(r('..', '..', '..', '..')).toBeNull();
    });
    it('does not fold Unicode (Kelvin sign) as ASCII k', () => {
        const kb = 'C:\\Users\\me\\KoBar\\extensions';
        expect(resolveInsideWith(w, kb, ['..', '..', '\u212Aobar', 'x'])).toBeNull();
        expect(resolveInsideWith(w, kb, ['..', '..', 'KoBar', 'extensions', 'evil'])).toBe(kb + '\\evil');
        expect(resolveInsideWith(w, 'C:\\Users\\me\\\u212Aobar', ['..', 'Kobar', 'x'])).toBeNull();
    });
    it('handles a drive-root base', () => {
        expect(resolveInsideWith(w, 'C:\\', ['a'])).toBe('C:\\a');
        expect(resolveInsideWith(w, 'C:\\', ['..'])).toBe('C:\\');
    });
    it('rejects a relative base', () => {
        expect(resolveInsideWith(w, 'C:foo', ['a'])).toBeNull();
    });
    it('rejects NUL', () => {
        expect(r('a\0')).toBeNull();
    });
});
