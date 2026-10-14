// T-608: the Settings window renders the main window's appearance (scheme, accent incl. a custom colour, material, density)
// from the read-only mirror, with the same helpers as src/App.tsx (src/theme/root.ts: the same hydration gate), so
// Settings › Appearance previews a change as soon as the main window applied it. Values from the snapshot are checked; an unknown
// value falls back to the store default. While the main window is not ready (state null) the last applied look is kept.
import {
    DEFAULT_ACCENT,
    DEFAULT_CUSTOM_THEME_COLOR,
    DEFAULT_MATERIAL,
    DEFAULT_SCHEME,
    isAccent,
    isMaterial,
    isScheme,
    type LegacyDesign,
} from '../store/appearance';
import { DEFAULT_DENSITY, isDensity } from '../store/density';
import { startThemeSync } from '../theme';
import { applyRootAppearance, effectiveThemePrefs, type RootAppearance, type ThemeSource } from '../theme/root';
import type { SettingsMirrorState } from './mirror';

export type MirroredAppearance = ThemeSource & RootAppearance;

/** The part of the mirror store this module uses (src/settings/mirror.ts `settingsMirror.store`). */
export interface MirrorStoreLike {
    getState(): SettingsMirrorState;
    subscribe(listener: (state: SettingsMirrorState) => void): () => void;
}

/** The appearance fields of a snapshot, each one validated (unknown values -> store defaults). */
export function readMirroredAppearance(state: Partial<Record<string, unknown>>): MirroredAppearance {
    const design: LegacyDesign = state.design === 'style2' ? 'style2' : 'style1';
    return {
        scheme: isScheme(state.scheme) ? state.scheme : DEFAULT_SCHEME,
        accent: isAccent(state.accent) ? state.accent : DEFAULT_ACCENT,
        customThemeColor: typeof state.customThemeColor === 'string' ? state.customThemeColor : DEFAULT_CUSTOM_THEME_COLOR,
        design,
        material: isMaterial(state.material) ? state.material : DEFAULT_MATERIAL,
        density: isDensity(state.density) ? state.density : DEFAULT_DENSITY,
    };
}

/**
 * Applies the defaults now (dark + amber, normal density, solid material: what the main window shows before hydration) and then
 * every mirrored appearance change to `root`. Returns the stop function.
 */
export function startSettingsAppearanceSync(store: MirrorStoreLike, root: HTMLElement) {
    let stopTheme: () => void = () => {};
    let themeKey = '';

    function applyTheme(ready: boolean, source: ThemeSource): void {
        const prefs = effectiveThemePrefs(ready, source);
        const key = JSON.stringify(prefs);
        if (key === themeKey) return;
        themeKey = key;
        stopTheme();
        stopTheme = startThemeSync(root, prefs);
    }

    function apply(mirror: SettingsMirrorState): void {
        if (mirror.status !== 'ready' || !mirror.state) return;
        const appearance = readMirroredAppearance(mirror.state as unknown as Partial<Record<string, unknown>>);
        applyTheme(true, appearance);
        applyRootAppearance(root, appearance);
    }

    applyTheme(false, { scheme: DEFAULT_SCHEME, accent: DEFAULT_ACCENT, customThemeColor: DEFAULT_CUSTOM_THEME_COLOR });
    root.setAttribute('data-density', DEFAULT_DENSITY);
    root.setAttribute('data-material', DEFAULT_MATERIAL);
    apply(store.getState());
    const unsubscribe = store.subscribe(apply);
    return () => {
        unsubscribe();
        stopTheme();
    };
}
