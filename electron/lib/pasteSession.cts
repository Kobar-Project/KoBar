// R4: the global paste state machine. Pure: every side effect (shortcut,
// renderer request, clipboard write, key state, key injection, timers, log) is injected, so tests/pasteSession.test.ts drives it
// with fakes. electron/main/services/globalPaste.cts wires it to Electron and the PowerShell bridge.
//
// How the races of the old flow are closed (none of this relies on a fixed delay):
// - One paste at a time. A physical press while a paste is busy is swallowed by the still registered shortcut and queued,
//   never dropped into the target app and never lost (the old flow unregistered Ctrl+V on every press).
// - Key repeat is folded: after a press, shortcut events are repeats until V has been seen up (polled with isKeyDown).
//   Holding Ctrl+V pastes exactly once. Holding Ctrl and pressing V again is a new press (only V is watched).
// - The simulated Ctrl+V is sent only after V is up, and the shortcut is released only right before it. It is registered
//   again only after the injection script reported that it ran AND V was seen up again, so our own injected V can never
//   reach our own shortcut (the old flow re-registered 200 ms after writing to stdin, whether the script had run or not).
// - The clipboard write is awaited and verified; an unverified write is never pasted (the target would paste stale content).
// - Turning the mode off never injects key-ups and never re-registers; an authorized paste in flight still completes (R-01).
//
// Residual window (accepted by the owner): a NEW physical V press made between the release before the
// injection and the re-registration after it reaches the target app natively, so the item just pasted is pasted once
// more. Closing it needs a low-level keyboard hook, which is out of scope.

import { PASTE_TOKEN_TTL_MS } from './pasteToken.cjs';
import { VK_V } from './pasteScripts.cjs';

export type PasteState = 'off' | 'armed' | 'awaitingItem' | 'writing' | 'waitingRelease' | 'injecting';

