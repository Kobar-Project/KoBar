import { describe, expect, it } from 'vitest';
import {
    EDGE_SNAP_EPSILON,
    centeredEyePosition,
    clampEyePosition,
    computeVisibleArea,
    defaultEyePosition,
    hasDisplayInfo,
    reconcileBarPosition,
    usableScreenRect,
    visibleAreaFromWorkArea,
    windowOriginForDisplay,
    type VisibleArea,
} from '../src/utils/visibleArea';
import { WINDOW_GEOMETRY_FALLBACK, type WindowGeometry } from '../src/utils/windowGeometry';

// T-322 (window model A, renderer): the usable screen rectangle in window coordinates. Model A: the window covers the display, so
// the visible area is the work area minus the display origin (taskbar offsets included). DIP throughout: scaleFactor plays no part.

type Rect = { x: number; y: number; width: number; height: number };

function fitted(displayBounds: Rect, workArea: Rect, scaleFactor = 1): WindowGeometry {
    return {
        width: displayBounds.width,
        height: displayBounds.height,
        centerX: Math.floor(displayBounds.width / 2),
        centerY: Math.floor(displayBounds.height / 2),
        fallbackScreenWidth: 1920,
        fallbackScreenHeight: 800,
        displayId: 1,
        displayBounds,
        workArea,
        scaleFactor,
    };
}

const edges = (a: VisibleArea) => [a.left, a.top, a.right, a.bottom];

describe('computeVisibleArea: window model A', () => {
    it('single display, taskbar at the bottom', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }));
        expect(edges(area)).toEqual([0, 0, 1920, 1040]);
        expect([area.width, area.height, area.centerX, area.centerY]).toEqual([1920, 1040, 960, 520]);
    });

    it('taskbar at the top: the area starts below it', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 40, width: 1920, height: 1040 }));
        expect(edges(area)).toEqual([0, 40, 1920, 1080]);
        expect(area.centerY).toBe(560);
    });

    it('taskbar on the left: the area starts right of it and its centre shifts', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 62, y: 0, width: 1858, height: 1080 }));
        expect(edges(area)).toEqual([62, 0, 1920, 1080]);
        expect(area.centerX).toBe(991);
    });

    it('taskbar on the right', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1858, height: 1080 }));
        expect(edges(area)).toEqual([0, 0, 1858, 1080]);
    });

    it('a secondary display with negative origin: relative to that origin, not to the primary', () => {
        const area = computeVisibleArea(
            fitted({ x: -2560, y: -360, width: 2560, height: 1440 }, { x: -2560, y: -312, width: 2560, height: 1392 })
        );
        expect(edges(area)).toEqual([0, 48, 2560, 1440]);
    });

    it('scaleFactor does not change anything (DIP in, DIP out)', () => {
        const display = { x: 1920, y: 0, width: 1536, height: 864 };
        const work = { x: 1920, y: 0, width: 1536, height: 824 };
        expect(computeVisibleArea(fitted(display, work, 1.25))).toEqual(computeVisibleArea(fitted(display, work, 1)));
        expect(computeVisibleArea(fitted(display, work, 2))).toEqual(computeVisibleArea(fitted(display, work, 1)));
    });

    it('clamps a work area that sticks out of the display to the window', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: -10, y: 1000, width: 2000, height: 500 }));
        expect(edges(area)).toEqual([0, 1000, 1920, 1080]);
    });

    it('a work area entirely outside the display falls back to the whole window', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 5000, y: 0, width: 100, height: 100 }));
        expect(edges(area)).toEqual([0, 0, 1920, 1080]);
    });

    it('every value is finite', () => {
        const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 40, width: 1920, height: 1040 }));
        expect(Object.values(area).every(Number.isFinite)).toBe(true);
    });
});

