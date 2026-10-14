// T-504: writes the scheme/accent root attributes and follows the OS scheme.
// The renderer's prefers-color-scheme already tracks the OS in Electron (nativeTheme.themeSource defaults to
// 'system'), so no main-process bridge is needed.
import { PRESET_ACCENT_VALUES, deriveCustomAccent, matchPresetAccent } from './color';
import { PRESET_ACCENTS } from './types';
import type { Accent, AccentValues, PresetAccent, ResolvedScheme, Scheme, ThemePrefs } from './types';

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** Inline custom properties set only for accent 'custom'; src/index.css derives --kb-accent / --kb-on-accent from them. */
export const CUSTOM_ACCENT_PROPERTIES = {
    dark: '--kb-accent-dark',
    onDark: '--kb-on-accent-dark',
    light: '--kb-accent-light',
    onLight: '--kb-on-accent-light',
} as const satisfies Record<keyof AccentValues, string>;

export interface ResolvedAccent {
    accent: Accent;
    /** Set only when `accent` is 'custom'. */
    values: AccentValues | null;
}

export interface AppliedTheme {
    scheme: ResolvedScheme;
    accent: Accent;
}

const DEFAULT_ACCENT: PresetAccent = 'amber';

function isPresetAccent(value: unknown): value is PresetAccent {
    return typeof value === 'string' && (PRESET_ACCENTS as readonly string[]).includes(value);
}

function getMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(SYSTEM_DARK_QUERY);
}

/** Current OS scheme; 'dark' when it cannot be read (KoBar's historical look). */
export function readSystemScheme(): ResolvedScheme {
    const query = getMediaQuery();
    if (!query) return 'dark';
    return query.matches ? 'dark' : 'light';
}

/** 'system' uses `systemScheme` when given, otherwise reads the OS; anything unknown resolves to 'dark'. */
export function resolveScheme(scheme: Scheme, systemScheme?: ResolvedScheme): ResolvedScheme {
    if (scheme === 'light') return 'light';
    if (scheme === 'system') return systemScheme ?? readSystemScheme();
    return 'dark';
}

/**
 * Presets pass through; 'custom' becomes a preset when the hex matches one exactly, falls back to amber
 * when the hex is invalid, and otherwise carries its derived values. Unknown ids fall back to amber.
 */
export function resolveAccent(accent: Accent, customAccent?: string | null): ResolvedAccent {
    if (accent === 'custom') {
        const preset = customAccent ? matchPresetAccent(customAccent) : null;
        if (preset) return { accent: preset, values: null };
        const values = deriveCustomAccent(customAccent);
        return values ? { accent: 'custom', values } : { accent: DEFAULT_ACCENT, values: null };
    }
    return { accent: isPresetAccent(accent) ? accent : DEFAULT_ACCENT, values: null };
}

/** Raw values of a resolved accent (presets mirror src/index.css). */
export function accentValues(resolved: ResolvedAccent): AccentValues {
    if (resolved.values) return resolved.values;
    return PRESET_ACCENT_VALUES[isPresetAccent(resolved.accent) ? resolved.accent : DEFAULT_ACCENT];
}

/**
 * Sets `data-scheme` (resolved, never 'system') and `data-accent` on `root`. For 'custom' it also sets the
 * raw `--kb-accent-*` / `--kb-on-accent-*` properties inline; for presets it removes them so the CSS blocks win.
 * Does not touch the legacy `data-theme` attribute or `--theme-*` variables.
 */
export function applyThemeAttributes(root: HTMLElement, prefs: ThemePrefs, systemScheme?: ResolvedScheme): AppliedTheme {
    const scheme = resolveScheme(prefs.scheme, systemScheme);
    const resolved = resolveAccent(prefs.accent, prefs.customAccent);

    root.setAttribute('data-scheme', scheme);
    root.setAttribute('data-accent', resolved.accent);
    for (const [key, property] of Object.entries(CUSTOM_ACCENT_PROPERTIES) as [keyof AccentValues, string][]) {
        if (resolved.values) root.style.setProperty(property, resolved.values[key]);
        else root.style.removeProperty(property);
    }
    return { scheme, accent: resolved.accent };
}

/** Calls `onChange` whenever the OS scheme changes. Returns the unsubscribe function. */
export function watchSystemScheme(onChange: (scheme: ResolvedScheme) => void): () => void {
    const query = getMediaQuery();
    if (!query) return () => {};
    const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
}

/**
 * Applies `prefs` now and, for scheme 'system', re-applies on every OS scheme change.
 * Returns a cleanup function (use as a React effect: `useEffect(() => startThemeSync(root, prefs), [...])`).
 */
export function startThemeSync(root: HTMLElement, prefs: ThemePrefs): () => void {
    applyThemeAttributes(root, prefs);
    if (prefs.scheme !== 'system') return () => {};
    return watchSystemScheme((systemScheme) => {
        applyThemeAttributes(root, prefs, systemScheme);
    });
}
