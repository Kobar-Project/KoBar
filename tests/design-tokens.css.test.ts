import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-503: --kb-* design tokens and the v1 plugin aliases in src/index.css.
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { selectors: string[]; body: string };

const rules: Rule[] = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
    selectors: m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    body: m[2],
}));

const norm = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const readRepoFile = (rel: string) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

/** Declarations of every rule whose selector list contains `selector` (later rules win). */
function declsFor(selector: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const rule of rules) {
        if (!rule.selectors.includes(selector)) continue;
        for (const decl of rule.body.split(';')) {
            const idx = decl.indexOf(':');
            if (idx === -1) continue;
            out.set(decl.slice(0, idx).trim(), norm(decl.slice(idx + 1)));
        }
    }
    return out;
}

const SCHEME_TOKENS = {
    dark: {
        '--kb-bg-shell': '#1f1f1f',
        '--kb-bg-surface': '#2a2a2a',
        '--kb-bg-inset': '#181818',
        '--kb-fill-hover': 'rgba(255,255,255,0.06)',
        '--kb-fill-pressed': 'rgba(255,255,255,0.04)',
        '--kb-fill-selected': 'rgba(255,255,255,0.09)',
        '--kb-stroke-subtle': 'rgba(255,255,255,0.08)',
        '--kb-stroke-strong': 'rgba(255,255,255,0.16)',
        '--kb-stroke-control': 'rgba(255,255,255,0.36)',
        '--kb-fg-1': 'rgba(255,255,255,0.92)',
        '--kb-fg-2': 'rgba(255,255,255,0.68)',
        '--kb-fg-3': 'rgba(255,255,255,0.46)',
        '--kb-scrim': 'rgba(0,0,0,0.5)',
        '--kb-success': '#6ccb5f',
        '--kb-warning': '#fce100',
        '--kb-danger': '#ff99a4',
        '--kb-info': '#60cdff',
        '--kb-accent': 'var(--kb-accent-dark)',
        '--kb-on-accent': 'var(--kb-on-accent-dark)',
        '--kb-shadow-e1': '01px2pxrgba(0,0,0,0.18)',
        '--kb-shadow-e2': '04px12pxrgba(0,0,0,0.24)',
        '--kb-shadow-e3': '08px28pxrgba(0,0,0,0.32)',
    },
    light: {
        '--kb-bg-shell': '#f3f3f3',
        '--kb-bg-surface': '#ffffff',
        '--kb-bg-inset': '#ebebeb',
        '--kb-fill-hover': 'rgba(0,0,0,0.04)',
        '--kb-fill-pressed': 'rgba(0,0,0,0.06)',
        '--kb-fill-selected': 'rgba(0,0,0,0.07)',
        '--kb-stroke-subtle': 'rgba(0,0,0,0.08)',
        '--kb-stroke-strong': 'rgba(0,0,0,0.16)',
        '--kb-stroke-control': 'rgba(0,0,0,0.45)',
        '--kb-fg-1': 'rgba(0,0,0,0.9)',
        '--kb-fg-2': 'rgba(0,0,0,0.62)',
        '--kb-fg-3': 'rgba(0,0,0,0.45)',
        '--kb-scrim': 'rgba(0,0,0,0.3)',
        '--kb-success': '#0f7b0f',
        '--kb-warning': '#9d5d00',
        '--kb-danger': '#c42b1c',
        '--kb-info': '#005fb8',
        '--kb-accent': 'var(--kb-accent-light)',
        '--kb-on-accent': 'var(--kb-on-accent-light)',
        '--kb-shadow-e1': '01px2pxrgba(0,0,0,0.08)',
        '--kb-shadow-e2': '04px12pxrgba(0,0,0,0.12)',
        '--kb-shadow-e3': '08px28pxrgba(0,0,0,0.16)',
    },
} as const;

const DERIVED = ['--kb-accent-hover', '--kb-accent-pressed', '--kb-accent-subtle', '--kb-focus-ring', '--kb-shadow-e0'];

// [dark accent, dark on-accent, light accent, light on-accent]
const ACCENTS: Record<string, [string, string, string, string]> = {
    amber: ['#f4a125', '#141414', '#9a5b00', '#ffffff'],
    orange: ['#f28c45', '#141414', '#b54708', '#ffffff'],
    red: ['#f2626f', '#141414', '#c42b3c', '#ffffff'],
    pink: ['#f07ab8', '#141414', '#b8236c', '#ffffff'],
    violet: ['#a78bfa', '#141414', '#7445d6', '#ffffff'],
    blue: ['#4ca8f5', '#141414', '#0067c0', '#ffffff'],
    green: ['#45c98b', '#141414', '#0b7a47', '#ffffff'],
    graphite: ['#a3abb8', '#141414', '#5a6472', '#ffffff'],
};

