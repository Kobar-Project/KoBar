// Legacy `--theme-*` inline overrides.
// T-601: the `--theme-*` variables are aliases of the `--kb-*` tokens in src/index.css, and a
// custom accent is applied by src/theme (`--kb-accent-*` inline properties). Nothing derives backgrounds from the custom
// colour any more; an inline `--theme-*` value would only shadow the aliases, so these helpers remove them.

/** Every `--theme-*` variable that older code wrote inline on the root element. */
export const LEGACY_THEME_PROPERTIES = [
    '--theme-primary',
    '--theme-bg-dark',
    '--theme-bg-base',
    '--theme-bg-light',
    '--theme-border',
    '--theme-surface',
    '--theme-accent-glow',
    '--theme-scrollbar',
    '--theme-marker',
] as const;

/** Removes inline `--theme-*` overrides from the root element so the CSS aliases apply. */
export function clearLegacyThemeCSS(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const property of LEGACY_THEME_PROPERTIES) root.style.removeProperty(property);
}

/**
 * @deprecated T-601: kept for the old settings panel (removed in T-615). The custom colour is applied from the store's
 * `accent` / `customThemeColor` by App.tsx; this only clears stale inline overrides.
 */
export const applyCustomThemeCSS: (primaryHex?: string) => void = () => {
    clearLegacyThemeCSS();
};
