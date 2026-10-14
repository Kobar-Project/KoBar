import { describe, expect, it } from 'vitest';
import {
    clampPanelOffset,
    panelAxisFor,
    panelOffsetForKey,
    sanitizePanelOffset,
    PANEL_KEY_STEP,
} from '../src/components/plugins/panelPosition';

// R-15: pure helpers of the movable plugin panel.

describe('panelAxisFor', () => {
    it('moves left/right in a horizontal bar and up/down in a vertical one', () => {
        expect(panelAxisFor('horizontal')).toBe('x');
        expect(panelAxisFor('vertical')).toBe('y');
    });
});

describe('clampPanelOffset', () => {
    // panel at 100..300 by default, area 0..1000 -> offset range -100..700
    it('keeps an offset that fits', () => {
        expect(clampPanelOffset(50, 100, 200, 0, 1000)).toBe(50);
        expect(clampPanelOffset(0, 100, 200, 0, 1000)).toBe(0);
    });
    it('clamps to both ends of the area', () => {
        expect(clampPanelOffset(-500, 100, 200, 0, 1000)).toBe(-100);
        expect(clampPanelOffset(5000, 100, 200, 0, 1000)).toBe(700);
    });
    it('pins a panel larger than the area to the area start', () => {
        expect(clampPanelOffset(40, 100, 2000, 0, 1000)).toBe(-100);
    });
    it('respects an area that does not start at 0 (taskbar at the left/top)', () => {
        expect(clampPanelOffset(-500, 100, 200, 48, 1000)).toBe(-52);
    });
});

describe('sanitizePanelOffset', () => {
    it('rounds finite numbers, bounds them and rejects the rest', () => {
        expect(sanitizePanelOffset(12.6)).toBe(13);
        expect(sanitizePanelOffset(1e9)).toBe(100000);
        expect(sanitizePanelOffset(-1e9)).toBe(-100000);
        for (const bad of [NaN, Infinity, '3', null, undefined, {}]) expect(sanitizePanelOffset(bad)).toBeNull();
    });
});

describe('panelOffsetForKey', () => {
    it('only handles the arrows of the free axis', () => {
        expect(panelOffsetForKey('ArrowRight', 'x', 0)).toBe(PANEL_KEY_STEP);
        expect(panelOffsetForKey('ArrowLeft', 'x', 0)).toBe(-PANEL_KEY_STEP);
        expect(panelOffsetForKey('ArrowUp', 'x', 0)).toBeNull();
        expect(panelOffsetForKey('ArrowDown', 'y', 5)).toBe(5 + PANEL_KEY_STEP);
        expect(panelOffsetForKey('ArrowLeft', 'y', 0)).toBeNull();
    });
});
