// R4: the global paste state machine with fakes only (no clipboard, no Electron, no PowerShell). The harness models the
// physical keyboard (V up/down), whether our Ctrl+V shortcut is registered (a press while it is not registered goes to the
// target app natively and pastes whatever is on the clipboard), the clipboard, and a plugin that answers every request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasteSession, type PasteSessionOptions } from '../electron/lib/pasteSession.cjs';
import { createPasteToken } from '../electron/lib/pasteToken.cjs';
import { VK_CONTROL, VK_V, injectPasteScript, isKeyDownScript, parseKeyDownReply } from '../electron/lib/pasteScripts.cjs';
import { clipboardImageMatches, clipboardTextMatches } from '../electron/lib/clipboardGuards.cjs';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

interface HarnessOptions {
    /** Slots the fake plugin hands out, in order. After the last one it turns the mode off (as ClipboardManager does). */
    slots?: string[];
    /** When false the plugin never answers. */
    answer?: boolean;
    /** Writes resolve only when the test resolves them (writes[i].resolve(ok)). */
    manualWrites?: boolean;
    /** Injections resolve only when the test resolves them. */
    manualInjects?: boolean;
    registerResults?: boolean[];
    keyDownResult?: (vk: number) => boolean | null;
    /** Every write rejects (e.g. the clipboard is locked by another app). */
    writeThrows?: boolean;
    session?: PasteSessionOptions;
}

function harness(opts: HarnessOptions = {}) {
    const calls: string[] = [];
    const keys = new Map<number, boolean>();
    const keyQueries: number[] = [];
    const pasted: string[] = [];
    const native: string[] = [];
    const writes: Array<Deferred<boolean>> = [];
    const injects: Array<Deferred<boolean>> = [];
    const slots = [...(opts.slots ?? [])];
    const registerResults = [...(opts.registerResults ?? [])];
    const token = createPasteToken(() => Date.now());
    let registered = false;
    let clipboard = '';
    let requests = 0;

    const session = createPasteSession<string>(
        {
            register: () => {
                const ok = registerResults.length ? registerResults.shift()! : true;
                calls.push(ok ? 'register' : 'register-failed');
                if (ok) registered = true;
                return ok;
            },
            unregister: () => {
                calls.push('unregister');
                registered = false;
            },
            requestItem: () => {
                requests += 1;
                calls.push('request');
                token.issue(1);
                if (opts.answer !== false && slots.length > 0) {
                    const item = slots.shift()!;
                    const last = slots.length === 0;
                    queueMicrotask(() => {
                        session.item(1, item);
                        if (last) session.setMode(false);
                    });
                }
                return true;
            },
            consumeToken: (id) => token.consume(id),
            writeAndVerify: (item) => {
                calls.push(`write:${item}`);
                if (opts.writeThrows) return Promise.reject(new Error('clipboard locked'));
                const d = deferred<boolean>();
                writes.push(d);
                if (!opts.manualWrites) d.resolve(true);
                return d.promise.then((ok) => {
                    if (ok) clipboard = item;
                    return ok;
                });
            },
            isKeyDown: async (vk) => {
                keyQueries.push(vk);
                if (opts.keyDownResult) return opts.keyDownResult(vk);
                return keys.get(vk) ?? false;
            },
            inject: () => {
                calls.push('inject');
                const d = deferred<boolean>();
                injects.push(d);
                if (!opts.manualInjects) d.resolve(true);
                return d.promise.then((ran) => {
                    if (ran) pasted.push(clipboard);
                    return ran;
                });
            },
            sendError: () => calls.push('error'),
            now: () => Date.now(),
            setTimer: (fn, ms) => setTimeout(fn, ms),
            clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
            log: () => undefined,
        },
        opts.session
    );

    const settle = (ms = 100) => vi.advanceTimersByTimeAsync(ms);
    return {
        session,
        calls,
        keys,
        keyQueries,
        pasted,
        native,
        writes,
        injects,
        settle,
        requests: () => requests,
        isRegistered: () => registered,
        /** Physical V down: our shortcut swallows it when registered, otherwise the target app pastes the clipboard. */
        pressV() {
            keys.set(VK_V, true);
            if (registered) session.hotkey();
            else native.push(clipboard);
        },
        /** An auto-repeat key-down of a held V. */
        repeatV() {
            if (registered) session.hotkey();
            else native.push(clipboard);
        },
        releaseV() {
            keys.set(VK_V, false);
        },
        async tap() {
            this.pressV();
            await settle(20);
            this.releaseV();
            await settle();
        },
    };
}

