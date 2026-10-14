// T-608: the root appearance of a window, shared by the main window (src/App.tsx) and the Settings window
// (src/settings/appearance.ts) so both render the same scheme, accent, material and density from the same values.
// Not re-exported from ./index: it maps the v26 store fields (src/store/appearance.ts), which itself imports ./index.
import { THEME_FOR_ACCENT, type LegacyDesign, type Material } from '../store/appearance';
import type { Density } from '../store/density';
import { resolveAccent } from './apply';
import { DEFAULT_THEME_PREFS, type Accent, type Scheme, type ThemePrefs } from './types';

export interface ThemeSource {
    scheme: Scheme;
    accent: Accent;
    customThemeColor: string;
}

export interface EffectiveThemePrefs extends ThemePrefs {
    customAccent: string | null;
}

/**
 * The scheme / accent a window renders. Until its settings are known (`ready` false: store not hydrated, no snapshot yet)
 * the historical look (dark + amber) is shown, so an existing (dark) user never flashes the fresh-install 'system' scheme.
 * Once ready the stored scheme (system / light / dark) is rendered as is; 'system' is resolved by startThemeSync.
 */
export function effectiveThemePrefs(ready: boolean, source: ThemeSource): EffectiveThemePrefs {
    return {
        scheme: ready ? source.scheme : DEFAULT_THEME_PREFS.scheme,
        accent: ready ? source.accent : DEFAULT_THEME_PREFS.accent,
        customAccent: ready && source.accent === 'custom' ? source.customThemeColor : null,
    };
}

export interface RootAppearance {
    accent: Accent;
    customThemeColor: string;
    design: LegacyDesign;
    material: Material;
    density: Density;
}

/**
 * v1 root attributes (data-theme = reverse mapping of the resolved accent; data-design), data-material
 * and data-density (T-602, v27). Call it only once the values are the user's (before that the :root token defaults apply).
 */
export function applyRootAppearance(root: HTMLElement, appearance: RootAppearance): void {
    root.setAttribute('data-theme', THEME_FOR_ACCENT[resolveAccent(appearance.accent, appearance.customThemeColor).accent]);
    root.setAttribute('data-design', appearance.design);
    root.setAttribute('data-material', appearance.material);
    root.setAttribute('data-density', appearance.density);
}