export interface PasteSessionDeps<T> {
    /** Registers the Ctrl+V shortcut; false when another app holds it. Its callback must call `session.hotkey()`. */
    register(): boolean;
    unregister(): void;
    /** Issues the paste token and sends `request-next-paste` to the renderer; false when there is no window to ask. */
    requestItem(): boolean;
    /** Consumes the paste token for this sender (SEC-13): true at most once per request. */
    consumeToken(senderId: number): boolean;
    /** Writes the item to the clipboard and reads it back; true only when the read-back matches what was written. */
    writeAndVerify(item: T): Promise<boolean>;
    /** Physical key state: true = down, false = up, null = unknown (bridge down or no answer). */
    isKeyDown(vk: number): Promise<boolean | null>;
    /** Sends the simulated Ctrl+V; resolves true once it ran, false when it could not run. */
    inject(): Promise<boolean>;
    /** Tells the renderer that this paste failed (`clipboard-paste-error`). */
    sendError(reason: 'write_failed'): void;
    now(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    /** Diagnostics only (KOBAR_DEBUG_PASTE): steps and counts, never clipboard content. */
    log(step: string): void;
}

export interface PasteSessionOptions {
    /** How long the renderer has to answer a request (the paste token TTL). */
    itemTimeoutMs?: number;
    /** Pause between two key-state polls. Each poll is a PowerShell round trip, so this only spaces them out. */
    keyPollMs?: number;
    /** Safety cap for a key that never reads as up (stuck state): after this the key is treated as released. */
    keyWaitMaxMs?: number;
    /** Most presses queued behind a busy paste. Further presses are swallowed and dropped (logged). */
    maxPending?: number;
    /**
     * Compatibility with plugins that still debounce (ClipboardManager up to 1.0.5): a press made while a request has
     * gone unanswered for this long asks again instead of queueing, so the next press works as it did with the old host.
     */
    staleRequestMs?: number;
    /**
     * Where isKeyDown cannot tell a repeat from a press (always false, non-Windows): shortcut events within this many ms of the
     * last accepted press are ignored. 0 (default) disables it.
     */
    repeatGuardMs?: number;
    /** A clipboard write that has not settled after this long counts as failed (write_failed, back to armed). */
    writeWatchdogMs?: number;
}

export const KEY_POLL_MS = 15;
export const KEY_WAIT_MAX_MS = 10000;
export const MAX_PENDING_PRESSES = 8;
export const STALE_REQUEST_MS = 500;
export const WRITE_WATCHDOG_MS = 5000;

export interface PasteSession<T> {
    /** Turns the mode on or off; returns whether the mode is on afterwards (false when Ctrl+V could not be registered). */
    setMode(on: boolean): boolean;
    /** The Ctrl+V shortcut fired (a physical press or one of its key repeats). */
    hotkey(): void;
    /** The renderer answered a request with an item; returns true when it was accepted for pasting. */
    item(senderId: number, item: T): boolean;
    isModeOn(): boolean;
    getState(): PasteState;
    getPending(): number;
}

export function createPasteSession<T>(deps: PasteSessionDeps<T>, options: PasteSessionOptions = {}): PasteSession<T> {
    const itemTimeoutMs = options.itemTimeoutMs ?? PASTE_TOKEN_TTL_MS;
    const keyPollMs = options.keyPollMs ?? KEY_POLL_MS;
    const keyWaitMaxMs = options.keyWaitMaxMs ?? KEY_WAIT_MAX_MS;
    const maxPending = options.maxPending ?? MAX_PENDING_PRESSES;
    const staleRequestMs = options.staleRequestMs ?? STALE_REQUEST_MS;
    const repeatGuardMs = options.repeatGuardMs ?? 0;
    const writeWatchdogMs = options.writeWatchdogMs ?? WRITE_WATCHDOG_MS;

    let state: PasteState = 'off';
    let modeOn = false;
    let registered = false;
    let pending = 0;
    // True when physical V has been seen up since the last accepted press (so the next shortcut event is a new press).
    let vUp = true;
    let watching = false;
    let itemTimer: unknown = null;
    let requestedAt = 0;
    let cycle = 0;
    let lastPressAt = -Infinity;
    let writeTimer: unknown = null;

    const log = (step: string) => deps.log(`[session] ${step}`);

    function setState(next: PasteState): void {
        if (state === next) return;
        log(`state ${state} -> ${next}`);
        state = next;
    }

    function register(): boolean {
        if (registered) return true;
        try {
            registered = deps.register() === true;
        } catch {
            registered = false;
        }
        log(`shortcut register: success=${registered}`);
        return registered;
    }

    function unregister(): void {
        if (!registered) return;
        registered = false;
        deps.unregister();
        log('shortcut unregistered');
    }

    function clearItemTimer(): void {
        if (itemTimer === null) return;
        deps.clearTimer(itemTimer);
        itemTimer = null;
    }

    function clearWriteTimer(): void {
        if (writeTimer === null) return;
        deps.clearTimer(writeTimer);
        writeTimer = null;
    }

    // Polls V until it reads as up. Unknown (bridge down) and the safety cap count as up, so the flow never hangs.
    function waitForVUp(label: string): Promise<void> {
        const started = deps.now();
        let polls = 0;
        return new Promise((resolve) => {
            const poll = () => {
                polls += 1;
                Promise.resolve()
                    .then(() => deps.isKeyDown(VK_V))
                    .then(
                        (down) => {
                            if (down === true && deps.now() - started < keyWaitMaxMs) {
                                deps.setTimer(poll, keyPollMs);
                                return;
                            }
                            if (down === null) log(`${label}: V state unknown, treated as released`);
                            else if (down === true) log(`${label}: V still down after ${keyWaitMaxMs}ms, treated as released`);
                            else log(`${label}: V up (polls=${polls})`);
                            resolve();
                        },
                        () => {
                            log(`${label}: V state query failed, treated as released`);
                            resolve();
                        }
                    );
            };
            poll();
        });
    }

    // A physical press was accepted: until V is seen up, further shortcut events are its key repeats.
    function startPressWatch(): void {
        vUp = false;
        if (watching) return;
        watching = true;
        void waitForVUp('press watch').then(() => {
            watching = false;
            vUp = true;
            if (state === 'waitingRelease') beginInject();
        });
    }

    function startPaste(): void {
        let asked = false;
        try {
            asked = deps.requestItem() === true;
        } catch {
            asked = false;
        }
        if (!asked) {
            log('no window to ask for an item');
            setState('armed');
            return;
        }
        clearItemTimer();
        setState('awaitingItem');
        requestedAt = deps.now();
        const myCycle = ++cycle;
        itemTimer = deps.setTimer(() => {
            itemTimer = null;
            if (cycle !== myCycle || state !== 'awaitingItem') return;
            log(`no item within ${itemTimeoutMs}ms (plugin did not answer); queued presses dropped=${pending}`);
            pending = 0;
            setState('armed');
        }, itemTimeoutMs);
    }

    // After a paste (injected or failed): back to armed (or off when the mode was turned off meanwhile).
    function finishCycle(): void {
        if (!modeOn) {
            unregister();
            if (pending > 0) log(`mode off: queued presses dropped=${pending}`);
            pending = 0;
            setState('off');
            return;
        }
        if (!register()) {
            // Another app took Ctrl+V meanwhile: the mode is off, a later setMode(true) retries (T-037).
            modeOn = false;
            pending = 0;
            setState('off');
            return;
        }
        setState('armed');
        if (pending > 0) {
            pending -= 1;
            log(`processing a queued press (still queued=${pending})`);
            startPaste();
        }
    }

    function beginInject(): void {
        setState('injecting');
        // Released only now, right before our own Ctrl+V, so that it reaches the target app and not our shortcut.
        unregister();
        void Promise.resolve()
            .then(() => deps.inject())
            .then(
                (ran) => ran === true,
                () => false
            )
            .then((ran) => {
                log(ran ? 'injection ran' : 'injection did not run');
                // The injected V-up must be processed (and no new physical V held) before the shortcut comes back.
                return waitForVUp('after injection');
            })
            .then(() => {
                if (state === 'injecting') finishCycle();
            });
    }

    function writeDone(ok: boolean): void {
        if (state !== 'writing') return;
        clearWriteTimer();
        if (!ok) {
            log('clipboard write not verified: no paste');
            deps.sendError('write_failed');
            finishCycle();
            return;
        }
        if (vUp) {
            beginInject();
        } else {
            log('clipboard ready, waiting for V release');
            setState('waitingRelease');
        }
    }

    return {
        setMode(on) {
            if (on) {
                if (modeOn) return true;
                if (state === 'off') {
                    if (!register()) return false;
                    modeOn = true;
                    setState('armed');
                    return true;
                }
                // A paste is still in flight: it registers the shortcut again when it finishes.
                modeOn = true;
                return true;
            }
            modeOn = false;
            if (pending > 0) log(`mode off: queued presses dropped=${pending}`);
            pending = 0;
            if (state === 'armed' || state === 'awaitingItem' || state === 'off') {
                clearItemTimer();
                unregister();
                setState('off');
            } else {
                // writing / waitingRelease / injecting: the authorized paste completes (R-01); no key-ups, no re-register.
                log(`mode off during ${state}: in-flight paste completes`);
            }
            return false;
        },

        hotkey() {
            if (state === 'off') {
                log('shortcut event ignored (mode off)');
                return;
            }
            if (!vUp) {
                log('shortcut event ignored (key repeat: V not released since the last press)');
                return;
            }
            if (repeatGuardMs > 0 && deps.now() - lastPressAt < repeatGuardMs) {
                log('shortcut event ignored (repeat guard: too soon after the last press)');
                return;
            }
            lastPressAt = deps.now();
            startPressWatch();
            if (state === 'armed') {
                startPaste();
                return;
            }
            if (state === 'awaitingItem' && deps.now() - requestedAt >= staleRequestMs) {
                log('request unanswered and stale: asking again');
                startPaste();
                return;
            }
            if (pending >= maxPending) {
                log(`press dropped (queue full, ${maxPending})`);
                return;
            }
            pending += 1;
            log(`press queued during ${state} (queued=${pending})`);
        },

        item(senderId, data) {
            if (!deps.consumeToken(senderId)) {
                log('item refused (no valid paste token for this sender)');
                return false;
            }
            if (state !== 'awaitingItem') {
                log(`item ignored in state ${state}`);
                return false;
            }
            clearItemTimer();
            setState('writing');
            clearWriteTimer();
            writeTimer = deps.setTimer(() => {
                writeTimer = null;
                if (state !== 'writing') return;
                log(`clipboard write did not settle within ${writeWatchdogMs}ms`);
                writeDone(false);
            }, writeWatchdogMs);
            void Promise.resolve()
                .then(() => deps.writeAndVerify(data))
                .then(
                    (ok) => writeDone(ok === true),
                    (err: unknown) => {
                        log(`clipboard write threw: ${err instanceof Error ? err.message : 'non-Error value thrown'}`);
                        writeDone(false);
                    }
                );
            return true;
        },

        isModeOn: () => modeOn,
        getState: () => state,
        getPending: () => pending,
    };
}
