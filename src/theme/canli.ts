// Canlı: tonal palette engine (ported from remaster/design/canli/tokens/palette.ts).
// Single source of truth for the Canlı colour formula. src/theme/canli.css expresses the same formula with
// `color-mix(in oklab, …)`; this module computes the resolved hex values so they can be tested for contrast
// (tests/canli.palette.test.ts) and used where CSS cannot reach. Pure, no DOM.
import { contrastRatio, mixOklab, PRESET_ACCENT_VALUES } from './color';
import type { PresetAccent } from './types';

export type CanliScheme = 'dark' | 'light';

export type SurfaceRole = 'nav' | 'shell' | 'surface' | 'tile' | 'inset' | 'line' | 'container';

/** Neutral bases (slightly cool). The accent is mixed into these by TINT percent. Mirrors the --kb-n-* tokens. */
export const NEUTRALS: Readonly<Record<CanliScheme, Record<SurfaceRole, string>>> = {
    dark: {
        nav: '#0d0f14',
        shell: '#111318',
        surface: '#1a1d25',
        tile: '#1d2029',
        inset: '#242833',
        line: '#2c3140',
        container: '#171a22',
    },
    light: {
        nav: '#f1f2f6',
        shell: '#fafafc',
        surface: '#ffffff',
        tile: '#f0f1f5',
        inset: '#e8eaf0',
        line: '#d9dce4',
        container: '#ffffff',
    },
};

/** Accent share (percent, OKLab mix) per surface role. `container` stays tinted with tonal surfaces off: it is a state colour. */
export const TINT: Readonly<Record<CanliScheme, Record<SurfaceRole, number>>> = {
    dark: { nav: 6, shell: 7, surface: 10, tile: 11, inset: 15, line: 20, container: 30 },
    light: { nav: 6, shell: 4, surface: 2, tile: 9, inset: 12, line: 16, container: 20 },
};

/** Share of fg-2 in the shell for control boundaries (WCAG 1.4.11 needs 3:1). */
export const STROKE_CONTROL: Readonly<Record<CanliScheme, number>> = { dark: 65, light: 70 };

/** Light scheme only: share of black mixed into the accent for `accentText`. */
export const ACCENT_TEXT_DARKEN = 15;

/** Text and fixed colours per scheme (not tinted). */
export const INK: Readonly<
    Record<
        CanliScheme,
        {
            fg1: string;
            fg2: string;
            fg3: string;
            onContainer: string;
            onAccentPreset: string;
            danger: string;
            warning: string;
            success: string;
        }
    >
> = {
    dark: {
        fg1: '#e9ebf1',
        fg2: '#b6bbc8',
        fg3: '#8e95a5',
        onContainer: '#f4f5f9',
        onAccentPreset: '#141414',
        danger: '#ffb4ab',
        warning: '#f2c46b',
        success: '#7fd99a',
    },
    light: {
        fg1: '#16181d',
        fg2: '#4a4f5c',
        fg3: '#6b7080',
        onContainer: '#14161b',
        onAccentPreset: '#ffffff',
        danger: '#ba1a1a',
        warning: '#8a5300',
        success: '#0f6b2e',
    },
};

export interface CanliPalette {
    scheme: CanliScheme;
    tonal: boolean;
    accent: string;
    /** Accent used as small text (tile captions, links). Dark: the accent itself. Light: 15 % darker in OKLab. */
    accentText: string;
    onAccent: string;
    nav: string;
    shell: string;
    surface: string;
    tile: string;
    inset: string;
    line: string;
    /** Control boundaries (switch off, chip, outline button): fg-2 mixed into the shell, ≥ 3:1. */
    strokeControl: string;
    container: string;
    onContainer: string;
    fg1: string;
    fg2: string;
    fg3: string;
    danger: string;
    warning: string;
    success: string;
}

