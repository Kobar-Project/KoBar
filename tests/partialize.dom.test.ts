import { describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test
// tsconfig (useAppStore.ts references it). Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// T-008: pins the exact list of fields persisted under `kobar-storage` (v22 since T-205; v26 since T-601; v27 since T-602; v29 since T-604; v30 since T-615d: no settingsWorkspaceViewMode).
// Regression shield for WS-06; update deliberately together with a migration.

function getPersisted(): Record<string, unknown> {
    const state = useAppStore.getState();
    const partialize = useAppStore.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');
    return partialize!(state) as Record<string, unknown>;
}

describe('useAppStore partialize', () => {
    it('persists exactly the pinned key list', () => {
        expect(Object.keys(getPersisted()).sort()).toEqual([
            'accent',
            'activeNoteId',
            'activeWorkspaceId',
            'currentExtensionsConfig',
            'customThemeColor',
            'defaultExtensionsConfig',
            'density',
            'design',
            'edgePosition',
            'enableEyeAnimation',
            'featureOrder',
            'featureSpacing',
            'glassOpacity',
            'globalNotes',
            'globalPluginData',
            'iconScale',
            'isKoBoxEnabled',
            'isPinInjectorEnabled',
            'isPopupSmartPositioning',
            'koBoxCleanupMode',
            'language',
            'launchAtStartup',
            'legacyBackup',
            'material',
            'nextNoteId',
            'noteListWidth',
            'notePanelHeight',
            'notePanelWidth',
            'notes',
            'onboarding',
            'orientation',
            'pluginPanelOffsets',
            'scheme',
            'settingsFeatureViewMode',
            'showTooltips',
            'sidebarWidth',
            'theme',
            'toggleWidth',
            'tutorialState',
            'workspaces',
        ]);
    });

    it('WS-06 fixed in v22 (T-205): the three layout settings are persisted with their live values', () => {
        const persisted = getPersisted();
        const state = useAppStore.getState();
        expect(persisted.toggleWidth).toBe(state.toggleWidth);
        expect(persisted.featureSpacing).toBe(state.featureSpacing);
        expect(persisted.isPopupSmartPositioning).toBe(state.isPopupSmartPositioning);

        const before = { ...state };
        state.setToggleWidth(40);
        state.setFeatureSpacing(20);
        state.setIsPopupSmartPositioning(!before.isPopupSmartPositioning);
        const after = getPersisted();
        expect(after.toggleWidth).toBe(40);
        expect(after.featureSpacing).toBe(20);
        expect(after.isPopupSmartPositioning).toBe(!before.isPopupSmartPositioning);
        useAppStore.setState({
            toggleWidth: before.toggleWidth,
            featureSpacing: before.featureSpacing,
            isPopupSmartPositioning: before.isPopupSmartPositioning,
        });
    });

    it('does not persist transient / runtime fields', () => {
        const keys = Object.keys(getPersisted());
        for (const key of ['currentMedia', 'activeVideoUrls', 'isDraggingGlobal', 'isHydrated']) {
            expect(keys).not.toContain(key);
        }
    });

    it('contains no functions and survives a JSON round trip', () => {
        const persisted = getPersisted();
        for (const [key, value] of Object.entries(persisted)) {
            expect(typeof value, key).not.toBe('function');
        }
        expect(JSON.parse(JSON.stringify(persisted))).toEqual(persisted);
    });
});
