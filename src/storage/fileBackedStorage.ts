// T-405: file-backed base storage of the `kobar-storage` persist store.
// It sits under the debounced persist layer (src/store/persistStorage.ts) where window.localStorage used to be. The value
// format is untouched: the file envelope's `value` is the exact string the persist middleware produced, byte for byte.
//
// Hydration (synchronous, once, on the first `getItem('kobar-storage')`, i.e. while the store is created):
//   - The boot snapshot is taken from the storage client exactly once (`takeBootSnapshot()`).
//   - The source is chosen by whether the file store holds a value (snapshot `source` 'file' / 'bak'), never by
//     `manifest.migratedFromLocalStorageAt` (that only means "the T-404 archive was taken").
//   - No usable snapshot (outside Electron, another window, read failed, read-only, disabled, unreadable): localStorage,
//     exactly as before, and nothing is written to the file this session.
//   - No file value: localStorage; the first write after hydration creates the file.
//   - Both exist and differ: the newer copy wins, decided by a POSITIVE marker instead of comparing
//     timestamps taken by two processes at different moments (late file writes, clock jumps). A small host-internal side
//     key (PERSIST_META_KEY) holds JSON meta (write time, length, fingerprint) written right after every successful
//     localStorage write. When a localStorage write fails (e.g. quota) and the file store has CONFIRMED that newer value,
//     the side key is overwritten with the tiny FILE_NEWER_MARKER (shrinking a value passes the quota check). Only that
//     marker lets the file win. Anything else -> localStorage wins: JSON meta that matches (KoBar's latest successful write),
//     JSON meta that does not match (backup restore, KoBar 1.2.x after a downgrade, a dev reload without the bridge), and a
//     missing or unparsable side key (e.g. never written because localStorage was near its quota). In doubt localStorage
//     wins: main copies the file to `.bak/` before the first write replaces it (StorageService: forced backup after every
//     hydration), localStorage has no such copy.
//
// Writes (dual-write through 1.3.x):
//   - Every write goes to localStorage first (synchronously, as before; its errors still reach the persist warning) and then
//     to the file (asynchronously, through the storage client, which always sends `baseSeq`). localStorage is never deleted
//     and stays the complete fallback, so reverting the commit that switched the backend is a full rollback.
//   - The first file write waits until the T-404 localStorage archive has finished (`releaseFileWrites()`),
//     unless the file store already holds a value or the archive was taken in an earlier session.
//   - A failed file write (`ok:false`) never loses data: localStorage holds the value, and a retryable failure is sent again
//     (always the newest value) with a growing delay. A refusal that will never succeed, or too many failures in a row,
//     stops the file writes for this session; the next startup then prefers the newer localStorage copy.
//   - Writes are sent the moment they are flushed, so the quit flush (`flush-persist`) puts them on the IPC pipe before its
//     ack; main drains them before quitting (storageIpc.cts).
// Values are never logged.
import type { IpcStorageSnapshot, IpcStorageWriteAck } from '../../shared/ipc-contract';
import { HOST_STORAGE_KEY, type StorageClient } from './client';

/** Host-internal localStorage key with the write time + fingerprint of KoBar's last `kobar-storage` write (never restored). */
export const PERSIST_META_KEY = 'kobar-storage.meta';
/** Side key value meaning "the file store holds a newer kobar-storage value than localStorage". */
export const FILE_NEWER_MARKER = 'file-newer';
export const FILE_WRITE_RETRY_BASE_MS = 1000;
export const FILE_WRITE_RETRY_MAX_MS = 30_000;
/** Consecutive failed file writes after which the file writes stop for the session (localStorage carries on). */
export const FILE_WRITE_MAX_FAILURES = 10;

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type LogDetails = Record<string, string | number | boolean | null>;

/** What PERSIST_META_KEY holds. */
export interface LocalWriteMeta {
    /** Epoch ms of the localStorage write. */
    writtenAt: number;
    length: number;
    hash: string;
}

/** FNV-1a (32 bit) over the UTF-16 code units, as 8 hex digits. Detects that a value changed; not a security hash. */
export function fingerprint(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function serializeLocalWriteMeta(value: string, writtenAt: number): string {
    return JSON.stringify({ writtenAt, length: value.length, hash: fingerprint(value) });
}

export function parseLocalWriteMeta(raw: string | null): LocalWriteMeta | null {
    if (typeof raw !== 'string') return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { writtenAt, length, hash } = parsed as Record<string, unknown>;
        if (typeof writtenAt !== 'number' || !Number.isFinite(writtenAt)) return null;
        if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return null;
        if (typeof hash !== 'string') return null;
        return { writtenAt, length, hash };
    } catch {
        return null;
    }
}

