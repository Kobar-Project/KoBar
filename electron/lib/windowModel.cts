// Window model A (T-321, ARC-02, decision K16): on Windows the transparent main window covers exactly the ACTIVE display (the
// display the bar lives on) instead of a fixed 6000x4000 "ghost" window. This module is the pure part: which display is active,
// which bounds the window gets, and whether a re-fit changes anything. No Electron import; unit tested in tests/windowModel.test.ts
// with fake displays. All rectangles are Electron DIP rectangles (Display.bounds / Display.workArea and BrowserWindow bounds are
// all DIP), so no DIP <-> physical conversion happens here.

export interface WindowRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WindowPoint {
    x: number;
    y: number;
}

/** The Electron.Display fields the window model reads. */
export interface DisplayLike {
    id: number;
    bounds: WindowRect;
    workArea: WindowRect;
    scaleFactor: number;
}

/** The geometry of the main window when it is fitted to one display (window-relative size and centre plus the display, in DIP). */
export interface WindowModelGeometry {
    displayId: number;
    /** The display's bounds in screen DIP coordinates; the window's bounds equal this rectangle. */
    displayBounds: WindowRect;
    /** The display's work area (without the taskbar) in screen DIP coordinates. */
    workArea: WindowRect;
    scaleFactor: number;
    /** Window size = display size. */
    width: number;
    height: number;
    /** Window-relative centre (half the size). */
    centerX: number;
    centerY: number;
}

export interface PickActiveDisplayInput<D extends DisplayLike = DisplayLike> {
    displays: readonly D[];
    /** A screen point on the bar/widget (or the window centre); wins when given and finite. */
    barPoint?: WindowPoint | null;
    /** The display the window is fitted to now; used while it still exists. */
    lastDisplayId?: number | null;
    /** The window's centre; used when the last display is gone (e.g. Windows moved the window off a removed display). */
    windowPoint?: WindowPoint | null;
    /** The cursor position; used when the bar position, the last display and the window position are unknown. */
    cursorPoint?: WindowPoint | null;
    /** The primary display's id; the last resort before the first display. */
    primaryId?: number | null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(point: WindowPoint | null | undefined): point is WindowPoint {
    return !!point && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/** A rectangle with finite coordinates and a positive, finite size. */
export function isUsableRect(rect: WindowRect | null | undefined): rect is WindowRect {
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

/** A display the window can be fitted to (usable bounds and work area). */
export function isUsableDisplay(display: DisplayLike | null | undefined): display is DisplayLike {
    return !!display && isUsableRect(display.bounds) && isUsableRect(display.workArea);
}

export function rectsEqual(a: WindowRect | null | undefined, b: WindowRect | null | undefined): boolean {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Right/bottom edges are exclusive, like Electron's own display lookup. */
export function rectContainsPoint(rect: WindowRect, point: WindowPoint): boolean {
    return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

/** Squared distance from the point to the rectangle (0 inside). */
function distanceSquared(rect: WindowRect, point: WindowPoint): number {
    const dx = point.x < rect.x ? rect.x - point.x : point.x >= rect.x + rect.width ? point.x - (rect.x + rect.width - 1) : 0;
    const dy = point.y < rect.y ? rect.y - point.y : point.y >= rect.y + rect.height ? point.y - (rect.y + rect.height - 1) : 0;
    return dx * dx + dy * dy;
}

/** The display containing the point, else the nearest one (like screen.getDisplayNearestPoint); null when none is usable. */
export function findDisplayNearestPoint<D extends DisplayLike>(displays: readonly D[], point: WindowPoint): D | null {
    let best: D | null = null;
    let bestDistance = Infinity;
    for (const display of displays) {
        if (!isUsableDisplay(display)) continue;
        const distance = distanceSquared(display.bounds, point);
        if (distance < bestDistance) {
            best = display;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * The active display: the one under `barPoint` (nearest when between displays), else the last fitted display while it still exists,
 * else the one under the window centre, else the one under the cursor, else the primary, else the first usable one. Null only when
 * no display is usable.
 */
export function pickActiveDisplay<D extends DisplayLike>(input: PickActiveDisplayInput<D>): D | null {
    const displays = (input.displays ?? []).filter((d): d is D => isUsableDisplay(d));
    if (displays.length === 0) return null;
    if (isFinitePoint(input.barPoint)) {
        const byBar = findDisplayNearestPoint(displays, input.barPoint);
        if (byBar) return byBar;
    }
    if (isFiniteNumber(input.lastDisplayId)) {
        const last = displays.find((d) => d.id === input.lastDisplayId);
        if (last) return last;
    }
    if (isFinitePoint(input.windowPoint)) {
        const byWindow = findDisplayNearestPoint(displays, input.windowPoint);
        if (byWindow) return byWindow;
    }
    if (isFinitePoint(input.cursorPoint)) {
        const byCursor = findDisplayNearestPoint(displays, input.cursorPoint);
        if (byCursor) return byCursor;
    }
    if (isFiniteNumber(input.primaryId)) {
        const primary = displays.find((d) => d.id === input.primaryId);
        if (primary) return primary;
    }
    return displays[0];
}

function roundRect(rect: WindowRect): WindowRect {
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

/** The main window's bounds for a display: exactly the display's bounds (DIP, whole pixels). */
export function fitBoundsToDisplay(display: DisplayLike): WindowRect {
    return roundRect(display.bounds);
}

/** The window model for a display (what `get-window-geometry` and `window-geometry-changed` report). */
export function geometryForDisplay(display: DisplayLike): WindowModelGeometry {
    const bounds = fitBoundsToDisplay(display);
    return {
        displayId: display.id,
        displayBounds: bounds,
        workArea: roundRect(display.workArea),
        scaleFactor: isFiniteNumber(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1,
        width: bounds.width,
        height: bounds.height,
        centerX: Math.floor(bounds.width / 2),
        centerY: Math.floor(bounds.height / 2),
    };
}

export function geometriesEqual(a: WindowModelGeometry | null | undefined, b: WindowModelGeometry | null | undefined): boolean {
    if (!a || !b) return false;
    return (
        a.displayId === b.displayId &&
        rectsEqual(a.displayBounds, b.displayBounds) &&
        rectsEqual(a.workArea, b.workArea) &&
        a.scaleFactor === b.scaleFactor &&
        a.width === b.width &&
        a.height === b.height &&
        a.centerX === b.centerX &&
        a.centerY === b.centerY
    );
}

export interface WindowFitPlan {
    /** The bounds the window must have. */
    target: WindowRect;
    /** The model after the fit. */
    geometry: WindowModelGeometry;
    /** False when the window already has exactly the target bounds (no setBounds call needed). */
    needsSetBounds: boolean;
    /** True when the model differs from the previous one (the renderer must be told). */
    geometryChanged: boolean;
}

/** What fitting the window to `display` would do, given the window's current bounds and the previous model. */
export function planWindowFit(
    currentBounds: WindowRect | null | undefined,
    previous: WindowModelGeometry | null | undefined,
    display: DisplayLike
): WindowFitPlan {
    const geometry = geometryForDisplay(display);
    const target = geometry.displayBounds;
    return {
        target,
        geometry,
        needsSetBounds: !rectsEqual(currentBounds, target),
        geometryChanged: !geometriesEqual(previous, geometry),
    };
}

/** The centre of a rectangle (rounded down), e.g. the window centre used as the bar point after a move. */
export function rectCenter(rect: WindowRect): WindowPoint {
    return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) };
}
