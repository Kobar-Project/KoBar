// Asks the main window's renderer to write its debounced persist state (`kobar-storage`) before the app quits or
// the Windows session ends (ARC-05, ARC-08). Pure logic, no Electron imports, so it can be unit-tested.
//
// Protocol (internal channels, not part of window.api): main sends `flush-persist` with a numeric id, the preload
// re-dispatches it as a DOM event (the renderer flushes synchronously) and replies `flush-persist-done` with the id.
// Every request settles: on ack, on send failure or after a short timeout, so quitting can never hang.

export const PERSIST_FLUSH_TIMEOUT_MS = 400;

export interface PersistFlushOptions {
    timeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface PersistFlusher {
    /** `send` delivers the request id to the renderer. Resolves true on ack, false on timeout or send failure. */
    request(send: (id: number) => void): Promise<boolean>;
    /** Feed an ack from the renderer. Returns true when it matched a pending request. */
    ack(id: unknown): boolean;
    pendingCount(): number;
}

export function createPersistFlusher(options: PersistFlushOptions = {}): PersistFlusher {
    const timeoutMs = options.timeoutMs ?? PERSIST_FLUSH_TIMEOUT_MS;
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const pending = new Map<number, { resolve: (acked: boolean) => void; timer: unknown }>();
    let nextId = 1;

    function settle(id: number, acked: boolean): boolean {
        const entry = pending.get(id);
        if (!entry) return false;
        pending.delete(id);
        clearTimer(entry.timer);
        entry.resolve(acked);
        return true;
    }

    return {
        request(send) {
            return new Promise((resolve) => {
                const id = nextId++;
                const timer = setTimer(() => settle(id, false), timeoutMs);
                pending.set(id, { resolve, timer });
                try {
                    send(id);
                } catch {
                    settle(id, false);
                }
            });
        },
        ack(id) {
            if (typeof id !== 'number' || !Number.isInteger(id)) return false;
            return settle(id, true);
        },
        pendingCount: () => pending.size,
    };
}

export interface QuitFlushGuardDeps {
    /** Starts a flush. Returns null when there is nothing to flush (no live window): quitting continues at once. */
    flush: () => Promise<unknown> | null;
    /** Called once the flush settled; must restart the quit (e.g. `app.quit()`). */
    quit: () => void;
}

export interface QuitFlushGuard {
    /** `before-quit` handler. Delays the first quit until the flush settles; every later quit passes through. */
    onBeforeQuit(event: { preventDefault(): void }): void;
}

export function createQuitFlushGuard(deps: QuitFlushGuardDeps): QuitFlushGuard {
    let state: 'idle' | 'flushing' | 'done' = 'idle';
    return {
        onBeforeQuit(event) {
            if (state === 'done') return;
            if (state === 'flushing') {
                // A second quit request while waiting: keep waiting, the pending flush restarts the quit.
                event.preventDefault();
                return;
            }
            let flushing: Promise<unknown> | null = null;
            try {
                flushing = deps.flush();
            } catch {
                flushing = null;
            }
            if (!flushing) {
                state = 'done';
                return;
            }
            state = 'flushing';
            event.preventDefault();
            flushing
                .catch(() => undefined)
                .then(() => {
                    state = 'done';
                    deps.quit();
                });
        },
    };
}
