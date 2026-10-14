import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as geometry from '../shared/geometry';
import {
    WINDOW_GEOMETRY_FALLBACK,
    getWindowGeometry,
    refreshWindowGeometry,
    resetWindowGeometryCacheForTests,
    subscribeWindowGeometry,
} from '../src/utils/windowGeometry';
import { installWindowApiMock } from './helpers/windowApi';

// T-320: the renderer reads the window model from main once (sync IPC `get-window-geometry`) and caches it. The fallback for
// test / non-Electron environments must be exactly the shared/geometry.ts values main answers with.

const FROM_SHARED = {
    width: geometry.GHOST_WINDOW_WIDTH,
    height: geometry.GHOST_WINDOW_HEIGHT,
    centerX: geometry.GHOST_WINDOW_CENTER_X,
    centerY: geometry.GHOST_WINDOW_CENTER_Y,
    fallbackScreenWidth: geometry.FALLBACK_SCREEN_WIDTH,
    fallbackScreenHeight: geometry.FALLBACK_SCREEN_HEIGHT,
};

/** A full main answer (T-321 added the active display; T-322 copies it into the cache too). */
const DISPLAY = { x: 0, y: 0, width: geometry.GHOST_WINDOW_WIDTH, height: geometry.GHOST_WINDOW_HEIGHT };
const FROM_MAIN = { ...FROM_SHARED, displayId: 1, displayBounds: DISPLAY, workArea: DISPLAY, scaleFactor: 1 };

describe('getWindowGeometry (T-320)', () => {
    beforeEach(() => resetWindowGeometryCacheForTests());
    afterEach(() => {
        resetWindowGeometryCacheForTests();
        vi.restoreAllMocks();
    });

    it('the built-in fallback equals the shared/geometry.ts window model', () => {
        expect({ ...WINDOW_GEOMETRY_FALLBACK }).toEqual(FROM_SHARED);
        expect(Object.isFrozen(WINDOW_GEOMETRY_FALLBACK)).toBe(true);
    });

    it('reads the geometry from main once, synchronously, and caches it', () => {
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, centerX: 1234 });
        const first = getWindowGeometry();
        expect(first.centerX).toBe(1234);
        expect(getWindowGeometry()).toBe(first);
        expect(api.getWindowGeometry).toHaveBeenCalledTimes(1);
    });

    it('the test helper mock answers like main (shared/geometry values)', () => {
        installWindowApiMock();
        expect({ ...getWindowGeometry() }).toEqual(FROM_MAIN);
    });

    it('falls back to the built-in values when window.api has no getWindowGeometry (non-Electron)', () => {
        const api = installWindowApiMock() as unknown as Record<string, unknown>;
        delete api.getWindowGeometry;
        expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);
    });

    it('falls back (with a warning) when main refuses the sender or answers garbage', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue(null);
        expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);

        resetWindowGeometryCacheForTests();
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, width: Number.NaN });
        expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);

        resetWindowGeometryCacheForTests();
        api.getWindowGeometry.mockImplementation(() => {
            throw new Error('no handler');
        });
        expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('refreshWindowGeometry() makes the next read ask main again (T-321)', () => {
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, width: 1920, centerX: 960 });
        expect(getWindowGeometry().centerX).toBe(960);
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, width: 2560, centerX: 1280 });
        expect(getWindowGeometry().centerX).toBe(960);
        refreshWindowGeometry();
        expect(getWindowGeometry()).toMatchObject({ width: 2560, centerX: 1280 });
        expect(api.getWindowGeometry).toHaveBeenCalledTimes(2);
    });

    it('returns only the known fields (layout + active display), frozen', () => {
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, extra: 1 } as typeof FROM_MAIN);
        const value = getWindowGeometry();
        expect({ ...value }).toEqual(FROM_MAIN);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.displayBounds)).toBe(true);
    });

    it('drops unusable display rectangles from the first read but keeps the layout fields (T-322)', () => {
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue({ ...FROM_MAIN, workArea: { x: 0, y: 0, width: 0, height: 10 } });
        expect({ ...getWindowGeometry() }).toEqual(FROM_SHARED);
    });
});

