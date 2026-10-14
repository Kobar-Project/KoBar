import { describe, expect, it } from 'vitest';
import type { AppState, Note, WorkspaceConfig } from '../src/store/useAppStore';
import { findActiveWorkspace, patchActiveWorkspace } from '../src/store/workspace/activeWorkspace';
import { activeContextId, contextIdOf, GLOBAL_CONTEXT_ID, workspaceIdOfContext, type ContextId } from '../src/store/workspace/contextId';
import {
    readActiveContextNotes,
    readContextNotes,
    workspaceOfContext,
    writeActiveContextNotes,
    writeContextNotes,
    type ContextNotesState,
} from '../src/store/workspace/contextNotes';
import { resolveDataContext } from '../src/store/workspace/dataContext';

// T-406: pure workspace helpers on the CURRENT persisted shape (contextId, read/write context notes, active workspace
// patch). Synthetic data only. The "legacy" functions below are semantic copies of the inline store patterns that
// T-407 replaced with these helpers, so the equivalence tests pin deep-equal output (plus reference identity where it matters).

function note(id: number, content = `n${id}`): Note {
    return { id, title: `T${id}`, icon: 'note', emoji: null, content };
}

function ws(id: string, isIsolated: boolean, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated,
        isolatedData: isIsolated ? { notes: [note(1, `iso-${id}`)], activeNoteId: 1, nextNoteId: 2, pluginData: { p: 1 } } : undefined,
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

type S = ContextNotesState<Note, WorkspaceConfig>;

function st(activeWorkspaceId: string | null, workspaces: WorkspaceConfig[], over: Partial<S> = {}): S {
    return {
        notes: [note(1, 'live-1'), note(2, 'live-2')],
        activeNoteId: 2,
        nextNoteId: 3,
        globalNotes: [note(1, 'global-1'), note(5, 'global-5')],
        activeWorkspaceId,
        workspaces,
        ...over,
    };
}

// Verbatim shape of the inline pattern in updateNoteContent/Title/Emoji (src/store/useAppStore.ts, before T-407).
function legacyUpdateNotes(state: S, nextNotes: Note[]) {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        const updatedWorkspaces = state.workspaces.map((w) =>
            w.id === activeWs.id ? { ...w, isolatedData: { ...(w.isolatedData || {}), notes: nextNotes } } : w
        );
        return { notes: nextNotes, workspaces: updatedWorkspaces };
    }
    return { notes: nextNotes, globalNotes: nextNotes };
}

// Verbatim shape of addNote / open*Tab.
function legacyAddNote(state: S, nextNotes: Note[], nextActiveId: number, nextId: number) {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        const updatedWorkspaces = state.workspaces.map((w) =>
            w.id === activeWs.id
                ? { ...w, isolatedData: { ...(w.isolatedData || {}), notes: nextNotes, activeNoteId: nextActiveId, nextNoteId: nextId } }
                : w
        );
        return { notes: nextNotes, activeNoteId: nextActiveId, nextNoteId: nextId, workspaces: updatedWorkspaces };
    }
    return { notes: nextNotes, activeNoteId: nextActiveId, nextNoteId: nextId, globalNotes: nextNotes };
}

// Verbatim shape of setActiveNoteId.
function legacySetActiveNoteId(state: S, id: number) {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        const updatedWorkspaces = state.workspaces.map((w) =>
            w.id === activeWs.id ? { ...w, isolatedData: { ...(w.isolatedData || {}), activeNoteId: id } } : w
        );
        return { activeNoteId: id, workspaces: updatedWorkspaces };
    }
    return { activeNoteId: id };
}

// Verbatim shape of deleteNote (notes + activeNoteId).
function legacyDeleteNote(state: S, filtered: Note[], newActiveId: number) {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        const updatedWorkspaces = state.workspaces.map((w) =>
            w.id === activeWs.id ? { ...w, isolatedData: { ...(w.isolatedData || {}), notes: filtered, activeNoteId: newActiveId } } : w
        );
        return { notes: filtered, activeNoteId: newActiveId, workspaces: updatedWorkspaces };
    }
    return { notes: filtered, activeNoteId: newActiveId, globalNotes: filtered };
}

