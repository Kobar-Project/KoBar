import { describe, expect, it, vi } from 'vitest';
import { DEV_SHORTCUT_NAME, ensureDevShortcut, type DevShortcutDeps, type ShortcutDetails } from '../electron/lib/devShortcut.cjs';

function deps(over: Partial<DevShortcutDeps> = {}): DevShortcutDeps {
    return {
        platform: 'win32',
        programsDir: 'C:/Programs',
        execPath: 'C:/app/electron.exe',
        appPath: 'D:/kobar',
        iconPath: 'D:/kobar/build/icon.ico',
        aumid: 'com.eedali.kobar.dev',
        join: (...p) => p.join('/'),
        readShortcut: () => null,
        writeShortcut: () => true,
        ...over,
    };
}

describe('ensureDevShortcut', () => {
    it('skips off Windows', () => {
        const write = vi.fn();
        expect(ensureDevShortcut(deps({ platform: 'linux', writeShortcut: write }))).toBe('skipped');
        expect(write).not.toHaveBeenCalled();
    });

    it('creates the shortcut with the AUMID and icon', () => {
        const write = vi.fn<(f: string, d: ShortcutDetails) => boolean>(() => true);
        expect(ensureDevShortcut(deps({ writeShortcut: write }))).toBe('created');
        const [file, details] = write.mock.calls[0];
        expect(file).toBe(`C:/Programs/${DEV_SHORTCUT_NAME}`);
        expect(details.appUserModelId).toBe('com.eedali.kobar.dev');
        expect(details.icon).toBe('D:/kobar/build/icon.ico');
        expect(details.args).toBe('"D:/kobar"');
    });

    it('leaves an identical shortcut alone and updates a stale one', () => {
        const same: ShortcutDetails = {
            target: 'C:/app/electron.exe',
            args: '"D:/kobar"',
            icon: 'D:/kobar/build/icon.ico',
            appUserModelId: 'com.eedali.kobar.dev',
        };
        const write = vi.fn(() => true);
        expect(ensureDevShortcut(deps({ readShortcut: () => same, writeShortcut: write }))).toBe('unchanged');
        expect(write).not.toHaveBeenCalled();
        expect(ensureDevShortcut(deps({ readShortcut: () => ({ ...same, appUserModelId: 'x' }), writeShortcut: write }))).toBe('updated');
    });

    it('never throws', () => {
        const boom = (): boolean => {
            throw new Error('boom');
        };
        expect(ensureDevShortcut(deps({ writeShortcut: boom }))).toBe('failed');
        expect(ensureDevShortcut(deps({ writeShortcut: () => false }))).toBe('failed');
    });
});
