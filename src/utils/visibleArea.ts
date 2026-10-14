import type { WindowGeometry } from './windowGeometry';

/*
 * T-322 (window model A, renderer side): the usable screen rectangle (the active display's work area, i.e. without the taskbar) in
 * WINDOW coordinates, the coordinate space of the bar, the mini-mode eye and the panels (CSS left/top inside the main window).
 *
 * Windows, model A: the window covers the active display, so its origin is the display's origin and
 *     left = workArea.x - displayBounds.x, top = workArea.y - displayBounds.y (right/bottom analogously).
 * This also gives the taskbar-at-top/left offset. All values are DIP (Electron's display rectangles and window bounds are DIP),
 * so the display scale factor plays no part.
 *
 * Without display information (the built-in fallback geometry: tests, a plain browser) the legacy ghost-window arithmetic is kept:
 * the visible area is centred on the window's centreX, starts at y=0 and has the reported screen size (or the fallback size).
 *
 * macOS never comes here: its branches keep using window.innerWidth / screenBounds as before.
 *
 * Plugin contract v1: this module does NOT change `screenBounds` (the work area in screen coordinates that main reports and plugins
 * read); it only replaces the host's own ghost-window layout arithmetic.
 */

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

/** A rectangle in window coordinates (CSS pixels inside the main window). */
export interface VisibleArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isUsableRect(rect: Rect | null | undefined): rect is Rect {
    return (
        !!rect &&
        isFiniteNumber(rect.x) &&
        isFiniteNumber(rect.y) &&
        isFiniteNumber(rect.width) &&
        isFiniteNumber(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
    );
}

function isFinitePoint(point: Point | null | undefined): point is Point {
    return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

function areaFromEdges(left: number, top: number, right: number, bottom: number): VisibleArea {
    const width = right - left;
    const height = bottom - top;
    return { left, top, right, bottom, width, height, centerX: left + width / 2, centerY: top + height / 2 };
}

/**
 * The work area (screen coordinates) relative to a window origin (screen coordinates). With `windowSize` the result is clamped to
 * the window rectangle [0, width] x [0, height]; when that leaves nothing (a work area outside the window) the whole window is used.
 * Null when an input is not finite/usable.
 */
export function visibleAreaFromWorkArea(
    workArea: Rect | null | undefined,
    windowOrigin: Point | null | undefined,
    windowSize?: { width: number; height: number } | null
): VisibleArea | null {
    if (!isUsableRect(workArea) || !isFinitePoint(windowOrigin)) return null;
    let left = workArea.x - windowOrigin.x;
    let top = workArea.y - windowOrigin.y;
    let right = left + workArea.width;
    let bottom = top + workArea.height;
    if (
        windowSize &&
        isFiniteNumber(windowSize.width) &&
        isFiniteNumber(windowSize.height) &&
        windowSize.width > 0 &&
        windowSize.height > 0
    ) {
        left = Math.max(0, left);
        top = Math.max(0, top);
        right = Math.min(windowSize.width, right);
        bottom = Math.min(windowSize.height, bottom);
        if (right - left < 1 || bottom - top < 1) return areaFromEdges(0, 0, windowSize.width, windowSize.height);
    }
    return areaFromEdges(left, top, right, bottom);
}

/** Same edges (the other fields derive from them). */
export function sameVisibleArea(a: VisibleArea, b: VisibleArea): boolean {
    return Object.is(a.left, b.left) && Object.is(a.top, b.top) && Object.is(a.right, b.right) && Object.is(a.bottom, b.bottom);
}

/** True when the geometry carries the active display (window model A): the window origin is then the display's origin. */
export function hasDisplayInfo(
    geometry: WindowGeometry
): geometry is WindowGeometry & Required<Pick<WindowGeometry, 'displayBounds' | 'workArea'>> {
    return isUsableRect(geometry.displayBounds) && isUsableRect(geometry.workArea);
}

/**
 * The usable screen rectangle in window coordinates (non-macOS layout). `screenSize` (the store's `screenBounds`) only matters for
 * the legacy fallback without display information. Always finite.
 */
export function computeVisibleArea(geometry: WindowGeometry, screenSize?: { width: number; height: number } | null): VisibleArea {
    if (hasDisplayInfo(geometry)) {
        const area = visibleAreaFromWorkArea(geometry.workArea, geometry.displayBounds, { width: geometry.width, height: geometry.height });
        if (area) return area;
    }
    const width = screenSize && isFiniteNumber(screenSize.width) && screenSize.width > 0 ? screenSize.width : geometry.fallbackScreenWidth;
    const height =
        screenSize && isFiniteNumber(screenSize.height) && screenSize.height > 0 ? screenSize.height : geometry.fallbackScreenHeight;
    const left = geometry.centerX - width / 2;
    return areaFromEdges(left, 0, left + width, height);
}

/**
 * The usable screen rectangle in SCREEN coordinates (what `screenBounds` holds): `screenBounds` when main has reported it, else the
 * live geometry's work area (non-macOS), else the fallback size at the origin (the values the code used before T-322).
 */
export function usableScreenRect(geometry: WindowGeometry, screenBounds: Rect | null | undefined, isMac: boolean): Rect {
    if (screenBounds) {
        return {
            x: screenBounds.x ?? 0,
            y: screenBounds.y ?? 0,
            width: screenBounds.width ?? geometry.fallbackScreenWidth,
            height: screenBounds.height ?? geometry.fallbackScreenHeight,
        };
    }
    if (!isMac && hasDisplayInfo(geometry)) return { ...geometry.workArea };
    return { x: 0, y: 0, width: geometry.fallbackScreenWidth, height: geometry.fallbackScreenHeight };
}

/**
 * Where the window must be (screen coordinates) for the bar to live on `display` while dragging (non-macOS): model A covers the
 * display, so its origin; the legacy ghost window was centred on the work area at its top. Null for an unusable display.
 */
export function windowOriginForDisplay(
    display: { bounds: Rect; workArea: Rect } | null | undefined,
    geometry: WindowGeometry
): Point | null {
    if (!display || !isUsableRect(display.bounds) || !isUsableRect(display.workArea)) return null;
    if (hasDisplayInfo(geometry)) return { x: Math.round(display.bounds.x), y: Math.round(display.bounds.y) };
    return { x: Math.floor(display.workArea.x + display.workArea.width / 2 - geometry.width / 2), y: display.workArea.y };
}

/** The mini-mode eye's "teleport to centre" position (non-macOS): the centre of the visible area. */
export function centeredEyePosition(area: VisibleArea): Point {
    return { x: Math.floor(area.centerX), y: Math.floor(area.centerY) };
}

/**
 * The eye's default position when the store has none (non-macOS): near the docked edge, vertically at the visible centre below the
 * bar's 20px top offset (the arithmetic FloatingEye used before, now relative to the visible area's top).
 */
export function defaultEyePosition(area: VisibleArea, edgePosition: string): Point {
    return {
        x: edgePosition === 'left' ? area.left + 60 : area.right - 60,
        y: area.top + 20 + area.height / 2,
    };
}

function clamp(value: number, min: number, max: number): number {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

/** Within this distance (px) of a visible edge the bar counts as snapped to it, and is re-snapped to the same edge after a change. */
export const EDGE_SNAP_EPSILON = 2;

/**
 * One axis of a box (start, size) after the visible area changed from [prevStart, prevEnd] to [nextStart, nextEnd]: a box snapped to
 * an edge of the old range stays snapped to the same edge of the new one; any other box is clamped into the new range (to its start
 * when the box is larger than the range).
 */
function reconcileAxis(
    start: number,
    size: number,
    prevStart: number | null,
    prevEnd: number | null,
    nextStart: number,
    nextEnd: number
): number {
    if (prevStart !== null && prevEnd !== null) {
        if (Math.abs(start - prevStart) <= EDGE_SNAP_EPSILON) return nextStart;
        if (Math.abs(start + size - prevEnd) <= EDGE_SNAP_EPSILON) return clamp(nextEnd - size, nextStart, nextEnd);
    }
    return clamp(start, nextStart, nextEnd - size);
}

/**
 * The bar's free-floating position (top-left, window coordinates) after the visible area changed (`prev` null: unknown, just clamp).
 * Returns the input object when nothing changes. Non-finite input is returned unchanged (nothing to reason about).
 */
export function reconcileBarPosition(
    pos: Point,
    size: { width: number; height: number },
    prev: VisibleArea | null,
    next: VisibleArea
): Point {
    if (!isFinitePoint(pos)) return pos;
    const width = isFiniteNumber(size.width) && size.width > 0 ? size.width : 0;
    const height = isFiniteNumber(size.height) && size.height > 0 ? size.height : 0;
    const x = reconcileAxis(pos.x, width, prev?.left ?? null, prev?.right ?? null, next.left, next.right);
    const y = reconcileAxis(pos.y, height, prev?.top ?? null, prev?.bottom ?? null, next.top, next.bottom);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return pos;
    return x === pos.x && y === pos.y ? pos : { x, y };
}

/** The eye's centre (window coordinates) clamped into the visible area, keeping `halfSize` px of the eye on screen. */
export function clampEyePosition(pos: Point, halfSize: number, area: VisibleArea): Point {
    if (!isFinitePoint(pos)) return pos;
    const half = isFiniteNumber(halfSize) && halfSize > 0 ? halfSize : 0;
    const x = clamp(pos.x, area.left + half, area.right - half);
    const y = clamp(pos.y, area.top + half, area.bottom - half);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return pos;
    return x === pos.x && y === pos.y ? pos : { x, y };
}
