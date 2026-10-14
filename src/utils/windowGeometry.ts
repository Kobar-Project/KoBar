import { useSyncExternalStore } from 'react';
import type { IpcRectangle, IpcWindowGeometry } from '../../shared/ipc-contract';

/*
 * T-320: the window model (window size and centre, fallback screen size) comes from the main process, which owns it (since T-321
 * the window covers the active display on Windows, see electron/main/windows/mainWindow.cts). The first read is synchronous
 * (`window.api.getWindowGeometry()` is an `ipcRenderer.sendSync`, like `getWindowPositionSync`), so the first render gets the values
 * exactly when it got the old module constants: nothing waits on async IPC.
 *
 * T-322: the cache is live. Main announces every re-fit with `window.api.onWindowGeometryChanged`; this module listens once, replaces
 * the cached object and notifies `subscribeWindowGeometry` listeners. Between two events `getWindowGeometry()` returns the same
 * frozen object (a stable snapshot for useSyncExternalStore). An invalid payload is ignored: the previous good geometry stays.
 *
 * Renderer code must take these numbers from `getWindowGeometry()` and never import shared/geometry.ts (tests/geometry.test.ts
 * checks this). Window-relative visible area: src/utils/visibleArea.ts.
 */

type LayoutKey = 'width' | 'height' | 'centerX' | 'centerY' | 'fallbackScreenWidth' | 'fallbackScreenHeight';

/**
 * The fields the renderer layout reads. The active display (T-321) is optional: the built-in fallback has none, and the layout then
 * keeps the legacy ghost-window arithmetic (src/utils/visibleArea.ts).
 */
export type WindowGeometry = Pick<IpcWindowGeometry, LayoutKey> &
    Partial<Pick<IpcWindowGeometry, 'displayId' | 'displayBounds' | 'workArea' | 'scaleFactor'>>;

/**
 * Used only when `window.api.getWindowGeometry` does not exist (vitest's node/jsdom environments, a plain browser) or, as a
 * defensive net that the app never hits, when main does not answer with a valid geometry (it answers `null` to a sender other
 * than the main window's top frame). These are the shared/geometry.ts values the renderer used before T-320
 * (GHOST_WINDOW_WIDTH/HEIGHT, GHOST_WINDOW_CENTER_X/Y, FALLBACK_SCREEN_WIDTH/HEIGHT); tests/windowGeometry.dom.test.ts pins
 * them equal, so the two cannot drift.
 */
export const WINDOW_GEOMETRY_FALLBACK: Readonly<WindowGeometry> = Object.freeze({
    width: 6000,
    height: 4000,
    centerX: 3000,
    centerY: 2000,
    fallbackScreenWidth: 1920,
    fallbackScreenHeight: 800,
});

const KEYS = ['width', 'height', 'centerX', 'centerY', 'fallbackScreenWidth', 'fallbackScreenHeight'] as const;

export type WindowGeometryListener = (next: Readonly<WindowGeometry>, prev: Readonly<WindowGeometry>) => void;

let cached: Readonly<WindowGeometry> | null = null;
const listeners = new Set<WindowGeometryListener>();
let unsubscribeMain: (() => void) | null = null;

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** A rectangle with finite coordinates and a positive, finite size. */
export function isUsableRectangle(value: unknown): value is IpcRectangle {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    return isFiniteNumber(r.x) && isFiniteNumber(r.y) && isPositiveFinite(r.width) && isPositiveFinite(r.height);
}

function hasLayoutFields(value: unknown): value is Record<LayoutKey, number> {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return KEYS.every((key) => isPositiveFinite(record[key]));
}

