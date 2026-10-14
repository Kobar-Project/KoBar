// T-601 (v26): the appearance model (scheme / accent / material) and its v1 view (theme / customThemeColor / design /
// glassOpacity). Pure: no store or DOM access.
//
// The v26 fields are the source of truth for the UI. The v1 fields stay persisted and readable (plugins read them) and are kept CONSISTENT with the v26 fields: `accentFromLegacy(theme, customThemeColor)`
// equals `accent` and `materialFromLegacy(design, glassOpacity)` equals `material`. A v1 value that is already
// consistent is kept as it is (e.g. 'lavender' stays 'lavender' for accent 'violet', a glass opacity of 40 stays 40),
// so plugins keep seeing the user's own values.
import { PRESET_ACCENTS, matchPresetAccent, normalizeHex } from '../theme';
import type { Accent, PresetAccent, Scheme } from '../theme';
import type { ThemeName } from './useAppStore';

export type Material = 'solid' | 'translucent';
export type LegacyDesign = 'style1' | 'style2';

export const SCHEMES: readonly Scheme[] = ['system', 'dark', 'light'];
export const ACCENTS: readonly Accent[] = [...PRESET_ACCENTS, 'custom'];
export const MATERIALS: readonly Material[] = ['solid', 'translucent'];

/** Store defaults of a fresh install. */
export const DEFAULT_SCHEME: Scheme = 'system';
export const DEFAULT_ACCENT: PresetAccent = 'amber';
export const DEFAULT_MATERIAL: Material = 'solid';
export const DEFAULT_CUSTOM_THEME_COLOR = '#f4a125';
export const DEFAULT_GLASS_OPACITY = 60;
/** `glassOpacity` at or above this value counts as solid. */
export const GLASS_SOLID_THRESHOLD = 90;
/** v1 glass opacity written when 'translucent' is chosen and the stored one does not describe it (= --kb-material-alpha). */
export const TRANSLUCENT_GLASS_OPACITY = 82;

export const isScheme = (value: unknown): value is Scheme => typeof value === 'string' && (SCHEMES as readonly string[]).includes(value);
export const isAccent = (value: unknown): value is Accent => typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
export const isMaterial = (value: unknown): value is Material =>
    typeof value === 'string' && (MATERIALS as readonly string[]).includes(value);

/** Old theme -> accent. */
export const ACCENT_FOR_THEME: Readonly<Record<Exclude<ThemeName, 'custom'>, PresetAccent>> = Object.freeze({
    ember: 'amber',
    coffee: 'orange',
    crimson: 'red',
    sakura: 'pink',
    amethyst: 'violet',
    lavender: 'violet',
    midnight: 'blue',
    ocean: 'blue',
    emerald: 'green',
    nord: 'graphite',
});

/** Reverse mapping (the `data-theme` value). */
export const THEME_FOR_ACCENT: Readonly<Record<Accent, ThemeName>> = Object.freeze({
    amber: 'ember',
    orange: 'coffee',
    red: 'crimson',
    pink: 'sakura',
    violet: 'amethyst',
    blue: 'ocean',
    green: 'emerald',
    graphite: 'nord',
    custom: 'custom',
});

/** Accent for a theme / custom colour pair (same rules as the v26 migration). */
export function accentFromLegacy(theme: unknown, customThemeColor: unknown): Accent {
    if (theme === 'custom') {
        const hex = normalizeHex(typeof customThemeColor === 'string' ? customThemeColor : DEFAULT_CUSTOM_THEME_COLOR);
        if (!hex) return DEFAULT_ACCENT;
        return matchPresetAccent(hex) ?? 'custom';
    }
    if (typeof theme === 'string' && Object.prototype.hasOwnProperty.call(ACCENT_FOR_THEME, theme)) {
        return ACCENT_FOR_THEME[theme as Exclude<ThemeName, 'custom'>];
    }
    return DEFAULT_ACCENT;
}

/** Material for a design / glass opacity pair (same rules as the v26 migration). */
export function materialFromLegacy(design: unknown, glassOpacity: unknown): Material {
    if (design !== 'style2') return 'solid';
    const opacity = typeof glassOpacity === 'number' && Number.isFinite(glassOpacity) ? glassOpacity : DEFAULT_GLASS_OPACITY;
    return opacity >= GLASS_SOLID_THRESHOLD ? 'solid' : 'translucent';
}

export interface LegacyThemeFields {
    theme: ThemeName;
    customThemeColor: string;
}

export interface LegacyMaterialFields {
    design: LegacyDesign;
    glassOpacity: number;
}

/**
 * The v1 theme view of `accent`. For 'custom' the theme is 'custom' and `customThemeColor` is kept (the custom hex lives
 * there). For a preset the current theme is kept when it already maps to it, otherwise the reverse mapping is used.
 */
export function legacyThemeFields(accent: Accent, current: { theme: unknown; customThemeColor: unknown }): LegacyThemeFields {
    const customThemeColor = typeof current.customThemeColor === 'string' ? current.customThemeColor : DEFAULT_CUSTOM_THEME_COLOR;
    if (accent === 'custom') return { theme: 'custom', customThemeColor };
    const keep = typeof current.theme === 'string' && accentFromLegacy(current.theme, customThemeColor) === accent;
    return { theme: keep ? (current.theme as ThemeName) : THEME_FOR_ACCENT[accent], customThemeColor };
}

/** The v1 design view of `material`; values that already describe it are kept. */
export function legacyMaterialFields(material: Material, current: { design: unknown; glassOpacity: unknown }): LegacyMaterialFields {
    const design: LegacyDesign = current.design === 'style2' ? 'style2' : 'style1';
    const glassOpacity =
        typeof current.glassOpacity === 'number' && Number.isFinite(current.glassOpacity) ? current.glassOpacity : DEFAULT_GLASS_OPACITY;
    if (materialFromLegacy(design, glassOpacity) === material) return { design, glassOpacity };
    if (material === 'translucent') {
        return { design: 'style2', glassOpacity: glassOpacity < GLASS_SOLID_THRESHOLD ? glassOpacity : TRANSLUCENT_GLASS_OPACITY };
    }
    return { design: 'style1', glassOpacity };
}

/** Accent of a stored profile (top level or workspace record): its valid `accent`, else derived from the v1 fields. */
export function profileAccent(profile: { accent?: unknown; theme?: unknown; customThemeColor?: unknown }): Accent {
    return isAccent(profile.accent) ? profile.accent : accentFromLegacy(profile.theme, profile.customThemeColor);
}

/** Material of a stored profile: its valid `material`, else derived from the v1 fields. */
export function profileMaterial(profile: { material?: unknown; design?: unknown; glassOpacity?: unknown }): Material {
    return isMaterial(profile.material) ? profile.material : materialFromLegacy(profile.design, profile.glassOpacity);
}
