// T-403: IPC transport of the file-backed store. Real StorageService on a temp dir, a fake ipcMain + the real typed registry,
// the real preload bridge (electron/lib/storageBridge.cts) and the real renderer client (src/storage/client.ts) wired through
// the fake handlers. Synthetic values only; never touches the real userData and never launches Electron.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { InvokeResult, IpcStorageSnapshot, IpcStorageWriteAck, IpcStorageWriteFailure, SyncResult } from '../shared/ipc-contract';
import { type IpcMainLike, createIpcRegistry } from '../electron/main/ipc/registry.cjs';
import { createStorageBridge } from '../electron/lib/storageBridge.cjs';
import { STORAGE_MAX_VALUE_BYTES } from '../electron/main/services/storage/layout.cjs';
import {
    STORAGE_DRAIN_TIMEOUT_MS,
    type StorageIpc,
    createStorageIpc,
    emptyStorageSnapshot,
    registerStorageIpc,
} from '../electron/main/services/storage/storageIpc.cjs';
import {
    type StorageService,
    type StorageWriteAck,
    type StorageWriteFailure,
    createStorageService,
} from '../electron/main/services/storage/storageService.cjs';
import { STORAGE_MAX_VALUE_BYTES as CLIENT_MAX_VALUE_BYTES, createStorageClient } from '../src/storage/client';
import { readMainModule } from './helpers/mainSource';

const KEY = 'kobar-storage';
const MAIN_WINDOW = 1;
const OTHER_WINDOW = 2;

type Listener = (event: never, ...args: unknown[]) => unknown;

interface FakeEvent {
    sender: { id: number };
    returnValue?: unknown;
}

let tmp: string;
let root: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-t403-'));
    root = path.join(tmp, 'kobar-data');
});

afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmp, { recursive: true, force: true });
});

function hostFile(): string {
    return path.join(root, 'host', 'kobar-storage.json');
}

function readHostValue(): string | null {
    if (!fs.existsSync(hostFile())) return null;
    return (JSON.parse(fs.readFileSync(hostFile(), 'utf8')) as { value: string }).value;
}

/** A persist-shaped synthetic value. */
function persisted(text: string): string {
    return JSON.stringify({ state: { note: text }, version: 22 });
}

function setup(options: { service?: StorageService; writers?: number[]; drainTimeoutMs?: number } = {}) {
    const service = options.service ?? createStorageService({ root, appVersion: '1.3.0-test', log: () => {} });
    const writers = new Set(options.writers ?? [MAIN_WINDOW]);
    const logged: Array<[string, unknown]> = [];
    const storage = createStorageIpc({
        service,
        isWriter: (event) => writers.has((event as unknown as FakeEvent).sender.id),
        log: (event, details) => logged.push([event, details]),
        drainTimeoutMs: options.drainTimeoutMs,
    });
    const handlers = new Map<string, Listener>();
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => void handlers.set(channel, listener as Listener),
        on: (channel, listener) => void listeners.set(channel, listener as Listener),
    };
    const registry = createIpcRegistry({ ipcMain, logger: { warn: () => {}, error: () => {} } });
    registerStorageIpc({ ipcMain, registry, storage });

    /** sendSync as Electron does it: the listener runs, the renderer gets event.returnValue. */
    const sendSync = (channel: string, sender: number, ...args: unknown[]) => {
        const event: FakeEvent = { sender: { id: sender } };
        listeners.get(channel)!(event as never, ...args);
        return event.returnValue;
    };
    const invoke = async (channel: string, sender: number, ...args: unknown[]) =>
        handlers.get(channel)!({ sender: { id: sender } } as never, ...args);

    /** The preload's transport, as electron/preload.cts builds it, for one sender. */
    const transportFor = (sender: number) => ({
        readSnapshot: () => sendSync('storage-snapshot', sender, KEY) as IpcStorageSnapshot,
        write: (request: unknown) => invoke('storage-write', sender, request) as Promise<IpcStorageWriteAck>,
        writeSync: (request: unknown) => sendSync('storage-write-sync', sender, request) as IpcStorageWriteAck,
    });

    return { service, storage, handlers, listeners, sendSync, invoke, transportFor, logged };
}

