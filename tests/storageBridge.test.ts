// T-403: the preload half of the file-backed store transport and the plugin-visible surface. The real
// electron/preload.cts is loaded against a mocked `electron`: window.api must be exactly the v1 member list, the storage
// channels must not be reachable from it, the boot snapshot is read ONCE (after the T-201 backup) and is handed out by the
// first claim only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IpcStorageBridge, IpcStorageSnapshot } from '../shared/ipc-contract';
import { createStorageBridge } from '../electron/lib/storageBridge.cjs';
import { WINDOW_API_KEYS } from './helpers/windowApi';

const SNAPSHOT: IpcStorageSnapshot = {
    ok: true,
    key: 'kobar-storage',
    source: 'file',
    seq: 7,
    schemaVersion: 1,
    value: '{"state":{},"version":22}',
    writtenAt: 1,
    readOnly: false,
    disabled: false,
    recoveredFromCorrupt: false,
    unreadable: false,
    previousCleanShutdown: true,
    migratedFromLocalStorageAt: null,
};

const exposed = new Map<string, unknown>();
const sendSyncCalls: string[] = [];
const ipcRenderer = {
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(async (channel: string) => ({ key: 'kobar-storage', seq: 8, ok: channel === 'storage-write' })),
    sendSync: vi.fn((channel: string) => {
        sendSyncCalls.push(channel);
        if (channel === 'storage-snapshot') return SNAPSHOT;
        if (channel === 'storage-write-sync') return { key: 'kobar-storage', seq: 9, ok: true };
        return undefined;
    }),
};

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: (name: string, value: unknown) => {
            exposed.set(name, value);
        },
    },
    ipcRenderer,
    webUtils: { getPathForFile: vi.fn() },
}));

const preloadSource = readFileSync(fileURLToPath(new URL('../electron/preload.cts', import.meta.url)), 'utf8');

beforeAll(async () => {
    // The page's localStorage the T-201 backup reads (node environment: provide it on globalThis).
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: { getItem: () => '{"state":{},"version":22}' },
    });
    await import('../electron/preload.cts');
});

describe('preload: plugin-visible surface is unchanged', () => {
    it('exposes exactly window.api and the internal claim-once bridges (__kobarStorage, T-606 __kobarSettingsSync)', () => {
        expect([...exposed.keys()].sort()).toEqual(['__kobarSettingsSync', '__kobarStorage', 'api']);
    });

    it('window.api has exactly the v1 member list and no storage member', () => {
        const api = exposed.get('api') as Record<string, unknown>;
        // R4: plus the additive globalPasteVersion value (WINDOW_API_KEYS = methods + plain values).
        expect(Object.keys(api).sort()).toEqual([...WINDOW_API_KEYS].sort());
        expect(api.globalPasteVersion).toBe(2);
        expect(Object.keys(api).filter((name) => /storage|snapshot|kobarBoot/i.test(name))).toEqual([]);
        const apiBody = preloadSource.slice(preloadSource.indexOf("contextBridge.exposeInMainWorld('api', {"));
        expect(apiBody).not.toMatch(/storage-(snapshot|write|localstorage)/);
        expect(apiBody).not.toMatch(/__kobarStorage|storageBridge/i);
    });

    it('the internal bridge offers nothing but claim()', () => {
        const bridge = exposed.get('__kobarStorage') as Record<string, unknown>;
        expect(Object.keys(bridge)).toEqual(['claim']);
    });
});

describe('preload: boot snapshot', () => {
    it('is read once, synchronously, after the T-201 backup', () => {
        expect(sendSyncCalls.filter((channel) => channel === 'storage-snapshot')).toHaveLength(1);
        expect(sendSyncCalls.indexOf('backup-kobar-storage')).toBeGreaterThanOrEqual(0);
        expect(sendSyncCalls.indexOf('backup-kobar-storage')).toBeLessThan(sendSyncCalls.indexOf('storage-snapshot'));
        expect(preloadSource).toContain("ipcRenderer.sendSync('storage-snapshot', 'kobar-storage')");
    });

    it('the first claim gets it and the channels; it does not stay reachable afterwards', async () => {
        const bridge = exposed.get('__kobarStorage') as IpcStorageBridge;
        const claimed = bridge.claim();
        expect(claimed?.snapshot).toEqual(SNAPSHOT);
        // Every later claim (a plugin shares the page realm) gets nothing.
        expect(bridge.claim()).toBeNull();
        expect(bridge.claim()).toBeNull();

        const request = { key: 'kobar-storage' as const, seq: 8, baseSeq: 7, value: 'v' };
        await expect(claimed!.write(request)).resolves.toMatchObject({ ok: true });
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('storage-write', request);
        expect(claimed!.writeSync({ ...request, seq: 9 })).toMatchObject({ ok: true, seq: 9 });
        expect(ipcRenderer.sendSync).toHaveBeenCalledWith('storage-write-sync', { ...request, seq: 9 });
        expect(claimed!.readSnapshot()).toEqual(SNAPSHOT);
        expect(sendSyncCalls.filter((channel) => channel === 'storage-snapshot')).toHaveLength(2);
        // T-404: the one-time localStorage archive travels on its own internal channel, through the claimed bridge only.
        const archive = { entries: [['k', 'v']] as Array<[string, string]> };
        await claimed!.archiveLocalStorage(archive);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('storage-localstorage-snapshot', archive);
    });
});

describe('createStorageBridge', () => {
    it('reads at creation and hands the snapshot out once', () => {
        const readSnapshot = vi.fn(() => SNAPSHOT);
        const bridge = createStorageBridge({ readSnapshot, write: vi.fn(), writeSync: vi.fn() });
        expect(readSnapshot).toHaveBeenCalledTimes(1);
        const first = bridge.claim();
        expect(first?.snapshot).toBe(SNAPSHOT);
        expect(bridge.claim()).toBeNull();
        expect(readSnapshot).toHaveBeenCalledTimes(1);
    });

    it('a failed or empty read becomes a null snapshot and never throws', () => {
        const logError = vi.fn();
        const throwing = createStorageBridge(
            {
                readSnapshot: () => {
                    throw new Error('sendSync failed');
                },
                write: vi.fn(),
                writeSync: vi.fn(),
            },
            logError
        );
        const claimed = throwing.claim();
        expect(claimed?.snapshot).toBeNull();
        expect(claimed?.readSnapshot()).toBeNull();
        expect(logError).toHaveBeenCalledTimes(2);

        const empty = createStorageBridge({
            readSnapshot: () => undefined as unknown as IpcStorageSnapshot,
            write: vi.fn(),
            writeSync: vi.fn(),
        });
        expect(empty.claim()?.snapshot).toBeNull();
    });
});
