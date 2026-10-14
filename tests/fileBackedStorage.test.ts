// T-405: the file-backed persist base (src/storage/fileBackedStorage.ts) against a fake storage client: hydration source
// rules, dual-write, the T-404 archive gate, ok:false retries and the stop rules. Synthetic values only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcStorageSnapshot, IpcStorageWriteAck } from '../shared/ipc-contract';
import { buildBackup } from '../src/backup/buildBackup';
import { HOST_INTERNAL_KEYS, OFFICIAL_PLUGIN_ID_LIST, classifyBackupKey } from '../src/backup/keyPolicy';
import type { StorageStoreStatus } from '../src/storage/client';
import {
    FILE_WRITE_MAX_FAILURES,
    FILE_NEWER_MARKER,
    PERSIST_META_KEY,
    chooseHydrationSource,
    createFileBackedStorage,
    fingerprint,
    metaMatches,
    parseLocalWriteMeta,
    serializeLocalWriteMeta,
} from '../src/storage/fileBackedStorage';

const KEY = 'kobar-storage';
const value = (text: string) => JSON.stringify({ state: { note: text }, version: 23 });

function snapshot(partial: Partial<IpcStorageSnapshot> = {}): IpcStorageSnapshot {
    return {
        ok: true,
        key: KEY,
        source: 'none',
        seq: 0,
        schemaVersion: 1,
        value: null,
        writtenAt: null,
        readOnly: false,
        disabled: false,
        recoveredFromCorrupt: false,
        unreadable: false,
        previousCleanShutdown: null,
        migratedFromLocalStorageAt: null,
        ...partial,
    };
}

function fileSnapshot(text: string, writtenAt = 1000, source: 'file' | 'bak' = 'file'): IpcStorageSnapshot {
    return snapshot({ source, seq: 5, value: value(text), writtenAt });
}

function memoryLocal(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    let failKey: string | null = null;
    return {
        map,
        failOn(key: string | null) {
            failKey = key;
        },
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: vi.fn((k: string, v: string) => {
            if (k === failKey) throw new DOMException('quota', 'QuotaExceededError');
            map.set(k, v);
        }),
        removeItem: vi.fn((k: string) => {
            map.delete(k);
        }),
    };
}

type Ack = IpcStorageWriteAck;

function fakeClient(boot: IpcStorageSnapshot | null, options: { archived?: boolean; available?: boolean } = {}) {
    let seq = boot?.seq ?? 0;
    const answers: Array<(request: { seq: number; value: string }) => Ack> = [];
    const client = {
        available: options.available ?? true,
        takeBootSnapshot: vi.fn(() => {
            const s = boot;
            boot = null;
            return s;
        }),
        storeStatus: vi.fn((): StorageStoreStatus => ({
            ok: true,
            readOnly: false,
            disabled: false,
            migratedFromLocalStorageAt: options.archived ? 1 : null,
        })),
        sent: [] as string[],
        write: vi.fn(async (v: string): Promise<Ack> => {
            seq += 1;
            client.sent.push(v);
            const answer = answers.shift();
            return answer ? answer({ seq, value: v }) : { key: KEY, seq, ok: true };
        }),
        /** Queue the answer of the next write(s). */
        answer(...next: Array<(request: { seq: number; value: string }) => Ack>) {
            answers.push(...next);
        },
    };
    return client;
}

const fail =
    (reason: Ack['reason'], retryable: boolean) =>
    ({ seq }: { seq: number }): Ack => ({ key: KEY, seq, ok: false, reason, retryable });

afterEach(() => {
    vi.useRealTimers();
});

describe('fingerprint + side key', () => {
    it('is stable, sensitive to any change and round-trips through the side key', () => {
        expect(fingerprint('abc')).toBe(fingerprint('abc'));
        expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
        expect(fingerprint('')).toMatch(/^[0-9a-f]{8}$/);
        const meta = parseLocalWriteMeta(serializeLocalWriteMeta(value('a'), 42));
        expect(meta).toEqual({ writtenAt: 42, length: value('a').length, hash: fingerprint(value('a')) });
        expect(metaMatches(meta, value('a'))).toBe(true);
        expect(metaMatches(meta, value('b'))).toBe(false);
        for (const raw of [null, '', 'x', '{}', '{"writtenAt":"1","length":1,"hash":"a"}', '[]'])
            expect(parseLocalWriteMeta(raw)).toBeNull();
    });
});