describe('contract types (compile time)', () => {
    it('the service shapes fit the IPC contract', () => {
        expectTypeOf<StorageWriteFailure>().toExtend<IpcStorageWriteFailure>();
        expectTypeOf<ReturnType<StorageIpc['write']>>().toEqualTypeOf<Promise<InvokeResult<'storage-write'>>>();
        expectTypeOf<ReturnType<StorageIpc['writeSync']>>().toEqualTypeOf<SyncResult<'storage-write-sync'>>();
        expectTypeOf<ReturnType<StorageIpc['snapshot']>>().toEqualTypeOf<SyncResult<'storage-snapshot'>>();
        expectTypeOf<StorageWriteAck['reason']>().toExtend<IpcStorageWriteAck['reason']>();
    });

    it('main and the renderer client use the same 20 MB cap', () => {
        expect(CLIENT_MAX_VALUE_BYTES).toBe(STORAGE_MAX_VALUE_BYTES);
        expect(STORAGE_MAX_VALUE_BYTES).toBe(20 * 1024 * 1024);
    });
});

describe('storage-snapshot', () => {
    it('serves the main window: empty store first, then the written value with its seq as the new baseline', async () => {
        const { sendSync, invoke } = setup();
        const first = sendSync('storage-snapshot', MAIN_WINDOW, KEY) as IpcStorageSnapshot;
        expect(first).toMatchObject({
            ok: true,
            source: 'none',
            seq: 0,
            value: null,
            previousCleanShutdown: null,
            migratedFromLocalStorageAt: null,
        });
        expect(first).not.toHaveProperty('manifest');

        const ack = (await invoke('storage-write', MAIN_WINDOW, {
            key: KEY,
            seq: 1,
            baseSeq: 0,
            value: persisted('a'),
        })) as IpcStorageWriteAck;
        expect(ack).toMatchObject({ key: KEY, seq: 1, ok: true });
        expect(readHostValue()).toBe(persisted('a'));

        const second = sendSync('storage-snapshot', MAIN_WINDOW, KEY) as IpcStorageSnapshot;
        expect(second).toMatchObject({ ok: true, source: 'file', seq: 1, value: persisted('a') });
    });

    it('refuses other senders without touching the disk or the baseline', async () => {
        const { sendSync, invoke, logged } = setup();
        const refused = sendSync('storage-snapshot', OTHER_WINDOW, KEY) as IpcStorageSnapshot;
        expect(refused).toEqual(emptyStorageSnapshot(KEY));
        expect(fs.existsSync(root)).toBe(false);
        expect(logged.some(([event]) => event === 'denied')).toBe(true);

        // A refused snapshot does not count as a hydration for anybody.
        const ack = (await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: 'x' })) as IpcStorageWriteAck;
        expect(ack).toMatchObject({ ok: false, reason: 'not-hydrated', retryable: true });
        expect(fs.existsSync(hostFile())).toBe(false);
    });

    it('only the allowlisted key is read; path-like keys never reach the service', () => {
        const service = createStorageService({ root, appVersion: 't', log: () => {} });
        const readSnapshot = vi.spyOn(service, 'readSnapshot');
        const { sendSync } = setup({ service });
        for (const key of ['../kobar-storage', 'host/kobar-storage.json', 'kobar-storage.json', '', 42, null, { key: KEY }]) {
            expect(sendSync('storage-snapshot', MAIN_WINDOW, key), String(key)).toMatchObject({ ok: false, source: 'none', value: null });
        }
        expect(readSnapshot).not.toHaveBeenCalled();
    });

    it('always sets returnValue, even when the service throws', () => {
        const service = createStorageService({ root, appVersion: 't', log: () => {} });
        vi.spyOn(service, 'readSnapshot').mockImplementation(() => {
            throw new Error('boom');
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { sendSync } = setup({ service });
        expect(sendSync('storage-snapshot', MAIN_WINDOW, KEY)).toEqual(emptyStorageSnapshot(KEY));
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('logs timing and size of the read, never the value', () => {
        const { sendSync, logged } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        const entry = logged.find(([event]) => event === 'snapshot' || event === 'slow-snapshot');
        expect(entry?.[1]).toMatchObject({ key: KEY, source: 'none', chars: 0 });
        expect(typeof (entry?.[1] as { ms: number }).ms).toBe('number');
    });
});

describe('storage-write / storage-write-sync validation', () => {
    const cases: Array<[string, unknown, IpcStorageWriteFailure]> = [
        ['not an object', 'kobar-storage', 'invalid-request'],
        ['an array', [KEY, 1, 0, 'v'], 'invalid-request'],
        ['a path as key', { key: '../host/kobar-storage', seq: 1, baseSeq: 0, value: 'v' }, 'invalid-key'],
        ['a file name as key', { key: 'host/kobar-storage.json', seq: 1, baseSeq: 0, value: 'v' }, 'invalid-key'],
        ['an unknown key', { key: 'chat', seq: 1, baseSeq: 0, value: 'v' }, 'invalid-key'],
        ['no baseSeq', { key: KEY, seq: 1, value: 'v' }, 'invalid-seq'],
        ['a bad seq', { key: KEY, seq: 1.5, baseSeq: 0, value: 'v' }, 'invalid-seq'],
        ['a non-string value', { key: KEY, seq: 1, baseSeq: 0, value: { state: {} } }, 'invalid-value'],
    ];

    for (const [label, request, reason] of cases) {
        it(`refuses ${label} on both channels`, async () => {
            const { sendSync, invoke } = setup();
            sendSync('storage-snapshot', MAIN_WINDOW, KEY);
            expect(await invoke('storage-write', MAIN_WINDOW, request)).toMatchObject({ ok: false, reason });
            expect(sendSync('storage-write-sync', MAIN_WINDOW, request)).toMatchObject({ ok: false, reason });
            expect(fs.existsSync(hostFile())).toBe(false);
        });
    }

    it('refuses values over the 20 MB cap on both channels (before the service)', async () => {
        const service = createStorageService({ root, appVersion: 't', log: () => {} });
        const write = vi.spyOn(service, 'write');
        const writeSync = vi.spyOn(service, 'writeSync');
        const { sendSync, invoke } = setup({ service });
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        const huge = 'x'.repeat(STORAGE_MAX_VALUE_BYTES + 1);
        const request = { key: KEY, seq: 1, baseSeq: 0, value: huge };
        expect(await invoke('storage-write', MAIN_WINDOW, request)).toMatchObject({ ok: false, reason: 'too-large', retryable: false });
        expect(sendSync('storage-write-sync', MAIN_WINDOW, request)).toMatchObject({ ok: false, reason: 'too-large' });
        expect(write).not.toHaveBeenCalled();
        expect(writeSync).not.toHaveBeenCalled();
    });

    it('a value under the UTF-16 bound but over 20 MB of UTF-8 is still refused by the service', async () => {
        const { sendSync, invoke } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        const wide = 'é'.repeat(STORAGE_MAX_VALUE_BYTES / 2 + 1); // 2 UTF-8 bytes each
        expect(await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: wide })).toMatchObject({
            ok: false,
            reason: 'too-large',
        });
        expect(fs.existsSync(hostFile())).toBe(false);
    });

    it('only the main window top frame may write (writer authorisation), on both channels', async () => {
        const { sendSync, invoke } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        const request = { key: KEY, seq: 1, baseSeq: 0, value: 'v' };
        expect(await invoke('storage-write', OTHER_WINDOW, request)).toMatchObject({ ok: false, reason: 'denied', retryable: false });
        expect(sendSync('storage-write-sync', OTHER_WINDOW, request)).toMatchObject({ ok: false, reason: 'denied' });
        expect(fs.existsSync(hostFile())).toBe(false);
    });

    it('a writer must have received the current snapshot (hydrate before the first write)', async () => {
        // Both windows pass the writer check here, but only the one that took the snapshot may write.
        const { sendSync, invoke } = setup({ writers: [MAIN_WINDOW, OTHER_WINDOW] });
        const request = { key: KEY, seq: 1, baseSeq: 0, value: 'v' };
        expect(await invoke('storage-write', MAIN_WINDOW, request)).toMatchObject({ ok: false, reason: 'not-hydrated' });
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        expect(await invoke('storage-write', OTHER_WINDOW, request)).toMatchObject({ ok: false, reason: 'not-hydrated' });
        expect(await invoke('storage-write', MAIN_WINDOW, request)).toMatchObject({ ok: true });
    });

    it('a write built on an older snapshot is refused after a re-hydration (stale-base), a late seq is stale', async () => {
        const { sendSync, invoke } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        expect(await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: persisted('a') })).toMatchObject({
            ok: true,
        });
        expect(await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: persisted('late') })).toMatchObject({
            ok: false,
            reason: 'stale',
        });
        sendSync('storage-snapshot', MAIN_WINDOW, KEY); // renderer reload: new baseline 1
        expect(await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 2, baseSeq: 0, value: persisted('old page') })).toMatchObject({
            ok: false,
            reason: 'stale-base',
        });
        expect(readHostValue()).toBe(persisted('a'));
    });

    it('storage-write-sync writes synchronously and always sets returnValue', () => {
        const { sendSync } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        expect(sendSync('storage-write-sync', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: persisted('sync') })).toMatchObject({
            ok: true,
            seq: 1,
        });
        expect(readHostValue()).toBe(persisted('sync'));
    });

    it('acks carry only contract fields and the log never contains a value', async () => {
        const { sendSync, invoke, logged } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        const secret = persisted('sk-test-not-a-real-key-123456');
        const ack = (await invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: secret, extra: 'x' })) as object;
        for (const field of Object.keys(ack)) expect(['key', 'seq', 'ok', 'reason', 'retryable', 'code', 'superseded']).toContain(field);
        await invoke('storage-write', OTHER_WINDOW, { key: KEY, seq: 2, baseSeq: 0, value: secret });
        expect(JSON.stringify(logged)).not.toContain('sk-test');
    });
});

