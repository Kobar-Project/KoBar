// T-404: renderer half of the one-time localStorage archive. Real jsdom localStorage (byte-for-byte unchanged, isolation
// patch bypassed), a fake storage client, fake timers for the scheduling. Synthetic values only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcLocalStorageSnapshotRequest, IpcLocalStorageSnapshotResult } from '../shared/ipc-contract';
import { STORAGE_MAX_VALUE_BYTES, type StorageStoreStatus } from '../src/storage/client';
import {
    LOCALSTORAGE_SNAPSHOT_DELAY_MS,
    migrateLocalStorageSnapshot,
    scheduleLocalStorageSnapshot,
} from '../src/storage/migrateFromLocalStorage';

const READY: StorageStoreStatus = { ok: true, readOnly: false, disabled: false, migratedFromLocalStorageAt: null };

function fakeClient(status: StorageStoreStatus | null, answer?: IpcLocalStorageSnapshotResult | Error) {
    const archiveLocalStorage = vi.fn(async (request: IpcLocalStorageSnapshotRequest): Promise<IpcLocalStorageSnapshotResult> => {
        void request;
        if (answer instanceof Error) throw answer;
        return answer ?? { ok: true, status: 'written', migratedFromLocalStorageAt: 1, keyCount: 0, omittedCount: 0 };
    });
    return { storeStatus: vi.fn(() => status), archiveLocalStorage };
}

