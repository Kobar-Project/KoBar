import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/** Marks the bar buttons that take part in the toolbar's roving tabindex (set by BarItem). */
export const BAR_ITEM_ATTR = 'data-bar-item';

export type ToolbarOrientation = 'vertical' | 'horizontal';

/** Next index for an arrow/Home/End key, or null when the key is not a navigation key for this orientation. */
export function nextToolbarIndex(key: string, orientation: ToolbarOrientation, current: number, count: number): number | null {
    if (count === 0) return null;
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === next) return (current + 1) % count;
    if (key === prev) return (current - 1 + count) % count;
    return null;
}

/** Marks the cells of one 2-column grid block of the wide bar (same value = same grid). Tiles and thin items have none. */
export const BAR_GRID_ATTR = 'data-bar-grid';

/**
 * Grid-aware navigation for the wide bar. `grids[i]` is the grid id of item i (null for tiles, thin items and the
 * mini button). A grid has two cells per row in item order, along the cross axis of the bar: the cell at grid position
 * k is the cross-axis neighbour of k^1 and the main-axis neighbour of k-2 / k+2. Left/Right (vertical bar) or Up/Down
 * (horizontal bar) stay inside the row; the main-axis keys walk row by row and then into the neighbouring block.
 * `rtl` mirrors the horizontal keys. Returns null when the key does nothing.
 */
export function nextGridIndex(
    key: string,
    orientation: ToolbarOrientation,
    current: number,
    grids: ReadonlyArray<string | null>,
    rtl = false
): number | null {
    const count = grids.length;
    if (count === 0 || current < 0) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    let k = key;
    if (rtl && (k === 'ArrowLeft' || k === 'ArrowRight')) k = k === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    const mainPrev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const mainNext = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const crossPrev = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const crossNext = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const isMain = k === mainPrev || k === mainNext;
    const isCross = k === crossPrev || k === crossNext;
    if (!isMain && !isCross) return null;

    const grid = grids[current];
    if (grid === null) {
        if (!isMain) return null;
        return k === mainNext ? (current + 1) % count : (current - 1 + count) % count;
    }
    const start = grids.indexOf(grid);
    let size = 0;
    while (start + size < count && grids[start + size] === grid) size++;
    const pos = current - start;
    if (isCross) {
        const mate = pos ^ 1;
        return mate < size ? start + mate : null;
    }
    if (k === mainPrev) return pos >= 2 ? current - 2 : (start - 1 + count) % count;
    if (pos + 2 < size) return current + 2;
    const row = pos >> 1;
    const lastRow = (size - 1) >> 1;
    return row < lastRow ? start + size - 1 : (start + size) % count;
}

function items(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(`[${BAR_ITEM_ATTR}]:not([disabled])`));
}

/**
 * Roving tabindex for the bar (role="toolbar"): one item is in the Tab order, arrow keys move between items.
 * Returns the keydown handler for the toolbar element. Items are discovered through the DOM so inline widgets
 * and reordering need no extra wiring.
 */
export function useRovingToolbar(containerRef: RefObject<HTMLElement | null>, orientation: ToolbarOrientation) {
    const activeRef = useRef<HTMLElement | null>(null);

    // Runs after every render: new or removed items keep exactly one tab stop.
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const list = items(container);
        const stop = activeRef.current && list.includes(activeRef.current) ? activeRef.current : list[0];
        for (const el of list) el.tabIndex = el === stop ? 0 : -1;
    });

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        const container = containerRef.current;
        const target = event.target as HTMLElement;
        if (!container || !target.hasAttribute(BAR_ITEM_ATTR)) return;
        const list = items(container);
        const grids = list.map((el) => el.getAttribute(BAR_GRID_ATTR));
        const rtl = getComputedStyle(container).direction === 'rtl';
        const nextIndex = nextGridIndex(event.key, orientation, list.indexOf(target), grids, rtl);
        if (nextIndex === null) return;
        event.preventDefault();
        const el = list[nextIndex];
        for (const other of list) other.tabIndex = other === el ? 0 : -1;
        activeRef.current = el;
        el.focus({ preventScroll: true });
    };

    const onFocus = (event: React.FocusEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        const container = containerRef.current;
        if (!container || !target.hasAttribute(BAR_ITEM_ATTR)) return;
        activeRef.current = target;
        for (const el of items(container)) el.tabIndex = el === target ? 0 : -1;
    };

    return { onKeyDown, onFocus };
}
