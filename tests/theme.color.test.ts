import { describe, expect, it } from 'vitest';
import {
    MIN_ACCENT_CONTRAST,
    PRESET_ACCENT_VALUES,
    SHELL_DARK,
    SHELL_LIGHT,
    contrastRatio,
    deriveCustomAccent,
    matchPresetAccent,
    normalizeHex,
    onAccentFor,
    relativeLuminance,
} from '../src/theme/color';
import { resolveAccent, resolveScheme } from '../src/theme/apply';

// T-504: colour math behind the "Custom…" accent.
describe('theme colour math', () => {
    it('normalises hex input', () => {
        expect(normalizeHex('#F4A125')).toBe('#f4a125');
        expect(normalizeHex('f4a125')).toBe('#f4a125');
        expect(normalizeHex(' #abc ')).toBe('#aabbcc');
        expect(normalizeHex('#12345')).toBeNull();
        expect(normalizeHex('red')).toBeNull();
        expect(normalizeHex(null)).toBeNull();
        expect(normalizeHex(undefined)).toBeNull();
    });

    it('computes WCAG luminance and contrast', () => {
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
        expect(relativeLuminance('#000000')).toBe(0);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        // White on amber is only 2.11:1.
        expect(contrastRatio('#ffffff', '#f4a125')).toBeCloseTo(2.11, 1);
    });

    it('picks the on-accent colour by higher contrast, not by a luminance > 0.5 rule', () => {
        expect(onAccentFor('#f4a125')).toBe('#000000'); // luminance 0.449 but dark text wins
        expect(onAccentFor('#0067c0')).toBe('#ffffff');
        expect(onAccentFor('#ffffff')).toBe('#000000');
        expect(onAccentFor('#000000')).toBe('#ffffff');
    });

    it('keeps the preset table in sync with its own contrast guarantees', () => {
        for (const [id, v] of Object.entries(PRESET_ACCENT_VALUES)) {
            expect(contrastRatio(v.dark, SHELL_DARK), id).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(contrastRatio(v.light, SHELL_LIGHT), id).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(contrastRatio(v.onDark, v.dark), id).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(contrastRatio(v.onLight, v.light), id).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
        }
    });

    it('matches a custom hex to a preset exactly', () => {
        expect(matchPresetAccent('#F4A125')).toBe('amber');
        expect(matchPresetAccent('4ca8f5')).toBe('blue');
        expect(matchPresetAccent('#f4a126')).toBeNull();
        expect(matchPresetAccent('nope')).toBeNull();
    });
});

describe('custom accent derivation', () => {
    const samples = [
        '#ff0000',
        '#00ff00',
        '#0000ff',
        '#ffff00',
        '#00ffff',
        '#ff00ff',
        '#000000',
        '#ffffff',
        '#808080',
        '#123456',
        '#7a5c00',
        '#f4a126',
        '#1f1f1f',
        '#f3f3f3',
        '#3a3a8c',
        '#c0ffee',
    ];

    for (const hex of samples) {
        it(`derives readable dark/light values for ${hex}`, () => {
            const v = deriveCustomAccent(hex);
            expect(v).not.toBeNull();
            if (!v) return;
            for (const value of [v.dark, v.onDark, v.light, v.onLight]) expect(value).toMatch(/^#[0-9a-f]{6}$/);
            expect(contrastRatio(v.dark, SHELL_DARK)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(contrastRatio(v.light, SHELL_LIGHT)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(['#ffffff', '#000000']).toContain(v.onDark);
            expect(['#ffffff', '#000000']).toContain(v.onLight);
            expect(contrastRatio(v.onDark, v.dark)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
            expect(contrastRatio(v.onLight, v.light)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
        });
    }

    it('keeps a value that already passes unchanged', () => {
        const v = deriveCustomAccent('#4CA8F6');
        expect(v?.dark).toBe('#4ca8f6');
        const w = deriveCustomAccent('#0067c1');
        expect(w?.light).toBe('#0067c1');
    });

    it('only moves lightness: a dark blue stays blue when lightened', () => {
        const v = deriveCustomAccent('#0000ff');
        expect(v).not.toBeNull();
        const n = parseInt(v!.dark.slice(1), 16);
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
        expect(contrastRatio(v!.dark, SHELL_DARK)).toBeLessThan(7); // stopped near the target, not jumped to white
    });

    it('rejects invalid input', () => {
        expect(deriveCustomAccent('xyz')).toBeNull();
        expect(deriveCustomAccent('')).toBeNull();
        expect(deriveCustomAccent(null)).toBeNull();
    });
});

describe('scheme / accent resolution', () => {
    it('resolves the scheme', () => {
        expect(resolveScheme('dark', 'light')).toBe('dark');
        expect(resolveScheme('light', 'dark')).toBe('light');
        expect(resolveScheme('system', 'light')).toBe('light');
        expect(resolveScheme('system', 'dark')).toBe('dark');
    });

    it('falls back to dark when the OS scheme cannot be read (no window)', () => {
        expect(resolveScheme('system')).toBe('dark');
    });

    it('resolves the accent', () => {
        expect(resolveAccent('violet')).toEqual({ accent: 'violet', values: null });
        expect(resolveAccent('custom', '#f4a125')).toEqual({ accent: 'amber', values: null });
        expect(resolveAccent('custom', 'not-a-colour')).toEqual({ accent: 'amber', values: null });
        expect(resolveAccent('custom', null)).toEqual({ accent: 'amber', values: null });
        expect(resolveAccent('custom', '#123456').accent).toBe('custom');
        expect(resolveAccent('custom', '#123456').values).toEqual(deriveCustomAccent('#123456'));
        expect(resolveAccent('bogus' as never)).toEqual({ accent: 'amber', values: null });
    });
});