/** Resolves the full Canlı palette for an accent hex already tuned for `scheme` (see deriveCustomAccent). */
export function canliPalette(accent: string, scheme: CanliScheme, tonal = true, onAccent?: string): CanliPalette {
    const base = NEUTRALS[scheme];
    const tint = TINT[scheme];
    const share = (role: SurfaceRole) => (tonal || role === 'container' ? tint[role] : 0);
    const role = (r: SurfaceRole) => mixOklab(accent, base[r], share(r));
    const ink = INK[scheme];
    return {
        scheme,
        tonal,
        accent,
        accentText: scheme === 'light' ? mixOklab('#000000', accent, ACCENT_TEXT_DARKEN) : accent,
        onAccent: onAccent ?? ink.onAccentPreset,
        nav: role('nav'),
        shell: role('shell'),
        surface: role('surface'),
        tile: role('tile'),
        inset: role('inset'),
        line: role('line'),
        strokeControl: mixOklab(ink.fg2, role('shell'), STROKE_CONTROL[scheme]),
        container: role('container'),
        onContainer: ink.onContainer,
        fg1: ink.fg1,
        fg2: ink.fg2,
        fg3: ink.fg3,
        danger: ink.danger,
        warning: ink.warning,
        success: ink.success,
    };
}

export function presetPalette(id: PresetAccent, scheme: CanliScheme, tonal = true): CanliPalette {
    const values = PRESET_ACCENT_VALUES[id];
    return canliPalette(scheme === 'dark' ? values.dark : values.light, scheme, tonal, scheme === 'dark' ? values.onDark : values.onLight);
}

/**
 * Contrast requirements. Every pair is checked for every preset × scheme × tonal on/off (tests/canli.palette.test.ts).
 * `min` is WCAG 2.x contrast: 4.5 = text, 3 = non-text indicators and large text. A new colour needs a new row here.
 */
export interface ContrastRule {
    fg: keyof CanliPalette;
    bg: keyof CanliPalette;
    min: number;
    why: string;
}

export const CONTRAST_RULES: readonly ContrastRule[] = [
    { fg: 'fg1', bg: 'shell', min: 7, why: 'primary text on bar / panel' },
    { fg: 'fg1', bg: 'tile', min: 7, why: 'tile value text' },
    { fg: 'fg1', bg: 'inset', min: 7, why: 'input text' },
    { fg: 'fg2', bg: 'shell', min: 4.5, why: 'secondary text, icons on shell' },
    { fg: 'fg2', bg: 'surface', min: 4.5, why: 'secondary text on cards' },
    { fg: 'fg2', bg: 'tile', min: 4.5, why: 'tile caption / meta text' },
    { fg: 'fg2', bg: 'inset', min: 4.5, why: 'placeholder-strength text in inputs that carries meaning' },
    { fg: 'fg3', bg: 'shell', min: 3, why: 'disabled / placeholder only' },
    { fg: 'accent', bg: 'shell', min: 3, why: 'indicator, focus ring, progress on shell' },
    { fg: 'accentText', bg: 'tile', min: 4.5, why: 'accent caption text on tiles' },
    { fg: 'accentText', bg: 'surface', min: 4.5, why: 'links and accent labels on cards' },
    { fg: 'accentText', bg: 'shell', min: 4.5, why: 'accent text on shell' },
    { fg: 'accent', bg: 'surface', min: 3, why: 'accent glyphs on cards' },
    { fg: 'accent', bg: 'container', min: 3, why: 'accent glyph inside an icon tile / selected row' },
    { fg: 'strokeControl', bg: 'shell', min: 3, why: 'switch / chip / outline button boundary on shell' },
    { fg: 'strokeControl', bg: 'surface', min: 3, why: 'switch / chip / outline button boundary on cards' },
    { fg: 'onAccent', bg: 'accent', min: 4.5, why: 'text and glyphs on filled accent' },
    { fg: 'onContainer', bg: 'container', min: 7, why: 'selected row / tonal button label' },
    { fg: 'danger', bg: 'shell', min: 4.5, why: 'destructive menu item' },
    { fg: 'warning', bg: 'surface', min: 4.5, why: 'unverified plugin meta text' },
];

/** Checks a palette against CONTRAST_RULES; returns the failures (empty = pass). */
export function auditPalette(p: CanliPalette): { rule: ContrastRule; ratio: number }[] {
    const out: { rule: ContrastRule; ratio: number }[] = [];
    for (const rule of CONTRAST_RULES) {
        const ratio = contrastRatio(String(p[rule.fg]), String(p[rule.bg]));
        if (ratio < rule.min) out.push({ rule, ratio });
    }
    return out;
}