/** Every key and value of the real localStorage, read through Storage.prototype. */
function dump(): string {
    const out: Array<[string, string | null]> = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = Storage.prototype.key.call(localStorage, i);
        if (key !== null) out.push([key, Storage.prototype.getItem.call(localStorage, key)]);
    }
    return JSON.stringify(out.sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

function seed() {
    localStorage.setItem('kobar-storage', JSON.stringify({ state: { theme: 'dark' }, version: 22 }));
    localStorage.setItem('kobar_language', 'tr');
    localStorage.setItem('pomodoro-state', '{"running":false}');
    localStorage.setItem('pomodoro-state_iso_ws-1', '{"running":true}');
    localStorage.setItem('ai-hub-settings_iso_ws-1', JSON.stringify({ apiKey: 'fake-not-a-secret' }));
    localStorage.setItem('unicode', 'çğış € 😀');
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('migrateLocalStorageSnapshot', () => {
    it('sends every key (host, plugin and _iso_) verbatim and leaves localStorage byte-for-byte unchanged', async () => {
        seed();
        const before = dump();
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
        const clear = vi.spyOn(Storage.prototype, 'clear');
        const client = fakeClient(READY);

        const result = await migrateLocalStorageSnapshot({ client, storage: localStorage, log: () => {} });
        expect(result).toMatchObject({ ok: true, status: 'written' });
        expect(client.archiveLocalStorage).toHaveBeenCalledTimes(1);
        const sent = new Map(client.archiveLocalStorage.mock.calls[0][0].entries);
        expect([...sent.keys()].sort()).toEqual(
            ['ai-hub-settings_iso_ws-1', 'kobar-storage', 'kobar_language', 'pomodoro-state', 'pomodoro-state_iso_ws-1', 'unicode'].sort()
        );
        expect(sent.get('pomodoro-state')).toBe('{"running":false}');
        expect(sent.get('pomodoro-state_iso_ws-1')).toBe('{"running":true}');
        expect(sent.get('unicode')).toBe('çğış € 😀');

        expect(dump()).toBe(before);
        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
        expect(clear).not.toHaveBeenCalled();
    });

    it('reads through Storage.prototype, so a patched localStorage (like the workspace isolation patch) is bypassed', async () => {
        seed();
        // What src/utils/localStorageIsolation.ts does: assign replacements on the instance. Depending on the engine this
        // overrides the methods or (Storage named-property setter) stores items named after them; either way the copy must
        // read the stored names and values as they are and never call the replacements.
        const patchedGet = vi.fn((key: string) => Storage.prototype.getItem.call(localStorage, `${key}_iso_ws-1`));
        const patchedSet = vi.fn();
        const target = localStorage as unknown as Record<string, unknown>;
        target.getItem = patchedGet;
        target.setItem = patchedSet;
        const before = dump();
        const client = fakeClient(READY);

        expect(await migrateLocalStorageSnapshot({ client, storage: localStorage, log: () => {} })).toMatchObject({ ok: true });
        const sent = new Map(client.archiveLocalStorage.mock.calls[0][0].entries);
        expect(sent.get('pomodoro-state')).toBe('{"running":false}');
        expect(sent.get('pomodoro-state_iso_ws-1')).toBe('{"running":true}');
        expect(sent.get('kobar_language')).toBe('tr');
        expect(patchedGet).not.toHaveBeenCalled();
        expect(patchedSet).not.toHaveBeenCalled();
        expect(dump()).toBe(before);

        for (const name of ['getItem', 'setItem']) {
            if (Object.prototype.hasOwnProperty.call(localStorage, name) && typeof target[name] === 'function') delete target[name];
        }
    });

    it.each([
        ['no store snapshot', null, 'no-store'],
        ['file store disabled', { ...READY, disabled: true }, 'disabled'],
        ['read-only store', { ...READY, ok: true, readOnly: true }, 'read-only'],
        ['refused / failed snapshot', { ...READY, ok: false }, 'unavailable'],
        ['already migrated', { ...READY, migratedFromLocalStorageAt: 123 }, 'already-done'],
    ] as const)('skips without reading or sending anything: %s', async (_name, status, reason) => {
        seed();
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const client = fakeClient(status);
        expect(await migrateLocalStorageSnapshot({ client, storage: localStorage, log: () => {} })).toEqual({
            ok: false,
            status: 'skipped',
            reason,
        });
        expect(client.archiveLocalStorage).not.toHaveBeenCalled();
        expect(getItem).not.toHaveBeenCalled();
    });

    it('does not send more than the 20 MB cap', async () => {
        const big = { length: 1, key: () => 'big', getItem: () => 'x'.repeat(STORAGE_MAX_VALUE_BYTES) };
        const client = fakeClient(READY);
        const log = vi.fn();
        expect(await migrateLocalStorageSnapshot({ client, storage: big, log })).toMatchObject({ status: 'skipped', reason: 'too-large' });
        expect(client.archiveLocalStorage).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('too-large', expect.objectContaining({ keys: 1 }));
    });

    it('never throws; logs carry no key names or values', async () => {
        seed();
        const log = vi.fn();
        const failing = fakeClient(READY, new Error('ipc down'));
        expect(await migrateLocalStorageSnapshot({ client: failing, storage: localStorage, log })).toEqual({
            ok: false,
            status: 'skipped',
            reason: 'error',
        });
        const io = fakeClient(READY, { ok: false, status: 'io', migratedFromLocalStorageAt: null });
        expect(await migrateLocalStorageSnapshot({ client: io, storage: localStorage, log })).toMatchObject({ ok: false, status: 'io' });
        const logged = JSON.stringify(log.mock.calls);
        for (const text of ['pomodoro', 'ai-hub', 'fake-not-a-secret', 'dark']) expect(logged).not.toContain(text);
    });
});

describe('scheduleLocalStorageSnapshot', () => {
    function fakeStore(hydrated: boolean) {
        let state = { isHydrated: hydrated };
        const listeners = new Set<(s: { isHydrated: boolean }) => void>();
        return {
            getState: () => state,
            subscribe: (listener: (s: { isHydrated: boolean }) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            hydrate() {
                state = { isHydrated: true };
                for (const listener of [...listeners]) listener(state);
            },
            listeners,
        };
    }

    it('waits for a successful hydration, then the delay, then an idle callback; runs once', () => {
        vi.useFakeTimers();
        const store = fakeStore(false);
        const run = vi.fn(async () => undefined);
        const idle: Array<() => void> = [];
        scheduleLocalStorageSnapshot({ store, run, requestIdle: (fn) => idle.push(fn) });

        vi.advanceTimersByTime(LOCALSTORAGE_SNAPSHOT_DELAY_MS * 3);
        expect(run).not.toHaveBeenCalled();

        store.hydrate();
        store.hydrate();
        expect(store.listeners.size).toBe(0);
        vi.advanceTimersByTime(LOCALSTORAGE_SNAPSHOT_DELAY_MS - 1);
        expect(idle).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(idle).toHaveLength(1);
        expect(run).not.toHaveBeenCalled();
        idle[0]();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('an already hydrated store starts the delay at once; without requestIdleCallback it runs after the delay', () => {
        vi.useFakeTimers();
        const run = vi.fn(async () => undefined);
        scheduleLocalStorageSnapshot({ store: fakeStore(true), run, requestIdle: null, delayMs: 100 });
        vi.advanceTimersByTime(100);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('a failed hydration (never isHydrated) sends nothing; cancel stops a pending run', () => {
        vi.useFakeTimers();
        const run = vi.fn(async () => undefined);
        scheduleLocalStorageSnapshot({ store: fakeStore(false), run, requestIdle: null });
        vi.advanceTimersByTime(LOCALSTORAGE_SNAPSHOT_DELAY_MS * 10);
        expect(run).not.toHaveBeenCalled();

        const cancel = scheduleLocalStorageSnapshot({ store: fakeStore(true), run, requestIdle: null });
        cancel();
        vi.advanceTimersByTime(LOCALSTORAGE_SNAPSHOT_DELAY_MS * 2);
        expect(run).not.toHaveBeenCalled();
    });

    it('a rejected run is swallowed', async () => {
        vi.useFakeTimers();
        const run = vi.fn(async () => {
            throw new Error('boom');
        });
        scheduleLocalStorageSnapshot({ store: fakeStore(true), run, requestIdle: null, delayMs: 1 });
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        expect(run).toHaveBeenCalledTimes(1);
    });
});
