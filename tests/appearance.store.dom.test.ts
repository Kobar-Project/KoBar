import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { accentFromLegacy, materialFromLegacy } from '../src/store/appearance';
import { FORCED_THEME_COLOR_KEY } from '../src/store/migrations';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-601 (v26): the store's appearance fields (scheme / accent / material) and their v1 view
// (theme / customThemeColor / design / glassOpacity). Synthetic data only.

vi.hoisted(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string): void => {
            map.set(k, String(v));
        },
        removeItem: (k: string): void => {
            map.delete(k);
        },
        clear: (): void => map.clear(),
        key: (i: number): string | null => [...map.keys()][i] ?? null,
        get length(): number {
            return map.size;
        },
    });
});

const store = useAppStore;
const initial = store.getState();

function makeWs(id: string, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated: false,
        isPinInjectorEnabled: false,
        isKoBoxEnabled: false,
        koBoxCleanupMode: '24h',
        toggleWidth: 22,
        sidebarWidth: 46,
        iconScale: 0.8,
        featureSpacing: 8,
        showTooltips: true,
        theme: 'ember',
        customThemeColor: '#f4a125',
        design: 'style1',
        glassOpacity: 60,
        featureOrder: ['calculator'],
        edgePosition: 'right',
        isPopupSmartPositioning: false,
        enableEyeAnimation: true,
        orientation: 'vertical',
        ...over,
    };
}

/** The v1 fields always describe the v26 fields (src/store/appearance.ts). */
function expectConsistent(profile: Partial<WorkspaceConfig> & { accent?: unknown; material?: unknown }) {
    expect(accentFromLegacy(profile.theme, profile.customThemeColor)).toBe(profile.accent);
    expect(materialFromLegacy(profile.design, profile.glassOpacity)).toBe(profile.material);
}

beforeEach(() => {
    store.setState(initial, true);
    localStorage.clear();
});

describe('fresh install defaults (T-601)', () => {
    it('follows the system scheme, amber accent, solid material; the v1 fields agree', () => {
        const s = store.getState();
        expect(s.scheme).toBe('system');
        expect(s.accent).toBe('amber');
        expect(s.material).toBe('solid');
        expect(s.theme).toBe('ember');
        expect(s.customThemeColor).toBe('#f4a125');
        expect(s.design).toBe('style1');
        expectConsistent(s);
    });

    it('persists the three v26 fields', () => {
        const persisted = store.persist.getOptions().partialize!(store.getState()) as Record<string, unknown>;
        expect(persisted).toMatchObject({ scheme: 'system', accent: 'amber', material: 'solid' });
    });
});

describe('setters keep both views in sync and write the active workspace record', () => {
    beforeEach(() => {
        store.setState({ workspaces: [makeWs('a'), makeWs('b', { theme: 'nord' })], activeWorkspaceId: 'a' });
    });

    it('setScheme is global (never written into a workspace record)', () => {
        const before = store.getState().workspaces;
        store.getState().setScheme('light');
        expect(store.getState().scheme).toBe('light');
        expect(store.getState().workspaces).toBe(before);
    });

    it('setTheme (v1) sets the mapped accent and keeps the chosen theme name', () => {
        store.getState().setTheme('lavender');
        const s = store.getState();
        expect(s.theme).toBe('lavender');
        expect(s.accent).toBe('violet');
        expect(s.workspaces[0]).toMatchObject({ theme: 'lavender', accent: 'violet' });
        expect(s.workspaces[1].accent).toBeUndefined();
        expectConsistent(s);
    });

    it('setCustomThemeColor (v1): custom accent, preset hex -> preset; writes the 1.2.x key', () => {
        store.getState().setCustomThemeColor('aa22cc');
        expect(store.getState()).toMatchObject({ theme: 'custom', customThemeColor: '#aa22cc', accent: 'custom' });
        expect(localStorage.getItem(FORCED_THEME_COLOR_KEY)).toBe('#aa22cc');
        store.getState().setCustomThemeColor('#F4A125');
        expect(store.getState().accent).toBe('amber');
        expectConsistent(store.getState());
        expect(store.getState().workspaces[0]).toMatchObject({ theme: 'custom', customThemeColor: '#F4A125', accent: 'amber' });
    });

    it('setAccent: a preset keeps a theme that already maps to it, otherwise uses the reverse mapping', () => {
        store.getState().setTheme('lavender');
        store.getState().setAccent('violet');
        expect(store.getState().theme).toBe('lavender');
        store.getState().setAccent('blue');
        expect(store.getState()).toMatchObject({ accent: 'blue', theme: 'ocean' });
        expect(store.getState().workspaces[0]).toMatchObject({ accent: 'blue', theme: 'ocean' });
        expectConsistent(store.getState());
    });

    it('setAccent custom stores the hex in customThemeColor; a preset hex selects the preset', () => {
        store.getState().setAccent('custom', '#123456');
        expect(store.getState()).toMatchObject({ accent: 'custom', theme: 'custom', customThemeColor: '#123456' });
        expect(localStorage.getItem(FORCED_THEME_COLOR_KEY)).toBe('#123456');
        store.getState().setAccent('custom', '#4ca8f5');
        expect(store.getState()).toMatchObject({ accent: 'blue', theme: 'custom', customThemeColor: '#4ca8f5' });
        expectConsistent(store.getState());
    });

    it('setDesign / setGlassOpacity (v1) derive the material', () => {
        store.getState().setDesign('style2');
        expect(store.getState().material).toBe('translucent');
        store.getState().setGlassOpacity(95);
        expect(store.getState().material).toBe('solid');
        expect(store.getState().workspaces[0]).toMatchObject({ design: 'style2', glassOpacity: 95, material: 'solid' });
        store.getState().setGlassOpacity(30);
        expect(store.getState().material).toBe('translucent');
        expectConsistent(store.getState());
    });

    it('setMaterial keeps v1 values that already describe it and fills the rest', () => {
        store.getState().setMaterial('translucent');
        expect(store.getState()).toMatchObject({ material: 'translucent', design: 'style2', glassOpacity: 60 });
        store.getState().setGlassOpacity(95);
        store.getState().setMaterial('translucent');
        expect(store.getState()).toMatchObject({ material: 'translucent', design: 'style2', glassOpacity: 82 });
        store.getState().setMaterial('solid');
        expect(store.getState()).toMatchObject({ material: 'solid', design: 'style1', glassOpacity: 82 });
        expect(store.getState().workspaces[0]).toMatchObject({ material: 'solid', design: 'style1' });
        expectConsistent(store.getState());
    });
});

