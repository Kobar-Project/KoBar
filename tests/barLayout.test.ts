// CNL-07: bar packing algorithm (pure).
import { describe, expect, it } from 'vitest';
import { GEOMETRY, layoutBar, type BarItemInput } from '../src/sidebar/barLayout';

const icons = (n: number): BarItemInput[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, size: 'icon' }));

describe('layoutBar', () => {
    it('density geometry invariants: 2 cells + gap = tile; tile + 2 pad = wide bar', () => {
        const wide = { compact: 76, normal: 84, comfortable: 100 } as const;
        for (const [d, g] of Object.entries(GEOMETRY)) {
            expect(2 * g.cell + g.tileGap, d).toBe(g.tile);
            expect(g.tile + 2 * g.barPad, d).toBe(wide[d as keyof typeof wide]);
            expect(g.cell, d).toBeGreaterThanOrEqual(28);
        }
    });

    it('all icons -> thin bar, one column, no grid', () => {
        const l = layoutBar(icons(5), 'normal', 2000);
        expect(l.mode).toBe('thin');
        expect(l.blocks.filter((b) => b.kind === 'thin')).toHaveLength(5);
        expect(l.fits).toBe(true);
    });

    it('one tile -> wide bar without divider or grid', () => {
        const l = layoutBar([{ id: 'cal', size: 'tile' }], 'normal', 2000);
        expect(l.mode).toBe('wide');
        expect(l.blocks.map((b) => b.kind)).toEqual(['handle', 'tile', 'mini']);
    });

    it('tiles then icons -> divider between tile run and grid; grid packs 2 per row', () => {
        const items: BarItemInput[] = [{ id: 'cal', size: 'tile' }, { id: 'focus', size: 'tile' }, ...icons(5)];
        const l = layoutBar(items, 'normal', 2000);
        expect(l.blocks.map((b) => b.kind)).toEqual(['handle', 'tile', 'tile', 'divider', 'grid', 'mini']);
        const grid = l.blocks.find((b) => b.kind === 'grid');
        expect(grid && grid.kind === 'grid' ? grid.ids.length : 0).toBe(5);
        expect(l.length).toBe(20 + 22 + 64 + 64 + 1 + 98 + 48 + 5 * 8);
    });

    it('a tile later in the order breaks the icon grid', () => {
        const items: BarItemInput[] = [
            { id: 'a', size: 'icon' },
            { id: 'b', size: 'icon' },
            { id: 't', size: 'tile' },
            { id: 'c', size: 'icon' },
        ];
        const l = layoutBar(items, 'normal', 2000);
        expect(l.blocks.map((b) => b.kind)).toEqual(['handle', 'grid', 'divider', 'tile', 'divider', 'grid', 'mini']);
    });

    it('not enough room: last non-active tile collapses first', () => {
        const items: BarItemInput[] = [
            { id: 't1', size: 'tile' },
            { id: 't2', size: 'tile', active: true },
            { id: 't3', size: 'tile' },
            ...icons(4),
        ];
        const full = layoutBar(items, 'normal', 5000).length;
        const l = layoutBar(items, 'normal', full - 1);
        expect(l.collapsed).toEqual(['t3']);
        expect(l.length).toBeLessThanOrEqual(full - 1);
    });

    it('still too long after collapsing all tiles: every item stays on the bar and the layout reports it does not fit', () => {
        const items: BarItemInput[] = [...icons(20), { id: 'last', size: 'icon', active: true }];
        const l = layoutBar(items, 'normal', 400);
        expect(l.mode).toBe('thin');
        expect(l.fits).toBe(false);
        const onBar = l.blocks.flatMap((b) => (b.kind === 'thin' ? [b.id] : []));
        expect(onBar).toEqual(items.map((i) => i.id));
    });

    it('handle and mini button always present', () => {
        for (const n of [0, 1, 40]) {
            const l = layoutBar(icons(n), 'compact', 300);
            expect(l.blocks[0].kind).toBe('handle');
            expect(l.blocks[l.blocks.length - 1].kind).toBe('mini');
        }
    });

    it('0 plugins: thin bar with handle and mini only', () => {
        const l = layoutBar([], 'normal', 800);
        expect(l.mode).toBe('thin');
        expect(l.blocks.map((b) => b.kind)).toEqual(['handle', 'mini']);
    });

    it('all tiles on a 768 px screen: collapses from the end, active tile stays a tile', () => {
        const items: BarItemInput[] = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, size: 'tile' as const, active: i === 0 }));
        const l = layoutBar(items, 'normal', 768 - 40);
        expect(l.length).toBeLessThanOrEqual(768 - 40);
        expect(l.collapsed).not.toContain('t0');
        expect(l.collapsed).toContain('t11');
    });

    it('a 1366 px horizontal bar (available 1326) fits tiles plus icons without overflow', () => {
        const items: BarItemInput[] = [...Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, size: 'tile' as const })), ...icons(10)];
        const l = layoutBar(items, 'normal', 1326);
        expect(l.length).toBeLessThanOrEqual(1326);
        expect(l.fits).toBe(true);
    });

    it('30+ plugins: every item is on the bar, in order (no overflow)', () => {
        const items = icons(35);
        const l = layoutBar(items, 'normal', 600);
        const onBar = l.blocks.flatMap((b) => (b.kind === 'thin' ? [b.id] : []));
        expect(onBar).toEqual(items.map((i) => i.id));
        expect(l.fits).toBe(false);
    });

    it('is deterministic for equal input', () => {
        expect(layoutBar(icons(10), 'normal', 300)).toEqual(layoutBar(icons(10), 'normal', 300));
    });

    it('when nothing fits even as icons, the thin layout keeps every item and reports fits: false', () => {
        const items: BarItemInput[] = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, size: 'icon' as const, active: true }));
        const l = layoutBar(items, 'normal', 200);
        expect(l.fits).toBe(false);
        expect(l.mode).toBe('thin');
        expect(l.blocks.filter((b) => b.kind === 'thin')).toHaveLength(30);
    });
});