function copyRect(rect: IpcRectangle): IpcRectangle {
    return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

/**
 * A frozen copy of the known fields, or null when the layout fields are unusable. `requireDisplay`: the display rectangles must be
 * usable too (events always carry them); otherwise unusable display fields are dropped and the layout falls back to the legacy
 * arithmetic.
 */
function sanitize(value: unknown, requireDisplay: boolean): Readonly<WindowGeometry> | null {
    if (!hasLayoutFields(value)) return null;
    const record = value as Record<string, unknown>;
    const geometry = {} as WindowGeometry;
    for (const key of KEYS) geometry[key] = record[key] as number;
    const hasDisplay = isUsableRectangle(record.displayBounds) && isUsableRectangle(record.workArea);
    if (hasDisplay) {
        geometry.displayBounds = copyRect(record.displayBounds as IpcRectangle);
        geometry.workArea = copyRect(record.workArea as IpcRectangle);
        if (isFiniteNumber(record.displayId)) geometry.displayId = record.displayId;
        geometry.scaleFactor = isPositiveFinite(record.scaleFactor) ? record.scaleFactor : 1;
    } else if (requireDisplay) {
        return null;
    }
    return Object.freeze(geometry);
}

function sameRect(a: IpcRectangle | undefined, b: IpcRectangle | undefined): boolean {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameGeometry(a: Readonly<WindowGeometry>, b: Readonly<WindowGeometry>): boolean {
    return (
        KEYS.every((key) => a[key] === b[key]) &&
        a.displayId === b.displayId &&
        a.scaleFactor === b.scaleFactor &&
        sameRect(a.displayBounds, b.displayBounds) &&
        sameRect(a.workArea, b.workArea)
    );
}

function getApi(): Partial<Window['api']> | undefined {
    return typeof window === 'undefined' ? undefined : (window.api as Partial<Window['api']> | undefined);
}

/** Reads main's current model; null when there is no bridge or the answer is unusable (warned, unless there is no bridge). */
function readFromMain(): Readonly<WindowGeometry> | null {
    const api = getApi();
    if (typeof api?.getWindowGeometry !== 'function') return null;
    try {
        const geometry = sanitize(api.getWindowGeometry(), false);
        if (geometry) return geometry;
        console.warn('[KoBar] window geometry from main is not usable; keeping the previous/built-in values');
    } catch (err) {
        console.warn('[KoBar] window geometry could not be read from main; keeping the previous/built-in values', err);
    }
    return null;
}

/** Replaces the cache when `next` differs, then notifies the listeners (a throwing listener does not stop the others). */
function commit(next: Readonly<WindowGeometry>): void {
    const prev = getWindowGeometry();
    if (sameGeometry(prev, next)) return;
    cached = next;
    for (const listener of [...listeners]) {
        try {
            listener(next, prev);
        } catch (err) {
            console.warn('[KoBar] window geometry listener failed', err);
        }
    }
}

function handleGeometryEvent(payload: unknown): void {
    const next = sanitize(payload, true);
    if (!next) {
        console.warn('[KoBar] window-geometry-changed payload is not usable; keeping the previous geometry');
        return;
    }
    commit(next);
}

/** Subscribes to main's `window-geometry-changed` once (when the bridge has it). */
function ensureListening(): void {
    if (unsubscribeMain) return;
    const api = getApi();
    if (typeof api?.onWindowGeometryChanged !== 'function') return;
    try {
        const unsubscribe = api.onWindowGeometryChanged((geometry) => handleGeometryEvent(geometry));
        unsubscribeMain = typeof unsubscribe === 'function' ? unsubscribe : () => {};
    } catch (err) {
        console.warn('[KoBar] window-geometry-changed subscription failed', err);
    }
}

/** The window model: the first call reads it from main (synchronously); later calls return the cached object until main changes it. */
export function getWindowGeometry(): Readonly<WindowGeometry> {
    if (cached === null) {
        cached = readFromMain() ?? WINDOW_GEOMETRY_FALLBACK;
        ensureListening();
    }
    return cached;
}

/**
 * Calls `listener(next, prev)` after every change of the cached geometry; returns the unsubscribe function. Also makes sure the
 * main-process event is subscribed.
 */
export function subscribeWindowGeometry(listener: WindowGeometryListener): () => void {
    getWindowGeometry();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React hook: the current window geometry; re-renders the component when main re-fits the window. */
export function useWindowGeometry(): Readonly<WindowGeometry> {
    return useSyncExternalStore(subscribeWindowGeometry, getWindowGeometry, getWindowGeometry);
}

/**
 * Re-reads the model from main synchronously (e.g. right after `recenterWindowOnWidget` resolved, when the re-fit event may still be
 * queued) and notifies the listeners when it changed. An unusable answer keeps the previous geometry.
 */
export function refreshWindowGeometry(): void {
    if (cached === null) {
        getWindowGeometry();
        return;
    }
    const next = readFromMain();
    if (next) commit(next);
}

/** Tests only: forget the cached geometry, the listeners and the main subscription so the next read starts from `window.api` again. */
export function resetWindowGeometryCacheForTests(): void {
    cached = null;
    listeners.clear();
    if (unsubscribeMain) {
        try {
            unsubscribeMain();
        } catch {
            // Test cleanup only.
        }
    }
    unsubscribeMain = null;
}
