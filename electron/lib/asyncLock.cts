// A single-flight queue for asynchronous critical sections (T-318). No Electron imports, so it is unit-tested directly.
// The plugin install / uninstall / config channels share one lock so their decision + write sequences never interleave
// once those sequences contain an `await` (they used to be fully synchronous, which gave the same guarantee for free).

export interface AsyncLock {
    /**
     * Runs `fn` after every earlier `run` call has settled (FIFO). The lock is released when `fn` returns, resolves,
     * throws or rejects; the result or error of `fn` is passed through unchanged. Never nest `run` calls on one lock
     * (the inner call would wait for the outer one forever).
     */
    run<T>(fn: () => T | PromiseLike<T>): Promise<Awaited<T>>;
    /** Calls that are running or waiting (for tests and diagnostics). */
    pending(): number;
}

export function createAsyncLock(): AsyncLock {
    // Always a fulfilled-or-pending promise that never rejects: each holder resolves its own link when it is done.
    let tail: Promise<void> = Promise.resolve();
    let count = 0;

    function run<T>(fn: () => T | PromiseLike<T>): Promise<Awaited<T>> {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        count += 1;
        // `then` turns a synchronous throw of `fn` into a rejection, so `finally` always releases.
        return previous
            .then(() => fn() as Awaited<T> | PromiseLike<Awaited<T>>)
            .finally(() => {
                count -= 1;
                release();
            });
    }

    return { run, pending: () => count };
}
