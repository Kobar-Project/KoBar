import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CUSTOM_ACCENT_PROPERTIES,
    DEFAULT_THEME_PREFS,
    SYSTEM_DARK_QUERY,
    applyThemeAttributes,
    deriveCustomAccent,
    readSystemScheme,
    startThemeSync,
    watchSystemScheme,
} from '../src/theme';

// T-504: root attributes and the OS scheme listener.

type Listener = (event: MediaQueryListEvent) => void;

/** Minimal controllable matchMedia: `setDark()` flips the OS scheme and fires 'change'. */
function installMatchMedia(initialDark: boolean) {
    let matches = initialDark;
    const listeners = new Set<Listener>();
    const query = {
        get matches() {
            return matches;
        },
        media: SYSTEM_DARK_QUERY,
        addEventListener: vi.fn((_type: string, l: Listener) => listeners.add(l)),
        removeEventListener: vi.fn((_type: string, l: Listener) => listeners.delete(l)),
    };
    const matchMedia = vi.fn(() => query as unknown as MediaQueryList);
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
    return {
        matchMedia,
        query,
        listeners,
        setDark(dark: boolean) {
            matches = dark;
            for (const l of [...listeners]) l({ matches: dark } as MediaQueryListEvent);
        },
    };
}

const root = () => document.documentElement;

beforeEach(() => {
    root().removeAttribute('data-scheme');
    root().removeAttribute('data-accent');
    root().removeAttribute('style');
});

afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('applyThemeAttributes', () => {
    it('applies the T-504 default: dark + amber, no inline accent properties', () => {
        const applied = applyThemeAttributes(root(), DEFAULT_THEME_PREFS);
        expect(applied).toEqual({ scheme: 'dark', accent: 'amber' });
        expect(root().getAttribute('data-scheme')).toBe('dark');
        expect(root().getAttribute('data-accent')).toBe('amber');
        for (const property of Object.values(CUSTOM_ACCENT_PROPERTIES)) expect(root().style.getPropertyValue(property)).toBe('');
    });

    it('sets a preset accent and the light scheme', () => {
        applyThemeAttributes(root(), { scheme: 'light', accent: 'green' });
        expect(root().getAttribute('data-scheme')).toBe('light');
        expect(root().getAttribute('data-accent')).toBe('green');
    });

    it('writes derived inline properties for a custom accent and removes them for a preset', () => {
        const values = deriveCustomAccent('#123456')!;
        applyThemeAttributes(root(), { scheme: 'dark', accent: 'custom', customAccent: '#123456' });
        expect(root().getAttribute('data-accent')).toBe('custom');
        expect(root().style.getPropertyValue('--kb-accent-dark')).toBe(values.dark);
        expect(root().style.getPropertyValue('--kb-on-accent-dark')).toBe(values.onDark);
        expect(root().style.getPropertyValue('--kb-accent-light')).toBe(values.light);
        expect(root().style.getPropertyValue('--kb-on-accent-light')).toBe(values.onLight);

        applyThemeAttributes(root(), { scheme: 'dark', accent: 'blue' });
        expect(root().getAttribute('data-accent')).toBe('blue');
        for (const property of Object.values(CUSTOM_ACCENT_PROPERTIES)) expect(root().style.getPropertyValue(property)).toBe('');
    });

    it('treats a custom hex equal to a preset as that preset', () => {
        applyThemeAttributes(root(), { scheme: 'dark', accent: 'custom', customAccent: '#F4A125' });
        expect(root().getAttribute('data-accent')).toBe('amber');
        expect(root().style.getPropertyValue('--kb-accent-dark')).toBe('');
    });

    it('leaves the legacy data-theme attribute and --theme-* variables alone', () => {
        root().setAttribute('data-theme', 'ocean');
        root().style.setProperty('--theme-primary', '#38bdf8');
        applyThemeAttributes(root(), { scheme: 'light', accent: 'custom', customAccent: '#123456' });
        expect(root().getAttribute('data-theme')).toBe('ocean');
        expect(root().style.getPropertyValue('--theme-primary')).toBe('#38bdf8');
        root().removeAttribute('data-theme');
    });

    it('resolves "system" through prefers-color-scheme', () => {
        installMatchMedia(false);
        expect(readSystemScheme()).toBe('light');
        expect(applyThemeAttributes(root(), { scheme: 'system', accent: 'amber' }).scheme).toBe('light');
        expect(root().getAttribute('data-scheme')).toBe('light');
    });

    it('falls back to dark when matchMedia is unavailable', () => {
        expect(typeof window.matchMedia).not.toBe('function');
        expect(readSystemScheme()).toBe('dark');
        applyThemeAttributes(root(), { scheme: 'system', accent: 'amber' });
        expect(root().getAttribute('data-scheme')).toBe('dark');
    });
});

describe('system scheme listener', () => {
    it('watchSystemScheme reports changes and unsubscribes', () => {
        const mm = installMatchMedia(true);
        const onChange = vi.fn();
        const stop = watchSystemScheme(onChange);
        expect(mm.matchMedia).toHaveBeenCalledWith(SYSTEM_DARK_QUERY);
        mm.setDark(false);
        expect(onChange).toHaveBeenLastCalledWith('light');
        stop();
        expect(mm.listeners.size).toBe(0);
        mm.setDark(true);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('watchSystemScheme is a no-op without matchMedia', () => {
        const stop = watchSystemScheme(vi.fn());
        expect(() => stop()).not.toThrow();
    });

    it('startThemeSync follows the OS for "system" and cleans up', () => {
        const mm = installMatchMedia(true);
        const stop = startThemeSync(root(), { scheme: 'system', accent: 'violet' });
        expect(root().getAttribute('data-scheme')).toBe('dark');
        expect(root().getAttribute('data-accent')).toBe('violet');
        mm.setDark(false);
        expect(root().getAttribute('data-scheme')).toBe('light');
        mm.setDark(true);
        expect(root().getAttribute('data-scheme')).toBe('dark');
        stop();
        expect(mm.query.removeEventListener).toHaveBeenCalledTimes(1);
        mm.setDark(false);
        expect(root().getAttribute('data-scheme')).toBe('dark');
    });

    it('startThemeSync does not listen for a fixed scheme', () => {
        const mm = installMatchMedia(false);
        const stop = startThemeSync(root(), DEFAULT_THEME_PREFS);
        expect(root().getAttribute('data-scheme')).toBe('dark');
        expect(mm.query.addEventListener).not.toHaveBeenCalled();
        mm.setDark(false);
        expect(root().getAttribute('data-scheme')).toBe('dark');
        stop();
    });
});
