import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type Note, type WorkspaceConfig } from '../src/store/useAppStore';
import { setupLocalStorageIsolation } from '../src/utils/localStorageIsolation';
import { installWindowApiMock } from './helpers/windowApi';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-206 (WS-03): every workspace action that switches the plugin data context goes through one helper
// (applyWorkspaceContext): dataContextId++, plugin reload, `kobar:workspace-changed`. Synthetic data only.

// Map-backed fake localStorage (same pattern as tests/isolation.dom.test.ts): jsdom Storage cannot be monkeypatched.
const fakeStorage = vi.hoisted(() => {
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
    return { map };
});

const raw = fakeStorage.map;
const store = useAppStore;

function note(id: number, content: string): Note {
    return { id, title: `T${id}`, icon: 'note', emoji: null, content };
}

const GLOBAL_NOTES = [note(1, 'global-1'), note(2, 'global-2')];

function ws(id: string, isIsolated: boolean, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated,
        isolatedData: isIsolated ? { notes: [note(1, `iso-${id}`)], activeNoteId: 1, nextNoteId: 2, pluginData: {} } : undefined,
        ...over,
    } as unknown as WorkspaceConfig;
}

/** Lets the setTimeout(0) event and the setExtensionsConfig().then(reload) of an action run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Tracker {
    events: Array<string | null>;
    reloads: () => number;
    contextBumps: () => number;
    stop: () => void;
}

function track(): Tracker {
    const events: Array<string | null> = [];
    const onEvent = (e: Event): void => {
        events.push((e as CustomEvent<{ workspaceId: string | null }>).detail.workspaceId);
    };
    window.addEventListener('kobar:workspace-changed', onEvent);
    const reload0 = store.getState().extensionReloadTrigger;
    const ctx0 = store.getState().dataContextId;
    return {
        events,
        reloads: () => store.getState().extensionReloadTrigger - reload0,
        contextBumps: () => store.getState().dataContextId - ctx0,
        stop: () => window.removeEventListener('kobar:workspace-changed', onEvent),
    };
}

let tracker: Tracker;
let idCounter = 0;

beforeAll(() => {
    setupLocalStorageIsolation();
});

beforeEach(() => {
    store.setState({
        workspaces: [],
        activeWorkspaceId: null,
        notes: JSON.parse(JSON.stringify(GLOBAL_NOTES)),
        globalNotes: JSON.parse(JSON.stringify(GLOBAL_NOTES)),
        activeNoteId: 1,
        nextNoteId: 3,
        currentExtensionsConfig: { base: true },
        defaultExtensionsConfig: null,
    });
    raw.clear();
    // saveCurrentAsWorkspace uses Date.now() as the id; make it unique per call.
    idCounter = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++idCounter);
    tracker = track();
});

afterEach(() => {
    tracker.stop();
    vi.restoreAllMocks();
});

function expectSwitched(workspaceId: string | null): void {
    expect(tracker.contextBumps()).toBe(1);
    expect(tracker.reloads()).toBe(1);
    expect(tracker.events).toEqual([workspaceId]);
}

function expectNotSwitched(): void {
    expect(tracker.contextBumps()).toBe(0);
    expect(tracker.reloads()).toBe(0);
    expect(tracker.events).toEqual([]);
}

describe('applyWorkspaceContext: when the data context switches', () => {
    it('loadWorkspace always switches (shared -> shared too) and sends the changed target set before loading plugins', async () => {
        const api = installWindowApiMock();
        const full0 = store.getState().extensionFullReloadTrigger;
        store.setState({
            workspaces: [ws('A', false), ws('B', false, { enabledExtensions: { base: false, only: true } })],
            activeWorkspaceId: 'A',
        });
        store.getState().loadWorkspace('B');
        // dataContextId moves with the state commit; the plugin load waits for setExtensionsConfig.
        expect(tracker.contextBumps()).toBe(1);
        expect(tracker.reloads()).toBe(0);
        // T-409: the record over the mirror ({ base: true }); the mirror follows in the same commit.
        expect(api.setExtensionsConfig).toHaveBeenCalledWith({ base: false, only: true });
        expect(store.getState().currentExtensionsConfig).toEqual({ base: false, only: true });
        await flush();
        expectSwitched('B');
        // Same data namespace (shared -> shared): only the enabled-set diff is loaded, no full reload.
        expect(store.getState().extensionFullReloadTrigger).toBe(full0);
    });

    it('loadWorkspace still reloads plugins when setExtensionsConfig rejects', async () => {
        const api = installWindowApiMock();
        api.setExtensionsConfig.mockRejectedValue(new Error('ipc down'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        store.setState({ workspaces: [ws('A', false), ws('B', false, { enabledExtensions: { base: false } })], activeWorkspaceId: 'A' });
        store.getState().loadWorkspace('B');
        expect(api.setExtensionsConfig).toHaveBeenCalledWith({ base: false });
        await flush();
        expectSwitched('B');
        expect(err).toHaveBeenCalled();
    });

    it('loadWorkspace without a stored extensions config reloads synchronously', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: null });
        store.getState().loadWorkspace('A');
        expect(tracker.reloads()).toBe(1);
        expect(window.api.setExtensionsConfig).not.toHaveBeenCalled();
        await flush();
        expectSwitched('A');
    });

    it('re-loading the already active workspace still switches (old behaviour kept)', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        store.getState().loadWorkspace('A');
        await flush();
        expectSwitched('A');
    });

    it('loadWorkspace of an unknown id is a no-op', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        const before = store.getState();
        store.getState().loadWorkspace('missing');
        await flush();
        expect(store.getState()).toBe(before);
        expectNotSwitched();
    });

    it('setActiveWorkspaceId(id) is a full workspace load (T-153): notes, reload and event follow', async () => {
        store.setState({ workspaces: [ws('A', false), ws('B', true)], activeWorkspaceId: 'A' });
        store.getState().setActiveWorkspaceId('B');
        await flush();
        expect(store.getState().activeWorkspaceId).toBe('B');
        expect(store.getState().notes.map((n) => n.content)).toEqual(['iso-B']);
        expect(store.getState().globalNotes.map((n) => n.content)).toEqual(['global-1', 'global-2']);
        expectSwitched('B');
    });

    it('a throwing afterCommit side effect does not skip the plugin reload and the event', async () => {
        store.setState({ workspaces: [ws('A', false), ws('B', false)], activeWorkspaceId: 'A' });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const removeProp = vi.spyOn(document.documentElement.style, 'removeProperty').mockImplementation(() => {
            throw new Error('dom down');
        });
        store.getState().loadWorkspace('B');
        removeProp.mockRestore();
        await flush();
        expect(err).toHaveBeenCalledWith('workspace afterCommit failed', expect.any(Error));
        expectSwitched('B');
    });

    it('setActiveWorkspaceId ignores unknown ids and the already active id', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        const before = store.getState();
        store.getState().setActiveWorkspaceId('missing');
        store.getState().setActiveWorkspaceId('A');
        await flush();
        expect(store.getState()).toBe(before);
        expectNotSwitched();
    });

    it('setActiveWorkspaceId(null) leaves an isolated workspace through the helper and restores the shared notes', async () => {
        store.setState({
            workspaces: [ws('A', true)],
            activeWorkspaceId: 'A',
            notes: [note(1, 'edited-iso-A')],
            activeNoteId: 1,
            nextNoteId: 2,
        });
        store.getState().setActiveWorkspaceId(null);
        await flush();
        const s = store.getState();
        expect(s.activeWorkspaceId).toBeNull();
        expect(s.notes.map((n) => n.content)).toEqual(['global-1', 'global-2']);
        expect(s.workspaces[0].isolatedData?.notes?.map((n) => n.content)).toEqual(['edited-iso-A']);
        expectSwitched(null);
    });

    it('setActiveWorkspaceId(null) from a shared workspace switches; from no workspace it is a no-op', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        store.getState().setActiveWorkspaceId(null);
        await flush();
        expect(store.getState().activeWorkspaceId).toBeNull();
        expectSwitched(null);
        const before = store.getState();
        store.getState().setActiveWorkspaceId(null);
        expect(store.getState()).toBe(before);
    });

    it('loadWorkspace clears stale inline theme overrides and writes the forced custom color after the commit (T-153, T-601)', async () => {
        store.setState({
            workspaces: [
                ws('A', false),
                ws('B', false, { theme: 'custom', customThemeColor: '#112233', design: 'style2' } as Partial<WorkspaceConfig>),
                ws('C', false, { theme: 'nord' } as Partial<WorkspaceConfig>),
            ],
            activeWorkspaceId: 'A',
        });
        let inlineAtCommit: string | null = 'unset';
        const unsub = store.subscribe((state, prev) => {
            if (state.activeWorkspaceId === 'B' && prev.activeWorkspaceId !== 'B') {
                inlineAtCommit = document.documentElement.style.getPropertyValue('--theme-primary');
            }
        });
        document.documentElement.style.setProperty('--theme-primary', '#6366f1');
        document.documentElement.setAttribute('data-theme', 'midnight');
        store.getState().loadWorkspace('B');
        unsub();
        // Not done inside the set callback: the subscriber (called by set) still saw the old inline value.
        expect(inlineAtCommit).toBe('#6366f1');
        expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe('');
        expect(store.getState()).toMatchObject({ theme: 'custom', accent: 'custom', design: 'style2', material: 'translucent' });
        expect(raw.get('kobar_force_theme_color')).toBe('#112233');
        // T-601: root attributes belong to App.tsx (from the committed state), the store no longer writes them.
        expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
        store.getState().loadWorkspace('C');
        expect(store.getState()).toMatchObject({ theme: 'nord', accent: 'graphite' });
        document.documentElement.removeAttribute('data-theme');
        await flush();
    });

    it('saveCurrentAsWorkspace switches to the new workspace (shared and isolated)', async () => {
        store.getState().saveCurrentAsWorkspace('S', false);
        await flush();
        const sharedId = store.getState().activeWorkspaceId;
        expect(sharedId).not.toBeNull();
        expectSwitched(sharedId);

        store.getState().saveCurrentAsWorkspace('I', true);
        await flush();
        const isoId = store.getState().activeWorkspaceId;
        expect(isoId).not.toBe(sharedId);
        expect(tracker.contextBumps()).toBe(2);
        expect(tracker.reloads()).toBe(2);
        expect(tracker.events).toEqual([sharedId, isoId]);
    });

    it('toggleWorkspaceIsolation of the ACTIVE workspace switches (both directions)', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        store.getState().toggleWorkspaceIsolation('A');
        await flush();
        expectSwitched('A');
        store.getState().toggleWorkspaceIsolation('A');
        await flush();
        expect(tracker.contextBumps()).toBe(2);
        expect(tracker.reloads()).toBe(2);
        expect(tracker.events).toEqual(['A', 'A']);
    });

    it('toggleWorkspaceIsolation of an INACTIVE workspace updates it without a switch (no reload, no event)', async () => {
        store.setState({ workspaces: [ws('A', true), ws('B', false)], activeWorkspaceId: 'A' });
        store.getState().toggleWorkspaceIsolation('B');
        await flush();
        expect(store.getState().workspaces.find((w) => w.id === 'B')!.isIsolated).toBe(true);
        expectNotSwitched();
    });

    it('deleteWorkspace of the ACTIVE workspace switches to shared (workspaceId null)', async () => {
        store.setState({ workspaces: [ws('A', true)], activeWorkspaceId: 'A' });
        store.getState().deleteWorkspace('A');
        await flush();
        expect(store.getState().activeWorkspaceId).toBeNull();
        expectSwitched(null);
    });

    it('deleteWorkspace of an INACTIVE workspace removes it without a switch', async () => {
        store.setState({ workspaces: [ws('A', true), ws('B', true)], activeWorkspaceId: 'A' });
        store.getState().deleteWorkspace('B');
        await flush();
        expect(store.getState().workspaces.map((w) => w.id)).toEqual(['A']);
        expectNotSwitched();
    });
});

describe('applyWorkspaceContext: open plugin panel', () => {
    const RECT = { top: 1, left: 2, bottom: 3, right: 4, width: 5, height: 6 };

    it('a context switch closes the open plugin panel in the same commit', async () => {
        store.setState({
            workspaces: [ws('A', false)],
            activeWorkspaceId: 'A',
            activeExtensionPanelId: 'aihub',
            activeExtensionAnchorRect: RECT,
        });
        const seen: Array<{ ctx: number; panel: string | null }> = [];
        const unsub = store.subscribe((s, p) => {
            if (s.dataContextId !== p.dataContextId) seen.push({ ctx: s.dataContextId, panel: s.activeExtensionPanelId });
        });
        store.getState().toggleWorkspaceIsolation('A');
        await flush();
        unsub();
        expect(seen).toHaveLength(1);
        expect(seen[0].panel).toBeNull();
        expect(store.getState().activeExtensionAnchorRect).toBeNull();
    });

    it('no switch (inactive toggle / inactive delete) keeps the open plugin panel', async () => {
        store.setState({
            workspaces: [ws('A', true), ws('B', false), ws('C', false)],
            activeWorkspaceId: 'A',
            activeExtensionPanelId: 'aihub',
            activeExtensionAnchorRect: RECT,
        });
        store.getState().toggleWorkspaceIsolation('B');
        store.getState().deleteWorkspace('C');
        await flush();
        expectNotSwitched();
        expect(store.getState().activeExtensionPanelId).toBe('aihub');
        expect(store.getState().activeExtensionAnchorRect).toEqual(RECT);
    });
});

describe('applyWorkspaceContext: ordering and persistence', () => {
    it('the reload and the event both see the committed new context', async () => {
        store.setState({ workspaces: [ws('A', false)], activeWorkspaceId: 'A' });
        const seenAtReload: Array<{ id: string | null; ctx: number }> = [];
        const unsub = store.subscribe((s, p) => {
            if (s.extensionReloadTrigger !== p.extensionReloadTrigger) {
                seenAtReload.push({ id: s.activeWorkspaceId, ctx: s.dataContextId });
            }
        });
        const seenAtEvent: Array<string | null> = [];
        const onEvent = (): void => {
            localStorage.setItem('probe', 'x');
            seenAtEvent.push(store.getState().workspaces.find((w) => w.id === 'A')!.isIsolated ? 'iso' : 'shared');
        };
        window.addEventListener('kobar:workspace-changed', onEvent);
        const ctx0 = store.getState().dataContextId;

        store.getState().toggleWorkspaceIsolation('A');
        await flush();

        window.removeEventListener('kobar:workspace-changed', onEvent);
        unsub();
        expect(seenAtReload).toEqual([{ id: 'A', ctx: ctx0 + 1 }]);
        expect(seenAtEvent).toEqual(['iso']);
        expect(raw.has('probe_iso_A')).toBe(true);
        expect(raw.has('probe')).toBe(false);
    });

    it('dataContextId is volatile: partialize never persists it', () => {
        const partialize = store.persist.getOptions().partialize!;
        expect(Object.keys(partialize(store.getState()) as Record<string, unknown>)).not.toContain('dataContextId');
    });
});

// AI Hub keeps a module-level persisted store and writes its WHOLE state to the current key on
// every change. Without a reload after a context switch it would write the old context's data into the new
// namespace. This fake plugin hydrates once when its "script" is (re)evaluated, like AI Hub.
describe('AI Hub scenario (WS-03): plugin data lands in the right namespace after every action', () => {
    const KEY = 'aihub-chats';

    function createPlugin(): { chats: () => string[]; send: (msg: string) => void } {
        let chats: string[] = JSON.parse(localStorage.getItem(KEY) ?? '[]');
        return {
            chats: () => chats,
            send: (msg) => {
                chats = [...chats, msg];
                localStorage.setItem(KEY, JSON.stringify(chats));
            },
        };
    }

    const stored = (key: string): string[] => JSON.parse(raw.get(key) ?? '[]');

    it('load / save-new / toggle active / delete active: the plugin re-reads and writes only the new namespace', async () => {
        let plugin = createPlugin();
        // The host re-injects plugin scripts whenever extensionReloadTrigger changes (App.tsx).
        const unsub = store.subscribe((s, p) => {
            if (s.extensionReloadTrigger !== p.extensionReloadTrigger) plugin = createPlugin();
        });
        // A listener-based plugin re-reads its key on the event.
        const seenByListener: string[][] = [];
        const onEvent = (): void => {
            seenByListener.push(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
        };
        window.addEventListener('kobar:workspace-changed', onEvent);

        // Shared context: two global chats.
        plugin.send('g1');
        plugin.send('g2');

        // 1. save as a NEW isolated workspace -> empty isolated namespace.
        store.getState().saveCurrentAsWorkspace('A', true);
        await flush();
        const a = store.getState().activeWorkspaceId as string;
        expect(plugin.chats()).toEqual([]);
        plugin.send('a1');
        expect(stored(KEY)).toEqual(['g1', 'g2']);
        expect(stored(`${KEY}_iso_${a}`)).toEqual(['a1']);

        // 2. toggle isolation OFF on the active workspace -> shared namespace again.
        store.getState().toggleWorkspaceIsolation(a);
        await flush();
        expect(plugin.chats()).toEqual(['g1', 'g2']);
        plugin.send('g3');
        expect(stored(KEY)).toEqual(['g1', 'g2', 'g3']);
        expect(stored(`${KEY}_iso_${a}`)).toEqual(['a1']);

        // 3. toggle isolation ON again -> back to A's namespace.
        store.getState().toggleWorkspaceIsolation(a);
        await flush();
        expect(plugin.chats()).toEqual(['a1']);
        plugin.send('a2');

        // 4. load a shared workspace B -> shared namespace.
        store.setState({ workspaces: [...store.getState().workspaces, ws('B', false)] });
        store.getState().loadWorkspace('B');
        await flush();
        expect(plugin.chats()).toEqual(['g1', 'g2', 'g3']);

        // 5. load A, then delete it while active -> shared namespace.
        store.getState().loadWorkspace(a);
        await flush();
        expect(plugin.chats()).toEqual(['a1', 'a2']);
        store.getState().deleteWorkspace(a);
        await flush();
        expect(plugin.chats()).toEqual(['g1', 'g2', 'g3']);
        plugin.send('g4');

        window.removeEventListener('kobar:workspace-changed', onEvent);
        unsub();

        expect(stored(KEY)).toEqual(['g1', 'g2', 'g3', 'g4']);
        // Deleting a workspace does not delete its namespaced keys (no data deletion here; cleanup is WS-05).
        expect(stored(`${KEY}_iso_${a}`)).toEqual(['a1', 'a2']);
        expect(seenByListener).toEqual([[], ['g1', 'g2'], ['a1'], ['g1', 'g2', 'g3'], ['a1', 'a2'], ['g1', 'g2', 'g3']]);
    });
});
