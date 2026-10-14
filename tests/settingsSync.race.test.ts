// T-606: race tests of the whole Settings window state sync, end to end and in-process: the main window side (src/store/sync.ts)
// on a zustand store shaped like the app store, the real main process relay (electron/lib/settingsSync.cts) and the Settings
// window's mirror (src/settings/mirror.ts). Every hop is an asynchronous, structured-cloned message on ONE simulated event queue,
// so concurrent actions, out-of-order delivery, echo loops, stale snapshots and a main window reload can be replayed exactly.
import { describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
    IpcClaimedSettingsSyncBridge,
    IpcSettingsAction,
    IpcSettingsStateMessage,
    IpcSettingsWindowBridge,
} from '../shared/ipc-contract';
import { createSettingsRelay } from '../electron/lib/settingsSync.cjs';
import {
    SETTINGS_ACTIONS,
    SETTINGS_SYNC_KEYS,
    type SettingsSyncStore,
    applySettingsAction,
    selectSettingsState,
    startSettingsSync,
} from '../src/store/sync';
import { createSettingsMirror } from '../src/settings/mirror';

type AnyState = Record<string, unknown>;

const SYNCED_DEFAULTS: AnyState = {
    scheme: 'dark',
    accent: 'amber',
    material: 'solid',
    density: 'normal',
    theme: 'ember',
    customThemeColor: '#ff8800',
    language: 'en',
    showTooltips: true,
    sidebarWidth: 64,
    iconScale: 1,
    launchAtStartup: false,
    enableEyeAnimation: true,
    isPinInjectorEnabled: true,
    isKoBoxEnabled: true,
    koBoxCleanupMode: '24h',
    featureOrder: ['notes', 'clipboard'],
    design: 'style1',
    glassOpacity: 50,
    settingsFeatureViewMode: 'list',
    orientation: 'vertical',
    edgePosition: 'right',
};

/** A store shaped like useAppStore for the sync: the synced keys, their setters, isHydrated, and private data that must never leak. */
function createAppLikeStore(overrides: AnyState = {}): StoreApi<AnyState> {
    return createStore<AnyState>()((set) => {
        const setters: AnyState = {};
        for (const [type, entry] of SETTINGS_ACTIONS) setters[type] = (value: unknown) => set({ [entry.key]: value });
        return {
            ...SYNCED_DEFAULTS,
            ...setters,
            isHydrated: false,
            notes: [{ id: 1, content: 'SECRET-NOTE-BODY' }],
            workspaces: [{ id: 'w', isolatedData: { pluginData: { ai: { apiKey: 'SECRET-KEY' } } } }],
            legacyBackup: { anything: 'SECRET-LEGACY' },
            setActiveWorkspaceId: () => set({ activeWorkspaceId: 'hijacked' }),
            setNotes: () => set({ notes: [] }),
            ...overrides,
        };
    });
}

/** One FIFO event queue for every IPC hop and every coalescing timer. */
function createNet() {
    const queue: Array<() => void> = [];
    return {
        push: (task: () => void) => void queue.push(task),
        size: () => queue.length,
        /** Runs tasks until the queue is empty (tasks may enqueue more). Throws on a runaway loop. */
        drain(limit = 1000) {
            let runs = 0;
            while (queue.length > 0) {
                if (++runs > limit) throw new Error('event queue did not settle (echo loop?)');
                queue.shift()!();
            }
            return runs;
        },
    };
}