describe('quit: drain + clean shutdown', () => {
    it('drain waits until a write main received is renamed into place', async () => {
        const { sendSync, invoke, storage } = setup();
        sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        // The renderer flushes (write in flight), then its flush-persist ack arrives: main drains before quitting.
        const writing = invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: persisted('last keystroke') });
        await expect(storage.drain()).resolves.toBe(true);
        expect(readHostValue()).toBe(persisted('last keystroke'));
        await expect(writing).resolves.toMatchObject({ ok: true });
    });

    it('drain resolves false at the timeout instead of hanging the quit', async () => {
        vi.useFakeTimers();
        const service = createStorageService({ root, appVersion: 't', log: () => {} });
        vi.spyOn(service, 'flush').mockImplementation(() => new Promise<void>(() => {}));
        const { storage, logged } = setup({ service });
        const draining = storage.drain();
        vi.advanceTimersByTime(STORAGE_DRAIN_TIMEOUT_MS);
        await expect(draining).resolves.toBe(false);
        expect(logged.some(([event]) => event === 'drain-timeout')).toBe(true);
    });

    it('drain resolves false (not a rejection) when the flush fails', async () => {
        const service = createStorageService({ root, appVersion: 't', log: () => {} });
        vi.spyOn(service, 'flush').mockImplementation(() => {
            throw new Error('boom');
        });
        const { storage } = setup({ service });
        await expect(storage.drain()).resolves.toBe(false);
    });

    it('a clean shutdown is visible to the next session through the snapshot', async () => {
        const first = setup();
        first.sendSync('storage-snapshot', MAIN_WINDOW, KEY);
        await first.invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: persisted('a') });
        await first.storage.drain();
        expect(first.storage.markCleanShutdown()).toBe(true);

        const next = setup();
        expect(next.sendSync('storage-snapshot', MAIN_WINDOW, KEY)).toMatchObject({
            source: 'file',
            seq: 1,
            previousCleanShutdown: true,
        });
        // Without markCleanShutdown the following session sees an unclean one.
        const after = setup();
        expect(after.sendSync('storage-snapshot', MAIN_WINDOW, KEY)).toMatchObject({ previousCleanShutdown: false });
    });
});

