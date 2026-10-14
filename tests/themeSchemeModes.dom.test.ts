import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettingsMirror } from '../src/settings/mirror';
import { startSettingsAppearanceSync } from '../src/settings/appearance';
import { SYSTEM_DARK_QUERY, startThemeSync } from '../src/theme';
import { effectiveThemePrefs } from '../src/theme/root';

// R-02: System / Light / Dark all render (the old dark-only clamp is gone), in the main window helpers and in the Settings window.

type Listener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialDark: boolean) {
    let matches = initialDark;
    const listeners = new Set<Listener>();
    const query = {
        get matches() {
            return matches;
        },
        media: SYSTEM_DARK_QUERY,
        addEventListener: (_type: string, l: Listener) => listeners.add(l),
        removeEventListener: (_type: string, l: Listener) => listeners.delete(l),
    };
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(() => query) });
    return {
        listeners,
        setDark(next: boolean) {
            matches = next;
            for (const l of [...listeners]) l({ matches } as MediaQueryListEvent);
        },
    };
}

afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
});

const source = { accent: 'amber' as const, customThemeColor: '#3a7bd5' };

describe('effectiveThemePrefs', () => {
    it('renders every stored scheme once ready and the dark default before', () => {
        for (const scheme of ['system', 'light', 'dark'] as const) {
            expect(effectiveThemePrefs(true, { ...source, scheme }).scheme).toBe(scheme);
            expect(effectiveThemePrefs(false, { ...source, scheme }).scheme).toBe('dark');
        }
    });
});

describe('startThemeSync with the main-window prefs', () => {
    it('light stays light and ignores the OS', () => {
        installMatchMedia(true);
        const root = document.createElement('div');
        const stop = startThemeSync(root, { scheme: 'light', accent: 'amber' });
        expect(root.getAttribute('data-scheme')).toBe('light');
        stop();
    });

    it('system follows the OS live and stops after cleanup', () => {
        const os = installMatchMedia(false);
        const root = document.createElement('div');
        const stop = startThemeSync(root, { scheme: 'system', accent: 'amber' });
        expect(root.getAttribute('data-scheme')).toBe('light');
        os.setDark(true);
        expect(root.getAttribute('data-scheme')).toBe('dark');
        os.setDark(false);
        expect(root.getAttribute('data-scheme')).toBe('light');
        stop();
        expect(os.listeners.size).toBe(0);
    });
});

describe('Settings window appearance sync', () => {
    function snapshot(scheme: string) {
        return {
            seq: 1,
            ack: 0,
            state: { scheme, accent: 'amber', customThemeColor: '#3a7bd5', material: 'solid', density: 'normal', design: 'style1' },
        };
    }

    it('applies a mirrored light scheme and a later change to dark', () => {
        installMatchMedia(true);
        const mirror = createSettingsMirror(null);
        const root = document.createElement('div');
        const stop = startSettingsAppearanceSync(mirror.store, root);
        expect(root.getAttribute('data-scheme')).toBe('dark');
        mirror.receive(snapshot('light') as never);
        expect(root.getAttribute('data-scheme')).toBe('light');
        mirror.receive({ ...snapshot('dark'), seq: 2 } as never);
        expect(root.getAttribute('data-scheme')).toBe('dark');
        stop();
    });

    it('a mirrored system scheme follows the OS change event', () => {
        const os = installMatchMedia(true);
        const mirror = createSettingsMirror(null);
        const root = document.createElement('div');
        const stop = startSettingsAppearanceSync(mirror.store, root);
        mirror.receive(snapshot('system') as never);
        expect(root.getAttribute('data-scheme')).toBe('dark');
        os.setDark(false);
        expect(root.getAttribute('data-scheme')).toBe('light');
        stop();
        expect(os.listeners.size).toBe(0);
    });
});