/** Between every unregister and the next register there must be exactly one injection and nothing that re-registers early. */
function expectInjectionBracketed(calls: string[]) {
    calls.forEach((c, i) => {
        if (c !== 'unregister') return;
        const nextRegister = calls.indexOf('register', i);
        const span = calls.slice(i + 1, nextRegister === -1 ? undefined : nextRegister);
        expect(span.filter((s) => s === 'inject')).toHaveLength(1);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('pasteSession: basic flow', () => {
    it('slow presses: one paste per press, in order, each injection between unregister and register', async () => {
        const h = harness({ slots: ['bir', 'iki', 'üç'] });
        expect(h.session.setMode(true)).toBe(true);
        for (let i = 0; i < 3; i++) await h.tap();
        expect(h.pasted).toEqual(['bir', 'iki', 'üç']);
        expect(h.native).toEqual([]);
        expect(h.calls.filter((c) => c === 'inject')).toHaveLength(3);
        expectInjectionBracketed(h.calls);
        // After the last item the plugin turned the mode off: no re-register at the end.
        expect(h.calls.at(-1)).toBe('inject');
        expect(h.session.getState()).toBe('off');
        expect(h.isRegistered()).toBe(false);
    });

    it('register failure keeps the mode off and a later setMode(true) retries (T-037)', () => {
        const h = harness({ registerResults: [false, true] });
        expect(h.session.setMode(true)).toBe(false);
        expect(h.session.isModeOn()).toBe(false);
        expect(h.session.getState()).toBe('off');
        expect(h.session.setMode(true)).toBe(true);
        expect(h.calls).toEqual(['register-failed', 'register']);
        expect(h.session.getState()).toBe('armed');
    });
});

describe('pasteSession: races', () => {
    it('rapid presses during a pending write are queued, none is lost, the next request goes out by itself', async () => {
        const h = harness({ slots: ['a', 'b'], manualWrites: true });
        h.session.setMode(true);
        h.pressV();
        await h.settle(1);
        expect(h.session.getState()).toBe('writing');
        h.releaseV();
        await h.settle(20);
        h.pressV(); // second press while the first write is still pending
        await h.settle(1);
        h.releaseV();
        await h.settle(20);
        expect(h.session.getPending()).toBe(1);
        expect(h.requests()).toBe(1);
        h.writes[0].resolve(true);
        await h.settle();
        expect(h.requests()).toBe(2); // asked by the session itself after the first injection was confirmed
        h.writes[1].resolve(true);
        await h.settle();
        expect(h.pasted).toEqual(['a', 'b']);
        expect(h.native).toEqual([]);
        expectInjectionBracketed(h.calls);
    });

    it('five very fast presses during the first write paste five items in order', async () => {
        const h = harness({ slots: ['1', '2', '3', '4', '5'], manualWrites: true });
        h.session.setMode(true);
        for (let i = 0; i < 5; i++) {
            h.pressV();
            await h.settle(1);
            h.releaseV();
            await h.settle(16);
        }
        expect(h.session.getPending()).toBe(4);
        for (let i = 0; i < 5; i++) {
            await vi.waitFor(() => expect(h.writes.length).toBeGreaterThan(i));
            h.writes[i].resolve(true);
            await h.settle();
        }
        expect(h.pasted).toEqual(['1', '2', '3', '4', '5']);
        expect(h.native).toEqual([]);
    });

    it('Ctrl held + V pressed repeatedly: one paste per V cycle, Ctrl is never queried or touched', async () => {
        const h = harness({ slots: ['w', 'x', 'y', 'z'] });
        h.keys.set(VK_CONTROL, true);
        h.session.setMode(true);
        for (let i = 0; i < 4; i++) await h.tap();
        expect(h.pasted).toEqual(['w', 'x', 'y', 'z']);
        expect(h.keyQueries).not.toContain(VK_CONTROL);
        // The injected script only presses/releases Ctrl when it is not already held.
        const script = injectPasteScript(9);
        for (const line of script.split('\n').filter((l) => l.includes('keybd_event(0x11'))) {
            expect(line.startsWith('if (-not $isDown)')).toBe(true);
        }
    });

    it('V held down (key repeat): repeats are ignored, exactly one paste, injected only after V is released', async () => {
        const h = harness({ slots: ['only', 'never'] });
        h.session.setMode(true);
        h.pressV();
        await h.settle(5);
        for (let i = 0; i < 10; i++) {
            h.repeatV();
            await h.settle(30);
        }
        expect(h.session.getState()).toBe('waitingRelease');
        expect(h.calls).not.toContain('inject');
        expect(h.requests()).toBe(1);
        h.releaseV();
        await h.settle();
        expect(h.pasted).toEqual(['only']);
        expect(h.requests()).toBe(1);
        expect(h.native).toEqual([]);
        expect(h.session.getState()).toBe('armed');
    });

    it('our own injection cannot reach our shortcut: register waits for the injection AND a released V', async () => {
        const h = harness({ slots: ['a', 'b'], manualInjects: true });
        h.session.setMode(true);
        await h.tap();
        expect(h.session.getState()).toBe('injecting');
        expect(h.calls.slice(-2)).toEqual(['unregister', 'inject']);
        await h.settle(500);
        expect(h.calls.at(-1)).toBe('inject'); // no timer-based re-register
        // A new physical press in the gap goes to the target natively (the accepted residual window) and is held.
        h.pressV();
        h.injects[0].resolve(true);
        await h.settle(200);
        expect(h.calls.at(-1)).toBe('inject');
        expect(h.isRegistered()).toBe(false);
        h.releaseV();
        await h.settle();
        expect(h.calls.at(-1)).toBe('register');
        expect(h.native).toEqual(['a']); // "the same item once more", never nothing and never a skipped item
    });

    it('mixed text and image: a slow image write keeps the order, a second answer to one request is ignored', async () => {
        const h = harness({ slots: ['text-1', 'image-1', 'text-2'], manualWrites: true });
        h.session.setMode(true);
        await h.tap();
        h.writes[0].resolve(true);
        await h.settle();
        await h.tap(); // image item: its write stays pending
        h.pressV(); // next press arrives while the image is still being written
        await h.settle(5);
        h.releaseV();
        await h.settle();
        expect(h.session.item(1, 'duplicate')).toBe(false); // single flight (no token for it either)
        h.writes[1].resolve(true);
        await h.settle();
        h.writes[2].resolve(true);
        await h.settle();
        expect(h.pasted).toEqual(['text-1', 'image-1', 'text-2']);
        expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual(['write:text-1', 'write:image-1', 'write:text-2']);
    });

    it('a second item for the same request is ignored even with a valid token (state check)', async () => {
        const h = harness({ answer: false, manualWrites: true });
        h.session.setMode(true);
        h.pressV();
        expect(h.session.item(1, 'first')).toBe(true);
        expect(h.session.item(1, 'second')).toBe(false);
        await h.settle(1);
        expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual(['write:first']);
    });
});

describe('pasteSession: failures', () => {
    it('failed write verification: no injection, one error, back to armed with the shortcut still registered', async () => {
        const h = harness({ slots: ['a', 'b'], manualWrites: true });
        h.session.setMode(true);
        await h.tap();
        h.writes[0].resolve(false);
        await h.settle();
        expect(h.calls).not.toContain('inject');
        expect(h.calls.filter((c) => c === 'error')).toHaveLength(1);
        expect(h.calls).not.toContain('unregister');
        expect(h.calls.filter((c) => c === 'register')).toHaveLength(1);
        expect(h.session.getState()).toBe('armed');
        expect(h.isRegistered()).toBe(true);
    });

    it('a write that throws counts as not verified', async () => {
        const h = harness({ slots: ['x'], writeThrows: true });
        h.session.setMode(true);
        await h.tap();
        expect(h.calls).toContain('error');
        expect(h.calls).not.toContain('inject');
    });

    it('plugin not answering: back to armed after the token TTL, no extra register, the next press works', async () => {
        const h = harness({ answer: false });
        h.session.setMode(true);
        await h.tap();
        expect(h.session.getState()).toBe('awaitingItem');
        await h.settle(3000);
        expect(h.session.getState()).toBe('armed');
        expect(h.calls.filter((c) => c === 'register')).toHaveLength(1);
        expect(h.calls).not.toContain('unregister');
        await h.tap();
        expect(h.requests()).toBe(2);
        expect(h.session.item(1, 'late')).toBe(true);
        await h.settle();
        expect(h.pasted).toEqual(['late']);
    });

    it('an old debouncing plugin: a press after a stale unanswered request asks again instead of waiting for the TTL', async () => {
        const h = harness({ answer: false });
        h.session.setMode(true);
        await h.tap(); // request 1 dropped by the plugin's debounce
        await h.settle(500);
        await h.tap();
        expect(h.requests()).toBe(2);
        expect(h.session.getPending()).toBe(0);
        expect(h.session.item(1, 'second')).toBe(true);
        await h.settle();
        expect(h.pasted).toEqual(['second']);
    });

    it('item from another sender is refused (SEC-13)', async () => {
        const h = harness({ answer: false });
        h.session.setMode(true);
        await h.tap();
        expect(h.session.item(2, 'evil')).toBe(false);
        expect(h.calls.some((c) => c.startsWith('write:'))).toBe(false);
        // The token is burned: the right sender is refused too, and the request times out back to armed.
        expect(h.session.item(1, 'late')).toBe(false);
        await h.settle(3000);
        expect(h.session.getState()).toBe('armed');
    });

    it('key state unknown (bridge down) counts as released, so the flow never hangs', async () => {
        const h = harness({ slots: ['a'], keyDownResult: () => null });
        h.session.setMode(true);
        h.pressV(); // V stays physically down, but the bridge cannot tell
        await h.settle();
        expect(h.pasted).toEqual(['a']);
    });

    it('presses beyond the queue limit are dropped, not replayed', async () => {
        const h = harness({ answer: false, manualWrites: true, session: { maxPending: 2 } });
        h.session.setMode(true);
        h.pressV();
        h.session.item(1, 'a');
        await h.settle(1);
        h.releaseV();
        await h.settle(20);
        for (let i = 0; i < 4; i++) {
            h.pressV();
            await h.settle(1);
            h.releaseV();
            await h.settle(20);
        }
        expect(h.session.getPending()).toBe(2);
    });
});

describe('pasteSession: turning the mode off', () => {
    it('R-01 regression: the last item is still pasted when the plugin turns the mode off right after it', async () => {
        const h = harness({ slots: ['last'] });
        h.session.setMode(true);
        h.pressV();
        await h.settle(5);
        expect(h.session.isModeOn()).toBe(false); // plugin already turned it off
        h.releaseV();
        await h.settle();
        expect(h.pasted).toEqual(['last']);
        expect(h.calls).toEqual(['register', 'request', 'write:last', 'unregister', 'inject']);
        expect(h.session.getState()).toBe('off');
    });

    it('mode off while waiting for V release: the paste completes after release, no re-register, no key-ups', async () => {
        const h = harness({ slots: ['a', 'b'] });
        h.session.setMode(true);
        h.pressV();
        await h.settle(5);
        expect(h.session.getState()).toBe('waitingRelease');
        h.session.setMode(false);
        expect(h.isRegistered()).toBe(true); // still swallowing key repeats of the held press
        h.repeatV();
        h.releaseV();
        await h.settle();
        expect(h.pasted).toEqual(['a']);
        expect(h.calls.filter((c) => c === 'register')).toHaveLength(1);
        expect(h.calls.filter((c) => c === 'inject')).toHaveLength(1);
        expect(h.session.getState()).toBe('off');
    });

    it('mode off before the plugin answered: the late answer is not pasted (T-037)', async () => {
        const h = harness({ answer: false });
        h.session.setMode(true);
        await h.tap();
        h.session.setMode(false);
        expect(h.calls.at(-1)).toBe('unregister');
        expect(h.session.item(1, 'late')).toBe(false);
        await h.settle();
        expect(h.calls).not.toContain('inject');
    });

    it('queued presses are dropped when the mode goes off', async () => {
        const h = harness({ slots: ['a', 'b', 'c'], manualWrites: true });
        h.session.setMode(true);
        h.pressV();
        await h.settle(1);
        h.releaseV();
        await h.settle(20);
        h.pressV();
        await h.settle(1);
        h.releaseV();
        await h.settle(20);
        expect(h.session.getPending()).toBe(1);
        h.session.setMode(false);
        h.writes[0].resolve(true);
        await h.settle();
        expect(h.pasted).toEqual(['a']);
        expect(h.requests()).toBe(1);
    });
});

describe('pasteScripts', () => {
    it('key query script echoes id|1 or id|0 and accepts integers only', () => {
        const s = isKeyDownScript(12, VK_V);
        expect(s).toContain('GetAsyncKeyState(86)');
        expect(s).toContain('"12|1"');
        expect(s).toContain('"12|0"');
        expect(() => isKeyDownScript(1.5, VK_V)).toThrow();
        expect(() => isKeyDownScript(1, -1)).toThrow();
    });

    it('injection script balances Ctrl and echoes id|OK last', () => {
        const s = injectPasteScript(3);
        expect(s).toContain('$isDown = ([K]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0');
        expect(s.indexOf('keybd_event(0x56, 0, 0, 0)')).toBeLessThan(s.indexOf('keybd_event(0x56, 0, 2, 0)'));
        expect(s.trim().split('\n').at(-1)).toBe('Write-Output "3|OK"');
        expect(() => injectPasteScript(-1)).toThrow();
    });

    it('parses key replies', () => {
        expect(parseKeyDownReply('1')).toBe(true);
        expect(parseKeyDownReply('0')).toBe(false);
        expect(parseKeyDownReply(null)).toBeNull();
        expect(parseKeyDownReply('garbage')).toBeNull();
    });
});

describe('clipboard write verification helpers', () => {
    it('text matches regardless of CRLF and trailing NULs, and differs otherwise', () => {
        expect(clipboardTextMatches('a\nb', 'a\r\nb')).toBe(true);
        expect(clipboardTextMatches('abc', 'abc\u0000')).toBe(true);
        expect(clipboardTextMatches('', '')).toBe(true);
        expect(clipboardTextMatches('abc', 'abd')).toBe(false);
        expect(clipboardTextMatches('abc', '')).toBe(false);
    });

    it('image matches by signature or by pixel size, never without a read-back image', () => {
        const size = { width: 10, height: 20 };
        expect(clipboardImageMatches({ writtenSignature: 's', writtenSize: size, readBackSignature: 's', readBackSize: null })).toBe(true);
        expect(clipboardImageMatches({ writtenSignature: 's', writtenSize: size, readBackSignature: 't', readBackSize: size })).toBe(true);
        expect(
            clipboardImageMatches({
                writtenSignature: 's',
                writtenSize: size,
                readBackSignature: 't',
                readBackSize: { width: 1, height: 1 },
            })
        ).toBe(false);
        expect(clipboardImageMatches({ writtenSignature: 's', writtenSize: size, readBackSignature: null, readBackSize: size })).toBe(
            false
        );
    });
});

describe('pasteSession: repeat guard and write watchdog', () => {
    it('repeat guard: events within the window after an accepted press are ignored (key state always up)', async () => {
        const h = harness({ slots: ['a'], manualWrites: true, session: { repeatGuardMs: 150 } });
        h.session.setMode(true);
        h.session.hotkey();
        await h.settle(1);
        expect(h.session.getState()).toBe('writing');
        await h.settle(50);
        h.session.hotkey(); // autorepeat
        h.session.hotkey();
        expect(h.session.getPending()).toBe(0);
        await h.settle(150);
        h.session.hotkey(); // a new press, 200 ms after the first
        expect(h.session.getPending()).toBe(1);
    });

    it('write watchdog: a write that never settles fails after 5 s, sends write_failed and re-arms', async () => {
        const h = harness({ slots: ['a', 'b'], manualWrites: true });
        h.session.setMode(true);
        h.pressV();
        await h.settle(1);
        h.releaseV();
        expect(h.session.getState()).toBe('writing');
        await h.settle(4900);
        expect(h.session.getState()).toBe('writing');
        await h.settle(200);
        expect(h.calls).toContain('error');
        expect(h.session.getState()).toBe('armed');
        expect(h.isRegistered()).toBe(true);
        expect(h.calls).not.toContain('inject');
    });

    it('write watchdog is cleared when the write settles in time (no late error)', async () => {
        const h = harness({ slots: ['a'], manualWrites: true });
        h.session.setMode(true);
        h.pressV();
        await h.settle(1);
        h.releaseV();
        h.writes[0].resolve(true);
        await h.settle(10000);
        expect(h.calls).not.toContain('error');
        expect(h.pasted).toEqual(['a']);
    });
});