// Verbatim shape of addNotes (notes + nextNoteId).
function legacyAddNotes(state: S, nextNotes: Note[], nextId: number) {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        const updatedWorkspaces = state.workspaces.map((w) =>
            w.id === activeWs.id ? { ...w, isolatedData: { ...(w.isolatedData || {}), notes: nextNotes, nextNoteId: nextId } } : w
        );
        return { notes: nextNotes, nextNoteId: nextId, workspaces: updatedWorkspaces };
    }
    return { notes: nextNotes, nextNoteId: nextId, globalNotes: nextNotes };
}

// Verbatim shape of a profile setter (setSidebarWidth, setTheme, ...).
function legacyProfileSetter(state: S, val: number) {
    return {
        sidebarWidth: val,
        workspaces: state.activeWorkspaceId
            ? state.workspaces.map((w) => (w.id === state.activeWorkspaceId ? { ...w, sidebarWidth: val } : w))
            : state.workspaces,
    };
}

/** Every relevant combination of the current shape. */
const SCENARIOS: Array<[string, () => S]> = [
    ['no workspace active', () => st(null, [ws('A', true), ws('S', false)])],
    ['shared workspace active', () => st('S', [ws('A', true), ws('S', false)])],
    ['isolated workspace active', () => st('A', [ws('A', true), ws('B', true), ws('S', false)])],
    ['unknown active id', () => st('gone', [ws('A', true)])],
    ['isolated active without isolatedData', () => st('A', [ws('A', true, { isolatedData: undefined })])],
];

describe('contextId', () => {
    it('isolated workspaces get ws:<id>, everything else is global', () => {
        expect(contextIdOf(ws('A', true))).toBe('ws:A');
        expect(contextIdOf(ws('S', false))).toBe(GLOBAL_CONTEXT_ID);
        expect(contextIdOf(null)).toBe('global');
        expect(contextIdOf(undefined)).toBe('global');
        expect(contextIdOf({ id: 'X' })).toBe('global');
    });

    it('a workspace literally named "global" cannot collide with the shared context', () => {
        expect(contextIdOf(ws('global', true))).toBe('ws:global');
        expect(workspaceIdOfContext('ws:global')).toBe('global');
        expect(workspaceIdOfContext('global')).toBeNull();
    });

    it('workspaceIdOfContext round-trips and rejects anything else', () => {
        expect(workspaceIdOfContext(contextIdOf(ws('1700000000000', true)))).toBe('1700000000000');
        expect(workspaceIdOfContext('ws:a:b')).toBe('a:b');
        expect(workspaceIdOfContext('A')).toBeNull();
        expect(workspaceIdOfContext('')).toBeNull();
    });

    it.each(SCENARIOS)('activeContextId agrees with resolveDataContext (%s)', (_name, make) => {
        const state = make();
        const id = activeContextId(state);
        const { isolationSuffix } = resolveDataContext(state);
        expect(id === GLOBAL_CONTEXT_ID).toBe(isolationSuffix === '');
        if (id !== GLOBAL_CONTEXT_ID) expect(isolationSuffix).toBe(`_iso_${workspaceIdOfContext(id)}`);
    });
});

describe('contextId: empty workspace ids (possible in imported data)', () => {
    it('an isolated workspace with id "" gets "ws:" and round-trips', () => {
        expect(contextIdOf(ws('', true))).toBe('ws:');
        expect(workspaceIdOfContext('ws:')).toBe('');
        expect(workspaceIdOfContext(contextIdOf(ws('', true)))).toBe('');
    });

    it('its notes can be read and written through "ws:"', () => {
        const state = st('A', [ws('A', true), ws('', true, { isolatedData: { notes: [note(4)], activeNoteId: 4, nextNoteId: 5 } })]);
        expect(workspaceOfContext(state, 'ws:')?.id).toBe('');
        expect(readContextNotes(state, 'ws:')?.notes).toEqual([note(4)]);
        const patch = writeContextNotes(state, 'ws:', { notes: [note(6)] });
        expect(patch.workspaces?.[1].isolatedData?.notes).toEqual([note(6)]);
        expect(patch.workspaces?.[0]).toBe(state.workspaces[0]);
    });
});