/** True when `meta` describes exactly `value` (KoBar wrote it and nothing changed it since). */
export function metaMatches(meta: LocalWriteMeta | null, value: string): meta is LocalWriteMeta {
    return meta !== null && meta.length === value.length && meta.hash === fingerprint(value);
}

export type HydrationSource = 'file' | 'bak' | 'local';
export type HydrationReason =
    | 'no-snapshot'
    | 'unavailable'
    | 'disabled'
    | 'read-only'
    | 'unreadable'
    | 'no-file'
    | 'no-local'
    | 'identical'
    | 'local-write-failed'
    | 'local-current'
    | 'local-changed';

export interface HydrationChoice {
    source: HydrationSource;
    /** The persist string to hydrate from (null: nothing stored). */
    value: string | null;
    /** Whether this session may write the file store. */
    fileWrites: boolean;
    reason: HydrationReason;
    /** The file store already holds a value (file or backup). */
    fileHasValue: boolean;
}

/**
 * Picks the hydration source (pure). `readMetaRaw` (the raw side key) is only called when the file value and localStorage
 * differ. See the module comment for the rules.
 */
export function chooseHydrationSource(
    snapshot: IpcStorageSnapshot | null,
    local: string | null,
    readMetaRaw: () => string | null
): HydrationChoice {
    const fromLocal = (reason: HydrationReason, fileWrites: boolean, fileHasValue = false): HydrationChoice => ({
        source: 'local',
        value: local,
        fileWrites,
        reason,
        fileHasValue,
    });
    if (!snapshot) return fromLocal('no-snapshot', false);
    if (snapshot.disabled) return fromLocal('disabled', false);
    if (snapshot.readOnly) return fromLocal('read-only', false);
    if (snapshot.unreadable) return fromLocal('unreadable', false);
    if (!snapshot.ok) return fromLocal('unavailable', false);
    if (snapshot.value === null || snapshot.source === 'none') return fromLocal('no-file', true);

    const fromFile = (reason: HydrationReason): HydrationChoice => ({
        source: snapshot.source === 'bak' ? 'bak' : 'file',
        value: snapshot.value,
        fileWrites: true,
        reason,
        fileHasValue: true,
    });
    if (local === null) return fromFile('no-local');
    if (local === snapshot.value) return fromFile('identical');
    let raw: string | null;
    try {
        raw = readMetaRaw();
    } catch {
        // Cannot tell: localStorage (the file is kept in .bak/).
        return fromLocal('local-changed', true, true);
    }
    // The positive marker: a localStorage write failed and the file store confirmed the newer value.
    if (raw === FILE_NEWER_MARKER) return fromFile('local-write-failed');
    // KoBar's latest successful write, changed outside KoBar since, or no usable side key: localStorage is the newer copy.
    return metaMatches(parseLocalWriteMeta(raw), local) ? fromLocal('local-current', true, true) : fromLocal('local-changed', true, true);
}

/** 'waiting': file writes are allowed but held until the T-404 archive finished; the newest value is kept. */
export type FileWriteMode = 'off' | 'waiting' | 'on';

export interface FileBackedStorageDeps {
    client: Pick<StorageClient, 'available' | 'takeBootSnapshot' | 'storeStatus' | 'write'>;
    getLocal: () => LocalStorageLike | null | undefined;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    log?: (event: string, details?: LogDetails) => void;
    retryBaseMs?: number;
    retryMaxMs?: number;
    maxFailures?: number;
}

export interface FileBackedStorage extends LocalStorageLike {
    /** The hydration decision (without the value), or null before the first read. */
    hydration(): Omit<HydrationChoice, 'value'> | null;
    fileWrites(): FileWriteMode;
    /** Lets the held file writes go (the T-404 archive finished). Before hydration it is remembered. */
    releaseFileWrites(): void;
    /** Resolves when no file write is in flight or scheduled for a retry. */
    whenIdle(): Promise<void>;
}

function defaultLog(event: string, details?: LogDetails): void {
    const write = event === 'hydrated' ? console.log : console.warn;
    write('[KoBar] persist-file:', event, details ?? {});
}

