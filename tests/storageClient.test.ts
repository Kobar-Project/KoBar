// T-403: renderer half of the file-backed store transport (src/storage/client.ts) against fake bridges: seq continuation,
// mandatory baseSeq, re-baselining when the boot snapshot is missing, local refusals and claim-once at import.
import { describe, expect, it, vi } from 'vitest';
import type { IpcClaimedStorageBridge, IpcStorageSnapshot, IpcStorageWriteAck, IpcStorageWriteRequest } from '../shared/ipc-contract';
import { createStorageBridge } from '../electron/lib/storageBridge.cjs';
import { STORAGE_MAX_VALUE_BYTES, claimStorageBridge, createStorageClient, isStorageSnapshot } from '../src/storage/client';

function snapshot(seq: number, value: string | null = null): IpcStorageSnapshot {
    return {
        ok: true,
        key: 'kobar-storage',
        source: value === null ? 'none' : 'file',
        seq,
        schemaVersion: 1,
        value,
        writtenAt: value === null ? null : 1,
        readOnly: false,
        disabled: false,
        recoveredFromCorrupt: false,
        unreadable: false,
        previousCleanShutdown: null,
        migratedFromLocalStorageAt: null,
    };
}

function fakeBridge(boot: IpcStorageSnapshot | null, reread: () => IpcStorageSnapshot | null = () => null) {
    const sent: IpcStorageWriteRequest[] = [];
    const bridge: IpcClaimedStorageBridge = {
        snapshot: boot,
        readSnapshot: vi.fn(reread),
        write: vi.fn(async (request: IpcStorageWriteRequest) => {
            sent.push(request);
            return { key: request.key, seq: request.seq, ok: true };
        }),
        writeSync: vi.fn((request: IpcStorageWriteRequest) => {
            sent.push(request);
            return { key: request.key, seq: request.seq, ok: true };
        }),
        archiveLocalStorage: vi.fn(async () => ({ ok: false, status: 'unavailable' as const, migratedFromLocalStorageAt: null })),
    };
    return { bridge, sent };
}

