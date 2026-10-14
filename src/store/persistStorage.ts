// Debounced write-through storage for the Zustand persist middleware (ARC-05, ARC-08).
//
// The persist middleware calls `setItem` on every `set()`, which used to mean one synchronous
// localStorage write (of the whole serialized state) per keystroke. This layer keeps the latest
// value per key in memory and writes it once after `delayMs` of quiet (bounded by `maxWaitMs`).
// Pending values are written synchronously by `flush()`, which runs on `beforeunload`,
// `pagehide`, `visibilitychange` -> hidden and when the main process asks for it before quit or
// session end (the preload re-dispatches that request as the `kobar:flush-persist` DOM event).
//
// Write lock (T-201): `lockWrites()` blocks all writes. The `kobar-storage` store locks before it hydrates and
// unlocks only after a successful hydration/migration, so a failed hydration can never overwrite the stored data.
//
// The value format is untouched: this layer only delays the exact string the persist
// middleware produced. Writes go through `window.localStorage` resolved at write time, so the
// workspace isolation patch (src/utils/localStorageIsolation.ts) applies exactly as before.
//
// T-405: the app instance's base is the file-backed storage (src/storage/fileBackedStorage.ts): it hydrates from
// kobar-data/host/kobar-storage.json or localStorage (the newer copy) and writes every value to BOTH localStorage (as
// above, unchanged) and the file store (dual-write through 1.3.x). This layer (debounce, write lock, flush triggers) is
// unchanged; reverting to the plain localStorage base is a one-line rollback.

/// <reference types="vite/client" />
import type { StateStorage } from 'zustand/middleware';
import { storageClient } from '../storage/client';
import { type FileBackedStorage, createFileBackedStorage } from '../storage/fileBackedStorage';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DebouncedStorageOptions {
    /** Quiet period before a pending value is written (trailing debounce). */
    delayMs?: number;
    /** Upper bound for how long a pending value may wait while writes keep coming in. */
    maxWaitMs?: number;
    /** Called when writing a value fails (e.g. QuotaExceededError). The error is never rethrown. */
    onError?: (error: unknown, key: string) => void;
    /** Called after a value was written successfully (used to re-arm the user warning, T-202). */
    onSuccess?: (key: string) => void;
}

export interface DebouncedStorage extends StateStorage {
    getItem: (name: string) => string | null;
    setItem: (name: string, value: string) => void;
    removeItem: (name: string) => void;
    /** Writes every pending value synchronously. Safe to call at any time, including with nothing pending. */
    flush: () => void;
    hasPending: () => boolean;
    /**
     * Blocks every write (T-201): pending values are discarded, later `setItem`/`removeItem` calls are ignored and
     * `flush()` writes nothing until `unlockWrites()`. Reads still go to the base storage.
     */
    lockWrites: (reason: string) => void;
    unlockWrites: () => void;
    isLocked: () => boolean;
    /** Reason passed to the active `lockWrites`, or null when unlocked. */
    lockReason: () => string | null;
}

export const PERSIST_DEBOUNCE_MS = 500;
export const PERSIST_MAX_WAIT_MS = 2000;
/** DOM event the preload dispatches when the main process asks the renderer to flush (internal, not window.api). */
export const FLUSH_PERSIST_EVENT = 'kobar:flush-persist';

export function createDebouncedStorage(
    getBase: () => StorageLike | null | undefined,
    options: DebouncedStorageOptions = {}
): DebouncedStorage {
    const delayMs = options.delayMs ?? PERSIST_DEBOUNCE_MS;
    const maxWaitMs = Math.max(options.maxWaitMs ?? PERSIST_MAX_WAIT_MS, delayMs);
    const pending = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstPendingAt: number | null = null;
    let lockedReason: string | null = null;

    function cancelTimer() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function discardPending() {
        cancelTimer();
        firstPendingAt = null;
        pending.clear();
    }

    function flush() {
        cancelTimer();
        firstPendingAt = null;
        if (lockedReason !== null) {
            pending.clear();
            return;
        }
        if (pending.size === 0) return;
        const entries = [...pending.entries()];
        pending.clear();
        const base = getBase();
        for (const [key, value] of entries) {
            try {
                if (!base) throw new Error('storage unavailable');
                base.setItem(key, value);
                try {
                    options.onSuccess?.(key);
                } catch {
                    // A failing success handler must not be mistaken for a write error.
                }
            } catch (error) {
                try {
                    options.onError?.(error, key);
                } catch {
                    // A failing error handler must not turn a write error into a crash.
                }
            }
        }
    }

    function schedule() {
        const now = Date.now();
        if (firstPendingAt === null) firstPendingAt = now;
        const remainingMaxWait = maxWaitMs - (now - firstPendingAt);
        cancelTimer();
        timer = setTimeout(flush, Math.max(0, Math.min(delayMs, remainingMaxWait)));
    }

    return {
        getItem(name) {
            // Read-your-writes: an unflushed value is the current one.
            const value = pending.get(name);
            if (value !== undefined) return value;
            const base = getBase();
            return base ? base.getItem(name) : null;
        },
        setItem(name, value) {
            if (lockedReason !== null) return;
            pending.set(name, value);
            schedule();
        },
        removeItem(name) {
            pending.delete(name);
            if (pending.size === 0) {
                cancelTimer();
                firstPendingAt = null;
            }
            // Locked: the stored value must survive (e.g. after a failed hydration it is the user's only copy).
            if (lockedReason !== null) return;
            getBase()?.removeItem(name);
        },
        flush,
        hasPending: () => pending.size > 0,
        lockWrites(reason) {
            lockedReason = reason || 'locked';
            discardPending();
        },
        unlockWrites() {
            lockedReason = null;
        },
        isLocked: () => lockedReason !== null,
        lockReason: () => lockedReason,
    };
}

