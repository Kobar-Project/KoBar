// CNL-07: bar thickness per density/mode and grid-aware keyboard navigation of the wide bar (pure).
import { describe, expect, it } from 'vitest';
import { barThickness } from '../src/sidebar/barLayout';
import { nextGridIndex } from '../src/sidebar/useRovingToolbar';

describe('barThickness', () => {
    it('matches the density tokens (thin 44/48/56, wide 76/84/100)', () => {
        expect(barThickness('compact', 'thin')).toBe(44);
        expect(barThickness('normal', 'thin')).toBe(48);
        expect(barThickness('comfortable', 'thin')).toBe(56);
        expect(barThickness('compact', 'wide')).toBe(76);
        expect(barThickness('normal', 'wide')).toBe(84);
        expect(barThickness('comfortable', 'wide')).toBe(100);
    });
});

describe('nextGridIndex', () => {
    // items: tile, a 4-cell grid, tile
    const grids = [null, 'g', 'g', 'g', 'g', null];
    it('moves across the row with the cross keys and stays inside it', () => {
        expect(nextGridIndex('ArrowRight', 'vertical', 1, grids)).toBe(2);
        expect(nextGridIndex('ArrowLeft', 'vertical', 2, grids)).toBe(1);
        expect(nextGridIndex('ArrowLeft', 'vertical', 1, grids)).toBe(2);
    });
    it('walks row by row with the main keys and leaves the grid at its ends', () => {
        expect(nextGridIndex('ArrowDown', 'vertical', 1, grids)).toBe(3);
        expect(nextGridIndex('ArrowDown', 'vertical', 3, grids)).toBe(5);
        expect(nextGridIndex('ArrowUp', 'vertical', 1, grids)).toBe(0);
    });
    it('tiles only react to the main keys; Home and End jump to the ends', () => {
        expect(nextGridIndex('ArrowRight', 'vertical', 0, grids)).toBeNull();
        expect(nextGridIndex('ArrowDown', 'vertical', 0, grids)).toBe(1);
        expect(nextGridIndex('Home', 'vertical', 3, grids)).toBe(0);
        expect(nextGridIndex('End', 'vertical', 3, grids)).toBe(5);
    });
    it('a horizontal bar uses Up/Down inside the row and mirrors Left/Right in RTL', () => {
        expect(nextGridIndex('ArrowDown', 'horizontal', 1, grids)).toBe(2);
        expect(nextGridIndex('ArrowRight', 'horizontal', 1, grids)).toBe(3);
        expect(nextGridIndex('ArrowLeft', 'horizontal', 1, grids, true)).toBe(3);
    });
});
