// T-403: the preload half of the file-backed store transport. Pure: no Electron and no
// Node imports (it is inlined into the sandboxed preload bundle), so it is unit-tested with fake transport functions.
//
// The preload reads ONE boot snapshot (`storage-snapshot`, sendSync) before any page script runs and exposes the object
// returned here as `window.__kobarStorage` (NOT window.api). `claim()` hands the snapshot and the write functions out exactly
// once: the host claims them at renderer start (src/storage/client.ts, imported by src/main.tsx before any plugin script is
// injected), so the snapshot does not stay reachable from `window` after that first read and every later claim (a plugin
// shares the page realm) gets null. Main checks the sender (main window top frame) on every call regardless.
import type {
    IpcClaimedStorageBridge,
    IpcLocalStorageSnapshotRequest,
    IpcLocalStorageSnapshotResult,
    IpcStorageBridge,
    IpcStorageSnapshot,
    IpcStorageWriteAck,
    IpcStorageWriteRequest,
} from '../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };

/** The channel calls, supplied by the preload with string-literal channel names (tests/ipcContract.test.ts scans them). */
export interface StorageBridgeTransport {
    readSnapshot(): IpcStorageSnapshot;
    write(request: IpcStorageWriteRequest): Promise<IpcStorageWriteAck>;
    writeSync(request: IpcStorageWriteRequest): IpcStorageWriteAck;
    /** T-404 (`storage-localstorage-snapshot`). Optional so a transport without it answers `unavailable`. */
    archiveLocalStorage?(request: IpcLocalStorageSnapshotRequest): Promise<IpcLocalStorageSnapshotResult>;
}

/**
 * Reads the boot snapshot immediately (call this at preload start) and returns the claim-once bridge. A failed or empty
 * read is reported as a null snapshot; the renderer then falls back to localStorage and re-reads before its first write.
 */
export function createStorageBridge(
    transport: StorageBridgeTransport,
    logError: (...data: unknown[]) => void = (...data) => console.error(...data)
): IpcStorageBridge {
    function readSnapshot(): IpcStorageSnapshot | null {
        try {
            const snapshot = transport.readSnapshot();
            return snapshot && typeof snapshot === 'object' ? snapshot : null;
        } catch (err) {
            logError('[KoBar] storage snapshot request failed:', err);
            return null;
        }
    }

    let boot: IpcStorageSnapshot | null = readSnapshot();
    let claimed = false;

    return {
        claim(): IpcClaimedStorageBridge | null {
            if (claimed) return null;
            claimed = true;
            const snapshot = boot;
            boot = null;
            return {
                snapshot,
                readSnapshot,
                write: (request) => transport.write(request),
                writeSync: (request) => transport.writeSync(request),
                archiveLocalStorage: (request) =>
                    transport.archiveLocalStorage
                        ? transport.archiveLocalStorage(request)
                        : Promise.resolve({ ok: false, status: 'unavailable', migratedFromLocalStorageAt: null }),
            };
        },
    };
}