// The 10 legacy theme names. Since T-601 data-theme no longer selects colours.
const LEGACY_THEMES = ['ember', 'ocean', 'sakura', 'emerald', 'midnight', 'amethyst', 'crimson', 'nord', 'coffee', 'lavender'];

// The full --theme-* alias table (T-601). Borders/scrollbar are per scheme.
const THEME_ALIASES: Record<string, string> = {
    '--theme-primary': 'var(--kb-accent)',
    '--theme-marker': 'var(--kb-accent)',
    '--theme-bg-dark': 'var(--kb-bg-shell)',
    '--theme-bg-base': 'var(--kb-bg-surface)',
    '--theme-surface': 'var(--kb-bg-inset)',
    '--theme-accent-glow': 'var(--kb-accent-subtle)',
    '--theme-bg-light': '#f3f3f3',
};
const THEME_BORDERS = { dark: '#3a3a3a', light: '#d1d1d1' };

const THEME_VARS = [
    '--theme-primary',
    '--theme-bg-dark',
    '--theme-bg-base',
    '--theme-bg-light',
    '--theme-border',
    '--theme-surface',
    '--theme-accent-glow',
    '--theme-scrollbar',
    '--theme-marker',
];

describe('index.css design tokens (T-503)', () => {
    for (const scheme of ['dark', 'light'] as const) {
        it(`defines the ${scheme} scheme tokens`, () => {
            const decls = declsFor(`[data-scheme="${scheme}"]`);
            for (const [name, value] of Object.entries(SCHEME_TOKENS[scheme])) {
                expect(decls.get(name), name).toBe(value);
            }
            for (const name of DERIVED) expect(decls.has(name), name).toBe(true);
            expect(decls.get('--kb-focus-ring')).toBe('0002pxvar(--kb-bg-shell),0004pxvar(--kb-accent)');
        });
    }

    it('sets color-scheme per scheme so native scrollbars and form controls follow it (T-601)', () => {
        expect(declsFor('[data-scheme="dark"]').get('color-scheme')).toBe('dark');
        expect(declsFor('[data-scheme="light"]').get('color-scheme')).toBe('light');
    });

    it('defines all 8 accents with per-scheme values', () => {
        for (const [accent, [dark, onDark, light, onLight]] of Object.entries(ACCENTS)) {
            const decls = declsFor(`[data-accent="${accent}"]`);
            expect(decls.get('--kb-accent-dark'), accent).toBe(dark);
            expect(decls.get('--kb-on-accent-dark'), accent).toBe(onDark);
            expect(decls.get('--kb-accent-light'), accent).toBe(light);
            expect(decls.get('--kb-on-accent-light'), accent).toBe(onLight);
        }
    });

    it('defaults :root to dark scheme, amber accent, normal density and solid material', () => {
        const root = declsFor(':root');
        expect(root.get('--kb-bg-shell')).toBe('#1f1f1f');
        expect(root.get('--kb-accent')).toBe('var(--kb-accent-dark)');
        expect(root.get('--kb-accent-dark')).toBe('#f4a125');
        expect(root.get('--kb-control-h')).toBe('32px');
        expect(root.get('--kb-material-bg')).toBe('var(--kb-bg-shell)');
        const lightSelectorsOnRoot = rules.filter((r) => r.selectors.includes(':root') && r.selectors.some((s) => s.includes('light')));
        expect(lightSelectorsOnRoot).toHaveLength(0);
    });

    it('defines density, material, radius and opacity tokens', () => {
        expect(declsFor('[data-density="compact"]').get('--kb-control-h')).toBe('28px');
        expect(declsFor('[data-density="comfortable"]').get('--kb-row-h')).toBe('48px');
        expect(declsFor('[data-material="translucent"]').get('--kb-material-alpha')).toBe('0.82');
        const root = declsFor(':root');
        expect(root.get('--kb-radius-xs')).toBe('4px');
        expect(root.get('--kb-radius-sm')).toBe('6px');
        expect(root.get('--kb-radius-md')).toBe('8px');
        expect(root.get('--kb-radius-lg')).toBe('12px');
        expect(root.get('--kb-radius-xl')).toBe('16px');
        expect(root.get('--kb-opacity-disabled')).toBe('0.45');
        expect(root.get('--kb-opacity-drag')).toBe('0.6');
    });

    it('maps the Tailwind radius scale to the tokens (no more 2rem / 3rem)', () => {
        const theme = declsFor('@theme');
        expect(theme.get('--radius-lg')).toBe('var(--kb-radius-lg)');
        expect(theme.get('--radius-xl')).toBe('var(--kb-radius-xl)');
        expect(theme.get('--radius-full')).toBe('var(--kb-radius-full)');
        expect(css).not.toMatch(/--radius-(lg|xl):\s*[23]rem/);
    });
});

