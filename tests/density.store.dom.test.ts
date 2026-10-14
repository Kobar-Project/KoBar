import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { densityFromSidebarWidth, legacySidebarWidth, profileDensity } from '../src/store/density';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-602 (v27): the store's density field and its v1 view (sidebarWidth); isPopupSmartPositioning defaults to true.
// Synthetic data only.

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
        isPopupSmartPositioning: true,
        enableEyeAnimation: true,
        orientation: 'vertical',
        ...over,
    };
}

beforeEach(() => {
    store.setState(initial, true);
    localStorage.clear();
});

describe('fresh install defaults (T-602)', () => {
    it('normal density, consistent with the default sidebarWidth 46; popups smart (v1 plugins read true)', () => {
        const s = store.getState();
        expect(s.density).toBe('normal');
        expect(s.sidebarWidth).toBe(46);
        expect(densityFromSidebarWidth(s.sidebarWidth)).toBe(s.density);
        expect(s.isPopupSmartPositioning).toBe(true);
    });

    it('persists the density', () => {
        const persisted = store.persist.getOptions().partialize!(store.getState()) as Record<string, unknown>;
        expect(persisted).toMatchObject({ density: 'normal', isPopupSmartPositioning: true });
    });
});

describe('setters keep both views in sync and write the active workspace record', () => {
    beforeEach(() => {
        store.setState({ workspaces: [makeWs('a'), makeWs('b', { sidebarWidth: 80 })], activeWorkspaceId: 'a' });
    });

    it('setDensity keeps a width that already describes it and otherwise writes the token thickness', () => {
        store.getState().setDensity('normal');
        expect(store.getState()).toMatchObject({ density: 'normal', sidebarWidth: 46 });
        store.getState().setDensity('compact');
        expect(store.getState()).toMatchObject({ density: 'compact', sidebarWidth: 40 });
        store.getState().setDensity('comfortable');
        expect(store.getState()).toMatchObject({ density: 'comfortable', sidebarWidth: 56 });
        expect(store.getState().workspaces[0]).toMatchObject({ density: 'comfortable', sidebarWidth: 56 });
        // Plugins can call it (window.useAppStore): invalid input is ignored without any state change.
        const before = store.getState();
        for (const bad of ['cozy', '', null, undefined, 3, {}]) store.getState().setDensity(bad as never);
        expect(store.getState()).toBe(before);
        expect(store.getState().workspaces[1].density).toBeUndefined();
        expect(store.getState().workspaces[1].sidebarWidth).toBe(80);
    });

    it('setSidebarWidth (v1) derives the density (old setter keeps working)', () => {
        store.getState().setSidebarWidth(42);
        expect(store.getState()).toMatchObject({ sidebarWidth: 42, density: 'compact' });
        store.getState().setSidebarWidth(52);
        expect(store.getState().density).toBe('normal');
        store.getState().setSidebarWidth(100);
        expect(store.getState()).toMatchObject({ sidebarWidth: 100, density: 'comfortable' });
        expect(store.getState().workspaces[0]).toMatchObject({ sidebarWidth: 100, density: 'comfortable' });
    });

    it('the other v1 layout setters and the popup setter still work and leave the density alone', () => {
        store.getState().setIconScale(1.4);
        store.getState().setFeatureSpacing(20);
        store.getState().setToggleWidth(30);
        store.getState().setIsPopupSmartPositioning(false);
        expect(store.getState()).toMatchObject({
            iconScale: 1.4,
            featureSpacing: 20,
            toggleWidth: 30,
            isPopupSmartPositioning: false,
            density: 'normal',
        });
        expect(store.getState().workspaces[0]).toMatchObject({ iconScale: 1.4, isPopupSmartPositioning: false });
    });
});

describe('workspace switches carry the density per workspace', () => {
    it('a record without density derives it from its width; a record with density wins', () => {
        store.setState({
            workspaces: [
                makeWs('a'),
                makeWs('wide', { sidebarWidth: 80 }),
                makeWs('dense', { density: 'compact', sidebarWidth: 46 }),
                makeWs('bare'),
            ],
            activeWorkspaceId: 'a',
        });
        store.getState().loadWorkspace('wide');
        expect(store.getState()).toMatchObject({ density: 'comfortable', sidebarWidth: 80 });
        store.getState().loadWorkspace('dense');
        // The stored width wins until T-618 (a switch never moves the bar); the density follows it.
        expect(store.getState()).toMatchObject({ density: 'normal', sidebarWidth: 46 });
        const bare = store.getState().workspaces.find((w) => w.id === 'bare') as Partial<WorkspaceConfig>;
        delete bare.sidebarWidth;
        delete bare.isPopupSmartPositioning;
        store.getState().loadWorkspace('bare');
        expect(store.getState()).toMatchObject({ density: 'normal', sidebarWidth: 46, isPopupSmartPositioning: true });
        // A record without a width but with a density uses the density's token thickness.
        const noWidth = makeWs('no-width', { density: 'compact' }) as Partial<WorkspaceConfig>;
        delete noWidth.sidebarWidth;
        store.setState({ workspaces: [...store.getState().workspaces, noWidth as WorkspaceConfig] });
        store.getState().loadWorkspace('no-width');
        expect(store.getState()).toMatchObject({ density: 'compact', sidebarWidth: 40 });
    });

    it('the leaving workspace keeps its density; a saved workspace records the live density', () => {
        store.setState({ workspaces: [makeWs('a'), makeWs('b')], activeWorkspaceId: 'a' });
        store.getState().setDensity('compact');
        store.getState().loadWorkspace('b');
        expect(store.getState().workspaces[0]).toMatchObject({ density: 'compact', sidebarWidth: 40 });
        expect(store.getState().density).toBe('normal');
        store.getState().setDensity('comfortable');
        store.getState().saveCurrentAsWorkspace('S', false);
        expect(store.getState().workspaces.find((w) => w.name === 'S')).toMatchObject({ density: 'comfortable', sidebarWidth: 56 });
    });
});

describe('helpers and App.tsx (T-602)', () => {
    it('profileDensity / legacySidebarWidth', () => {
        expect(profileDensity({ density: 'compact', sidebarWidth: 80 })).toBe('compact');
        expect(profileDensity({ density: 'cozy', sidebarWidth: 80 })).toBe('comfortable');
        expect(profileDensity({})).toBe('normal');
        expect(legacySidebarWidth('normal', 50)).toBe(50);
        expect(legacySidebarWidth('normal', undefined)).toBe(46);
        expect(legacySidebarWidth('compact', 46)).toBe(40);
        expect(legacySidebarWidth('comfortable', Number.NaN)).toBe(56);
    });

    it('App.tsx writes the root data-density from the store once hydrated', () => {
        // T-608: the attributes are written by the shared helper (src/theme/root.ts, also used by the Settings window).
        const app = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
        const root = readFileSync(resolve(__dirname, '../src/theme/root.ts'), 'utf8');
        expect(app).toContain('applyRootAppearance(document.documentElement, { accent, customThemeColor, design, material, density });');
        expect(root).toContain("root.setAttribute('data-density', appearance.density);");
        expect(app).toMatch(/\[accent, customThemeColor, design, material, density, isHydrated\]/);
    });
});