/** Raw access for the side key: bypasses the workspace isolation patch (src/utils/localStorageIsolation.ts). */
function rawGet(local: LocalStorageLike, key: string): string | null {
    return typeof Storage !== 'undefined' && local instanceof Storage ? Storage.prototype.getItem.call(local, key) : local.getItem(key);
}

function rawSet(local: LocalStorageLike, key: string, value: string): void {
    if (typeof Storage !== 'undefined' && local instanceof Storage) Storage.prototype.setItem.call(local, key, value);
    else local.setItem(key, value);
}

function rawRemove(local: LocalStorageLike, key: string): void {
    if (typeof Storage !== 'undefined' && local instanceof Storage) Storage.prototype.removeItem.call(local, key);
    else local.removeItem(key);
}

export function createFileBackedStorage(deps: FileBackedStorageDeps): FileBackedStorage {
    const { client, getLocal } = deps;
    const now = deps.now ?? Date.now;
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const log = deps.log ?? defaultLog;
    const retryBaseMs = deps.retryBaseMs ?? FILE_WRITE_RETRY_BASE_MS;
    const retryMaxMs = deps.retryMaxMs ?? FILE_WRITE_RETRY_MAX_MS;
    const maxFailures = deps.maxFailures ?? FILE_WRITE_MAX_FAILURES;

    let choice: Omit<HydrationChoice, 'value'> | null = null;
    let mode: FileWriteMode = 'off';
    let released = false;
    /** The newest value this session (what the store holds on disk somewhere). */
    let current: string | null = null;
    /** localStorage holds `current` (false after a failed localStorage write or when the file won with another value). */
    let localInSync = true;
    /** Newest value not yet sent to the file. */
    let pendingFile: string | null = null;
    let lastSentId = 0;
    let confirmedId = 0;
    let inFlight = 0;
    let failures = 0;
    let retryTimer: unknown = null;
    let metaErrorLogged = false;
    /** A localStorage write failed: once the file confirms a write with this id or newer, FILE_NEWER_MARKER is set. */
    let markFromId: number | null = null;
    const idleWaiters: Array<() => void> = [];

    function checkIdle(): void {
        if (inFlight > 0 || retryTimer !== null) return;
        for (const resolve of idleWaiters.splice(0)) resolve();
    }

    function cancelRetry(): void {
        if (retryTimer === null) return;
        clearTimer(retryTimer);
        retryTimer = null;
    }

    function stop(reason: string): void {
        if (mode === 'off') return;
        mode = 'off';
        pendingFile = null;
        cancelRetry();
        log('file-writes-stopped', { reason });
        checkIdle();
    }

    function hydrate(): Omit<HydrationChoice, 'value'> {
        if (choice) return choice;
        let snapshot: IpcStorageSnapshot | null = null;
        try {
            // Taken exactly once: releases the boot snapshot held by the client.
            snapshot = client.takeBootSnapshot();
        } catch {
            snapshot = null;
        }
        const local = getLocal();
        // Same read as before T-405; a throwing localStorage still surfaces as a hydration error.
        const localValue = local ? local.getItem(HOST_STORAGE_KEY) : null;
        const picked = chooseHydrationSource(snapshot, localValue, () => (local ? rawGet(local, PERSIST_META_KEY) : null));
        const { value, ...decision } = picked;
        choice = decision;
        current = value;
        localInSync = picked.source === 'local' || value === localValue;
        if (picked.fileWrites) {
            let archived = false;
            try {
                archived = client.storeStatus()?.migratedFromLocalStorageAt != null;
            } catch {
                archived = false;
            }
            mode = picked.fileHasValue || archived || released ? 'on' : 'waiting';
        }
        // Outside Electron (no bridge) there is nothing to report.
        if (client.available) {
            log('hydrated', { source: picked.source, reason: picked.reason, fileWrites: mode, chars: value === null ? 0 : value.length });
        }
        return choice;
    }

    function handleAck(id: number, value: string, ack: IpcStorageWriteAck): void {
        inFlight -= 1;
        if (ack.ok) {
            if (id > confirmedId) confirmedId = id;
            if (id === lastSentId) failures = 0;
            // The file now holds a value newer than localStorage (whose write failed): set the marker.
            if (markFromId !== null && id >= markFromId && !localInSync) {
                markFromId = null;
                markFileNewer();
            }
        } else if (id === lastSentId && id > confirmedId && mode === 'on') {
            // Older writes are decided by the newer one that followed them.
            if (ack.retryable !== true) {
                stop(`rejected:${ack.reason ?? 'unknown'}`);
            } else if (++failures >= maxFailures) {
                stop('too-many-failures');
            } else {
                if (pendingFile === null) pendingFile = value;
                const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1));
                log('write-retry', { reason: ack.reason ?? 'unknown', code: ack.code ?? null, failures, delayMs: delay });
                cancelRetry();
                retryTimer = setTimer(() => {
                    retryTimer = null;
                    sendPending();
                    checkIdle();
                }, delay);
            }
        }
        checkIdle();
    }

    function sendPending(): void {
        if (mode !== 'on' || pendingFile === null) return;
        cancelRetry();
        const value = pendingFile;
        pendingFile = null;
        const id = ++lastSentId;
        inFlight += 1;
        let sent: Promise<IpcStorageWriteAck>;
        try {
            sent = client.write(value);
        } catch {
            sent = Promise.resolve({ key: HOST_STORAGE_KEY, seq: 0, ok: false, reason: 'io', retryable: true, code: 'THROWN' });
        }
        sent.then(
            (ack) => handleAck(id, value, ack),
            () => handleAck(id, value, { key: HOST_STORAGE_KEY, seq: 0, ok: false, reason: 'io', retryable: true, code: 'REJECTED' })
        );
    }

    function markFileNewer(): void {
        const local = getLocal();
        if (!local) return;
        try {
            rawSet(local, PERSIST_META_KEY, FILE_NEWER_MARKER);
        } catch (err) {
            // No marker: the next startup prefers localStorage (the old JSON meta or a missing key both mean that) and the
            // file is kept in .bak/ before it is replaced. Removing the key would change nothing, so it is left alone.
            log('marker-write-failed', { name: err instanceof Error ? err.name : 'error' });
        }
    }

    function writeMeta(local: LocalStorageLike, value: string): void {
        try {
            rawSet(local, PERSIST_META_KEY, serializeLocalWriteMeta(value, now()));
        } catch (err) {
            // Could not record this write (e.g. near the quota). A stale JSON meta or a missing key make the next startup
            // prefer localStorage, which is right; a stale FILE_NEWER_MARKER would not be, so it is removed (removeItem
            // works with a full quota).
            try {
                if (rawGet(local, PERSIST_META_KEY) === FILE_NEWER_MARKER) rawRemove(local, PERSIST_META_KEY);
            } catch {
                /* the marker stays; logged below */
            }
            if (!metaErrorLogged) {
                metaErrorLogged = true;
                log('meta-write-failed', { name: err instanceof Error ? err.name : 'error' });
            }
        }
    }

    return {
        getItem(name) {
            const local = getLocal();
            if (name !== HOST_STORAGE_KEY) return local ? local.getItem(name) : null;
            if (!choice) {
                hydrate();
                return current;
            }
            // Later reads (persist.rehydrate) behave as before while localStorage is up to date.
            return localInSync && local ? local.getItem(name) : current;
        },
        setItem(name, value) {
            const local = getLocal();
            if (name !== HOST_STORAGE_KEY) {
                if (!local) throw new Error('storage unavailable');
                local.setItem(name, value);
                return;
            }
            hydrate();
            current = value;
            let localError: unknown = null;
            try {
                if (!local) throw new Error('storage unavailable');
                local.setItem(name, value);
                localInSync = true;
                markFromId = null;
                if (client.available) writeMeta(local, value);
            } catch (err) {
                localError = err;
                localInSync = false;
                // This value (or a newer one) is sent with the next id; the marker waits for the file to confirm it.
                if (markFromId === null && mode !== 'off') markFromId = lastSentId + 1;
            }
            if (mode !== 'off') {
                pendingFile = value;
                sendPending();
            }
            // localStorage stays the reported target (persist warning, T-202): the file is the extra copy in M4.
            if (localError !== null) throw localError;
        },
        removeItem(name) {
            const local = getLocal();
            if (name === HOST_STORAGE_KEY) {
                hydrate();
                current = null;
                localInSync = true;
                pendingFile = null;
                // The file store has no delete channel in M4; the file keeps the last value (and wins over a missing
                // localStorage value at the next startup).
                if (mode !== 'off') log('remove-not-mirrored');
            }
            local?.removeItem(name);
        },
        hydration: () => choice,
        fileWrites: () => mode,
        releaseFileWrites() {
            released = true;
            if (mode !== 'waiting') return;
            mode = 'on';
            sendPending();
        },
        whenIdle() {
            return new Promise<void>((resolve) => {
                idleWaiters.push(resolve);
                checkIdle();
            });
        },
    };
}
