// KoBar Canli bar packing algorithm (pure, no DOM). Spec: remaster/design/canli/design-system/07-bar.md section 3.

export type BarItemSize = 'icon' | 'tile';
export type Density = 'compact' | 'normal' | 'comfortable';

export interface BarItemInput {
    id: string;
    size: BarItemSize;
    /** Its panel is open: its tile collapses last. */
    active?: boolean;
}

export interface BarGeometry {
    tile: number;
    cell: number;
    tileGap: number;
    barGap: number;
    barPad: number;
    thinItem: number;
    thinGap: number;
    thinPad: number;
    handle: number;
    mini: number; // mini button length along the axis in the wide bar
}

/** Mirrors the density tokens in tokens/canli.css. */
export const GEOMETRY: Readonly<Record<Density, BarGeometry>> = {
    compact: { tile: 60, cell: 28, tileGap: 4, barGap: 6, barPad: 8, thinItem: 32, thinGap: 2, thinPad: 6, handle: 22, mini: 45 },
    normal: { tile: 64, cell: 30, tileGap: 4, barGap: 8, barPad: 10, thinItem: 36, thinGap: 2, thinPad: 6, handle: 22, mini: 48 },
    comfortable: { tile: 76, cell: 36, tileGap: 4, barGap: 10, barPad: 12, thinItem: 44, thinGap: 2, thinPad: 6, handle: 22, mini: 57 },
};

export type BarBlock =
    | { kind: 'handle' }
    | { kind: 'tile'; id: string }
    | { kind: 'grid'; ids: string[] }
    | { kind: 'divider' }
    | { kind: 'thin'; id: string } // thin bar item
    | { kind: 'mini' };

export interface BarLayout {
    mode: 'thin' | 'wide';
    blocks: BarBlock[];
    /** Length along the bar axis in px, including padding. */
    length: number;
    /** Tiles shown as icons because of space (user choice unchanged). */
    collapsed: string[];
    /** False when even the all-icon bar is longer than `available`: the bar then scrolls between the handle and the mini button. */
    fits: boolean;
}

/**
 * Packs the items into blocks and fits them into `available` px along the bar axis. Every item always stays on the bar
 * (owner decision: no "More" overflow). While it does not fit, tiles collapse to icons from the end (an active item last);
 * when nothing is left to collapse the layout is returned with `fits: false` and the bar scrolls.
 */
export function layoutBar(items: readonly BarItemInput[], density: Density, available: number): BarLayout {
    const g = GEOMETRY[density];
    const collapsed = new Set<string>();

    for (let guard = 0; guard <= items.length; guard++) {
        const effective = items.map((it) => ({ ...it, size: collapsed.has(it.id) ? ('icon' as const) : it.size }));
        const result = pack(effective, g);
        if (result.length <= available) return { ...result, collapsed: [...collapsed], fits: true };
        const tiles = effective.filter((it) => it.size === 'tile');
        if (tiles.length === 0) return { ...result, collapsed: [...collapsed], fits: false };
        const victim = [...tiles].reverse().find((it) => !it.active) ?? tiles[tiles.length - 1];
        collapsed.add(victim.id);
    }
    const result = pack(
        items.map((it) => ({ ...it, size: 'icon' as const })),
        g
    );
    return { ...result, collapsed: [...collapsed], fits: result.length <= available };
}

function pack(items: readonly BarItemInput[], g: BarGeometry): Omit<BarLayout, 'collapsed' | 'fits'> {
    const anyTile = items.some((it) => it.size === 'tile');
    if (!anyTile) {
        const ids = items.map((it) => it.id);
        const blocks: BarBlock[] = [{ kind: 'handle' }, ...ids.map((id) => ({ kind: 'thin' as const, id })), { kind: 'mini' }];
        const count = ids.length + 1; // + mini (thin item size)
        const length = 2 * g.thinPad + g.handle + count * g.thinItem + count * g.thinGap;
        return { mode: 'thin', blocks, length };
    }

    const blocks: BarBlock[] = [{ kind: 'handle' }];
    let run: string[] = [];
    const flushRun = () => {
        if (run.length === 0) return;
        if (blocks[blocks.length - 1]?.kind === 'tile') blocks.push({ kind: 'divider' });
        blocks.push({ kind: 'grid', ids: run });
        run = [];
    };
    for (const it of items) {
        if (it.size === 'tile') {
            flushRun();
            if (blocks[blocks.length - 1]?.kind === 'grid') blocks.push({ kind: 'divider' });
            blocks.push({ kind: 'tile', id: it.id });
        } else {
            run.push(it.id);
        }
    }
    flushRun();
    blocks.push({ kind: 'mini' });

    let length = 2 * g.barPad;
    blocks.forEach((b, i) => {
        if (i > 0) length += g.barGap;
        length += blockLength(b, g);
    });
    return { mode: 'wide', blocks, length };
}

function blockLength(b: BarBlock, g: BarGeometry): number {
    switch (b.kind) {
        case 'handle':
            return g.handle;
        case 'tile':
            return g.tile;
        case 'grid': {
            const rows = Math.ceil(b.ids.length / 2);
            return rows * g.cell + (rows - 1) * g.tileGap;
        }
        case 'divider':
            return 1;
        case 'thin':
            return g.thinItem;
        case 'mini':
            return g.mini;
    }
}

/** Bar thickness (cross axis) in px: thin = item + 2 pad (44/48/56), wide = tile + 2 pad (76/84/100). */
export function barThickness(density: Density, mode: 'thin' | 'wide'): number {
    const g = GEOMETRY[density] ?? GEOMETRY.normal;
    return mode === 'wide' ? g.tile + 2 * g.barPad : g.thinItem + 2 * g.thinPad;
}

/** Distance along the bar axis from the centre of the mini button (the last block) to the bar's end edge. */
export function miniButtonCenterToEnd(density: Density, mode: 'thin' | 'wide'): number {
    const g = GEOMETRY[density] ?? GEOMETRY.normal;
    return mode === 'wide' ? g.mini / 2 + g.barPad : g.thinItem / 2 + g.thinPad;
}

/** The mini-mode orb (FloatingEye): a fixed 44 px circle at every density. */
export const MINI_ORB_SIZE = 44;
