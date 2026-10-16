// R-04: the main-bar always-on-top keeper (electron/lib/topmostKeeper.cts). No Electron, fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTopmostKeeper, type TopmostWindowLike } from '../electron/lib/topmostKeeper.cjs';

function fakeWindow(over: Partial<{ destroyed: boolean; visible: boolean; minimized: boolean }> = {}) {
    const state = { destroyed: false, visible: true, minimized: false, ...over };
    const calls: string[] = [];
    const win: TopmostWindowLike = {
        isDestroyed: () => state.destroyed,
        isVisible: () => state.visible,
        isMinimized: () => state.minimized,
        setAlwaysOnTop: (flag, level, rel) => {
            calls.push(`aot:${flag}:${level}:${rel}`);
        },
        moveTop: () => {
            calls.push('moveTop');
        },
    };
    return { win, calls };
}

describe('createTopmostKeeper', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-asserts the level and raises the window without focusing', () => {
        const { win, calls } = fakeWindow();
        const k = createTopmostKeeper({ getWindow: () => win, level: 'screen-saver' });
        expect(k.assertNow('t')).toBe(true);
        expect(calls).toEqual(['aot:true:screen-saver:1', 'moveTop']);
    });

    it('runs afterAssert only when the window was actually re-asserted', () => {
        const after = vi.fn();
        const shown = fakeWindow();
        createTopmostKeeper({ getWindow: () => shown.win, level: 'screen-saver', afterAssert: after }).assertNow('t');
        expect(after).toHaveBeenCalledTimes(1);
        const hidden = fakeWindow({ visible: false });
        createTopmostKeeper({ getWindow: () => hidden.win, level: 'screen-saver', afterAssert: after }).assertNow('t');
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('debounces bursts into one assertion', () => {
        const { win, calls } = fakeWindow();
        const k = createTopmostKeeper({ getWindow: () => win, level: 'screen-saver', debounceMs: 100 });
        k.request('a');
        k.request('b');
        k.request('c');
        vi.advanceTimersByTime(99);
        expect(calls).toHaveLength(0);
        vi.advanceTimersByTime(2);
        expect(calls).toHaveLength(2);
    });

    it('does nothing for missing, destroyed, hidden or minimized windows', () => {
        for (const over of [{ destroyed: true }, { visible: false }, { minimized: true }]) {
            const { win, calls } = fakeWindow(over);
            expect(createTopmostKeeper({ getWindow: () => win, level: 'floating' }).assertNow('t')).toBe(false);
            expect(calls).toHaveLength(0);
        }
        expect(createTopmostKeeper({ getWindow: () => null, level: 'floating' }).assertNow('t')).toBe(false);
    });

    it('honours shouldSkip', () => {
        const { win, calls } = fakeWindow();
        const k = createTopmostKeeper({ getWindow: () => win, level: 'floating', shouldSkip: () => true });
        expect(k.assertNow('t')).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('swallows window errors and logs them', () => {
        const log = vi.fn();
        const win: TopmostWindowLike = {
            ...fakeWindow().win,
            moveTop: () => {
                throw new Error('boom');
            },
        };
        const k = createTopmostKeeper({ getWindow: () => win, level: 'floating', log });
        expect(k.assertNow('t')).toBe(false);
        expect(log).toHaveBeenCalled();
    });

    it('safety interval runs periodically, start is idempotent, stop ends it', () => {
        const { win, calls } = fakeWindow();
        const k = createTopmostKeeper({ getWindow: () => win, level: 'screen-saver', safetyIntervalMs: 1000 });
        k.start();
        k.start();
        vi.advanceTimersByTime(3000);
        expect(calls.filter((c) => c === 'moveTop')).toHaveLength(3);
        k.stop();
        vi.advanceTimersByTime(3000);
        expect(calls.filter((c) => c === 'moveTop')).toHaveLength(3);
    });

    it('interval 0 disables the safety timer', () => {
        const { win, calls } = fakeWindow();
        const k = createTopmostKeeper({ getWindow: () => win, level: 'screen-saver', safetyIntervalMs: 0 });
        k.start();
        vi.advanceTimersByTime(100000);
        expect(calls).toHaveLength(0);
    });
});
