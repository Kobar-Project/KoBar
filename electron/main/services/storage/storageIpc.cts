// T-403: IPC transport of the file-backed store. Internal channels, NOT part of
// window.api: `storage-snapshot` (sendSync, the boot hydration read), `storage-write` (invoke, queued + coalesced) and
// `storage-write-sync` (sendSync, the one-shot unload path). Pure: no Electron runtime import (ipcMain, the registry and the
// sender check are injected), so it is unit-tested with a fake ipcMain and a temp dir.
//
// Rules enforced here, on every call, in front of the StorageService (T-402), which validates again:
//   - Only the main window's top frame (`isWriter`, the existing isMainWindowTopFrame check) may read or write. A refused
//     snapshot request never touches the service, so another window cannot reset the seq baseline.
//   - The key is the enum allowlist (`kobar-storage`), never a path fragment; the request must be a plain object with a
//     string value, and `baseSeq` is mandatory. Values over the 20 MB cap are refused for BOTH write channels (a cheap length
//     bound here, the exact UTF-8 size in the service).
//   - A write is accepted only from the renderer that received the current snapshot (hydrate before the first write), so a
//     write can never land on a baseline the writer did not see.
// T-404: `storage-localstorage-snapshot` (invoke) carries the one-time localStorage archive to localStorageSnapshot.cts; same
// writer check, and only the renderer that received the current snapshot (i.e. after its hydration read) may send it.
// Quit: `drain()` waits (bounded) until every write main received is renamed into place; persist.cts calls it after the
// renderer acknowledged `flush-persist`. The renderer's writes travel on the same IPC pipe as that ack and are delivered
// in order, so they are queued here before the ack arrives. Values are never logged (key, sizes, timings and codes only).
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type {
    IpcLocalStorageSnapshotResult,
    IpcLocalStorageSnapshotStatus,
    IpcStorageSnapshot,
    IpcStorageWriteAck,
    IpcStorageWriteFailure,
} from '../../../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };
import type { IpcMainLike, IpcRegistry } from '../../ipc/registry.cjs';
import { STORAGE_MAX_VALUE_BYTES, STORAGE_SCHEMA_VERSION, isStorageKey } from './layout.cjs';
import type { LocalStorageSnapshotWriter } from './localStorageSnapshot.cjs';
import type { StorageService, StorageSnapshot, StorageWriteAck } from './storageService.cjs';

/**
 * Upper bound for waiting on outstanding file writes at quit / session end. Quitting never hangs.
 * Deviation from the existing limit: the drain runs AFTER the renderer's flush ack (<= 400 ms), so the total quit wait
 * is <= 400 + 800 ms instead of 400 ms. 800 ms covers one write including most Windows rename retries (5 attempts, 20-200 ms);
 * on timeout the quit continues without a clean-shutdown mark and the localStorage copy remains the fallback.
 */
export const STORAGE_DRAIN_TIMEOUT_MS = 800;
/** Snapshot reads and writes slower than this are logged with their size, to measure the main-thread cost. */
export const STORAGE_SLOW_OP_MS = 50;

type LogDetails = Record<string, string | number | boolean | null>;

