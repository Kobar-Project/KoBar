// T-404: renderer half of the one-time localStorage -> file copy.
// After a successful hydration, when the app is idle, every localStorage key (host keys, `_iso_<workspace>` keys and plugin
// keys) is read and sent once to main over the host-internal storage bridge (src/storage/client.ts, NOT window.api). Main
// masks secrets and writes the read-only archive `kobar-data/localstorage-snapshot/` (electron/main/services/storage/
// localStorageSnapshot.cts), then records `manifest.migratedFromLocalStorageAt`.
//
// Guarantees:
//   - localStorage is only READ (through Storage.prototype, so the workspace isolation patch does not rename keys); nothing
//     is set, removed or cleared here. It stays the source of truth (and the rollback path) for the whole of M4.
//   - Whether to run is decided by `migratedFromLocalStorageAt` of the store snapshot (not by manifest.json existing).
//     Main checks again (manifest field or `.done` marker), so a second run never rewrites the archive.
//   - Never blocks startup: scheduled after hydration, after a delay, in an idle callback. Never throws; a failure is
//     logged without values and simply retried on the next startup.
//   - It does not switch the persist backend (T-405).
import type { IpcLocalStorageSnapshotResult } from '../../shared/ipc-contract';
import { snapshotLocalStorage } from '../backup/exportBackup';
import { STORAGE_MAX_VALUE_BYTES, type StorageClient, storageClient } from './client';

type StorageReader = Pick<Storage, 'length' | 'key' | 'getItem'>;

/** Delay after hydration before the copy starts, so it never competes with startup work. */
export const LOCALSTORAGE_SNAPSHOT_DELAY_MS = 5000;
/** Upper bound for waiting on an idle period once the delay is over. */
export const LOCALSTORAGE_SNAPSHOT_IDLE_TIMEOUT_MS = 10000;

export type LocalStorageMigrationSkip = 'no-store' | 'disabled' | 'read-only' | 'unavailable' | 'already-done' | 'too-large' | 'error';

export type LocalStorageMigrationOutcome =
    IpcLocalStorageSnapshotResult | { ok: false; status: 'skipped'; reason: LocalStorageMigrationSkip };

export interface LocalStorageMigrationDeps {
    client: Pick<StorageClient, 'storeStatus' | 'archiveLocalStorage'>;
    storage: StorageReader;
    log?: (event: string, details?: Record<string, string | number | boolean | null>) => void;
}

function defaultLog(event: string, details?: Record<string, string | number | boolean | null>): void {
    const write = event === 'written' || event === 'already-done' ? console.log : console.warn;
    write('[KoBar] localstorage-snapshot:', event, details ?? {});
}

function defaultDeps(): LocalStorageMigrationDeps {
    return { client: storageClient, storage: window.localStorage, log: defaultLog };
}

/**
 * Sends every localStorage entry to main once, unless the store reports the copy as done or is not usable. Never throws.
 */
export async function migrateLocalStorageSnapshot(deps: LocalStorageMigrationDeps = defaultDeps()): Promise<LocalStorageMigrationOutcome> {
    const log = deps.log ?? defaultLog;
    const skip = (reason: LocalStorageMigrationSkip): LocalStorageMigrationOutcome => ({ ok: false, status: 'skipped', reason });
    try {
        const status = deps.client.storeStatus();
        // No snapshot from main (outside Electron, another window, the boot read failed): try again next startup.
        if (!status) return skip('no-store');
        if (status.disabled) return skip('disabled');
        if (status.readOnly) return skip('read-only');
        if (!status.ok) return skip('unavailable');
        if (status.migratedFromLocalStorageAt !== null) return skip('already-done');

        const values = snapshotLocalStorage(deps.storage);
        const entries: Array<[string, string]> = [];
        let chars = 0;
        for (const key of Object.keys(values)) {
            entries.push([key, values[key]]);
            chars += key.length + values[key].length;
        }
        // UTF-8 never has fewer bytes than UTF-16 code units: certainly over main's cap, do not send it at all.
        if (chars > STORAGE_MAX_VALUE_BYTES) {
            log('too-large', { keys: entries.length, chars });
            return skip('too-large');
        }
        const result = await deps.client.archiveLocalStorage({ entries });
        log(result.status, {
            keys: result.keyCount ?? null,
            omitted: result.omittedCount ?? null,
            chars,
        });
        return result;
    } catch (err) {
        log('error', { name: err instanceof Error ? err.name : 'error' });
        return skip('error');
    }
}

interface HydrationSource {
    getState(): { isHydrated: boolean };
    subscribe(listener: (state: { isHydrated: boolean }) => void): () => void;
}

export interface ScheduleLocalStorageSnapshotDeps {
    store: HydrationSource;
    run?: () => Promise<unknown>;
    delayMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** `requestIdleCallback` when the environment has one. */
    requestIdle?: ((fn: () => void, options: { timeout: number }) => unknown) | null;
}

/**
 * Runs the copy once, after the store finished a successful hydration (`isHydrated`), a delay and an idle callback.
 * A failed hydration never sets `isHydrated`, so nothing is sent then. Returns a cancel function.
 */
export function scheduleLocalStorageSnapshot(deps: ScheduleLocalStorageSnapshotDeps): () => void {
    const run = deps.run ?? (() => migrateLocalStorageSnapshot());
    const delayMs = deps.delayMs ?? LOCALSTORAGE_SNAPSHOT_DELAY_MS;
    const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const requestIdle =
        deps.requestIdle !== undefined
            ? deps.requestIdle
            : typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
              ? (fn: () => void, options: { timeout: number }) => window.requestIdleCallback(fn, options)
              : null;

    let started = false;
    let cancelled = false;
    let timer: unknown = null;
    let unsubscribe: (() => void) | null = null;

    const start = () => {
        if (started || cancelled) return;
        started = true;
        unsubscribe?.();
        unsubscribe = null;
        timer = setTimer(() => {
            timer = null;
            if (cancelled) return;
            const go = () => {
                if (!cancelled) void run().catch(() => undefined);
            };
            if (requestIdle) requestIdle(go, { timeout: LOCALSTORAGE_SNAPSHOT_IDLE_TIMEOUT_MS });
            else go();
        }, delayMs);
    };

    try {
        if (deps.store.getState().isHydrated) start();
        else {
            unsubscribe = deps.store.subscribe((state) => {
                if (state.isHydrated) start();
            });
            if (started) {
                unsubscribe();
                unsubscribe = null;
            }
        }
    } catch {
        // Never let the archive affect startup.
    }

    return () => {
        cancelled = true;
        unsubscribe?.();
        unsubscribe = null;
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
}