describe('findActiveWorkspace / patchActiveWorkspace', () => {
    it('finds the active workspace, undefined for none/unknown', () => {
        const list = [ws('A', true), ws('S', false)];
        expect(findActiveWorkspace(st('S', list))?.id).toBe('S');
        expect(findActiveWorkspace(st(null, list))).toBeUndefined();
        expect(findActiveWorkspace(st('gone', list))).toBeUndefined();
    });

    it.each(SCENARIOS)('matches the inline profile-setter pattern (%s)', (_name, make) => {
        const state = make();
        const legacy = legacyProfileSetter(state, 99);
        const next = { sidebarWidth: 99, workspaces: patchActiveWorkspace(state, { sidebarWidth: 99 }) };
        expect(next).toEqual(legacy);
        // Same reference semantics: untouched when nothing is active.
        expect(next.workspaces === state.workspaces).toBe(legacy.workspaces === state.workspaces);
    });

    it('accepts an updater and leaves the input untouched', () => {
        const state = st('S', [ws('A', true), ws('S', false, { enabledExtensions: { x: true } })]);
        const before = JSON.stringify(state);
        const next = patchActiveWorkspace(state, (w) => ({ ...w, enabledExtensions: { ...(w.enabledExtensions || {}), y: false } }));
        expect(next.find((w) => w.id === 'S')?.enabledExtensions).toEqual({ x: true, y: false });
        expect(next[0]).toBe(state.workspaces[0]);
        expect(JSON.stringify(state)).toBe(before);
    });
});

describe('readContextNotes / readActiveContextNotes', () => {
    it('active context is always the live notes', () => {
        for (const [, make] of SCENARIOS) {
            const state = make();
            const r = readActiveContextNotes(state);
            expect(r.notes).toBe(state.notes);
            expect(r.activeNoteId).toBe(2);
            expect(r.nextNoteId).toBe(3);
        }
    });

    it('global is the live notes while shared, globalNotes while an isolated workspace is active', () => {
        const shared = st('S', [ws('A', true), ws('S', false)]);
        expect(readContextNotes(shared, 'global')?.notes).toBe(shared.notes);

        const isolated = st('A', [ws('A', true), ws('S', false)]);
        const g = readContextNotes(isolated, 'global');
        expect(g?.notes).toBe(isolated.globalNotes);
        // No ids are stored for the inactive shared context: derived from its notes.
        expect(g?.activeNoteId).toBe(1);
        expect(g?.nextNoteId).toBe(6);
    });

    it('an inactive isolated workspace reads its isolatedData, normalised', () => {
        const state = st(null, [ws('B', true, { isolatedData: { notes: [note(4), note(7)], activeNoteId: 99, nextNoteId: 2 } })]);
        expect(readContextNotes(state, 'ws:B')).toEqual({ notes: [note(4), note(7)], activeNoteId: 4, nextNoteId: 8 });
    });

    it('null for ids that name no isolated workspace', () => {
        const state = st(null, [ws('A', true), ws('S', false)]);
        expect(readContextNotes(state, 'ws:S')).toBeNull();
        expect(readContextNotes(state, 'ws:gone')).toBeNull();
        expect(readContextNotes(state, 'A' as ContextId)).toBeNull();
        expect(workspaceOfContext(state, 'ws:A')?.id).toBe('A');
        expect(workspaceOfContext(state, 'ws:S')).toBeUndefined();
    });
});