// WCAG 2.x relative luminance / contrast ratio. rgba() foregrounds are composited over the background first.
type Rgb = [number, number, number];

function parseColor(value: string): { rgb: Rgb; alpha: number } {
    const hex = /^#([0-9a-f]{6})$/.exec(value);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
    }
    const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
    if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
    throw new Error(`unsupported color ${value}`);
}

function luminance([r, g, b]: Rgb): number {
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number {
    const back = parseColor(bg).rgb;
    const front = parseColor(fg);
    const mixed = front.rgb.map((c, i) => c * front.alpha + back[i] * (1 - front.alpha)) as Rgb;
    const [hi, lo] = [luminance(mixed), luminance(back)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
}

describe('index.css token contrast', () => {
    for (const scheme of ['dark', 'light'] as const) {
        it(`meets the WCAG targets in the ${scheme} scheme`, () => {
            const t = SCHEME_TOKENS[scheme];
            for (const bg of [t['--kb-bg-shell'], t['--kb-bg-surface']]) {
                expect(contrast(t['--kb-fg-1'], bg)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(t['--kb-fg-2'], bg)).toBeGreaterThanOrEqual(4.5);
                expect(contrast(t['--kb-fg-3'], bg)).toBeGreaterThanOrEqual(3);
            }
            expect(contrast(t['--kb-stroke-control'], t['--kb-bg-shell'])).toBeGreaterThanOrEqual(3);
            for (const status of ['--kb-success', '--kb-warning', '--kb-danger', '--kb-info'] as const) {
                expect(contrast(t[status], t['--kb-bg-shell']), status).toBeGreaterThanOrEqual(4.5);
            }
            for (const [accent, [dark, onDark, light, onLight]] of Object.entries(ACCENTS)) {
                const [value, on] = scheme === 'dark' ? [dark, onDark] : [light, onLight];
                expect(contrast(value, t['--kb-bg-shell']), `${accent} vs shell`).toBeGreaterThanOrEqual(4.5);
                expect(contrast(value, t['--kb-bg-surface']), `${accent} vs surface`).toBeGreaterThanOrEqual(4.5);
                expect(contrast(on, value), `on-accent vs ${accent}`).toBeGreaterThanOrEqual(4.5);
            }
        });
    }
});

describe('v1 plugin roots are wrapped in data-scheme="dark"', () => {
    const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

    it('wraps extension panels (App.tsx)', () => {
        // R-15: App.tsx renders the panel through PluginPanelHost, which keeps the dark-scheme display: contents wrapper.
        expect(read('../src/App.tsx')).toMatch(/<PluginPanelHost[^>]*>\s*\{panel\.render\(/);
        expect(read('../src/components/plugins/PluginPanelHost.tsx')).toMatch(/data-scheme="dark"\s+className="contents"/);
    });

    it('wraps extension settings panels (PluginSettingsHost.tsx)', () => {
        expect(read('../src/components/plugins/PluginSettingsHost.tsx')).toMatch(/<div data-scheme="dark"[^>]*>\s*\{panel\.render\(\)\}/);
    });

    it('wraps inline widgets (Sidebar.tsx)', () => {
        expect(read('../src/components/layout/Sidebar.tsx')).toMatch(
            /data-scheme="dark" data-bar-widget="" className="contents">\s*\{feat\.render\(\)\}/
        );
    });
});

describe('nested [data-scheme] roots re-resolve root-computed aliases (T-504)', () => {
    it('re-resolves every --theme-* alias in a nested [data-scheme] root (T-601)', () => {
        const decls = declsFor('[data-scheme]');
        for (const [name, value] of Object.entries(THEME_ALIASES)) expect(decls.get(name), name).toBe(value);
        for (const scheme of ['dark', 'light'] as const) {
            const schemeDecls = declsFor(`[data-scheme="${scheme}"]`);
            expect(schemeDecls.get('--theme-border'), scheme).toBe(THEME_BORDERS[scheme]);
            expect(schemeDecls.get('--theme-scrollbar'), scheme).toBe(THEME_BORDERS[scheme]);
        }
    });

    it('re-resolves the Tailwind --color-primary alias and the solid/translucent material background', () => {
        const scheme = declsFor('[data-scheme]');
        expect(scheme.get('--color-primary')).toBe('var(--theme-primary)');
        expect(scheme.get('--kb-material-bg')).toBe('var(--kb-bg-shell)');
        for (const selector of ['[data-material="translucent"][data-scheme]', '[data-material="translucent"] [data-scheme]']) {
            expect(declsFor(selector).get('--kb-material-bg'), selector).toBe('color-mix(insrgb,var(--kb-bg-shell)82%,transparent)');
        }
    });
});

describe('index.css v1 plugin aliases (T-503)', () => {
    it('keeps the Tailwind aliases bg-primary / bg-background-*', () => {
        const theme = declsFor('@theme');
        expect(theme.get('--color-primary')).toBe('var(--theme-primary)');
        expect(theme.get('--color-background-dark')).toBe('var(--theme-bg-dark)');
        expect(theme.get('--color-background-light')).toBe('var(--theme-bg-light)');
        expect(theme.get('--font-display')).toContain('"spacegrotesk"');
    });

    it('keeps the Space Grotesk @font-face alias', () => {
        expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Space Grotesk"/);
    });

    it('keeps the material-symbols-outlined class working (bundled, not remote)', () => {
        expect(readRepoFile('src/main.tsx')).toContain("import 'material-symbols/outlined.css'");
        expect(readRepoFile('node_modules/material-symbols/outlined.css')).toContain('url("./material-symbols-outlined.woff2")');
    });

    it('keeps every --theme-* variable on :root', () => {
        const root = declsFor(':root');
        for (const name of THEME_VARS) expect(root.has(name), name).toBe(true);
    });

    it('applies the full alias table on :root (T-601)', () => {
        const root = declsFor(':root');
        for (const [name, value] of Object.entries(THEME_ALIASES)) expect(root.get(name), name).toBe(value);
        expect(root.get('--theme-border')).toBe(THEME_BORDERS.dark);
        expect(root.get('--theme-scrollbar')).toBe(THEME_BORDERS.dark);
    });

    it('no legacy data-theme block selects colours any more; data-theme is only a v1 compatibility attribute (T-601)', () => {
        for (const theme of LEGACY_THEMES) {
            expect(declsFor(`[data-theme="${theme}"]`).size, theme).toBe(0);
            expect(declsFor(`[data-theme="${theme}"] [data-scheme]`).size, theme).toBe(0);
        }
        expect(css).not.toMatch(/\[data-theme=/);
    });
});

describe('fonts and icons (T-506)', () => {
    it('defines the system font tokens and uses them for the host body', () => {
        const root = declsFor(':root');
        expect(root.get('--kb-font')).toBe(
            norm('"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif')
        );
        expect(root.get('--kb-font-display')).toBe(
            norm('"Segoe UI Variable Display", "Segoe UI", -apple-system, "SF Pro Display", system-ui, sans-serif')
        );
        expect(root.get('--kb-font-mono')).toBe(norm('"Cascadia Mono", "SF Mono", ui-monospace, monospace'));
        expect(declsFor('body').get('font-family')).toBe('var(--kb-font)');
        const theme = declsFor('@theme');
        expect(theme.get('--font-sans')).toBe('var(--kb-font)');
        expect(theme.get('--font-mono')).toBe('var(--kb-font-mono)');
    });

    it('sets the Material Symbols default axes (FILL 0, wght 300, GRAD 0, opsz 20)', () => {
        expect(declsFor('.material-symbols-outlined').get('font-variation-settings')).toBe(
            norm('"FILL" 0, "wght" 300, "GRAD" 0, "opsz" 20')
        );
    });

    it('loads no remote fonts in pages, entry points or styles', () => {
        for (const file of [
            'index.html',
            'pip.html',
            'settings.html',
            'src/index.css',
            'src/main.tsx',
            'src/pip/main.tsx',
            'src/settings/main.tsx',
        ]) {
            const text = readRepoFile(file);
            expect(text, file).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
        }
    });
});
