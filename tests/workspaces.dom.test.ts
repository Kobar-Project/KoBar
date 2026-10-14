import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { useAppStore, type Note, type WorkspaceConfig } from '../src/store/useAppStore';
import { setupLocalStorageIsolation } from '../src/utils/localStorageIsolation';
import { computeNextNoteId, resolveContextNotes, type ContextState } from '../src/store/workspace/context';
import { installWindowApiMock } from './helpers/windowApi';
import { parseDataImport } from '../src/store/importExport';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test
// tsconfig (useAppStore.ts references it). Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// T-009: behaviour tests for workspaces. Synthetic data only.
// Known bugs are pinned with `it.fails` (WS-01 fixed in T-203, WS-02/WS-08 in T-204, WS-07 in T-209): they PASS today because
// the assertion of the intended behaviour fails. When the bug is fixed the test starts to
// "unexpectedly pass" and must be flipped from `it.fails` to `it`.
// Item 13 (partialize key list) lives in tests/partialize.dom.test.ts; only a light cross-check is here.

const fakeStorage = vi.hoisted(() => {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string): void => { map.set(k, String(v)); },
        removeItem: (k: string): void => { map.delete(k); },
        clear: (): void => map.clear(),
        key: (i: number): string | null => [...map.keys()][i] ?? null,
        get length(): number { return map.size; },
    };
    // Intentionally never unstubbed: the fake must live for the whole file (vitest isolates files).
    vi.stubGlobal('localStorage', storage);
    return { map };
});

const store = useAppStore;

function note(id: number, content: string): Note {
    return { id, title: `T${id}`, icon: 'note', emoji: null, content };
}

const GLOBAL_NOTES = [note(1, 'global-1'), note(2, 'global-2'), note(3, 'global-3'), note(4, 'global-4'), note(5, 'global-5'), note(6, 'global-6')];
const ISO_NOTES = [note(1, 'iso-1'), note(2, 'iso-2')];

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

