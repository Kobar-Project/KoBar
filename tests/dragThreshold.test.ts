// R-08/R-09: click-vs-drag helper and the removed grip/dots markup.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD_PX, exceedsDragThreshold } from '../src/utils/dragThreshold';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('exceedsDragThreshold', () => {
    const o = { x: 100, y: 100 };
    it('treats no movement and tiny jitter as a click', () => {
        expect(exceedsDragThreshold(o, o)).toBe(false);
        expect(exceedsDragThreshold(o, { x: 102, y: 102 })).toBe(false);
        expect(exceedsDragThreshold(o, { x: 100 - 3, y: 100 })).toBe(false);
    });
    it('treats travel at or beyond the threshold as a drag, in any direction', () => {
        expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
        expect(exceedsDragThreshold(o, { x: 100 + DRAG_THRESHOLD_PX, y: 100 })).toBe(true);
        expect(exceedsDragThreshold(o, { x: 100, y: 100 - 10 })).toBe(true);
        expect(exceedsDragThreshold(o, { x: 103, y: 103 })).toBe(true);
    });
    it('honours a custom threshold', () => {
        expect(exceedsDragThreshold(o, { x: 108, y: 100 }, 10)).toBe(false);
        expect(exceedsDragThreshold(o, { x: 110, y: 100 }, 10)).toBe(true);
    });
});

describe('drag grip markup is gone', () => {
    it('mini-mode eye has no grip under it; the eye button is the drag source', () => {
        const eye = read('src/components/layout/FloatingEye.tsx');
        expect(eye).not.toContain('eyeDragHandle');
        expect(eye).not.toContain('role="img"');
        expect(eye).not.toContain('-bottom-3');
        expect(eye).toMatch(/<button[\s\S]*?onMouseDown=\{handleMouseDown\}/);
    });
    it('bar header is one full-area button (R2-02): no old half-line, dots or sr-only anchor', () => {
        const sb = read('src/components/layout/Sidebar.tsx');
        expect(sb).not.toContain('w-1 h-8 ml-1');
        expect(sb).not.toContain('w-6 h-full -mr-2');
        expect(sb).not.toContain('w-8 h-1 mt-1');
        expect(sb).not.toContain('<div className="sr-only">');
        expect(sb).toContain('<BarHeader');
        expect(sb).toContain('onDragStart={handleSidebarDragStart}');
    });
});
