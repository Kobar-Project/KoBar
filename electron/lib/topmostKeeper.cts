// R-04: keeps the main bar above other windows. Windows can silently drop a topmost window behind others after display changes,
// lock/unlock, sleep/resume or another app grabbing the topmost band, and Electron's setAlwaysOnTop(true) alone can be a no-op when the
// flag is already set. The keeper re-asserts the level AND raises the window with moveTop() (never focus(), so no focus is stolen).
// Pure: the window, the timers and the skip rules are injected, so it is testable without Electron.

export interface TopmostWindowLike {
    isDestroyed(): boolean;
    isVisible(): boolean;
    isMinimized(): boolean;
    setAlwaysOnTop(flag: boolean, level?: 'floating' | 'screen-saver', relativeLevel?: number): void;
    moveTop(): void;
}

export interface TopmostKeeperOptions {
    getWindow: () => TopmostWindowLike | null;
    /** True while re-asserting would be wrong (pin-target picking, screenshot session, ...). */
    shouldSkip?: () => boolean;
    level: 'floating' | 'screen-saver';
    /** Burst coalescing delay. */
    debounceMs?: number;
    /** Low-frequency safety re-assertion; 0 disables it. */
    safetyIntervalMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    setIntervalTimer?: (fn: () => void, ms: number) => unknown;
    clearIntervalTimer?: (handle: unknown) => void;
    log?: (message: string) => void;
}

export interface TopmostKeeper {
    /** Debounced re-assertion; many requests inside the debounce window run once. */
    request(reason: string): void;
    /** Runs the re-assertion right now (no debounce). Returns true when it touched the window. */
    assertNow(reason: string): boolean;
    /** Starts the safety interval (idempotent). */
    start(): void;
    stop(): void;
}

export const TOPMOST_DEBOUNCE_MS = 150;
export const TOPMOST_SAFETY_INTERVAL_MS = 30_000;

export function createTopmostKeeper(opts: TopmostKeeperOptions): TopmostKeeper {
    const debounceMs = opts.debounceMs ?? TOPMOST_DEBOUNCE_MS;
    const safetyMs = opts.safetyIntervalMs ?? TOPMOST_SAFETY_INTERVAL_MS;
    const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const setIntervalTimer = opts.setIntervalTimer ?? ((fn, ms) => setInterval(fn, ms));
    const clearIntervalTimer = opts.clearIntervalTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    let pending: unknown = null;
    let interval: unknown = null;

    function assertNow(reason: string): boolean {
        try {
            const win = opts.getWindow();
            // A hidden or minimized window must stay that way: moveTop/setAlwaysOnTop could otherwise re-show it.
            if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
            if (opts.shouldSkip?.()) return false;
            win.setAlwaysOnTop(true, opts.level, 1);
            win.moveTop();
            return true;
        } catch (err) {
            opts.log?.(`[KoBar] topmost re-assert failed (${reason}): ${String(err)}`);
            return false;
        }
    }

    return {
        request(reason) {
            if (pending !== null) clearTimer(pending);
            pending = setTimer(() => {
                pending = null;
                assertNow(reason);
            }, debounceMs);
        },
        assertNow,
        start() {
            if (interval !== null || safetyMs <= 0) return;
            interval = setIntervalTimer(() => {
                assertNow('safety-interval');
            }, safetyMs);
        },
        stop() {
            if (pending !== null) clearTimer(pending);
            pending = null;
            if (interval !== null) clearIntervalTimer(interval);
            interval = null;
        },
    };
}