describe('robustness (T-601)', () => {
    it('a failing write of the 1.2.x colour key does not stop the colour change', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => store.getState().setCustomThemeColor('#aa22cc')).not.toThrow();
        expect(() => store.getState().setAccent('custom', '#123456')).not.toThrow();
        expect(store.getState()).toMatchObject({ accent: 'custom', customThemeColor: '#123456' });
        setItem.mockRestore();
        warn.mockRestore();
    });

    it('App.tsx renders the stored scheme once hydrated (R-02)', () => {
        const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
        const root = readFileSync(resolve(__dirname, '../src/theme/root.ts'), 'utf8');
        expect(root).not.toContain('LIGHT_SCHEME_READY');
        expect(root).toMatch(/scheme: ready \? source\.scheme : DEFAULT_THEME_PREFS\.scheme/);
        expect(app).toMatch(/effectiveThemePrefs\(isHydrated, \{ scheme, accent, customThemeColor \}\)/);
        expect(store.getState().scheme).toBe('system');
    });
});

describe('workspace switches carry accent/material per workspace', () => {
    it('a record without v26 fields derives them; a missing theme follows the accent (no "midnight" fallback)', () => {
        const legacy = makeWs('old', { theme: 'nord', design: 'style2', glassOpacity: 40 });
        const bare = makeWs('bare');
        delete (bare as Partial<WorkspaceConfig>).theme;
        store.setState({ workspaces: [makeWs('a'), legacy, bare], activeWorkspaceId: 'a' });
        store.getState().loadWorkspace('old');
        expect(store.getState()).toMatchObject({ accent: 'graphite', material: 'translucent', theme: 'nord', glassOpacity: 40 });
        store.getState().loadWorkspace('bare');
        expect(store.getState()).toMatchObject({ accent: 'amber', theme: 'ember', material: 'solid' });
        expectConsistent(store.getState());
    });

    it('a record with v26 fields wins and the leaving workspace keeps its accent/material', () => {
        store.setState({
            workspaces: [
                makeWs('a'),
                makeWs('v26', { accent: 'pink', material: 'translucent', theme: 'sakura', design: 'style2', glassOpacity: 50 }),
            ],
            activeWorkspaceId: 'a',
        });
        store.getState().setAccent('green');
        store.getState().loadWorkspace('v26');
        expect(store.getState()).toMatchObject({ accent: 'pink', material: 'translucent', theme: 'sakura' });
        expect(store.getState().workspaces[0]).toMatchObject({ accent: 'green', theme: 'emerald', material: 'solid' });
        store.getState().loadWorkspace('a');
        expect(store.getState()).toMatchObject({ accent: 'green', theme: 'emerald' });
    });

    it('a saved workspace records the live accent and material', () => {
        store.getState().setAccent('red');
        store.getState().setMaterial('translucent');
        store.getState().saveCurrentAsWorkspace('S', false);
        const saved = store.getState().workspaces.find((w) => w.name === 'S');
        expect(saved).toMatchObject({ accent: 'red', material: 'translucent', theme: 'crimson', design: 'style2' });
    });
});