describe('computeVisibleArea: legacy fallback without display info (tests, plain browser)', () => {
    it('reproduces the old ghost-window arithmetic: centred on centerX, top 0, screen size from screenBounds', () => {
        const area = computeVisibleArea(WINDOW_GEOMETRY_FALLBACK, { width: 2560, height: 1400 });
        expect(edges(area)).toEqual([3000 - 1280, 0, 3000 + 1280, 1400]);
        expect([area.centerX, area.centerY]).toEqual([3000, 700]);
    });

    it('uses the fallback screen size when screenBounds is not known yet', () => {
        const area = computeVisibleArea(WINDOW_GEOMETRY_FALLBACK, null);
        expect(edges(area)).toEqual([3000 - 960, 0, 3000 + 960, 800]);
    });

    it('treats unusable display rectangles as missing', () => {
        const broken = { ...fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 0, height: 1040 }) };
        expect(hasDisplayInfo(broken)).toBe(false);
        expect(computeVisibleArea(broken, null).top).toBe(0);
        expect(Number.isFinite(computeVisibleArea(broken, { width: Number.NaN, height: 10 }).width)).toBe(true);
    });
});

describe('visibleAreaFromWorkArea', () => {
    it('is the work area relative to the real window origin (also for the legacy ghost window)', () => {
        // Ghost window centred on a 1920x1040 work area at its top: the same numbers the drop path computed before T-322.
        const area = visibleAreaFromWorkArea({ x: 0, y: 0, width: 1920, height: 1040 }, { x: 960 - 3000, y: 0 });
        expect(edges(area!)).toEqual([2040, 0, 3960, 1040]);
    });

    it('returns null for non-finite input', () => {
        expect(visibleAreaFromWorkArea(null, { x: 0, y: 0 })).toBeNull();
        expect(visibleAreaFromWorkArea({ x: 0, y: 0, width: 10, height: 10 }, { x: Number.NaN, y: 0 })).toBeNull();
        expect(visibleAreaFromWorkArea({ x: 0, y: 0, width: Infinity, height: 10 }, { x: 0, y: 0 })).toBeNull();
    });
});

describe('usableScreenRect (screen coordinates, the meaning of screenBounds)', () => {
    const geometry = fitted({ x: 1920, y: 0, width: 2560, height: 1440 }, { x: 1920, y: 0, width: 2560, height: 1400 });

    it('screenBounds wins when main has reported it', () => {
        expect(usableScreenRect(geometry, { x: 5, y: 6, width: 7, height: 8 }, false)).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    });

    it('otherwise the live work area (non-macOS)', () => {
        expect(usableScreenRect(geometry, null, false)).toEqual({ x: 1920, y: 0, width: 2560, height: 1400 });
    });

    it('macOS and the fallback geometry keep the old fixed fallback size', () => {
        expect(usableScreenRect(geometry, null, true)).toEqual({ x: 0, y: 0, width: 1920, height: 800 });
        expect(usableScreenRect(WINDOW_GEOMETRY_FALLBACK, null, false)).toEqual({ x: 0, y: 0, width: 1920, height: 800 });
    });
});

describe('windowOriginForDisplay (drag across displays)', () => {
    const target = { bounds: { x: 1920, y: -100, width: 2560, height: 1440 }, workArea: { x: 1920, y: -60, width: 2560, height: 1400 } };

    it('model A: the display origin', () => {
        const geometry = fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 });
        expect(windowOriginForDisplay(target, geometry)).toEqual({ x: 1920, y: -100 });
    });

    it('legacy ghost window: centred on the work area, at its top (the old formula)', () => {
        expect(windowOriginForDisplay(target, WINDOW_GEOMETRY_FALLBACK)).toEqual({ x: Math.floor(1920 + 1280 - 3000), y: -60 });
    });

    it('null for an unusable display', () => {
        expect(windowOriginForDisplay(null, WINDOW_GEOMETRY_FALLBACK)).toBeNull();
        expect(
            windowOriginForDisplay({ bounds: { x: 0, y: 0, width: 0, height: 0 }, workArea: target.workArea }, WINDOW_GEOMETRY_FALLBACK)
        ).toBeNull();
    });
});

