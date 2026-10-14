// T-504: scheme and accent model.

/** User-facing scheme choice. 'system' follows the OS (prefers-color-scheme). */
export type Scheme = 'dark' | 'light' | 'system';

/** The scheme actually written to `data-scheme`. */
export type ResolvedScheme = 'dark' | 'light';

export const PRESET_ACCENTS = ['amber', 'orange', 'red', 'pink', 'violet', 'blue', 'green', 'graphite'] as const;

export type PresetAccent = (typeof PRESET_ACCENTS)[number];

/** `data-accent` value: one of the 8 presets or 'custom' (a user hex). */
export type Accent = PresetAccent | 'custom';

export interface ThemePrefs {
    scheme: Scheme;
    accent: Accent;
    /** User hex for accent 'custom' (`#rgb` or `#rrggbb`, `#` optional). Ignored for presets. */
    customAccent?: string | null;
}

/** Raw per-scheme accent values (the `--kb-accent-*` / `--kb-on-accent-*` custom properties). */
export interface AccentValues {
    dark: string;
    onDark: string;
    light: string;
    onLight: string;
}

/**
 * KoBar's historical look (dark + amber). Since T-601 (v26) App.tsx applies the user's scheme/accent from the store;
 * this constant is only shown until the store is hydrated.
 */
export const DEFAULT_THEME_PREFS: Readonly<ThemePrefs> = Object.freeze({ scheme: 'dark', accent: 'amber' });
