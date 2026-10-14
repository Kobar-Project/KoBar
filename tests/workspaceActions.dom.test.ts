import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type AppState, type Note, type WorkspaceConfig } from '../src/store/useAppStore';
import { setSettingsOpener } from '../src/store/settingsOpener';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-407 (ARC-07): profile setters and note actions now go through patchActiveWorkspace / writeActiveContextNotes.
// Store-level pins of what they write (values and reference identity) in every workspace mode. Synthetic data only.

// Map-backed fake localStorage (same pattern as tests/workspaceContext.dom.test.ts).
vi.hoisted(() => {
    const map = new Map<string, string>();
    const storage = {
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
    };
    // Intentionally never unstubbed: vitest isolates test files.
    vi.stubGlobal('localStorage', storage);
});

const store = useAppStore;

function note(id: number, content: string): Note {
    return { id, title: `T${id}`, icon: 'note', emoji: null, content };
}

function makeWs(id: string, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated: false,
        enabledExtensions: { [`ext-${id}`]: true },
        isPinInjectorEnabled: false,
        isKoBoxEnabled: false,
        koBoxCleanupMode: '24h',
        toggleWidth: 22,
        sidebarWidth: 46,
        iconScale: 0.8,
        featureSpacing: 8,
        showTooltips: true,
        theme: 'midnight',
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

const LIVE = [note(1, 'live-1'), note(2, 'live-2')];
const GLOBAL = [note(1, 'global-1'), note(5, 'global-5')];

type Mode = 'none' | 'shared' | 'isolated';

/** The workspaces array right after the last setup(), to pin reference identity. */
let wsBefore: WorkspaceConfig[] = [];

/** Workspaces A (isolated) and S (shared); `mode` picks which one is active. */
function setup(mode: Mode): void {
    store.setState({
        workspaces: [
            makeWs('A', { isIsolated: true, isolatedData: { notes: [...LIVE], activeNoteId: 2, nextNoteId: 3, pluginData: { p: 1 } } }),
            makeWs('S'),
        ],
        activeWorkspaceId: mode === 'none' ? null : mode === 'shared' ? 'S' : 'A',
        notes: [...LIVE],
        globalNotes: [...GLOBAL],
        activeNoteId: 2,
        nextNoteId: 3,
        currentExtensionsConfig: { base: true },
        sidebarWidth: 46,
        isNotePanelOpen: false,
    });
    wsBefore = store.getState().workspaces;
}

const ACTIVE_INDEX: Record<Mode, number | null> = { none: null, shared: 1, isolated: 0 };

// Every profile setter that mirrors its field into the active workspace. Values differ from the makeWs() defaults.
type ProfileField = keyof WorkspaceConfig & keyof AppState;
const PROFILE_SETTERS: Array<[keyof AppState, ProfileField, unknown]> = [
    ['setEdgePosition', 'edgePosition', 'left'],
    ['setOrientation', 'orientation', 'horizontal'],
    ['setTheme', 'theme', 'ocean'],
    ['setCustomThemeColor', 'customThemeColor', '#123456'],
    ['setDesign', 'design', 'style2'],
    ['setGlassOpacity', 'glassOpacity', 33],
    ['setShowTooltips', 'showTooltips', false],
    ['setSidebarWidth', 'sidebarWidth', 99],
    ['setIconScale', 'iconScale', 1.25],
    ['setIsPinInjectorEnabled', 'isPinInjectorEnabled', true],
    ['setIsKoBoxEnabled', 'isKoBoxEnabled', true],
    ['setKoBoxCleanupMode', 'koBoxCleanupMode', 'quit'],
    ['setIsPopupSmartPositioning', 'isPopupSmartPositioning', true],
    ['setFeatureOrder', 'featureOrder', ['notes', 'calculator']],
    ['setToggleWidth', 'toggleWidth', 30],
    ['setFeatureSpacing', 'featureSpacing', 12],
    ['setEnableEyeAnimation', 'enableEyeAnimation', false],
];
const PROFILE_CASES = PROFILE_SETTERS.flatMap(([setter, field, value]) =>
    (['none', 'shared', 'isolated'] as const).map((mode) => [setter, mode, field, value] as const)
);

describe('profile setters write the live field and the active workspace', () => {
    it.each(PROFILE_CASES)('%s (%s)', (setter, mode, field, value) => {
        setup(mode);
        (store.getState()[setter] as (v: unknown) => void)(value);
        const s = store.getState();
        expect(s[field]).toEqual(value);
        const idx = ACTIVE_INDEX[mode];
        if (idx === null) {
            expect(s.workspaces).toBe(wsBefore);
            return;
        }
        expect(s.workspaces).not.toBe(wsBefore);
        expect(s.workspaces[idx][field]).toEqual(value);
        expect(s.workspaces[1 - idx]).toBe(wsBefore[1 - idx]);
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('setSidebarWidth / setOrientation / setFeatureOrder (%s)', (mode) => {
        setup(mode);
        const before = store.getState().workspaces;
        store.getState().setSidebarWidth(99);
        const s = store.getState();
        expect(s.sidebarWidth).toBe(99);
        const idx = ACTIVE_INDEX[mode];
        if (idx === null) {
            expect(s.workspaces).toBe(before);
            return;
        }
        expect(s.workspaces).not.toBe(before);
        expect(s.workspaces[idx].sidebarWidth).toBe(99);
        expect(s.workspaces[1 - idx]).toBe(before[1 - idx]);

        store.getState().setOrientation('horizontal');
        const o = store.getState();
        expect([o.orientation, o.edgePosition, o.sidebarPosition]).toEqual(['horizontal', 'bottom', null]);
        expect([o.workspaces[idx].orientation, o.workspaces[idx].edgePosition]).toEqual(['horizontal', 'bottom']);

        const order = ['notes', 'calculator'];
        store.getState().setFeatureOrder(order);
        const f = store.getState();
        expect(f.featureOrder).toBe(order);
        expect(f.workspaces[idx].featureOrder).toEqual(order);
        expect(f.workspaces[idx].featureOrder).not.toBe(order);
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('setExtensionEnabledInWorkspace (%s)', (mode) => {
        setup(mode);
        const before = store.getState().workspaces;
        store.getState().setExtensionEnabledInWorkspace('x', false);
        const s = store.getState();
        expect(s.currentExtensionsConfig).toEqual({ base: true, x: false });
        const idx = ACTIVE_INDEX[mode];
        if (idx === null) {
            expect(s.workspaces).toBe(before);
            return;
        }
        const id = before[idx].id;
        expect(s.workspaces[idx].enabledExtensions).toEqual({ [`ext-${id}`]: true, x: false });
        expect(s.workspaces[1 - idx]).toBe(before[1 - idx]);
    });
});

describe('note actions write the live notes and the active context owner', () => {
    function expectOwner(mode: Mode, fields: { activeNoteId?: number; nextNoteId?: number }): void {
        const s = store.getState();
        if (mode === 'isolated') {
            expect(s.globalNotes).toEqual(GLOBAL);
            expect(s.workspaces[1]).toBe(wsBefore[1]);
            expect(s.workspaces[0].isolatedData).toEqual({
                notes: s.notes,
                activeNoteId: fields.activeNoteId ?? 2,
                nextNoteId: fields.nextNoteId ?? 3,
                pluginData: { p: 1 },
            });
        } else {
            expect(s.globalNotes).toBe(s.notes);
            expect(s.workspaces).toBe(wsBefore);
        }
    }

    it.each<Mode>(['none', 'shared', 'isolated'])('setActiveNoteId (%s)', (mode) => {
        setup(mode);
        const globalBefore = store.getState().globalNotes;
        store.getState().setActiveNoteId(1);
        const s = store.getState();
        expect(s.activeNoteId).toBe(1);
        expect(s.globalNotes).toBe(globalBefore);
        if (mode === 'isolated') expect(s.workspaces[0].isolatedData?.activeNoteId).toBe(1);
        else expect(s.workspaces[0].isolatedData?.activeNoteId).toBe(2);
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('addNote / addNotes / deleteNote (%s)', (mode) => {
        setup(mode);
        store.getState().addNote();
        let s = store.getState();
        expect(s.notes.map((n) => n.id)).toEqual([1, 2, 3]);
        expect([s.activeNoteId, s.nextNoteId]).toEqual([3, 4]);
        expectOwner(mode, { activeNoteId: 3, nextNoteId: 4 });

        store.getState().addNotes([note(0, 'imported-a'), note(0, 'imported-b')]);
        s = store.getState();
        expect(s.notes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
        expect([s.activeNoteId, s.nextNoteId]).toEqual([3, 6]);
        expectOwner(mode, { activeNoteId: 3, nextNoteId: 6 });

        store.getState().deleteNote(3);
        s = store.getState();
        expect(s.notes.map((n) => n.id)).toEqual([1, 2, 4, 5]);
        expect([s.activeNoteId, s.nextNoteId]).toEqual([1, 6]);
        expectOwner(mode, { activeNoteId: 1, nextNoteId: 6 });
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('updateNoteContent / Title / Emoji (%s)', (mode) => {
        setup(mode);
        store.getState().updateNoteContent(2, 'edited');
        store.getState().updateNoteTitle(2, 'Title');
        store.getState().updateNoteEmoji(2, 'x');
        const s = store.getState();
        expect(s.notes[1]).toEqual({ ...LIVE[1], content: 'edited', title: 'Title', emoji: 'x' });
        expect(s.notes[0]).toBe(LIVE[0]);
        expect([s.activeNoteId, s.nextNoteId]).toEqual([2, 3]);
        expectOwner(mode, {});
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('openSettingsTab / openPluginsTab only ask the Settings window opener (%s)', (mode) => {
        setup(mode);
        const opener = vi.fn();
        setSettingsOpener(opener);
        const notesBefore = store.getState().notes;
        store.getState().openSettingsTab();
        store.getState().openPluginsTab();
        setSettingsOpener(null);
        expect(opener.mock.calls).toEqual([['general'], ['plugins']]);
        expect(store.getState().notes).toBe(notesBefore);
    });

    it.each<Mode>(['none', 'shared', 'isolated'])('openPluginSettings opens the plugin host tab and reuses it (%s)', (mode) => {
        setup(mode);
        store.getState().openPluginSettings('a');
        let s = store.getState();
        expect(s.isNotePanelOpen).toBe(true);
        expect(s.selectedPluginId).toBe('a');
        expect(s.notes[2]).toMatchObject({ id: 3, isPlugins: true });
        expect([s.activeNoteId, s.nextNoteId]).toEqual([3, 4]);
        expectOwner(mode, { activeNoteId: 3, nextNoteId: 4 });

        const notesBefore = s.notes;
        store.getState().openPluginSettings(null);
        s = store.getState();
        expect(s.notes).toBe(notesBefore);
        expect(s.selectedPluginId).toBeNull();
        expect([s.activeNoteId, s.nextNoteId]).toEqual([3, 4]);
    });
});

beforeEach(() => {
    setup('none');
});