function isoWs(id: string, notes: Note[], activeNoteId: number, nextNoteId: number, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return makeWs(id, { isIsolated: true, isolatedData: { notes, activeNoteId, nextNoteId, pluginData: {} }, ...over });
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

function getWs(id: string): WorkspaceConfig {
    const ws = store.getState().workspaces.find(w => w.id === id);
    if (!ws) throw new Error(`workspace ${id} missing`);
    return ws;
}

// Baseline: shared mode (no active workspace), six global notes, no workspaces.
function resetStore(): void {
    store.setState({
        workspaces: [],
        activeWorkspaceId: null,
        notes: clone(GLOBAL_NOTES),
        globalNotes: clone(GLOBAL_NOTES),
        activeNoteId: 1,
        nextNoteId: 7,
        currentExtensionsConfig: { base: true },
        isPinInjectorEnabled: false,
        isKoBoxEnabled: false,
        theme: 'midnight',
        sidebarWidth: 46,
    });
}

function setIsolatedActive(id: string): void {
    store.setState({
        workspaces: [isoWs(id, clone(ISO_NOTES), 1, 3)],
        activeWorkspaceId: id,
        notes: clone(ISO_NOTES),
        activeNoteId: 1,
        nextNoteId: 3,
    });
}

// saveCurrentAsWorkspace activates the new workspace; read its id instead of predicting Date.now() ticks
// (the debounced persist writes also call Date.now()).
function newActiveId(previousId: string | null): string {
    const id = store.getState().activeWorkspaceId;
    expect(id).not.toBeNull();
    expect(id).not.toBe(previousId);
    return id as string;
}

let idCounter = 0;

beforeEach(() => {
    resetStore();
    // saveCurrentAsWorkspace uses Date.now() as the id; make it unique per call.
    idCounter = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++idCounter);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('saveCurrentAsWorkspace', () => {
    it('1. isolated save deep-copies the current notes and activates the new workspace', () => {
        // Make the live shared notes differ from globalNotes to pin which one becomes the shared copy.
        store.setState({ notes: [...clone(GLOBAL_NOTES), note(7, 'live-only')], nextNoteId: 8 });
        const liveBefore = clone(store.getState().notes);
        store.getState().saveCurrentAsWorkspace('A', true);
        const s = store.getState();
        const iso = getWs(newActiveId(null)).isolatedData!;
        expect(iso.notes).toEqual(s.notes);
        expect(iso.notes).not.toBe(s.notes);
        expect(iso.notes![0]).not.toBe(s.notes[0]);
        expect(iso.activeNoteId).toBe(s.activeNoteId);
        expect(iso.nextNoteId).toBe(s.nextNoteId);
        // T-204: leaving a shared context, its live notes become the canonical shared copy (like loadWorkspace).
        expect(s.globalNotes).toEqual(liveBefore);
        expect(s.globalNotes).not.toBe(s.notes);
    });

    it('2. WS-02: shared save from inside an isolated workspace shows globalNotes', () => {
        setIsolatedActive('A');
        store.getState().saveCurrentAsWorkspace('B', false);
        const s = store.getState();
        expect(getWs(newActiveId('A')).isIsolated).toBe(false);
        expect(s.notes).toEqual(s.globalNotes);
    });

    it('2b. T-204: shared save from isolated A keeps A and global intact, ids valid; editing does not leak', () => {
        setIsolatedActive('A');
        store.getState().saveCurrentAsWorkspace('B', false);
        let s = store.getState();
        expect(s.globalNotes).toEqual(GLOBAL_NOTES);
        expect(s.notes).not.toBe(s.globalNotes);
        expect(s.notes.some(n => n.id === s.activeNoteId)).toBe(true);
        expect(s.nextNoteId).toBe(7);
        expect(getWs('A').isolatedData!.notes).toEqual(ISO_NOTES);

        store.getState().addNote();
        s = store.getState();
        expect(new Set(s.notes.map(n => n.id)).size).toBe(s.notes.length);
        expect(s.globalNotes).toEqual(s.notes);
        expect(getWs('A').isolatedData!.notes).toEqual(ISO_NOTES);
    });

    it('2c. T-204: isolated save from isolated A copies the live notes, syncs A, keeps pluginData; globalNotes untouched', () => {
        // A's stored copy is behind the live state (extra note, different active note) and has plugin data.
        const live = [...clone(ISO_NOTES), note(3, 'iso-3')];
        store.setState({
            workspaces: [isoWs('A', clone(ISO_NOTES), 1, 3, { isolatedData: { notes: clone(ISO_NOTES), activeNoteId: 1, nextNoteId: 3, pluginData: { k: 'v' } } })],
            activeWorkspaceId: 'A',
            notes: clone(live),
            activeNoteId: 3,
            nextNoteId: 4,
        });
        store.getState().saveCurrentAsWorkspace('C', true);
        const s = store.getState();
        const c = getWs(newActiveId('A')).isolatedData!;
        expect(c.notes).toEqual(live);
        expect(c.activeNoteId).toBe(3);
        expect(c.nextNoteId).toBe(4);
        expect(c.pluginData).toEqual({ k: 'v' });

        const a = getWs('A').isolatedData!;
        expect(a.notes).toEqual(live);
        expect(a.notes).not.toBe(s.notes);
        expect(a.activeNoteId).toBe(3);
        expect(a.nextNoteId).toBe(4);
        expect(a.pluginData).toEqual({ k: 'v' });

        expect(s.notes).toEqual(live);
        expect(s.activeNoteId).toBe(3);
        expect(s.nextNoteId).toBe(4);
        expect(s.globalNotes).toEqual(GLOBAL_NOTES);
    });
});

describe('resolveContextNotes / computeNextNoteId (T-204)', () => {
    const B_ISO = [note(2, 'b-2'), note(9, 'b-9')];

    function state(over: Partial<ContextState<Note>> = {}): ContextState<Note> {
        return {
            workspaces: [isoWs('A', clone(ISO_NOTES), 2, 3), isoWs('B', clone(B_ISO), 9, 4), makeWs('S')],
            activeWorkspaceId: 'A',
            notes: clone(ISO_NOTES),
            activeNoteId: 2,
            nextNoteId: 3,
            globalNotes: clone(GLOBAL_NOTES),
            ...over,
        };
    }

    it('active isolated -> live; inactive isolated -> isolatedData (stale counter repaired)', () => {
        const st = state();
        expect(resolveContextNotes(st, st.workspaces[0])).toEqual({ notes: ISO_NOTES, activeNoteId: 2, nextNoteId: 3 });
        expect(resolveContextNotes(st, st.workspaces[1])).toEqual({ notes: B_ISO, activeNoteId: 9, nextNoteId: 10 });
    });

    it('inactive shared while an isolated workspace is active -> globalNotes; while shared is active -> live', () => {
        const st = state();
        expect(resolveContextNotes(st, st.workspaces[2])).toEqual({ notes: GLOBAL_NOTES, activeNoteId: 1, nextNoteId: 7 });
        expect(resolveContextNotes(st, null).notes).toBe(st.globalNotes);

        const shared = state({ activeWorkspaceId: 'S', notes: clone(GLOBAL_NOTES), activeNoteId: 4, nextNoteId: 12 });
        expect(resolveContextNotes(shared, shared.workspaces[2])).toEqual({ notes: GLOBAL_NOTES, activeNoteId: 4, nextNoteId: 12 });
        expect(resolveContextNotes(shared, null).notes).toBe(shared.notes);
    });

    it('dangling activeNoteId falls back to the first note, empty notes give null', () => {
        const st = state({ activeNoteId: 42 });
        expect(resolveContextNotes(st, st.workspaces[0]).activeNoteId).toBe(1);
        const empty = state({ workspaces: [isoWs('A', [], 5, 1)], activeWorkspaceId: null, notes: [], activeNoteId: 5, nextNoteId: 1 });
        expect(resolveContextNotes(empty, empty.workspaces[0])).toEqual({ notes: [], activeNoteId: null, nextNoteId: 1 });
    });

    it('computeNextNoteId is max(id)+1 with gaps, never below the stored counter', () => {
        expect(computeNextNoteId([note(1, ''), note(7, ''), note(3, '')])).toBe(8);
        expect(computeNextNoteId([note(1, ''), note(7, '')], 3)).toBe(8);
        expect(computeNextNoteId([note(1, '')], 20)).toBe(20);
        expect(computeNextNoteId([])).toBe(1);
        expect(computeNextNoteId([], 5)).toBe(5);
    });
});

describe('addNote', () => {
    it('3a. shared workspace: notes and globalNotes stay in sync', () => {
        store.setState({ workspaces: [makeWs('S')], activeWorkspaceId: 'S' });
        store.getState().addNote();
        const s = store.getState();
        expect(s.notes).toHaveLength(7);
        expect(s.globalNotes).toEqual(s.notes);
    });

    it('3b. isolated workspace: globalNotes untouched, isolatedData.notes updated', () => {
        setIsolatedActive('I');
        store.getState().addNote();
        const s = store.getState();
        expect(s.notes).toHaveLength(3);
        expect(s.globalNotes).toEqual(GLOBAL_NOTES);
        expect(getWs('I').isolatedData!.notes).toEqual(s.notes);
        expect(getWs('I').isolatedData!.nextNoteId).toBe(4);
    });
});

describe('loadWorkspace', () => {
    it('4. snapshots A from live state, applies B, and sends B extensions config (T-409: B over the live mirror)', () => {
        const setExt = installWindowApiMock().setExtensionsConfig;
        store.setState({
            workspaces: [makeWs('A'), makeWs('B', { theme: 'ocean', sidebarWidth: 60, enabledExtensions: { live: false, only: true } })],
            activeWorkspaceId: 'A',
            theme: 'nord',
            sidebarWidth: 55,
            currentExtensionsConfig: { live: true },
        });
        store.getState().loadWorkspace('B');
        const s = store.getState();
        expect(getWs('A').theme).toBe('nord');
        expect(getWs('A').sidebarWidth).toBe(55);
        expect(getWs('A').enabledExtensions).toEqual({ live: true });
        expect(s.activeWorkspaceId).toBe('B');
        expect(s.theme).toBe('ocean');
        expect(s.sidebarWidth).toBe(60);
        expect(setExt).toHaveBeenCalledWith({ live: false, only: true });
    });

    it('4b. T-027: a workspace without featureOrder keeps the current bar (no calendar button added)', () => {
        installWindowApiMock();
        const bar = ['com.kobar.aihub.btn', 'copypaste', 'kobox'];
        for (const featureOrder of [undefined, []]) {
            store.setState({
                workspaces: [makeWs('A'), makeWs('B', { featureOrder: featureOrder as unknown as string[] })],
                activeWorkspaceId: 'A',
                featureOrder: [...bar],
            });
            store.getState().loadWorkspace('B');
            expect(store.getState().featureOrder).toEqual(bar);
            expect(store.getState().featureOrder).not.toContain('ko-calender-plugin-btn');
        }
    });

    it('4c. T-027: no featureOrder on the workspace and an empty current bar fall back to the default list', () => {
        installWindowApiMock();
        store.setState({
            workspaces: [makeWs('A'), makeWs('B', { featureOrder: [] })],
            activeWorkspaceId: 'A',
            featureOrder: [],
        });
        store.getState().loadWorkspace('B');
        expect(store.getState().featureOrder).toEqual([
            'com.kobar.aihub.btn', 'ko-calender-plugin-btn', 'todolist-plugin-btn', 'snippetvault-plugin-btn',
            'pininjector', 'kobox', 'kobar-colorpicker-plugin-btn', 'calculator',
        ]);
    });

    it('5. isolated A -> shared B -> isolated A keeps A notes and activeNoteId', () => {
        store.setState({
            workspaces: [isoWs('A', clone(ISO_NOTES), 2, 3), makeWs('B')],
            activeWorkspaceId: 'A',
            notes: clone(ISO_NOTES),
            activeNoteId: 2,
            nextNoteId: 3,
        });
        store.getState().loadWorkspace('B');
        expect(store.getState().notes).toEqual(GLOBAL_NOTES);
        store.getState().loadWorkspace('A');
        const s = store.getState();
        expect(s.notes).toEqual(ISO_NOTES);
        expect(s.activeNoteId).toBe(2);
        expect(s.nextNoteId).toBe(3);
        expect(s.globalNotes).toEqual(GLOBAL_NOTES);
    });
});

describe('updateWorkspaceSettings', () => {
    it('6. WS-01: a non-active isolated workspace keeps its own notes', () => {
        store.setState({
            workspaces: [makeWs('A'), isoWs('B', clone(ISO_NOTES), 1, 3)],
            activeWorkspaceId: 'A',
        });
        store.getState().updateWorkspaceSettings('B');
        expect(getWs('B').isolatedData!.notes).toEqual(ISO_NOTES);
    });

    // T-203 regression: two isolated workspaces with distinct notes plus a shared one.
    const B_NOTES = [note(1, 'b-only-1'), note(5, 'b-only-5')];

    function setTwoIsolated(): void {
        store.setState({
            workspaces: [
                isoWs('A', clone(ISO_NOTES), 2, 3),
                isoWs('B', clone(B_NOTES), 5, 6),
                makeWs('S'),
            ],
            activeWorkspaceId: 'A',
            notes: clone(ISO_NOTES),
            activeNoteId: 2,
            nextNoteId: 3,
            theme: 'nord',
            sidebarWidth: 55,
        });
    }

    it('6b. updating an inactive isolated workspace copies the profile but not the live notes', () => {
        setTwoIsolated();
        const bIsoBefore = JSON.stringify(getWs('B').isolatedData);
        const aBefore = JSON.stringify(getWs('A'));
        const sBefore = JSON.stringify(getWs('S'));
        const globalBefore = JSON.stringify(store.getState().globalNotes);

        store.getState().updateWorkspaceSettings('B');

        const b = getWs('B');
        expect(JSON.stringify(b.isolatedData)).toBe(bIsoBefore);
        expect(b.isolatedData!.activeNoteId).toBe(5);
        expect(b.isolatedData!.nextNoteId).toBe(6);
        // Profile fields are still taken from the live state (intended behaviour of "Update").
        expect(b.theme).toBe('nord');
        expect(b.sidebarWidth).toBe(55);
        // Nothing else moves.
        expect(JSON.stringify(getWs('A'))).toBe(aBefore);
        expect(JSON.stringify(getWs('S'))).toBe(sBefore);
        expect(JSON.stringify(store.getState().globalNotes)).toBe(globalBefore);
        expect(store.getState().notes).toEqual(ISO_NOTES);
    });

    it('6c. (guards the active path, not a WS-01 regression) updating the active isolated workspace snapshots the live notes into it only', () => {
        setTwoIsolated();
        store.getState().addNote(); // live A now has 3 notes, nextNoteId 4
        const bIsoBefore = JSON.stringify(getWs('B').isolatedData);
        const live = store.getState();

        store.getState().updateWorkspaceSettings('A');

        const a = getWs('A');
        expect(a.isolatedData!.notes).toEqual(live.notes);
        expect(a.isolatedData!.notes).not.toBe(live.notes);
        expect(a.isolatedData!.activeNoteId).toBe(live.activeNoteId);
        expect(a.isolatedData!.nextNoteId).toBe(4);
        expect(a.theme).toBe('nord');
        expect(JSON.stringify(getWs('B').isolatedData)).toBe(bIsoBefore);
        expect(store.getState().globalNotes).toEqual(GLOBAL_NOTES);
    });

    it('6d. from shared mode, updating an isolated workspace leaves its notes intact', () => {
        setTwoIsolated();
        store.setState({ activeWorkspaceId: 'S', notes: clone(GLOBAL_NOTES), activeNoteId: 1, nextNoteId: 7 });
        const aIsoBefore = JSON.stringify(getWs('A').isolatedData);
        const bIsoBefore = JSON.stringify(getWs('B').isolatedData);

        store.getState().updateWorkspaceSettings('A');
        store.getState().updateWorkspaceSettings('B');
        store.getState().updateWorkspaceSettings('S');

        expect(JSON.stringify(getWs('A').isolatedData)).toBe(aIsoBefore);
        expect(JSON.stringify(getWs('B').isolatedData)).toBe(bIsoBefore);
        expect(getWs('S').isolatedData).toBeUndefined();
        expect(store.getState().globalNotes).toEqual(GLOBAL_NOTES);
    });
});

describe('toggleWorkspaceIsolation', () => {
    it('7. active workspace: on moves notes to isolated data, off restores globalNotes', () => {
        store.setState({ workspaces: [makeWs('A')], activeWorkspaceId: 'A' });
        store.getState().toggleWorkspaceIsolation('A');
        expect(getWs('A').isIsolated).toBe(true);
        expect(getWs('A').isolatedData!.notes).toEqual(GLOBAL_NOTES);
        expect(store.getState().globalNotes).toEqual(GLOBAL_NOTES);

        store.getState().addNote(); // isolated edit must not leak into globalNotes
        expect(store.getState().notes).toHaveLength(7);
        expect(store.getState().globalNotes).toEqual(GLOBAL_NOTES);

        store.getState().toggleWorkspaceIsolation('A');
        const s = store.getState();
        expect(getWs('A').isIsolated).toBe(false);
        expect(s.notes).toEqual(GLOBAL_NOTES);
        expect(s.nextNoteId).toBe(7);
    });

    it('8. WS-08: toggling a non-active workspace yields nextNoteId > max(id)', () => {
        // Active isolated A is small (nextNoteId 3); B is shared and inactive; global has ids 1-6.
        store.setState({
            workspaces: [isoWs('A', clone(ISO_NOTES), 1, 3), makeWs('B')],
            activeWorkspaceId: 'A',
            notes: clone(ISO_NOTES),
            activeNoteId: 1,
            nextNoteId: 3,
        });
        store.getState().toggleWorkspaceIsolation('B');
        const iso = getWs('B').isolatedData!;
        const maxId = Math.max(...iso.notes!.map(n => n.id));
        expect(iso.nextNoteId).toBeGreaterThan(maxId);
    });

    it('8b. T-204: inactive toggle takes a consistent context; adding a note in B never collides', () => {
        store.setState({
            workspaces: [isoWs('A', clone(ISO_NOTES), 2, 3), makeWs('B')],
            activeWorkspaceId: 'A',
            notes: clone(ISO_NOTES),
            activeNoteId: 2,
            nextNoteId: 3,
        });
        store.getState().toggleWorkspaceIsolation('B');
        const iso = getWs('B').isolatedData!;
        expect(iso.notes).toEqual(GLOBAL_NOTES);
        expect(iso.notes).not.toBe(store.getState().globalNotes);
        expect(iso.activeNoteId).toBe(1);
        expect(iso.nextNoteId).toBe(7);
        // Live A context is untouched.
        expect(store.getState().notes).toEqual(ISO_NOTES);
        expect(getWs('A').isolatedData!.notes).toEqual(ISO_NOTES);

        store.getState().loadWorkspace('B');
        store.getState().addNote();
        const s = store.getState();
        expect(new Set(s.notes.map(n => n.id)).size).toBe(s.notes.length);
        expect(s.notes.some(n => n.id === s.activeNoteId)).toBe(true);
    });

    it('8c. T-204: loading an isolated workspace with a stale counter repairs nextNoteId (existing WS-08 data)', () => {
        store.setState({
            workspaces: [makeWs('A'), isoWs('B', clone(GLOBAL_NOTES), 99, 3)],
            activeWorkspaceId: 'A',
        });
        store.getState().loadWorkspace('B');
        const s = store.getState();
        expect(s.nextNoteId).toBe(7);
        expect(s.activeNoteId).toBe(1);
    });
});

describe('deleteWorkspace', () => {
    it('9. deleting the active isolated workspace falls back to globalNotes', () => {
        setIsolatedActive('A');
        store.getState().deleteWorkspace('A');
        const s = store.getState();
        expect(s.activeWorkspaceId).toBeNull();
        expect(s.workspaces).toHaveLength(0);
        expect(s.notes).toEqual(GLOBAL_NOTES);
        expect(s.nextNoteId).toBe(7);
    });
});

// getIsolatedKey is module-private; it is observable through the patched localStorage.
// jsdom's Storage does not allow overriding setItem/getItem/... on the instance (the assignment
// would create items named "setItem"), so the file runs against a Map-backed fake installed
// (via vi.hoisted) before the isolation module binds the original methods at import time.
describe('localStorage isolation (getIsolatedKey and clear)', () => {
    // Un-patched access that bypasses isolation.
    const rawSet = (k: string, v: string): void => { fakeStorage.map.set(k, v); };
    const rawKeys = (): string[] => [...fakeStorage.map.keys()].sort();

    beforeAll(() => {
        setupLocalStorageIsolation();
    });

    afterEach(() => {
        // Back to shared mode and an empty storage.
        store.setState({ workspaces: [], activeWorkspaceId: null });
        fakeStorage.map.clear();
    });

    it('10. system keys never get a suffix; isolated active gets _iso_<id>; shared gets none', () => {
        store.setState({ workspaces: [isoWs('I', [], 1, 1), makeWs('S')], activeWorkspaceId: 'I' });
        window.localStorage.setItem('plugin_data', 'x');
        window.localStorage.setItem('kobar-storage', 'sys');
        window.localStorage.setItem('kobar_language', 'tr');
        expect(rawKeys()).toEqual(['kobar-storage', 'kobar_language', 'plugin_data_iso_I']);
        expect(window.localStorage.getItem('plugin_data')).toBe('x');

        store.setState({ activeWorkspaceId: 'S' });
        window.localStorage.setItem('plugin_data', 'shared');
        expect(rawKeys()).toContain('plugin_data');
        expect(rawKeys()).not.toContain('plugin_data_iso_S');
    });

    it('11. clear() in isolated mode removes only the suffixed keys (documents today)', () => {
        rawSet('plugin_data', 'global');
        rawSet('plugin_data_iso_I', 'iso');
        rawSet('plugin_data_iso_OTHER', 'other-iso');
        rawSet('kobar-storage', 'sys');
        store.setState({ workspaces: [isoWs('I', [], 1, 1)], activeWorkspaceId: 'I' });
        window.localStorage.clear();
        expect(rawKeys()).toEqual(['kobar-storage', 'plugin_data', 'plugin_data_iso_OTHER']);
    });
});

describe('persistence cross-checks', () => {
    it('12. migrate(v20, 20) fills globalNotes, globalPluginData and isIsolated=false', () => {
        const v20 = {
            notes: [note(1, 'n')],
            nextNoteId: 2,
            workspaces: [{ id: 'w1', name: 'W', theme: 'midnight' }],
        };
        const out = migrateKobarStorage(clone(v20), 20);
        expect(out.globalNotes).toEqual(v20.notes);
        expect(out.globalPluginData).toBeDefined();
        expect(out.workspaces[0].isIsolated).toBe(false);
    });

    it('13. partialize still persists the workspace-related keys (full list: partialize.dom.test.ts)', () => {
        const partialize = store.persist.getOptions().partialize!;
        const keys = Object.keys(partialize(store.getState()) as Record<string, unknown>);
        expect(keys).toEqual(expect.arrayContaining(['workspaces', 'activeWorkspaceId', 'globalNotes', 'globalPluginData', 'notes']));
    });
});

describe('data import (WS-07, fixed in T-209)', () => {
    const importText = JSON.stringify({ notes: [note(99, 'imported'), { ...note(98, 'settings-tab'), isSettings: true }] });

    it('14. WS-07: importing in an isolated context also updates isolatedData.notes', () => {
        setIsolatedActive('I');
        store.getState().addNotes(parseDataImport(importText));
        const s = store.getState();
        expect(s.notes.map(n => n.content)).toEqual(['iso-1', 'iso-2', 'imported']);
        expect(s.notes.map(n => n.id)).toEqual([1, 2, 3]);
        expect(s.nextNoteId).toBe(4);
        expect(s.activeNoteId).toBe(1);
        expect(getWs('I').isolatedData!.notes).toEqual(s.notes);
        expect(getWs('I').isolatedData!.nextNoteId).toBe(4);
        expect(s.globalNotes).toEqual(GLOBAL_NOTES);
    });

    it('14b. importing in the shared context also updates globalNotes', () => {
        store.getState().addNotes(parseDataImport(importText));
        const s = store.getState();
        expect(s.notes.at(-1)).toMatchObject({ id: 7, content: 'imported' });
        expect(s.globalNotes).toEqual(s.notes);
        expect(s.nextNoteId).toBe(8);
    });

    it('14c. ids never collide with existing notes even if nextNoteId is stale', () => {
        store.setState({ nextNoteId: 2 });
        store.getState().addNotes(parseDataImport(importText));
        expect(store.getState().notes.at(-1)!.id).toBe(7);
    });
});