function setup(options: { hydrated?: boolean } = {}) {
    const net = createNet();
    const settingsListeners = new Set<(message: IpcSettingsStateMessage) => void>();
    const mainActionListeners = new Set<(action: IpcSettingsAction) => void>();
    const toSettings: IpcSettingsStateMessage[] = [];
    let holdSettings: IpcSettingsStateMessage[] | null = null;
    let mainAlive = true;

    const relay = createSettingsRelay({
        sendToSettings: (message) => {
            const copy = structuredClone(message);
            toSettings.push(copy);
            if (holdSettings) return void holdSettings.push(copy);
            net.push(() => settingsListeners.forEach((listener) => listener(copy)));
        },
        sendToMain: (action) => {
            if (!mainAlive) return false;
            const copy = structuredClone(action);
            net.push(() => mainActionListeners.forEach((listener) => listener(copy)));
            return true;
        },
        log: () => {},
    });

    const publishes: unknown[] = [];
    function mainBridge(): IpcClaimedSettingsSyncBridge {
        return {
            publish: (message) => {
                const copy = structuredClone(message);
                publishes.push(copy);
                net.push(() => relay.publish(copy));
            },
            openSettings: () => {},
            onAction: (callback) => {
                mainActionListeners.add(callback);
                return () => void mainActionListeners.delete(callback);
            },
        };
    }

    const dispatched: IpcSettingsAction[] = [];
    const settingsBridge: Omit<IpcSettingsWindowBridge, `gcal${string}`> = {
        onState: (callback) => {
            settingsListeners.add(callback);
            return () => void settingsListeners.delete(callback);
        },
        requestState: () => net.push(() => relay.requestState()),
        dispatch: (action) => {
            const copy = structuredClone(action);
            dispatched.push(copy);
            net.push(() => relay.action(copy));
        },
        onShowPage: () => () => {},
    };

    const schedule = (run: () => void) => {
        let cancelled = false;
        net.push(() => {
            if (!cancelled) run();
        });
        return () => {
            cancelled = true;
        };
    };

    const store = createAppLikeStore({ isHydrated: options.hydrated ?? false });
    const log = vi.fn();
    let sync = startSettingsSync({ store: store as unknown as SettingsSyncStore, bridge: mainBridge(), schedule, epoch: 'A', log });
    const mirror = createSettingsMirror(settingsBridge, { firstActionId: 100 });

    return {
        net,
        relay,
        store,
        mirror,
        log,
        publishes,
        dispatched,
        toSettings,
        get sync() {
            return sync;
        },
        /** Simulates a main window reload: the old renderer stops, main resets, a new renderer (new epoch, new store) starts. */
        reloadMain(next: StoreApi<AnyState>, epoch: string) {
            sync.stop();
            relay.resetMain('navigate');
            sync = startSettingsSync({ store: next as unknown as SettingsSyncStore, bridge: mainBridge(), schedule, epoch, log });
        },
        holdSettingsMessages() {
            holdSettings = [];
        },
        releaseSettingsMessages(order: (held: IpcSettingsStateMessage[]) => IpcSettingsStateMessage[]) {
            const held = holdSettings ?? [];
            holdSettings = null;
            for (const message of order(held)) net.push(() => settingsListeners.forEach((listener) => listener(message)));
        },
        setMainAlive(alive: boolean) {
            mainAlive = alive;
        },
    };
}

const mirrored = (h: ReturnType<typeof setup>) => h.mirror.store.getState();
const synced = (store: StoreApi<AnyState>) => selectSettingsState(store.getState());

describe('initial snapshot and hydration', () => {
    it('the mirror waits (and refuses to dispatch) until the main window hydrated, then shows its settings', () => {
        const h = setup();
        h.mirror.start();
        h.net.drain();
        expect(mirrored(h)).toMatchObject({ status: 'waiting', state: null });
        expect(h.mirror.dispatch('setTheme', 'ocean')).toBeNull();
        expect(h.publishes).toEqual([]);

        h.store.setState({ isHydrated: true });
        h.net.drain();
        expect(mirrored(h).status).toBe('ready');
        expect(mirrored(h).state).toEqual(synced(h.store));
    });

    it('the snapshot carries exactly the settings keys: no notes, workspaces, plugin data or legacy backup', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        const state = mirrored(h).state as unknown as AnyState;
        expect(Object.keys(state).sort()).toEqual([...SETTINGS_SYNC_KEYS].sort());
        expect(JSON.stringify(h.toSettings)).not.toMatch(/SECRET/);
        expect(JSON.stringify(h.publishes)).not.toMatch(/SECRET/);
    });

    it('a mirror started after the main window published gets the cached snapshot on request', () => {
        const h = setup({ hydrated: true });
        h.net.drain();
        expect(h.publishes).toHaveLength(1);
        h.mirror.start();
        h.net.drain();
        expect(mirrored(h)).toMatchObject({ status: 'ready', seq: 2 });
        expect(mirrored(h).state).toEqual(synced(h.store));
    });
});