describe('side key safety', () => {
    it('is a listed host-internal key: never restored (a restored side key could make an older file win) and never exported', () => {
        expect(HOST_INTERNAL_KEYS).toContain(PERSIST_META_KEY);
        const installed = new Set([...OFFICIAL_PLUGIN_ID_LIST, 'kobar-storage', 'kobar']);
        expect(classifyBackupKey(PERSIST_META_KEY, installed, new Set(), installed)).toEqual({ accepted: false, reason: 'host-internal' });
        for (const includeSecrets of [false, true]) {
            const backup = buildBackup(
                {
                    localStorage: { [KEY]: value('a'), [PERSIST_META_KEY]: serializeLocalWriteMeta(value('a'), 1) },
                    extensionsConfig: {},
                    plugins: [],
                    appVersion: '1.3.0',
                    now: new Date(0),
                },
                { includeSecrets }
            );
            expect(Object.keys(backup.localStorage)).toEqual([KEY]);
        }
    });
});

describe('chooseHydrationSource', () => {
    const meta = (text: string, writtenAt: number) => () => serializeLocalWriteMeta(value(text), writtenAt);

    it.each([
        ['no snapshot', null, 'no-snapshot'],
        ['refused/failed read', snapshot({ ok: false }), 'unavailable'],
        ['disabled', snapshot({ disabled: true, value: value('f'), source: 'file' }), 'disabled'],
        ['read-only (newer schema)', snapshot({ readOnly: true, value: value('f'), source: 'file' }), 'read-only'],
        ['unreadable file', snapshot({ ok: false, unreadable: true }), 'unreadable'],
    ] as const)('%s: localStorage, no file writes', (_label, snap, reason) => {
        expect(chooseHydrationSource(snap, value('l'), meta('l', 1))).toMatchObject({
            source: 'local',
            value: value('l'),
            fileWrites: false,
            reason,
        });
    });

    it('no file value: localStorage, file writes allowed (the first write creates the file)', () => {
        expect(chooseHydrationSource(snapshot(), value('l'), meta('l', 1))).toMatchObject({
            source: 'local',
            value: value('l'),
            fileWrites: true,
            reason: 'no-file',
            fileHasValue: false,
        });
        expect(chooseHydrationSource(snapshot({ recoveredFromCorrupt: true }), null, () => null)).toMatchObject({
            source: 'local',
            value: null,
        });
    });

    it('file value and no / identical localStorage: the file', () => {
        expect(chooseHydrationSource(fileSnapshot('f'), null, () => null)).toMatchObject({
            source: 'file',
            value: value('f'),
            reason: 'no-local',
        });
        const readMeta = vi.fn(() => null);
        expect(chooseHydrationSource(fileSnapshot('f'), value('f'), readMeta)).toMatchObject({ source: 'file', reason: 'identical' });
        expect(readMeta).not.toHaveBeenCalled();
        expect(chooseHydrationSource(fileSnapshot('f', 1, 'bak'), null, () => null)).toMatchObject({ source: 'bak' });
    });

    it('both differ: the file wins only on the positive marker; otherwise localStorage', () => {
        // Marker: a localStorage write failed and the file confirmed the newer value.
        expect(chooseHydrationSource(fileSnapshot('f', 1000), value('l'), () => FILE_NEWER_MARKER)).toMatchObject({
            source: 'file',
            reason: 'local-write-failed',
        });
        // A missing side key (never written, e.g. near the quota) means localStorage.
        expect(chooseHydrationSource(fileSnapshot('f', 1000), value('l'), () => null)).toMatchObject({
            source: 'local',
            reason: 'local-changed',
            fileWrites: true,
        });
        // The file write failed after the localStorage write.
        expect(chooseHydrationSource(fileSnapshot('f', 1000), value('l'), meta('l', 2000))).toMatchObject({
            source: 'local',
            reason: 'local-current',
            fileWrites: true,
            fileHasValue: true,
        });
        // Restore / KoBar 1.2.x / broken side key: the fingerprint does not match.
        expect(chooseHydrationSource(fileSnapshot('f', 1000), value('l'), meta('other', 1))).toMatchObject({
            source: 'local',
            reason: 'local-changed',
        });
        expect(chooseHydrationSource(fileSnapshot('f', 1000), value('l'), () => 'not json')).toMatchObject({
            source: 'local',
            reason: 'local-changed',
        });
        expect(
            chooseHydrationSource(fileSnapshot('f', 1000), value('l'), () => {
                throw new Error('boom');
            })
        ).toMatchObject({ source: 'local', reason: 'local-changed' });
    });

    it('file stamped after the local write (late file write, clock jump) -> localStorage wins', () => {
        // Main wrote an OLDER value V1 late (writtenAt 5000) after the renderer had written V2 to localStorage (t=1000),
        // and the app crashed before V2 reached the file: timestamps would pick the older file, the marker does not.
        expect(chooseHydrationSource(fileSnapshot('v1', 5000), value('v2'), meta('v2', 1000))).toMatchObject({
            source: 'local',
            value: value('v2'),
            reason: 'local-current',
        });
    });
});