export interface StorageIpcDeps {
    service: StorageService;
    /** T-404: the one-time localStorage archive; without it `storage-localstorage-snapshot` answers `unavailable`. */
    localStorageSnapshot?: LocalStorageSnapshotWriter;
    /** The writer authorisation: true only for the main window's top frame. */
    isWriter: (event: IpcMainInvokeEvent) => boolean;
    /** Monotonic-enough millisecond clock for the timings. */
    now?: () => number;
    log?: (event: string, details?: LogDetails) => void;
    drainTimeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface StorageIpc {
    snapshot(event: IpcMainInvokeEvent, key: unknown): IpcStorageSnapshot;
    write(event: IpcMainInvokeEvent, request: unknown): Promise<IpcStorageWriteAck>;
    writeSync(event: IpcMainInvokeEvent, request: unknown): IpcStorageWriteAck;
    /** T-404: one-time masked localStorage archive. Never rejects. */
    archiveLocalStorage(event: IpcMainInvokeEvent, request: unknown): Promise<IpcLocalStorageSnapshotResult>;
    /** Resolves true once every write main received is on disk (or failed), false when the timeout hit first. Never rejects. */
    drain(): Promise<boolean>;
    /** Records a clean shutdown in manifest.json (after a complete drain). Never throws. */
    markCleanShutdown(): boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The answer for a refused or invalid snapshot request: nothing read, the renderer falls back to localStorage. */
export function emptyStorageSnapshot(key: unknown): IpcStorageSnapshot {
    return {
        ok: false,
        key: typeof key === 'string' ? key.slice(0, 64) : '',
        source: 'none',
        seq: 0,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        value: null,
        writtenAt: null,
        readOnly: false,
        disabled: false,
        recoveredFromCorrupt: false,
        unreadable: false,
        previousCleanShutdown: null,
        migratedFromLocalStorageAt: null,
    };
}

/** The renderer-facing snapshot: explicit fields only (the manifest itself stays in main). */
function toIpcSnapshot(snapshot: StorageSnapshot, previousCleanShutdown: boolean | null): IpcStorageSnapshot {
    return {
        ok: snapshot.ok,
        key: snapshot.key,
        source: snapshot.source,
        seq: snapshot.seq,
        schemaVersion: snapshot.schemaVersion,
        value: snapshot.value,
        writtenAt: snapshot.writtenAt,
        readOnly: snapshot.readOnly,
        disabled: snapshot.disabled,
        recoveredFromCorrupt: snapshot.recoveredFromCorrupt,
        unreadable: snapshot.unreadable,
        previousCleanShutdown,
        migratedFromLocalStorageAt: snapshot.manifest?.migratedFromLocalStorageAt ?? null,
    };
}

function toIpcAck(ack: StorageWriteAck): IpcStorageWriteAck {
    const out: IpcStorageWriteAck = { key: ack.key, seq: ack.seq, ok: ack.ok };
    if (ack.reason !== undefined) out.reason = ack.reason;
    if (ack.retryable !== undefined) out.retryable = ack.retryable;
    // A write cancelled by a re-hydration is not lost data: the client re-reads the snapshot once and sends the value again.
    if (ack.reason === 'rehydrated') out.retryable = true;
    if (ack.code !== undefined) out.code = ack.code;
    if (ack.superseded !== undefined) out.superseded = ack.superseded;
    return out;
}

export function createStorageIpc(deps: StorageIpcDeps): StorageIpc {
    const { service, isWriter } = deps;
    const now = deps.now ?? Date.now;
    const log =
        deps.log ?? ((event, details) => (event === 'snapshot' ? console.log : console.warn)('[KoBar] storage-ipc:', event, details ?? {}));
    const drainTimeoutMs = deps.drainTimeoutMs ?? STORAGE_DRAIN_TIMEOUT_MS;
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    /** webContents id of the renderer that received the current snapshot; writes from anyone else are refused. */
    let hydratedSender: number | null = null;

    function senderId(event: IpcMainInvokeEvent): number | null {
        const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
        return typeof id === 'number' ? id : null;
    }

    function allowed(event: IpcMainInvokeEvent): boolean {
        try {
            return isWriter(event) === true;
        } catch {
            return false;
        }
    }

    function refuse(request: unknown, reason: IpcStorageWriteFailure, retryable = false): IpcStorageWriteAck {
        const key = isPlainObject(request) && typeof request.key === 'string' ? request.key.slice(0, 64) : '';
        const seq = isPlainObject(request) && typeof request.seq === 'number' && Number.isFinite(request.seq) ? request.seq : 0;
        return { key, seq, ok: false, reason, retryable };
    }

    /** Checks in front of the service; returns a refusal, or the request reduced to its known fields. */
    function precheck(
        event: IpcMainInvokeEvent,
        request: unknown,
        channel: string
    ): { ok: false; ack: IpcStorageWriteAck } | { ok: true; request: { key: unknown; seq: unknown; baseSeq: unknown; value: unknown } } {
        if (!allowed(event)) {
            log('denied', { channel });
            return { ok: false, ack: refuse(request, 'denied') };
        }
        if (!isPlainObject(request)) return { ok: false, ack: refuse(request, 'invalid-request') };
        const { key, seq, baseSeq, value } = request;
        if (!isStorageKey(key)) return { ok: false, ack: refuse(request, 'invalid-key') };
        if (baseSeq === undefined) return { ok: false, ack: refuse(request, 'invalid-seq') };
        if (typeof value !== 'string') return { ok: false, ack: refuse(request, 'invalid-value') };
        // UTF-8 never has fewer bytes than UTF-16 code units, so this cheap bound only refuses values that are certainly too large.
        if (value.length > STORAGE_MAX_VALUE_BYTES) {
            log('rejected', { channel, key, reason: 'too-large' });
            return { ok: false, ack: refuse(request, 'too-large') };
        }
        if (hydratedSender === null || senderId(event) !== hydratedSender) {
            log('rejected', { channel, key, reason: 'not-hydrated' });
            // Retryable: the client re-reads the snapshot once and its next write is accepted (src/storage/client.ts).
            return { ok: false, ack: refuse(request, 'not-hydrated', true) };
        }
        return { ok: true, request: { key, seq, baseSeq, value } };
    }

    function timed(channel: string, key: unknown, chars: number, started: number, ack: IpcStorageWriteAck): IpcStorageWriteAck {
        const ms = now() - started;
        if (ms >= STORAGE_SLOW_OP_MS) log('slow-write', { channel, key: typeof key === 'string' ? key : '', ms, chars, ok: ack.ok });
        return ack;
    }

    return {
        snapshot(event, key) {
            if (!allowed(event)) {
                log('denied', { channel: 'storage-snapshot' });
                return emptyStorageSnapshot(key);
            }
            if (!isStorageKey(key)) return emptyStorageSnapshot(key);
            const started = now();
            const status = service.init();
            const snapshot = service.readSnapshot(key);
            // The service re-baselined the key: from now on only this renderer may write, starting above `snapshot.seq`.
            hydratedSender = senderId(event);
            const ms = now() - started;
            const chars = snapshot.value === null ? 0 : snapshot.value.length;
            // One line per hydration (startup / reload) to measure the cost of the blocking read (target: p95 < 50 ms).
            log(ms >= STORAGE_SLOW_OP_MS ? 'slow-snapshot' : 'snapshot', {
                key,
                source: snapshot.source,
                ok: snapshot.ok,
                ms,
                chars,
            });
            return toIpcSnapshot(snapshot, status.previousCleanShutdown);
        },

        async write(event, request) {
            const checked = precheck(event, request, 'storage-write');
            if (!checked.ok) return checked.ack;
            const started = now();
            const chars = (checked.request.value as string).length;
            try {
                const ack = toIpcAck(await service.write(checked.request));
                return timed('storage-write', checked.request.key, chars, started, ack);
            } catch {
                return refuse(request, 'io', true);
            }
        },

        writeSync(event, request) {
            const checked = precheck(event, request, 'storage-write-sync');
            if (!checked.ok) return checked.ack;
            const started = now();
            const chars = (checked.request.value as string).length;
            try {
                const ack = toIpcAck(service.writeSync(checked.request));
                return timed('storage-write-sync', checked.request.key, chars, started, ack);
            } catch {
                return refuse(request, 'io', true);
            }
        },

        async archiveLocalStorage(event, request) {
            const refused = (status: IpcLocalStorageSnapshotStatus): IpcLocalStorageSnapshotResult => ({
                ok: false,
                status,
                migratedFromLocalStorageAt: null,
            });
            if (!allowed(event)) {
                log('denied', { channel: 'storage-localstorage-snapshot' });
                return refused('denied');
            }
            if (hydratedSender === null || senderId(event) !== hydratedSender) {
                log('rejected', { channel: 'storage-localstorage-snapshot', reason: 'not-hydrated' });
                return refused('not-hydrated');
            }
            if (!deps.localStorageSnapshot) return refused('unavailable');
            try {
                return await deps.localStorageSnapshot.run(request);
            } catch {
                return refused('io');
            }
        },

        drain() {
            return new Promise<boolean>((resolve) => {
                let settled = false;
                const timer = setTimer(() => {
                    if (settled) return;
                    settled = true;
                    log('drain-timeout', { ms: drainTimeoutMs });
                    resolve(false);
                }, drainTimeoutMs);
                let flushing: Promise<void>;
                try {
                    flushing = service.flush();
                } catch {
                    flushing = Promise.reject(new Error('flush failed'));
                }
                flushing
                    .then(
                        () => true,
                        () => false
                    )
                    .then((done) => {
                        if (settled) return;
                        settled = true;
                        clearTimer(timer);
                        resolve(done);
                    });
            });
        },

        markCleanShutdown() {
            try {
                return service.markCleanShutdown();
            } catch {
                return false;
            }
        },
    };
}

export interface StorageIpcRegistration {
    ipcMain: IpcMainLike;
    registry: IpcRegistry;
    storage: StorageIpc;
}

/** Registers the internal channels. The sync ones always set `returnValue` (a sync sender blocks until it is set). */
export function registerStorageIpc({ ipcMain, registry, storage }: StorageIpcRegistration): void {
    ipcMain.on('storage-snapshot', (event: IpcMainEvent, key: unknown) => {
        let result: IpcStorageSnapshot = emptyStorageSnapshot(key);
        try {
            result = storage.snapshot(event, key);
        } catch (err) {
            console.error('[KoBar] storage-ipc: snapshot failed:', err instanceof Error ? err.name : 'error');
        } finally {
            event.returnValue = result;
        }
    });

    ipcMain.on('storage-write-sync', (event: IpcMainEvent, request: unknown) => {
        let ack: IpcStorageWriteAck = { key: '', seq: 0, ok: false, reason: 'io', retryable: true };
        try {
            ack = storage.writeSync(event, request);
        } catch (err) {
            console.error('[KoBar] storage-ipc: sync write failed:', err instanceof Error ? err.name : 'error');
        } finally {
            event.returnValue = ack;
        }
    });

    registry.handle('storage-write', (event, request) => storage.write(event, request));
    registry.handle('storage-localstorage-snapshot', (event, request) => storage.archiveLocalStorage(event, request));
}
