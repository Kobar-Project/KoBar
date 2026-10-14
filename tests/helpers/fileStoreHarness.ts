// T-405: the main-process half of the file-backed store for renderer-side tests. A real StorageService on a temp dir, the real
// storage IPC (writer check, hydrated-sender check) behind a fake ipcMain, and the real preload bridge, so a renderer under test
// talks to main exactly as in the app. Synthetic values only; never touches the real userData and never launches Electron.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcStorageBridge, IpcStorageSnapshot, IpcStorageWriteAck, IpcStorageWriteRequest } from '../../shared/ipc-contract';
import { type IpcMainLike, createIpcRegistry } from '../../electron/main/ipc/registry.cjs';
import { createStorageBridge } from '../../electron/lib/storageBridge.cjs';
import { type StorageIpc, createStorageIpc, registerStorageIpc } from '../../electron/main/services/storage/storageIpc.cjs';
import { type StorageService, createStorageService } from '../../electron/main/services/storage/storageService.cjs';

export const MAIN_WINDOW = 1;
export const OTHER_WINDOW = 2;
const KEY = 'kobar-storage';

type Listener = (event: never, ...args: unknown[]) => unknown;

export interface HostEnvelope {
    schemaVersion: number;
    seq: number;
    writtenAt: number;
    value: string;
}

/** Optional hook in front of `storage-write`: return an ack to answer instead of main (fault injection), or null. */
export type WriteInterceptor = (request: IpcStorageWriteRequest) => IpcStorageWriteAck | null;

export interface FileStoreHarness {
    readonly tmp: string;
    readonly root: string;
    service: StorageService;
    storage: StorageIpc;
    /** Every request that reached `storage-write` (after the interceptor), in order. */
    writes: IpcStorageWriteRequest[];
    intercept: WriteInterceptor | null;
    /** A preload bridge for `sender`, as the preload builds it: the boot snapshot is read right now. */
    bridge(sender?: number): IpcStorageBridge;
    /** A fresh main process on the same disk (an app restart). */
    restart(): void;
    hostFile(): string;
    readHost(): HostEnvelope | null;
    /** Writes the host file as a previous session would have (hydrate + one write through the service). */
    seedHost(value: string): void;
    listDir(name: '.bak' | '.corrupt'): string[];
    drain(): Promise<boolean>;
    cleanup(): void;
}

export function createFileStoreHarness(appVersion = '1.3.0-test'): FileStoreHarness {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-t405-'));
    const root = path.join(tmp, 'kobar-data');
    const handlers = new Map<string, Listener>();
    const listeners = new Map<string, Listener>();

    const harness = {
        tmp,
        root,
        writes: [] as IpcStorageWriteRequest[],
        intercept: null as WriteInterceptor | null,
    } as FileStoreHarness;

    function start(): void {
        handlers.clear();
        listeners.clear();
        harness.service = createStorageService({ root, appVersion, log: () => {} });
        harness.storage = createStorageIpc({
            service: harness.service,
            isWriter: (event) => (event as unknown as { sender: { id: number } }).sender.id === MAIN_WINDOW,
            log: () => {},
        });
        const ipcMain: IpcMainLike = {
            handle: (channel, listener) => void handlers.set(channel, listener as Listener),
            on: (channel, listener) => void listeners.set(channel, listener as Listener),
        };
        registerStorageIpc({
            ipcMain,
            registry: createIpcRegistry({ ipcMain, logger: { warn: () => {}, error: () => {} } }),
            storage: harness.storage,
        });
    }

    const sendSync = (channel: string, sender: number, ...args: unknown[]) => {
        const event: { sender: { id: number }; returnValue?: unknown } = { sender: { id: sender } };
        listeners.get(channel)!(event as never, ...args);
        return event.returnValue;
    };
    const invoke = async (channel: string, sender: number, ...args: unknown[]) =>
        handlers.get(channel)!({ sender: { id: sender } } as never, ...args);

    // Bumped by restart() and cleanup(): a renderer of an earlier "process" (a module instance left over from a previous
    // boot, with a retry timer) is refused, so it can never write into a later boot or a removed temp dir.
    let generation = 0;
    const gone = (request: IpcStorageWriteRequest): IpcStorageWriteAck => ({
        key: KEY,
        seq: request.seq,
        ok: false,
        reason: 'denied',
        retryable: false,
    });

    harness.bridge = (sender = MAIN_WINDOW) => {
        const born = generation;
        return createStorageBridge({
            readSnapshot: () => sendSync('storage-snapshot', sender, KEY) as IpcStorageSnapshot,
            write: async (request) => {
                if (born !== generation) return gone(request);
                const injected = harness.intercept?.(request) ?? null;
                if (injected) return injected;
                harness.writes.push(request);
                return (await invoke('storage-write', sender, request)) as IpcStorageWriteAck;
            },
            writeSync: (request) => sendSync('storage-write-sync', sender, request) as IpcStorageWriteAck,
            archiveLocalStorage: async (request) => invoke('storage-localstorage-snapshot', sender, request) as never,
        });
    };
    harness.restart = () => {
        generation += 1;
        start();
    };
    harness.hostFile = () => path.join(root, 'host', 'kobar-storage.json');
    harness.readHost = () => {
        const file = harness.hostFile();
        return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as HostEnvelope) : null;
    };
    harness.seedHost = (value) => {
        const snapshot = harness.service.readSnapshot(KEY);
        const ack = harness.service.writeSync({ key: KEY, seq: snapshot.seq + 1, baseSeq: snapshot.seq, value });
        if (!ack.ok) throw new Error(`seedHost failed: ${ack.reason}`);
    };
    harness.listDir = (name) => {
        const dir = path.join(root, name);
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    };
    harness.drain = () => harness.storage.drain();
    harness.cleanup = () => {
        generation += 1;
        fs.rmSync(tmp, { recursive: true, force: true });
    };

    start();
    return harness;
}