describe('writeActiveContextNotes matches the inline note-action patterns', () => {
    const nextNotes = [note(1, 'edited'), note(2, 'live-2')];

    it.each(SCENARIOS)('update notes (%s)', (_name, make) => {
        const state = make();
        expect(writeActiveContextNotes(state, { notes: nextNotes })).toEqual(legacyUpdateNotes(state, nextNotes));
    });

    it.each(SCENARIOS)('add note: notes + activeNoteId + nextNoteId (%s)', (_name, make) => {
        const state = make();
        const added = [...state.notes, note(3)];
        expect(writeActiveContextNotes(state, { notes: added, activeNoteId: 3, nextNoteId: 4 })).toEqual(legacyAddNote(state, added, 3, 4));
    });

    it.each(SCENARIOS)('delete note: notes + activeNoteId (%s)', (_name, make) => {
        const state = make();
        const filtered = state.notes.filter((n) => n.id !== 2);
        expect(writeActiveContextNotes(state, { notes: filtered, activeNoteId: 1 })).toEqual(legacyDeleteNote(state, filtered, 1));
    });

    it.each(SCENARIOS)('add notes: notes + nextNoteId (%s)', (_name, make) => {
        const state = make();
        const added = [...state.notes, note(3), note(4)];
        expect(writeActiveContextNotes(state, { notes: added, nextNoteId: 5 })).toEqual(legacyAddNotes(state, added, 5));
    });

    it.each(SCENARIOS)('set active note only (%s)', (_name, make) => {
        const state = make();
        expect(writeActiveContextNotes(state, { activeNoteId: 1 })).toEqual(legacySetActiveNoteId(state, 1));
    });

    it('keeps pluginData and other isolatedData fields, never touches other workspaces or the input', () => {
        const state = st('A', [ws('A', true), ws('B', true)]);
        const before = JSON.stringify(state);
        const patch = writeActiveContextNotes(state, { notes: nextNotes, nextNoteId: 9 });
        const a = patch.workspaces?.find((w) => w.id === 'A');
        expect(a?.isolatedData).toEqual({ notes: nextNotes, activeNoteId: 1, nextNoteId: 9, pluginData: { p: 1 } });
        expect(patch.workspaces?.[1]).toBe(state.workspaces[1]);
        expect(patch.globalNotes).toBeUndefined();
        expect(JSON.stringify(state)).toBe(before);
    });

    it('undefined fields are not written', () => {
        const state = st(null, []);
        expect(writeActiveContextNotes(state, { notes: undefined, activeNoteId: undefined })).toEqual({});
        expect(Object.keys(writeActiveContextNotes(state, { nextNoteId: 5 }))).toEqual(['nextNoteId']);
    });
});

describe('writeContextNotes', () => {
    it.each(SCENARIOS)('the active context id behaves exactly like writeActiveContextNotes (%s)', (_name, make) => {
        const state = make();
        const data = { notes: [note(8)], activeNoteId: 8, nextNoteId: 9 };
        expect(writeContextNotes(state, activeContextId(state), data)).toEqual(writeActiveContextNotes(state, data));
    });

    it('inactive shared context (isolated active) only stores notes as globalNotes', () => {
        const state = st('A', [ws('A', true)]);
        expect(writeContextNotes(state, 'global', { notes: [note(3)], activeNoteId: 3, nextNoteId: 4 })).toEqual({
            globalNotes: [note(3)],
        });
        expect(writeContextNotes(state, 'global', { activeNoteId: 3 })).toEqual({});
    });

    it('inactive isolated workspace only gets its isolatedData merged (live fields untouched)', () => {
        const state = st('A', [ws('A', true), ws('B', true)]);
        const patch = writeContextNotes(state, 'ws:B', { notes: [note(6)], nextNoteId: 7 });
        expect(Object.keys(patch)).toEqual(['workspaces']);
        expect(patch.workspaces?.[0]).toBe(state.workspaces[0]);
        expect(patch.workspaces?.[1].isolatedData).toEqual({ notes: [note(6)], activeNoteId: 1, nextNoteId: 7, pluginData: { p: 1 } });
    });

    it('ids that name no isolated workspace yield an empty patch', () => {
        const state = st('A', [ws('A', true), ws('S', false)]);
        expect(writeContextNotes(state, 'ws:S', { notes: [note(1)] })).toEqual({});
        expect(writeContextNotes(state, 'ws:gone', { notes: [note(1)] })).toEqual({});
        expect(writeContextNotes(state, 'S' as ContextId, { notes: [note(1)] })).toEqual({});
    });
});

describe('types', () => {
    it('patches are assignable to the store state (no casts needed in set())', () => {
        const state = st('A', [ws('A', true)]);
        const notesPatch: Partial<AppState> = writeActiveContextNotes(state, { notes: [note(1)] });
        const profilePatch: Partial<AppState> = { sidebarWidth: 50, workspaces: patchActiveWorkspace(state, { sidebarWidth: 50 }) };
        expect(notesPatch.workspaces).toHaveLength(1);
        expect(profilePatch.workspaces?.[0].sidebarWidth).toBe(50);
    });
});