describe('concurrent actions', () => {
    it('actions and a simultaneous local change in the main window converge; last action wins; ack is the last id', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        const publishedBefore = h.publishes.length;

        expect(h.mirror.dispatch('setTheme', 'ocean')).toBe(100);
        expect(h.mirror.dispatch('setDensity', 'compact')).toBe(101);
        // The user changes something in the main window at the same moment.
        (h.store.getState().setGlassOpacity as (v: number) => void)(80);
        expect(h.mirror.dispatch('setTheme', 'nord')).toBe(102);
        h.net.drain();

        expect(h.store.getState()).toMatchObject({ theme: 'nord', density: 'compact', glassOpacity: 80 });
        expect(mirrored(h).state).toEqual(synced(h.store));
        expect(mirrored(h).ack).toBe(102);
        // The mirror never changed optimistically: it only ever showed states the main window really had.
        const states = h.toSettings.map((m) => m.state).filter(Boolean) as AnyState[];
        expect(states.every((s) => ['ember', 'ocean', 'nord'].includes(s.theme as string))).toBe(true);
        // Coalesced: at most one publish per processed action plus the local change, never more.
        expect(h.publishes.length - publishedBefore).toBeLessThanOrEqual(4);
        expect(h.sync.stats()).toMatchObject({ applied: 3 });
    });

    it('echo-loop free: snapshots never trigger actions and the queue settles', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        for (const theme of ['ocean', 'nord', 'sakura', 'coffee'] as const) h.mirror.dispatch('setTheme', theme);
        const runs = h.net.drain();
        expect(runs).toBeLessThan(50);
        expect(h.dispatched).toHaveLength(4);
        expect(h.net.size()).toBe(0);
        // Nothing changes afterwards: no publish, no dispatch, no relay message.
        const counts = [h.publishes.length, h.dispatched.length, h.toSettings.length];
        h.net.drain();
        expect([h.publishes.length, h.dispatched.length, h.toSettings.length]).toEqual(counts);
        expect(mirrored(h).state).toMatchObject({ theme: 'coffee' });
    });

    it('a no-op or rejected action still gets its ack (forced publish), without changing the state', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        const before = synced(h.store);
        h.mirror.dispatch('setTheme', 'ember');
        h.net.drain();
        expect(mirrored(h).ack).toBe(100);
        h.mirror.dispatch('setTheme', 'hacker' as never);
        h.net.drain();
        expect(mirrored(h).ack).toBe(101);
        expect(synced(h.store)).toEqual(before);
        expect(h.sync.stats().rejected['invalid-payload']).toBe(1);
    });
});

describe('out-of-order delivery and stale snapshots', () => {
    it('the mirror keeps the newest snapshot when older ones arrive later', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        h.holdSettingsMessages();
        h.mirror.dispatch('setTheme', 'ocean');
        h.net.drain();
        h.mirror.dispatch('setTheme', 'nord');
        h.net.drain();
        h.releaseSettingsMessages((held) => [...held].reverse());
        h.net.drain();
        expect(mirrored(h).state).toMatchObject({ theme: 'nord' });
        expect(mirrored(h).seq).toBe(Math.max(...h.toSettings.map((m) => m.seq)));
    });

    it('receive() ignores duplicates, older seqs and malformed messages', () => {
        const mirror = createSettingsMirror({
            onState: () => () => {},
            requestState: () => {},
            dispatch: () => {},
            onShowPage: () => () => {},
        });
        mirror.receive({ seq: 5, state: { theme: 'nord' }, ack: 3 });
        for (const message of [
            { seq: 5, state: { theme: 'x' }, ack: 9 },
            { seq: 4, state: { theme: 'y' }, ack: 9 },
            { seq: Number.NaN, state: {} },
            { state: {} },
            null,
            'seq',
        ]) {
            mirror.receive(message);
        }
        expect(mirror.store.getState()).toEqual({
            status: 'ready',
            seq: 5,
            state: { theme: 'nord' },
            ack: 3,
            plugins: null,
            workspaces: null,
            system: null,
        });
    });

    it('main window reload: the mirror waits, a late publish of the old document is dropped, the new one wins', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        // The old renderer changes something but its message is still in flight when the reload starts.
        h.store.setState({ theme: 'crimson' });
        const next = createAppLikeStore({ isHydrated: false, theme: 'midnight' });
        h.reloadMain(next, 'B');
        // Stopping cancelled the old renderer's pending publish timer; nothing of epoch A reaches the mirror any more.
        h.net.drain();
        expect(mirrored(h)).toMatchObject({ status: 'waiting', state: null });
        expect(h.mirror.dispatch('setTheme', 'ocean')).toBeNull();
        // Even if a message of the old document were delivered now, main drops it (retired epoch).
        h.relay.publish({ epoch: 'A', rev: 99, ack: 0, state: selectSettingsState({ ...SYNCED_DEFAULTS, theme: 'crimson' }) });
        h.net.drain();
        expect(mirrored(h).state).toBeNull();
        expect(h.relay.stats().dropped['retired-epoch']).toBe(1);

        next.setState({ isHydrated: true });
        h.net.drain();
        expect(mirrored(h).status).toBe('ready');
        expect(mirrored(h).state).toMatchObject({ theme: 'midnight' });
        // The old store is no longer synced: its changes go nowhere.
        h.store.setState({ theme: 'lavender' });
        h.net.drain();
        expect(mirrored(h).state).toMatchObject({ theme: 'midnight' });
    });

    it('actions sent while the main window is not ready are dropped by main, never queued for later', () => {
        const h = setup();
        h.mirror.start();
        h.net.drain();
        // A dispatch that bypasses the mirror's readiness check (e.g. the page raced the reset).
        h.dispatched.length = 0;
        (h.mirror as unknown as { store: StoreApi<{ status: string }> }).store.setState({ status: 'ready' });
        h.mirror.dispatch('setTheme', 'ocean');
        h.net.drain();
        h.store.setState({ isHydrated: true });
        h.net.drain();
        expect(h.store.getState().theme).toBe('ember');
        expect(h.relay.stats().dropped['main-not-ready']).toBe(1);
    });

    it('a dead main window drops actions', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        h.setMainAlive(false);
        h.mirror.dispatch('setTheme', 'ocean');
        h.net.drain();
        expect(h.store.getState().theme).toBe('ember');
        expect(h.relay.stats().dropped['main-unavailable']).toBe(1);
    });

    it('stop() ends publishing and applying', () => {
        const h = setup({ hydrated: true });
        h.mirror.start();
        h.net.drain();
        h.sync.stop();
        const count = h.publishes.length;
        h.store.setState({ theme: 'nord' });
        h.mirror.dispatch('setDensity', 'compact');
        h.net.drain();
        expect(h.publishes).toHaveLength(count);
        expect(h.store.getState().density).toBe('normal');
    });
});

