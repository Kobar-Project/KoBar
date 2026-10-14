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
        const nextIndex = nextToolbarIndex(event.key, orientation, list.indexOf(target), list.length);
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