describe('createStorageClient', () => {
    it('without a bridge it is unavailable and refuses writes locally (not retryable)', async () => {
        const client = createStorageClient(null);
        expect(client.available).toBe(false);
        expect(client.takeBootSnapshot()).toBeNull();
        await expect(client.write('v')).resolves.toMatchObject({ ok: false, reason: 'unavailable', retryable: false });
        expect(client.writeSync('v')).toMatchObject({ ok: false, reason: 'unavailable', retryable: false });
        expect(client.resync()).toBeNull();
    });

    it('continues from the boot snapshot seq and always sends baseSeq', async () => {
        const { bridge, sent } = fakeBridge(snapshot(7, 'stored'));
        const client = createStorageClient(bridge);
        expect(client.baseSeq()).toBe(7);
        await client.write('a');
        client.writeSync('b');
        await client.write('c');
        expect(sent.map((r) => [r.key, r.seq, r.baseSeq, r.value])).toEqual([
            ['kobar-storage', 8, 7, 'a'],
            ['kobar-storage', 9, 7, 'b'],
            ['kobar-storage', 10, 7, 'c'],
        ]);
        expect(bridge.readSnapshot).not.toHaveBeenCalled();
    });

    it('hands the boot snapshot out once', () => {
        const { bridge } = fakeBridge(snapshot(3, 'stored'));
        const client = createStorageClient(bridge);
        expect(client.takeBootSnapshot()).toMatchObject({ seq: 3, value: 'stored' });
        expect(client.takeBootSnapshot()).toBeNull();
    });

    it('without a boot snapshot it re-reads the baseline before the first write (main may already be at N)', async () => {
        const { bridge, sent } = fakeBridge(null, () => snapshot(12, 'stored'));
        const client = createStorageClient(bridge);
        expect(client.baseSeq()).toBeNull();
        await client.write('a');
        await client.write('b');
        expect(bridge.readSnapshot).toHaveBeenCalledTimes(1);
        expect(sent.map((r) => [r.seq, r.baseSeq])).toEqual([
            [13, 12],
            [14, 12],
        ]);
    });

    it('when the re-read fails too, nothing is sent and the refusal is retryable', async () => {
        const { bridge, sent } = fakeBridge(null, () => null);
        const client = createStorageClient(bridge);
        await expect(client.write('a')).resolves.toMatchObject({ ok: false, reason: 'unavailable', retryable: true });
        expect(client.writeSync('a')).toMatchObject({ ok: false, retryable: true });
        expect(sent).toEqual([]);
    });

    it('a malformed boot snapshot counts as missing', () => {
        const { bridge } = fakeBridge({ ...snapshot(1), seq: -1 });
        expect(createStorageClient(bridge).baseSeq()).toBeNull();
        expect(isStorageSnapshot({ ok: true, source: 'file', seq: 1, value: 3 })).toBe(false);
        expect(isStorageSnapshot(snapshot(0))).toBe(true);
    });

    it('resync re-baselines the following writes', async () => {
        let next = snapshot(20, 'x');
        const { bridge, sent } = fakeBridge(snapshot(2), () => next);
        const client = createStorageClient(bridge);
        await client.write('a');
        expect(client.resync()).toMatchObject({ seq: 20 });
        next = snapshot(30);
        await client.write('b');
        expect(sent.map((r) => [r.seq, r.baseSeq])).toEqual([
            [3, 2],
            [21, 20],
        ]);
    });

    it('not-hydrated / rehydrated refusals re-read the snapshot once per baseline', async () => {
        const { bridge, sent } = fakeBridge(snapshot(5), () => snapshot(9));
        const refusals: Array<'not-hydrated' | 'rehydrated'> = ['not-hydrated', 'rehydrated'];
        bridge.write = vi.fn(async (request: IpcStorageWriteRequest) => {
            sent.push(request);
            const reason = refusals.shift();
            return reason
                ? { key: request.key, seq: request.seq, ok: false, reason, retryable: true }
                : { key: request.key, seq: request.seq, ok: true };
        });
        const client = createStorageClient(bridge);
        // Two writes on baseline 5 are refused; only the first refusal re-reads (the second was built on the old baseline).
        const [first, second] = await Promise.all([client.write('a'), client.write('b')]);
        expect(first).toMatchObject({ ok: false, reason: 'not-hydrated', retryable: true });
        expect(second).toMatchObject({ ok: false, reason: 'rehydrated', retryable: true });
        expect(bridge.readSnapshot).toHaveBeenCalledTimes(1);
        expect(client.baseSeq()).toBe(9);
        await expect(client.write('a')).resolves.toMatchObject({ ok: true });
        expect(sent.map((r) => [r.seq, r.baseSeq])).toEqual([
            [6, 5],
            [7, 5],
            [10, 9],
        ]);
    });

    it('transport failures become retryable acks; nothing throws or rejects', async () => {
        const { bridge } = fakeBridge(snapshot(0));
        bridge.write = vi.fn(async () => {
            throw new Error('ipc down');
        });
        bridge.writeSync = vi.fn(() => {
            throw new Error('ipc down');
        });
        const client = createStorageClient(bridge);
        await expect(client.write('a')).resolves.toMatchObject({ ok: false, reason: 'io', retryable: true, code: 'IPC' });
        expect(client.writeSync('b')).toMatchObject({ ok: false, reason: 'io', retryable: true, code: 'IPC' });
        bridge.write = vi.fn(async () => undefined as never);
        await expect(client.write('c')).resolves.toMatchObject({ ok: false, code: 'BAD_ACK' });
        expect(client.inFlight()).toBe(0);
    });

    it('counts writes in flight', async () => {
        const { bridge } = fakeBridge(snapshot(0));
        let release: () => void = () => {};
        bridge.write = vi.fn(
            (request: IpcStorageWriteRequest) =>
                new Promise<IpcStorageWriteAck>((resolve) => {
                    release = () => resolve({ key: request.key, seq: request.seq, ok: true });
                })
        );
        const client = createStorageClient(bridge);
        const pending = client.write('a');
        expect(client.inFlight()).toBe(1);
        release();
        await pending;
        expect(client.inFlight()).toBe(0);
    });

    it('refuses values that are certainly over 20 MB without sending them', async () => {
        const { bridge, sent } = fakeBridge(snapshot(0));
        const client = createStorageClient(bridge);
        await expect(client.write('x'.repeat(STORAGE_MAX_VALUE_BYTES + 1))).resolves.toMatchObject({ ok: false, reason: 'too-large' });
        await expect(client.write(42 as unknown as string)).resolves.toMatchObject({ ok: false, reason: 'invalid-value' });
        expect(sent).toEqual([]);
    });
});

describe('claimStorageBridge', () => {
    it('claims the preload bridge once; a second claimer (a plugin) gets null', () => {
        const target = {
            __kobarStorage: createStorageBridge({ readSnapshot: () => snapshot(4), write: vi.fn(), writeSync: vi.fn() }),
        };
        const first = claimStorageBridge(target);
        expect(first?.snapshot).toMatchObject({ seq: 4 });
        expect(claimStorageBridge(target)).toBeNull();
    });

    it('is null outside Electron or for a broken bridge', () => {
        expect(claimStorageBridge({})).toBeNull();
        expect(claimStorageBridge(null)).toBeNull();
        expect(claimStorageBridge({ __kobarStorage: { claim: 'no' } })).toBeNull();
        expect(
            claimStorageBridge({
                __kobarStorage: {
                    claim: () => {
                        throw new Error('x');
                    },
                },
            })
        ).toBeNull();
    });

    it('importing the module claims the global bridge immediately (before any plugin could)', async () => {
        const bridge = createStorageBridge({ readSnapshot: () => snapshot(9, 'boot'), write: vi.fn(), writeSync: vi.fn() });
        (globalThis as { __kobarStorage?: unknown }).__kobarStorage = bridge;
        try {
            vi.resetModules();
            const { storageClient } = await import('../src/storage/client');
            expect(storageClient.available).toBe(true);
            expect(storageClient.baseSeq()).toBe(9);
            expect(bridge.claim()).toBeNull();
            expect(storageClient.takeBootSnapshot()).toMatchObject({ value: 'boot' });
        } finally {
            delete (globalThis as { __kobarStorage?: unknown }).__kobarStorage;
        }
    });
});
