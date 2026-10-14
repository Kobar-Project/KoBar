// T-403: renderer half of the file-backed store transport. Host-internal: it claims the
// preload's `window.__kobarStorage` bridge exactly once, when this module is first imported (src/main.tsx imports it before
// any plugin script is injected), so the boot snapshot and the storage channels are not reachable from `window` afterwards.
// NOT part of window.api or the plugin contract.
//
// Transport only: nothing uses it for persistence yet (T-405 switches the persist backend). What it guarantees:
//   - `takeBootSnapshot()` returns the snapshot the preload read before any page script, once; later calls return null.
//   - Writes carry a monotonic `seq` that continues from the hydration snapshot's `seq` and always carry that `baseSeq`.
//     When the boot snapshot is missing (its sendSync failed), the client re-reads a snapshot before its first write, so its
//     baseline matches main's (main may already have re-baselined to N while the renderer would otherwise start at 0).
//     A `not-hydrated` / `rehydrated` refusal (main holds another baseline) makes the client re-read the snapshot once.
//   - Nothing throws: transport failures come back as `ok:false` acks (`retryable` tells the caller whether to try again).
//
// Notes for T-405 (the persist backend switch):
//   - It MUST call `storageClient.takeBootSnapshot()` during hydration: that releases the snapshot (up to 20 MB) held here.
//   - "Has the localStorage -> file migration happened?" must be decided by `manifest.migratedFromLocalStorageAt` (set by the
//     first migration), NOT by manifest.json existing: since T-403 every startup creates kobar-data/manifest.json.
//   - Since T-404 that field means only "the one-time masked localStorage ARCHIVE was taken" (localstorage-snapshot/, set by
//     src/storage/migrateFromLocalStorage.ts); it does NOT mean the persist value lives in the file store. T-405 must choose
//     the hydration source by whether host/kobar-storage.json exists (the snapshot's `source` is 'file'/'bak'),
//     not by this field. `storeStatus()` keeps it (and the other small flags) after `takeBootSnapshot()` released the value.
import type {
    IpcClaimedStorageBridge,
    IpcLocalStorageSnapshotRequest,
    IpcLocalStorageSnapshotResult,
    IpcStorageBridge,
    IpcStorageKey,
    IpcStorageSnapshot,
    IpcStorageWriteAck,
    IpcStorageWriteFailure,
    IpcStorageWriteRequest,
} from '../../shared/ipc-contract';

export const HOST_STORAGE_KEY: IpcStorageKey = 'kobar-storage';
/** Same cap as main (electron/main/services/storage/layout.cts STORAGE_MAX_VALUE_BYTES, 20 MB); tests keep them equal. */
export const STORAGE_MAX_VALUE_BYTES = 20 * 1024 * 1024;

/** The small flags of the latest snapshot (no value), kept after the boot snapshot was taken. */
export type StorageStoreStatus = Pick<IpcStorageSnapshot, 'ok' | 'readOnly' | 'disabled' | 'migratedFromLocalStorageAt'>;

export interface StorageClient {
    /** True when this client holds the bridge (false outside Electron or when the bridge was already claimed). */
    readonly available: boolean;
    /** The boot snapshot, handed out once (later calls: null) so it is not kept in memory. */
    takeBootSnapshot(): IpcStorageSnapshot | null;
    /** The seq of the snapshot the writes build on, or null while the client is not in step with main. */
    baseSeq(): number | null;
    /** Asynchronous write of the whole value (queued and coalesced in main). Never rejects. */
    write(value: string): Promise<IpcStorageWriteAck>;
    /** Blocking write for the unload path. Never throws. */
    writeSync(value: string): IpcStorageWriteAck;
    /** Reads a fresh snapshot from main (a re-hydration: new baseline for both sides). Null when it failed. */
    resync(): IpcStorageSnapshot | null;
    /** Asynchronous writes sent and not answered yet. */
    inFlight(): number;
    /** Flags of the latest snapshot (boot or resync), or null when there was none. */
    storeStatus(): StorageStoreStatus | null;
    /** T-404: sends the one-time localStorage archive to main. Never rejects. */
    archiveLocalStorage(request: IpcLocalStorageSnapshotRequest): Promise<IpcLocalStorageSnapshotResult>;
}

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Light shape check of what main sent (main is trusted; this only guards against a broken transport). */
export function isStorageSnapshot(value: unknown): value is IpcStorageSnapshot {
    if (typeof value !== 'object' || value === null) return false;
    const s = value as Record<string, unknown>;
    return (
        typeof s.ok === 'boolean' &&
        (s.source === 'file' || s.source === 'bak' || s.source === 'none') &&
        isNonNegativeInt(s.seq) &&
        (s.value === null || typeof s.value === 'string')
    );
}

function isAck(value: unknown): value is IpcStorageWriteAck {
    if (typeof value !== 'object' || value === null) return false;
    const a = value as Record<string, unknown>;
    return typeof a.ok === 'boolean' && typeof a.seq === 'number';
}

function localAck(seq: number, reason: IpcStorageWriteFailure, retryable: boolean, code?: string): IpcStorageWriteAck {
    const ack: IpcStorageWriteAck = { key: HOST_STORAGE_KEY, seq, ok: false, reason, retryable };
    if (code !== undefined) ack.code = code;
    return ack;
}