describe('preload bridge + renderer client end to end', () => {
    it('the client continues from the boot snapshot seq and always sends baseSeq', async () => {
        const main = setup();
        await main.invoke('storage-write', MAIN_WINDOW, { key: KEY, seq: 1, baseSeq: 0, value: 'x' }); // refused: not hydrated
        // Session 1 writes seq 1..3.
        const s1 = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        for (const text of ['a', 'b', 'c']) expect(await s1.write(persisted(text))).toMatchObject({ ok: true });
        // Session 2 (reload): its boot snapshot has seq 3, so its first write is seq 4 with baseSeq 3.
        const write = vi.spyOn(main.storage, 'write');
        const s2 = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        expect(s2.takeBootSnapshot()).toMatchObject({ source: 'file', seq: 3, value: persisted('c') });
        expect(s2.takeBootSnapshot()).toBeNull();
        expect(await s2.write(persisted('d'))).toMatchObject({ ok: true, seq: 4 });
        expect(write.mock.calls[0][1]).toMatchObject({ key: KEY, seq: 4, baseSeq: 3 });
        expect(readHostValue()).toBe(persisted('d'));
    });

    it('a failed boot snapshot read does not leave the renderer at seq 0 while main is at N', async () => {
        const main = setup();
        const s1 = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        for (const text of ['a', 'b', 'c', 'd', 'e']) await s1.write(persisted(text));

        // The preload's sendSync throws AFTER main read the file and re-baselined to 5.
        const transport = main.transportFor(MAIN_WINDOW);
        const brokenFirstRead = {
            ...transport,
            readSnapshot: vi.fn((): IpcStorageSnapshot => {
                transport.readSnapshot();
                throw new Error('sendSync failed');
            }),
        };
        const bridge = createStorageBridge(brokenFirstRead, () => {});
        brokenFirstRead.readSnapshot.mockImplementation(transport.readSnapshot);
        const s2 = createStorageClient(bridge.claim());
        expect(s2.takeBootSnapshot()).toBeNull();
        expect(s2.baseSeq()).toBeNull();
        // The first write re-reads the baseline (5) and is accepted as seq 6.
        expect(await s2.write(persisted('f'))).toMatchObject({ ok: true, seq: 6 });
        expect(s2.baseSeq()).toBe(5);
        expect(readHostValue()).toBe(persisted('f'));
    });

    it('writeSync goes through the sync channel with the same seq sequence', async () => {
        const main = setup();
        const client = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        expect(await client.write(persisted('async'))).toMatchObject({ ok: true, seq: 1 });
        expect(client.writeSync(persisted('unload'))).toMatchObject({ ok: true, seq: 2 });
        expect(readHostValue()).toBe(persisted('unload'));
    });

    it('a not-hydrated refusal is retryable; the client re-reads the snapshot once and its retry is accepted', async () => {
        // Both senders pass the writer check; another one took the latest snapshot (e.g. a recreated main window).
        const main = setup({ writers: [MAIN_WINDOW, OTHER_WINDOW] });
        const client = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        expect(await client.write(persisted('a'))).toMatchObject({ ok: true, seq: 1 });
        main.sendSync('storage-snapshot', OTHER_WINDOW, KEY);
        const snapshot = vi.spyOn(main.storage, 'snapshot');
        const refused = await client.write(persisted('b'));
        expect(refused).toMatchObject({ ok: false, reason: 'not-hydrated', retryable: true });
        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(client.baseSeq()).toBe(1);
        expect(await client.write(persisted('b'))).toMatchObject({ ok: true, seq: 2 });
        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(readHostValue()).toBe(persisted('b'));
    });

    it('main source wiring: registered in registerCoreIpc with the main-window writer check', () => {
        // Source check only for the Electron-bound wiring; the quit / session-end behaviour is tested in tests/persistQuit.test.ts.
        const bootstrap = readMainModule('bootstrap.cts');
        expect(bootstrap).toMatch(/registerStorageIpc\(\{ ipcMain, registry: ctx\.registry, storage: ctx\.storage \}\)/);
        const context = readMainModule('app/context.cts');
        expect(context).toMatch(/isWriter: \(event\) => isMainWindowTopFrame\(event\)/);
        expect(context).toMatch(/createPersistSession\(storage\)/);
    });
});