describe('eye positions', () => {
    const area = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 40, width: 1920, height: 1040 }));

    it('centred eye: the centre of the visible area, whole pixels', () => {
        expect(centeredEyePosition(area)).toEqual({ x: 960, y: 560 });
        // Legacy fallback: exactly the old { x: centerX, y: floor(height / 2) }.
        expect(centeredEyePosition(computeVisibleArea(WINDOW_GEOMETRY_FALLBACK, { width: 1921, height: 1081 }))).toEqual({
            x: 3000,
            y: 540,
        });
    });

    it('default eye: near the docked edge, below the 20px bar offset (old formula for the fallback)', () => {
        expect(defaultEyePosition(area, 'left')).toEqual({ x: 60, y: 40 + 20 + 520 });
        expect(defaultEyePosition(area, 'right')).toEqual({ x: 1860, y: 580 });
        const legacy = computeVisibleArea(WINDOW_GEOMETRY_FALLBACK, null);
        expect(defaultEyePosition(legacy, 'left')).toEqual({ x: 3000 - 960 + 60, y: 20 + 400 });
        expect(defaultEyePosition(legacy, 'right')).toEqual({ x: 3000 + 960 - 60, y: 20 + 400 });
    });

    it('clampEyePosition keeps the eye inside, returns the same object when nothing changes', () => {
        const inside = { x: 500, y: 500 };
        expect(clampEyePosition(inside, 24, area)).toBe(inside);
        expect(clampEyePosition({ x: 2500, y: -50 }, 24, area)).toEqual({ x: 1896, y: 64 });
        expect(clampEyePosition({ x: -10, y: 5000 }, 24, area)).toEqual({ x: 24, y: 1056 });
        const bad = { x: Number.NaN, y: 1 };
        expect(clampEyePosition(bad, 24, area)).toBe(bad);
    });
});

describe('reconcileBarPosition (geometry change)', () => {
    const before = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }));
    // Same display at 125%: 1536x864 DIP.
    const after = computeVisibleArea(fitted({ x: 0, y: 0, width: 1536, height: 864 }, { x: 0, y: 0, width: 1536, height: 824 }));
    const bar = { width: 64, height: 400 };

    it('a bar snapped to the right edge stays snapped to the right edge', () => {
        expect(reconcileBarPosition({ x: 1920 - 64, y: 20 }, bar, before, after)).toEqual({ x: 1536 - 64, y: 20 });
        expect(reconcileBarPosition({ x: 1920 - 64 - EDGE_SNAP_EPSILON, y: 20 }, bar, before, after).x).toBe(1536 - 64);
    });

    it('a bar snapped to the left / top edge follows that edge (taskbar moved to the top)', () => {
        const top = computeVisibleArea(fitted({ x: 0, y: 0, width: 1920, height: 1080 }, { x: 0, y: 40, width: 1920, height: 1040 }));
        expect(reconcileBarPosition({ x: 0, y: 0 }, bar, before, top)).toEqual({ x: 0, y: 40 });
    });

    it('a bar snapped to the bottom stays at the bottom', () => {
        const horizontal = { width: 600, height: 64 };
        expect(reconcileBarPosition({ x: 300, y: 1040 - 64 }, horizontal, before, after)).toEqual({ x: 300, y: 824 - 64 });
    });

    it('a free-floating bar outside the new area is clamped in; one inside is returned unchanged', () => {
        expect(reconcileBarPosition({ x: 1700, y: 700 }, bar, before, after)).toEqual({ x: 1536 - 64, y: 824 - 400 });
        const inside = { x: 300, y: 100 };
        expect(reconcileBarPosition(inside, bar, before, after)).toBe(inside);
    });

    it('a bar taller than the area goes to the top; unknown previous area: clamp only', () => {
        expect(reconcileBarPosition({ x: 100, y: 300 }, { width: 64, height: 2000 }, before, after)).toEqual({ x: 100, y: 0 });
        expect(reconcileBarPosition({ x: 1900, y: 0 }, bar, null, after)).toEqual({ x: 1536 - 64, y: 0 });
    });

    it('non-finite input is left alone', () => {
        const bad = { x: Number.NaN, y: 0 };
        expect(reconcileBarPosition(bad, bar, before, after)).toBe(bad);
        expect(Number.isFinite(reconcileBarPosition({ x: 10, y: 10 }, { width: Number.NaN, height: Infinity }, before, after).x)).toBe(
            true
        );
    });
});