/**
 * Registers the flush triggers on `target` (normally `window`). Returns a function that removes them.
 * `beforeunload`/`pagehide` cover reloads and window closes (including the window close done by app quit),
 * `visibilitychange` -> hidden is an extra safety net, `kobar:flush-persist` is the main-process request.
 */
export function installFlushListeners(storage: Pick<DebouncedStorage, 'flush'>, target: Window): () => void {
    const onFlush = () => storage.flush();
    const onVisibility = () => {
        if (target.document?.visibilityState === 'hidden') storage.flush();
    };
    target.addEventListener('beforeunload', onFlush);
    target.addEventListener('pagehide', onFlush);
    target.addEventListener(FLUSH_PERSIST_EVENT, onFlush);
    target.document?.addEventListener('visibilitychange', onVisibility);
    return () => {
        target.removeEventListener('beforeunload', onFlush);
        target.removeEventListener('pagehide', onFlush);
        target.removeEventListener(FLUSH_PERSIST_EVENT, onFlush);
        target.document?.removeEventListener('visibilitychange', onVisibility);
    };
}

// ─── App instance (used by the `kobar-storage` persist store) ───────────────────────────────

type PersistWriteErrorListener = (error: unknown, key: string) => void;
const writeErrorListeners = new Set<PersistWriteErrorListener>();
const writeSuccessListeners = new Set<(key: string) => void>();
let writeErrorLogged = false;

/**
 * Subscribes to every persist write failure (raw, unthrottled; the user warning of T-202 adds a failure streak on top,
 * see persistWarning.ts). Failed writes of a locked storage never reach listeners: locked writes are dropped on purpose.
 * Returns an unsubscribe function.
 */
export function onPersistWriteError(listener: PersistWriteErrorListener): () => void {
    writeErrorListeners.add(listener);
    return () => {
        writeErrorListeners.delete(listener);
    };
}

/** Subscribes to successful persist writes. Returns an unsubscribe function. */
export function onPersistWriteSuccess(listener: (key: string) => void): () => void {
    writeSuccessListeners.add(listener);
    return () => {
        writeSuccessListeners.delete(listener);
    };
}

function reportWriteSuccess(key: string) {
    for (const listener of writeSuccessListeners) {
        try {
            listener(key);
        } catch {
            // Listener errors are ignored on purpose.
        }
    }
}

function reportWriteError(error: unknown, key: string) {
    // The in-memory state stays intact; only the disk copy is behind. Log once to avoid flooding.
    if (!writeErrorLogged) {
        writeErrorLogged = true;
        console.error(`[Store] Could not save "${key}" to localStorage; changes are kept in memory only.`, error);
    }
    for (const listener of writeErrorListeners) {
        try {
            listener(error, key);
        } catch {
            // Listener errors are ignored on purpose.
        }
    }
}

/** T-405: the base of the app instance: localStorage + the file store (host-internal storage client, not window.api). */
export const appPersistBackend: FileBackedStorage = createFileBackedStorage({
    client: storageClient,
    getLocal: () => (typeof window !== 'undefined' ? window.localStorage : undefined),
});

export const appPersistStorage: DebouncedStorage = createDebouncedStorage(() => appPersistBackend, {
    onError: reportWriteError,
    onSuccess: reportWriteSuccess,
});

/** Writes any pending `kobar-storage` value now. */
export function flushAppPersist(): void {
    appPersistStorage.flush();
}

/** T-405: the T-404 localStorage archive finished, so the file store may receive its first write. */
export function releasePersistFileWrites(): void {
    appPersistBackend.releaseFileWrites();
}

if (typeof window !== 'undefined') {
    const uninstall = installFlushListeners(appPersistStorage, window);
    // Dev HMR: write pending state and drop this module instance's listeners before it is replaced.
    import.meta.hot?.dispose(() => {
        appPersistStorage.flush();
        uninstall();
    });
}