describe('live window geometry (T-322)', () => {
    type Listener = Parameters<Window['api']['onWindowGeometryChanged']>[0];
    const fitted = (x: number, y: number, width: number, height: number) => ({
        width,
        height,
        centerX: Math.floor(width / 2),
        centerY: Math.floor(height / 2),
        fallbackScreenWidth: geometry.FALLBACK_SCREEN_WIDTH,
        fallbackScreenHeight: geometry.FALLBACK_SCREEN_HEIGHT,
        displayId: x + 1,
        displayBounds: { x, y, width, height },
        workArea: { x, y, width, height: height - 40 },
        scaleFactor: 1,
    });

    function setup() {
        const api = installWindowApiMock();
        api.getWindowGeometry.mockReturnValue(fitted(0, 0, 1920, 1080));
        let emit: Listener = () => {
            throw new Error('not subscribed');
        };
        const unsubscribe = vi.fn();
        api.onWindowGeometryChanged.mockImplementation((callback) => {
            emit = callback;
            return unsubscribe;
        });
        return { api, emit: (value: unknown) => emit(value as never), unsubscribe };
    }

    beforeEach(() => resetWindowGeometryCacheForTests());
    afterEach(() => {
        resetWindowGeometryCacheForTests();
        vi.restoreAllMocks();
    });

    it('subscribes to main once and updates the cache on window-geometry-changed', () => {
        const { api, emit } = setup();
        const first = getWindowGeometry();
        getWindowGeometry();
        expect(api.onWindowGeometryChanged).toHaveBeenCalledTimes(1);
        expect(getWindowGeometry()).toBe(first);

        emit(fitted(1920, -200, 2560, 1440));
        const next = getWindowGeometry();
        expect(next).not.toBe(first);
        expect(next).toMatchObject({ width: 2560, height: 1440, centerX: 1280, displayBounds: { x: 1920, y: -200 } });
        expect(Object.isFrozen(next)).toBe(true);
        expect(getWindowGeometry()).toBe(next);
        expect(api.getWindowGeometry).toHaveBeenCalledTimes(1);
    });

    it('notifies subscribers with (next, prev) and stops after unsubscribe', () => {
        const { emit } = setup();
        const listener = vi.fn();
        const unsubscribe = subscribeWindowGeometry(listener);
        const prev = getWindowGeometry();
        emit(fitted(0, 0, 1536, 864));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]).toBe(getWindowGeometry());
        expect(listener.mock.calls[0][1]).toBe(prev);

        unsubscribe();
        emit(fitted(0, 0, 1280, 720));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getWindowGeometry().width).toBe(1280);
    });

    it('ignores an identical geometry (no notification, same object)', () => {
        const { emit } = setup();
        const listener = vi.fn();
        subscribeWindowGeometry(listener);
        const before = getWindowGeometry();
        emit(fitted(0, 0, 1920, 1080));
        expect(listener).not.toHaveBeenCalled();
        expect(getWindowGeometry()).toBe(before);
    });

    it('keeps the previous good geometry on an invalid payload', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { emit } = setup();
        const listener = vi.fn();
        subscribeWindowGeometry(listener);
        const before = getWindowGeometry();
        emit(null);
        emit({ ...fitted(0, 0, 1280, 720), width: Number.POSITIVE_INFINITY });
        emit({ ...fitted(0, 0, 1280, 720), displayBounds: undefined });
        emit({ ...fitted(0, 0, 1280, 720), workArea: { x: 0, y: 0, width: Number.NaN, height: 700 } });
        expect(getWindowGeometry()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(4);
    });

    it('a throwing listener does not stop the others', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { emit } = setup();
        const second = vi.fn();
        subscribeWindowGeometry(() => {
            throw new Error('boom');
        });
        subscribeWindowGeometry(second);
        emit(fitted(0, 0, 1280, 720));
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('refreshWindowGeometry() notifies when main has a newer model, and keeps the old one on a bad answer', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { api } = setup();
        const listener = vi.fn();
        subscribeWindowGeometry(listener);
        api.getWindowGeometry.mockReturnValue(fitted(1920, 0, 2560, 1440));
        refreshWindowGeometry();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getWindowGeometry().width).toBe(2560);

        api.getWindowGeometry.mockReturnValue(null);
        refreshWindowGeometry();
        expect(getWindowGeometry().width).toBe(2560);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('without window.api the fallback stays and subscribing is harmless', () => {
        const original = window.api;
        try {
            (window as unknown as { api?: unknown }).api = undefined;
            const listener = vi.fn();
            const unsubscribe = subscribeWindowGeometry(listener);
            expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);
            refreshWindowGeometry();
            expect(getWindowGeometry()).toBe(WINDOW_GEOMETRY_FALLBACK);
            expect(listener).not.toHaveBeenCalled();
            unsubscribe();
        } finally {
            window.api = original;
        }
    });

    it('the test reset drops the main subscription', () => {
        const { unsubscribe } = setup();
        getWindowGeometry();
        resetWindowGeometryCacheForTests();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
