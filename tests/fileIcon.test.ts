import { describe, expect, it } from 'vitest';
import { pickShortcutIconSource, validateIconPath } from '../electron/lib/fileIcon.cjs';

const abs = process.platform === 'win32' ? 'C:\\Apps\\a&b.exe' : '/apps/a&b.exe';

describe('validateIconPath', () => {
    it('accepts absolute paths, including shell metacharacters', () => {
        expect(validateIconPath(abs)).toBe(abs);
    });
    it('rejects non-strings, empty, relative, NUL and overlong input', () => {
        expect(validateIconPath(undefined)).toBeNull();
        expect(validateIconPath(42)).toBeNull();
        expect(validateIconPath('')).toBeNull();
        expect(validateIconPath('relative/a.lnk')).toBeNull();
        expect(validateIconPath(abs + '\0')).toBeNull();
        expect(validateIconPath(abs + 'a'.repeat(5000))).toBeNull();
    });
    it('rejects UNC paths', () => {
        expect(validateIconPath('\\\\host\\share\\a.exe')).toBeNull();
        expect(validateIconPath('//host/share/a.exe')).toBeNull();
    });
});

describe('pickShortcutIconSource', () => {
    const lnk = abs.replace('.exe', '.lnk');
    const other = abs.replace('a&b', 'icon');
    it('uses the target and ignores the icon field', () => {
        expect(pickShortcutIconSource(lnk, { target: abs, icon: other } as never)).toBe(abs);
    });
    it('falls back to the shortcut itself without a usable target', () => {
        expect(pickShortcutIconSource(lnk, { target: '' })).toBe(lnk);
        expect(pickShortcutIconSource(lnk, {})).toBe(lnk);
        expect(pickShortcutIconSource(lnk, null)).toBe(lnk);
        expect(pickShortcutIconSource(lnk, { target: 'relative.exe' })).toBe(lnk);
    });
    it('falls back for unexpanded env vars and UNC targets', () => {
        expect(pickShortcutIconSource(lnk, { target: '%FOO%/x.exe' })).toBe(lnk);
        expect(pickShortcutIconSource(lnk, { target: '\\\\host\\share\\x.exe' })).toBe(lnk);
        expect(pickShortcutIconSource(lnk, { target: '//host/share/x.exe' })).toBe(lnk);
    });
    it('does not reject a lone percent sign', () => {
        const p = process.platform === 'win32' ? 'C:\\100% Tools\\app.exe' : '/100% Tools/app.exe';
        expect(pickShortcutIconSource(lnk, { target: p })).toBe(p);
    });
});