describe('applySettingsAction (allow-listed table)', () => {
    const hydrated = () => createAppLikeStore({ isHydrated: true });

    it('applies each synced key through its own setter with a valid payload', () => {
        const store = hydrated();
        const valid: AnyState = { ...SYNCED_DEFAULTS, theme: 'ocean', sidebarWidth: 80, featureOrder: ['clipboard'], language: 'tr' };
        for (const [type, entry] of SETTINGS_ACTIONS) {
            expect(applySettingsAction(store as unknown as SettingsSyncStore, { type, payload: valid[entry.key] }, () => {})).toEqual({
                ok: true,
                key: entry.key,
            });
        }
        expect(store.getState()).toMatchObject({ theme: 'ocean', sidebarWidth: 80, featureOrder: ['clipboard'], language: 'tr' });
        expect(SETTINGS_ACTIONS.size).toBe(SETTINGS_SYNC_KEYS.length);
    });

    it.each([
        [{ type: 'setNotes', payload: [] }, 'unknown-action'],
        [{ type: 'setActiveWorkspaceId', payload: 'x' }, 'unknown-action'],
        [{ type: '__proto__', payload: {} }, 'unknown-action'],
        [{ type: 'constructor', payload: {} }, 'unknown-action'],
        [{ type: 'toString' }, 'unknown-action'],
        [{ type: 'setTheme', payload: 'hacker' }, 'invalid-payload'],
        [{ type: 'setSidebarWidth', payload: 1e9 }, 'invalid-payload'],
        [{ type: 'setFeatureOrder', payload: 'notes' }, 'invalid-payload'],
        [{ type: 'setLanguage', payload: 'xx' }, 'invalid-payload'],
        [{ type: 'setCustomThemeColor', payload: 'red; background:url(x)' }, 'invalid-payload'],
        [{ type: 'setTheme' }, 'invalid-payload'],
        [null, 'invalid-action'],
        ['setTheme', 'invalid-action'],
        [{ payload: 'ocean' }, 'invalid-action'],
    ])('rejects %j (%s) and changes nothing', (action, reason) => {
        const store = hydrated();
        const before = store.getState();
        const log = vi.fn();
        expect(applySettingsAction(store as unknown as SettingsSyncStore, action, log)).toEqual({ ok: false, reason });
        expect(store.getState()).toBe(before);
        expect(log).toHaveBeenCalledTimes(1);
        // Type and reason only: never the payload.
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/hacker|background|1000000000/);
    });

    it('rejects every action before hydration (the store still holds defaults)', () => {
        const store = createAppLikeStore({ isHydrated: false });
        expect(applySettingsAction(store as unknown as SettingsSyncStore, { type: 'setTheme', payload: 'ocean' }, () => {})).toEqual({
            ok: false,
            reason: 'not-hydrated',
        });
        expect(store.getState().theme).toBe('ember');
    });

    it('a throwing setter is reported as failed, never thrown', () => {
        const store = createAppLikeStore({
            isHydrated: true,
            setTheme: () => {
                throw new Error('boom');
            },
        });
        expect(applySettingsAction(store as unknown as SettingsSyncStore, { type: 'setTheme', payload: 'ocean' }, () => {})).toEqual({
            ok: false,
            reason: 'failed',
        });
    });
});

describe('without a bridge (tests, browser)', () => {
    it('startSettingsSync does nothing and the mirror is unavailable', () => {
        const store = createAppLikeStore({ isHydrated: true });
        const sync = startSettingsSync({ store: store as unknown as SettingsSyncStore, bridge: null });
        expect(sync.stats().published).toBe(0);
        sync.stop();
        const mirror = createSettingsMirror(null);
        mirror.start();
        expect(mirror.store.getState().status).toBe('unavailable');
        expect(mirror.dispatch('setTheme', 'ocean')).toBeNull();
    });
});
