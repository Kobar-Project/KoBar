import { describe, expect, it } from 'vitest';
// The Screenshot plugin lives in a sibling repo; skip when it is not checked out next to the host repo.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const geoPath = resolve(__dirname, '../../../KoBar Plugins/screenshot/src/geometry.ts');
const available = existsSync(geoPath);

describe.skipIf(!available)('screenshot plugin geometry (R-17)', async () => {
    const g = available ? await import(/* @vite-ignore */ geoPath) : (null as never);
    const rect = (rot = 0) => ({
        id: 'a',
        tool: 'rect' as const,
        color: '#fff',
        sizeLevel: 2 as const,
        rot,
        points: [
            { x: 10, y: 10 },
            { x: 110, y: 60 },
        ],
    });

    it('hit-tests rect edges but not the empty interior', () => {
        expect(g.hitShape(rect(), { x: 60, y: 10 })).toBe(true);
        expect(g.hitShape(rect(), { x: 60, y: 35 })).toBe(false);
    });

    it('hit-test follows rotation', () => {
        const s = rect(Math.PI / 2); // centre (60,35); top edge moves to the right side
        expect(g.hitShape(s, { x: 85, y: 35 })).toBe(true);
        expect(g.hitShape(s, { x: 60, y: 10 })).toBe(false);
    });

    it('resize keeps the opposite anchor fixed in the world, also when rotated', () => {
        const s = rect(Math.PI / 6);
        const f0 = g.shapeFrame(s);
        const h = { hx: 1, hy: 1 };
        const anchor = g.rotatePt({ x: f0.cx - f0.w / 2, y: f0.cy - f0.h / 2 }, { x: f0.cx, y: f0.cy }, f0.rot);
        const target = g.rotatePt({ x: f0.cx + f0.w / 2 + 30, y: f0.cy + f0.h / 2 + 20 }, { x: f0.cx, y: f0.cy }, f0.rot);
        const f1 = g.resizeFrame(f0, h, target, 5, 5);
        expect(f1.w).toBeCloseTo(f0.w + 30, 5);
        expect(f1.h).toBeCloseTo(f0.h + 20, 5);
        const anchor1 = g.rotatePt({ x: f1.cx - f1.w / 2, y: f1.cy - f1.h / 2 }, { x: f1.cx, y: f1.cy }, f1.rot);
        expect(anchor1.x).toBeCloseTo(anchor.x, 5);
        expect(anchor1.y).toBeCloseTo(anchor.y, 5);
        const next = g.applyShapeFrame(s, f1);
        const f2 = g.shapeFrame(next);
        expect(f2.cx).toBeCloseTo(f1.cx, 5);
        expect(f2.w).toBeCloseTo(f1.w, 5);
        expect(next.rot).toBeCloseTo(s.rot, 8);
    });

    it('edge handle changes a single axis; min size is respected', () => {
        const f0 = g.shapeFrame(rect());
        const f1 = g.resizeFrame(f0, { hx: 1, hy: 0 }, { x: f0.cx - 500, y: f0.cy + 99 }, 20, 20);
        expect(f1.w).toBe(20);
        expect(f1.h).toBe(f0.h);
    });

    it('rotation angle is relative to the drag start', () => {
        const f = { cx: 0, cy: 0, w: 10, h: 10, rot: 0 };
        expect(g.rotatedAngle(f, 0, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2, 8);
        expect(g.rotatedAngle(f, 1, { x: 10, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(1, 8);
    });

    it('degenerate (horizontal) arrow resizes without NaN', () => {
        const s = {
            ...rect(),
            tool: 'arrow' as const,
            points: [
                { x: 0, y: 5 },
                { x: 50, y: 5 },
            ],
        };
        const f0 = g.shapeFrame(s);
        const out = g.applyShapeFrame(s, g.resizeFrame(f0, { hx: 1, hy: 1 }, { x: 200, y: 80 }, 5, 5));
        out.points.forEach((p: { x: number; y: number }) => {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        });
    });
});

describe.skipIf(!available)('screenshot plugin area clamping (R3-03)', async () => {
    const g = available ? await import(/* @vite-ignore */ geoPath) : (null as never);
    it('shifts a frame that sticks out back inside the area', () => {
        const f = { cx: 195, cy: 5, w: 40, h: 20, rot: 0 };
        const d = g.shiftIntoArea(f, 200, 100);
        expect(d.x).toBe(-15);
        expect(d.y).toBe(5);
    });
    it('leaves a frame that is already inside untouched', () => {
        expect(g.shiftIntoArea({ cx: 100, cy: 50, w: 20, h: 20, rot: 0.5 }, 200, 100)).toEqual({ x: 0, y: 0 });
    });
    it('uses the rotated bounding box', () => {
        const b = g.frameAABB({ cx: 0, cy: 0, w: 20, h: 10, rot: Math.PI / 2 });
        expect(b.maxX).toBeCloseTo(5);
        expect(b.maxY).toBeCloseTo(10);
    });
    it('clamps points into the area', () => {
        expect(g.clampPt({ x: -5, y: 300 }, 200, 100)).toEqual({ x: 0, y: 100 });
    });
});