describe('createFileBackedStorage', () => {
    function setup(
        boot: IpcStorageSnapshot | null,
        options: { archived?: boolean; available?: boolean; local?: Record<string, string> } = {}
    ) {
        const local = memoryLocal(options.local);
        const client = fakeClient(boot, options);
        let clock = 10_000;
        const log = vi.fn();
        const storage = createFileBackedStorage({
            client,
            getLocal: () => local,
            now: () => ++clock,
            log,
            retryBaseMs: 10,
            retryMaxMs: 40,
        });
        return { local, client, storage, log };
    }

    it('takes the boot snapshot exactly once and hydrates from the file', () => {
        const { client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        expect(storage.getItem(KEY)).toBe(value('f'));
        expect(storage.getItem(KEY)).toBe(value('f'));
        expect(client.takeBootSnapshot).toHaveBeenCalledTimes(1);
        expect(storage.hydration()).toMatchObject({ source: 'file', reason: 'identical' });
        expect(storage.hydration()).not.toHaveProperty('value');
        expect(storage.fileWrites()).toBe('on');
    });

    it('dual-write: the same string goes to localStorage and the file; the side key describes it', async () => {
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        storage.setItem(KEY, value('n'));
        expect(local.map.get(KEY)).toBe(value('n'));
        expect(client.sent).toEqual([value('n')]);
        expect(metaMatches(parseLocalWriteMeta(local.map.get(PERSIST_META_KEY) ?? null), value('n'))).toBe(true);
        await storage.whenIdle();
        // Other keys are plain localStorage.
        storage.setItem('other', 'x');
        expect(local.map.get('other')).toBe('x');
        expect(client.sent).toHaveLength(1);
    });

    it('no snapshot (outside Electron / another window): localStorage only, no file write and no side key', async () => {
        const { local, client, storage } = setup(null, { available: false, local: { [KEY]: value('l') } });
        expect(storage.getItem(KEY)).toBe(value('l'));
        storage.setItem(KEY, value('n'));
        expect(local.map.get(KEY)).toBe(value('n'));
        expect(local.map.has(PERSIST_META_KEY)).toBe(false);
        expect(client.write).not.toHaveBeenCalled();
        expect(storage.fileWrites()).toBe('off');
    });

    it('a refused snapshot (another window) writes no file but keeps the side key current', () => {
        const { local, client, storage } = setup(snapshot({ ok: false }), { local: { [KEY]: value('l') } });
        storage.getItem(KEY);
        storage.setItem(KEY, value('n'));
        expect(client.write).not.toHaveBeenCalled();
        expect(metaMatches(parseLocalWriteMeta(local.map.get(PERSIST_META_KEY) ?? null), value('n'))).toBe(true);
    });

    it('no file yet: the first file write waits for the T-404 archive, then sends the newest value', async () => {
        const { client, storage } = setup(snapshot(), { local: { [KEY]: value('l') } });
        expect(storage.getItem(KEY)).toBe(value('l'));
        expect(storage.fileWrites()).toBe('waiting');
        storage.setItem(KEY, value('1'));
        storage.setItem(KEY, value('2'));
        expect(client.write).not.toHaveBeenCalled();
        storage.releaseFileWrites();
        expect(storage.fileWrites()).toBe('on');
        expect(client.sent).toEqual([value('2')]);
        await storage.whenIdle();
    });

    it('no file yet but the archive was taken in an earlier session: writes at once', () => {
        const { client, storage } = setup(snapshot(), { archived: true, local: { [KEY]: value('l') } });
        storage.getItem(KEY);
        storage.setItem(KEY, value('1'));
        expect(client.sent).toEqual([value('1')]);
    });

    it('a release before hydration is remembered', () => {
        const { client, storage } = setup(snapshot());
        storage.releaseFileWrites();
        storage.getItem(KEY);
        storage.setItem(KEY, value('1'));
        expect(client.sent).toEqual([value('1')]);
    });

    it('ok:false (retryable) never loses data: localStorage has it and the newest value is sent again', async () => {
        vi.useFakeTimers();
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        client.answer(fail('io', true), fail('backup-failed', true));
        storage.setItem(KEY, value('1'));
        expect(local.map.get(KEY)).toBe(value('1'));
        await vi.advanceTimersByTimeAsync(0);
        expect(client.sent).toEqual([value('1')]);
        await vi.advanceTimersByTimeAsync(10);
        expect(client.sent).toEqual([value('1'), value('1')]);
        await vi.advanceTimersByTimeAsync(20);
        expect(client.sent).toEqual([value('1'), value('1'), value('1')]);
        expect(storage.fileWrites()).toBe('on');
        const idle = storage.whenIdle();
        await vi.advanceTimersByTimeAsync(100);
        await idle;
        expect(client.sent).toHaveLength(3);
        expect(local.map.get(KEY)).toBe(value('1'));
    });

    it('a new value during the back-off is sent at once (the retry then has nothing left to send)', async () => {
        vi.useFakeTimers();
        const { client, storage } = setup(fileSnapshot('f'));
        storage.getItem(KEY);
        client.answer(fail('io', true));
        storage.setItem(KEY, value('1'));
        await vi.advanceTimersByTimeAsync(0);
        storage.setItem(KEY, value('2'));
        await vi.advanceTimersByTimeAsync(100);
        expect(client.sent).toEqual([value('1'), value('2')]);
    });

    it('the failure of an older write is decided by the newer write that followed it', async () => {
        const { client, storage, log } = setup(fileSnapshot('f'));
        storage.getItem(KEY);
        client.answer(fail('stale-base', false));
        storage.setItem(KEY, value('1'));
        storage.setItem(KEY, value('2'));
        await storage.whenIdle();
        expect(storage.fileWrites()).toBe('on');
        expect(log).not.toHaveBeenCalledWith('file-writes-stopped', expect.anything());
    });

    it('a refusal that will never succeed stops the file writes for the session; localStorage carries on', async () => {
        const { local, client, storage, log } = setup(fileSnapshot('f'));
        storage.getItem(KEY);
        client.answer(fail('read-only', false));
        storage.setItem(KEY, value('1'));
        await storage.whenIdle();
        expect(storage.fileWrites()).toBe('off');
        expect(log).toHaveBeenCalledWith('file-writes-stopped', { reason: 'rejected:read-only' });
        storage.setItem(KEY, value('2'));
        expect(client.sent).toEqual([value('1')]);
        expect(local.map.get(KEY)).toBe(value('2'));
    });

    it(`stops after ${FILE_WRITE_MAX_FAILURES} failures in a row`, async () => {
        vi.useFakeTimers();
        const { client, storage } = setup(fileSnapshot('f'));
        storage.getItem(KEY);
        for (let i = 0; i < FILE_WRITE_MAX_FAILURES + 5; i++) client.answer(fail('io', true));
        storage.setItem(KEY, value('1'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(client.sent).toHaveLength(FILE_WRITE_MAX_FAILURES);
        expect(storage.fileWrites()).toBe('off');
    });

    it('a failing localStorage write is still reported (persist warning) but the file gets the value', () => {
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        local.failOn(KEY);
        expect(() => storage.setItem(KEY, value('1'))).toThrow('quota');
        expect(client.sent).toEqual([value('1')]);
        expect(local.map.get(KEY)).toBe(value('f'));
        // A later read (persist.rehydrate) returns the newest value, not the stale localStorage copy.
        expect(storage.getItem(KEY)).toBe(value('1'));
    });

    it('the file-newer marker is set only after the file confirmed the value localStorage could not store', async () => {
        vi.useFakeTimers();
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        storage.setItem(KEY, value('0'));
        await vi.advanceTimersByTimeAsync(0);
        expect(local.map.has(PERSIST_META_KEY)).toBe(true);
        local.failOn(KEY);
        client.answer(fail('io', true));
        expect(() => storage.setItem(KEY, value('1'))).toThrow('quota');
        // Still the JSON meta while the file has not got the newer value (a crash now must prefer localStorage).
        await vi.advanceTimersByTimeAsync(0);
        expect(metaMatches(parseLocalWriteMeta(local.map.get(PERSIST_META_KEY) ?? null), value('0'))).toBe(true);
        // The retry succeeds: now the file is provably newer.
        await vi.advanceTimersByTimeAsync(10);
        expect(client.sent).toEqual([value('0'), value('1'), value('1')]);
        expect(local.map.get(PERSIST_META_KEY)).toBe(FILE_NEWER_MARKER);
        // The next successful localStorage write puts the side key back.
        local.failOn(null);
        storage.setItem(KEY, value('2'));
        expect(metaMatches(parseLocalWriteMeta(local.map.get(PERSIST_META_KEY) ?? null), value('2'))).toBe(true);
    });

    it('first side-key write fails, then a file write fails -> localStorage wins at the next start', async () => {
        const local = memoryLocal({ [KEY]: value('f') });
        const first = createFileBackedStorage({ client: fakeClient(fileSnapshot('f')), getLocal: () => local, log: () => {} });
        first.getItem(KEY);
        // Near the quota: overwriting kobar-storage works, adding the new side key does not.
        local.failOn(PERSIST_META_KEY);
        first.setItem(KEY, value('1'));
        expect(local.map.get(KEY)).toBe(value('1'));
        expect(local.map.has(PERSIST_META_KEY)).toBe(false);
        // The file write never lands (crash / drain timeout): next start sees file 'f' and localStorage '1'.
        local.failOn(null);
        const next = createFileBackedStorage({ client: fakeClient(fileSnapshot('f')), getLocal: () => local, log: () => {} });
        expect(next.getItem(KEY)).toBe(value('1'));
        expect(next.hydration()).toMatchObject({ source: 'local', reason: 'local-changed' });
    });

    it('a stale file-newer marker is removed when the side key cannot record a later successful localStorage write', () => {
        const { local, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('l'), [PERSIST_META_KEY]: FILE_NEWER_MARKER } });
        expect(storage.getItem(KEY)).toBe(value('f'));
        local.failOn(PERSIST_META_KEY);
        storage.setItem(KEY, value('n'));
        expect(local.map.get(KEY)).toBe(value('n'));
        expect(local.map.has(PERSIST_META_KEY)).toBe(false);
    });

    it('JSON side keys written by earlier builds still mean "localStorage is current"', () => {
        const { storage } = setup(fileSnapshot('f'), {
            local: { [KEY]: value('l'), [PERSIST_META_KEY]: serializeLocalWriteMeta(value('l'), 1) },
        });
        expect(storage.getItem(KEY)).toBe(value('l'));
        expect(storage.hydration()).toMatchObject({ source: 'local', reason: 'local-current' });
    });

    it('no marker when the file never confirms (file writes stop): localStorage wins at the next start', async () => {
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        storage.setItem(KEY, value('0'));
        await storage.whenIdle();
        local.failOn(KEY);
        client.answer(fail('read-only', false));
        expect(() => storage.setItem(KEY, value('1'))).toThrow('quota');
        await storage.whenIdle();
        expect(storage.fileWrites()).toBe('off');
        expect(local.map.has(PERSIST_META_KEY)).toBe(true);
    });

    it('a failing side-key write is swallowed (the next startup then prefers localStorage)', () => {
        const { local, client, storage, log } = setup(fileSnapshot('f'));
        storage.getItem(KEY);
        local.failOn(PERSIST_META_KEY);
        expect(() => storage.setItem(KEY, value('1'))).not.toThrow();
        expect(local.map.get(KEY)).toBe(value('1'));
        expect(client.sent).toEqual([value('1')]);
        expect(log).toHaveBeenCalledWith('meta-write-failed', expect.anything());
    });

    it('the file won with another value: later reads return it until localStorage was written again', () => {
        const { local, storage } = setup(fileSnapshot('f', 1000), { local: { [KEY]: value('l'), [PERSIST_META_KEY]: FILE_NEWER_MARKER } });
        expect(storage.getItem(KEY)).toBe(value('f'));
        expect(storage.getItem(KEY)).toBe(value('f'));
        expect(local.map.get(KEY)).toBe(value('l'));
        storage.setItem(KEY, value('n'));
        expect(storage.getItem(KEY)).toBe(value('n'));
    });

    it('removeItem removes the localStorage value only', () => {
        const { local, client, storage } = setup(fileSnapshot('f'), { local: { [KEY]: value('f') } });
        storage.getItem(KEY);
        storage.removeItem(KEY);
        expect(local.map.has(KEY)).toBe(false);
        expect(storage.getItem(KEY)).toBeNull();
        expect(client.write).not.toHaveBeenCalled();
    });

    it('never logs a value', async () => {
        const { storage, client, log } = setup(fileSnapshot('secret-note'));
        storage.getItem(KEY);
        client.answer(fail('read-only', false));
        storage.setItem(KEY, value('secret-2'));
        await storage.whenIdle();
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    });
});