function statusOf(snapshot: IpcStorageSnapshot): StorageStoreStatus {
    const migratedAt = snapshot.migratedFromLocalStorageAt;
    return {
        ok: snapshot.ok,
        readOnly: snapshot.readOnly === true,
        disabled: snapshot.disabled === true,
        migratedFromLocalStorageAt: typeof migratedAt === 'number' && Number.isFinite(migratedAt) ? migratedAt : null,
    };
}

export function createStorageClient(bridge: IpcClaimedStorageBridge | null): StorageClient {
    let boot: IpcStorageSnapshot | null = bridge && isStorageSnapshot(bridge.snapshot) ? bridge.snapshot : null;
    let base: number | null = boot ? boot.seq : null;
    let lastSeq = base ?? 0;
    let pending = 0;
    let status: StorageStoreStatus | null = boot ? statusOf(boot) : null;

    function resync(): IpcStorageSnapshot | null {
        if (!bridge) return null;
        let snapshot: unknown = null;
        try {
            snapshot = bridge.readSnapshot();
        } catch {
            snapshot = null;
        }
        if (!isStorageSnapshot(snapshot)) return null;
        base = snapshot.seq;
        lastSeq = snapshot.seq;
        status = statusOf(snapshot);
        return snapshot;
    }

    /** The next request, or a local refusal. Re-reads the baseline first when the client is not in step with main. */
    function nextRequest(value: unknown): { ok: true; request: IpcStorageWriteRequest } | { ok: false; ack: IpcStorageWriteAck } {
        if (!bridge) return { ok: false, ack: localAck(0, 'unavailable', false) };
        if (typeof value !== 'string') return { ok: false, ack: localAck(0, 'invalid-value', false) };
        // UTF-8 never has fewer bytes than UTF-16 code units: certainly too large, do not send it over IPC at all.
        if (value.length > STORAGE_MAX_VALUE_BYTES) return { ok: false, ack: localAck(0, 'too-large', false) };
        if (base === null && resync() === null) return { ok: false, ack: localAck(0, 'unavailable', true, 'NO_BASELINE') };
        lastSeq += 1;
        return { ok: true, request: { key: HOST_STORAGE_KEY, seq: lastSeq, baseSeq: base as number, value } };
    }

    /**
     * Main refused a write because it holds another baseline (`not-hydrated`: no snapshot for this renderer; `rehydrated`: a
     * re-hydration cancelled it). Re-read the snapshot ONCE per baseline (only when the refused write was built on the current
     * one, so a burst of refusals causes a single re-read); the caller's retry then goes out on the new baseline.
     */
    function afterAck(request: IpcStorageWriteRequest, ack: IpcStorageWriteAck): IpcStorageWriteAck {
        if (!ack.ok && (ack.reason === 'not-hydrated' || ack.reason === 'rehydrated') && request.baseSeq === base) resync();
        return ack;
    }

    return {
        available: bridge !== null,
        takeBootSnapshot() {
            const snapshot = boot;
            boot = null;
            return snapshot;
        },
        baseSeq: () => base,
        async write(value) {
            const next = nextRequest(value);
            if (!next.ok) return next.ack;
            const { seq } = next.request;
            pending += 1;
            try {
                const ack: unknown = await bridge!.write(next.request);
                return isAck(ack) ? afterAck(next.request, ack) : localAck(seq, 'io', true, 'BAD_ACK');
            } catch {
                return localAck(seq, 'io', true, 'IPC');
            } finally {
                pending -= 1;
            }
        },
        writeSync(value) {
            const next = nextRequest(value);
            if (!next.ok) return next.ack;
            const { seq } = next.request;
            try {
                const ack: unknown = bridge!.writeSync(next.request);
                return isAck(ack) ? afterAck(next.request, ack) : localAck(seq, 'io', true, 'BAD_ACK');
            } catch {
                return localAck(seq, 'io', true, 'IPC');
            }
        },
        resync,
        inFlight: () => pending,
        storeStatus: () => status,
        async archiveLocalStorage(request) {
            const failed = (): IpcLocalStorageSnapshotResult => ({ ok: false, status: 'unavailable', migratedFromLocalStorageAt: null });
            if (!bridge || typeof bridge.archiveLocalStorage !== 'function') return failed();
            try {
                const answer: unknown = await bridge.archiveLocalStorage(request);
                if (typeof answer !== 'object' || answer === null || typeof (answer as { ok?: unknown }).ok !== 'boolean') return failed();
                const result = answer as IpcLocalStorageSnapshotResult;
                if (result.ok && typeof result.migratedFromLocalStorageAt === 'number' && status) {
                    status = { ...status, migratedFromLocalStorageAt: result.migratedFromLocalStorageAt };
                }
                return result;
            } catch {
                return failed();
            }
        },
    };
}

/** Claims the preload bridge. Null outside Electron (tests, browser) or when it was already claimed. */
export function claimStorageBridge(target: unknown = globalThis): IpcClaimedStorageBridge | null {
    try {
        const bridge = (target as { __kobarStorage?: Partial<IpcStorageBridge> } | null)?.__kobarStorage;
        if (!bridge || typeof bridge.claim !== 'function') return null;
        return bridge.claim() ?? null;
    } catch {
        return null;
    }
}

/** The host's client, created (and the bridge claimed) when this module is first imported. */
export const storageClient: StorageClient = createStorageClient(claimStorageBridge());
