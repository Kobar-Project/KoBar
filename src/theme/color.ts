// T-504: pure colour math for the accent system.
// WCAG 2.x relative luminance / contrast and an sRGB <-> OKLab round trip; no DOM access.
import type { AccentValues, PresetAccent } from './types';

type Rgb = [number, number, number];

/** Preset accent values, identical to the `[data-accent]` blocks in src/index.css. */
export const PRESET_ACCENT_VALUES: Readonly<Record<PresetAccent, AccentValues>> = Object.freeze({
    amber: { dark: '#f4a125', onDark: '#141414', light: '#9a5b00', onLight: '#ffffff' },
    orange: { dark: '#f28c45', onDark: '#141414', light: '#b54708', onLight: '#ffffff' },
    red: { dark: '#f2626f', onDark: '#141414', light: '#c42b3c', onLight: '#ffffff' },
    pink: { dark: '#f07ab8', onDark: '#141414', light: '#b8236c', onLight: '#ffffff' },
    violet: { dark: '#a78bfa', onDark: '#141414', light: '#7445d6', onLight: '#ffffff' },
    blue: { dark: '#4ca8f5', onDark: '#141414', light: '#0067c0', onLight: '#ffffff' },
    green: { dark: '#45c98b', onDark: '#141414', light: '#0b7a47', onLight: '#ffffff' },
    graphite: { dark: '#a3abb8', onDark: '#141414', light: '#5a6472', onLight: '#ffffff' },
});

/** `--kb-bg-shell` per scheme; the custom accent is tuned against these. */
export const SHELL_DARK = '#1f1f1f';
export const SHELL_LIGHT = '#f3f3f3';

/** Minimum accent/shell and on-accent/accent contrast (WCAG AA text). */
export const MIN_ACCENT_CONTRAST = 4.5;

const WHITE = '#ffffff';
const BLACK = '#000000';
const L_STEP = 0.01;

/** Normalises `#rgb` / `#rrggbb` (with or without `#`, any case) to lowercase `#rrggbb`; null when invalid. */
export function normalizeHex(input: string | null | undefined): string | null {
    if (typeof input !== 'string') return null;
    const raw = input.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
    if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
    return null;
}

function hexToRgb(hex: string): Rgb {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: Rgb): string {
    return `#${rgb
        .map((c) =>
            Math.round(Math.min(255, Math.max(0, c)))
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;
}

const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (c: number) => {
    const v = Math.min(1, Math.max(0, c));
    return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1–21). */
export function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** Text colour on a filled accent: white or black, whichever contrasts more. */
export function onAccentFor(accentHex: string): string {
    return contrastRatio(WHITE, accentHex) > contrastRatio(BLACK, accentHex) ? WHITE : BLACK;
}

type Lab = [number, number, number];

function hexToOklab(hex: string): Lab {
    const [r, g, b] = hexToRgb(hex).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

/** OKLab -> `#rrggbb`; out-of-gamut channels are clipped. */
function oklabToHex([L, a, b]: Lab): string {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return rgbToHex([
        fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ]);
}

/** Same result as CSS `color-mix(in oklab, <a> <pct>%, <b>)` for two `#rrggbb` colours. */
export function mixOklab(a: string, b: string, pct: number): string {
    if (pct <= 0) return b;
    const t = Math.min(100, pct) / 100;
    const A = hexToOklab(a);
    const B = hexToOklab(b);
    return oklabToHex([A[0] * t + B[0] * (1 - t), A[1] * t + B[1] * (1 - t), A[2] * t + B[2] * (1 - t)]);
}

/**
 * Moves OKLCH lightness (chroma and hue kept: a/b are fixed in OKLab) up ('lighter') or down ('darker')
 * until `passes(candidate)` holds. Returns the input unchanged when it already passes; falls back to
 * white/black if clipping ever prevents reaching the target.
 */
function tuneLightnessUntil(hex: string, direction: 'lighter' | 'darker', passes: (candidate: string) => boolean): string {
    if (passes(hex)) return hex;
    const [L0, a, b] = hexToOklab(hex);
    const step = direction === 'lighter' ? L_STEP : -L_STEP;
    for (let L = L0 + step; L <= 1 && L >= 0; L += step) {
        const candidate = oklabToHex([L, a, b]);
        if (passes(candidate)) return candidate;
    }
    return direction === 'lighter' ? WHITE : BLACK;
}

/**
 * Canlı (01-color §6): the custom accent is tuned against the Canlı tile of that accent, the hardest surface of the
 * contrast contract. The tile depends on the accent, so it is recomputed for every candidate.
 * Shares mirror src/theme/canli.ts (TINT.dark.tile / TINT.light.tile) and src/theme/canli.css.
 */
const CANLI_TILE_DARK = { neutral: '#1d2029', share: 11 };
const CANLI_TILE_LIGHT = { neutral: '#f0f1f5', share: 9 };
const CANLI_ACCENT_TEXT_DARKEN = 15;

function canliTile(accent: string, scheme: 'dark' | 'light'): string {
    const tile = scheme === 'dark' ? CANLI_TILE_DARK : CANLI_TILE_LIGHT;
    return mixOklab(accent, tile.neutral, tile.share);
}

/** Preset whose dark value equals `hex` exactly (`#f4a125` -> amber). */
export function matchPresetAccent(hex: string): PresetAccent | null {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    for (const [id, values] of Object.entries(PRESET_ACCENT_VALUES) as [PresetAccent, AccentValues][]) {
        if (values.dark === normalized) return id;
    }
    return null;
}

/**
 * "Custom…" accent (Canlı, 01-color §6): the dark value is lightened until it reaches 4.5:1 on the dark shell and
 * on its own dark Canlı tile; the light value is darkened until its accent text (15 % black) reaches 4.5:1 on its
 * light Canlı tile, the accent reaches 4.5:1 on the light shell and white text reaches 4.5:1 on it. Each on-accent
 * is pure white or black. Returns null for an invalid hex.
 */
export function deriveCustomAccent(input: string | null | undefined): AccentValues | null {
    const hex = normalizeHex(input);
    if (!hex) return null;
    const dark = tuneLightnessUntil(
        hex,
        'lighter',
        (c) => contrastRatio(c, SHELL_DARK) >= MIN_ACCENT_CONTRAST && contrastRatio(c, canliTile(c, 'dark')) >= MIN_ACCENT_CONTRAST
    );
    const light = tuneLightnessUntil(
        hex,
        'darker',
        (c) =>
            contrastRatio(c, SHELL_LIGHT) >= MIN_ACCENT_CONTRAST &&
            contrastRatio(mixOklab(BLACK, c, CANLI_ACCENT_TEXT_DARKEN), canliTile(c, 'light')) >= MIN_ACCENT_CONTRAST &&
            contrastRatio(WHITE, c) >= MIN_ACCENT_CONTRAST
    );
    return { dark, onDark: onAccentFor(dark), light, onLight: onAccentFor(light) };
}
