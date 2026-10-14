// R-15: pure helpers for moving a plugin panel along the bar's free axis. No store/window imports.

/** `x` = left/right (horizontal bar), `y` = up/down (vertical bar). */
export type PanelAxis = 'x' | 'y';
export type PanelOffsets = { x?: number; y?: number };

export const PANEL_OFFSET_LIMIT = 100000;
/** Keyboard step (Alt+Arrow) in px. */
export const PANEL_KEY_STEP = 16;
/** Height (px) of the panel's top strip that also starts a drag (outside interactive controls). */
export const PANEL_DRAG_STRIP_PX = 36;

/** A horizontal bar (top/bottom edge) moves the panel left/right; a vertical bar (left/right edge) up/down. */
export function panelAxisFor(orientation: 'horizontal' | 'vertical'): PanelAxis {
    return orientation === 'horizontal' ? 'x' : 'y';
}

/** Rounded finite offset within +-PANEL_OFFSET_LIMIT, or `null` for anything else. */
export function sanitizePanelOffset(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(PANEL_OFFSET_LIMIT, Math.max(-PANEL_OFFSET_LIMIT, Math.round(value)));
}

/**
 * Clamps an offset (px relative to the panel's default position) so the panel [baseStart + offset, baseStart + offset + size]
 * stays inside [areaStart, areaEnd]. A panel larger than the area is pinned to the area's start.
 */
export function clampPanelOffset(offset: number, baseStart: number, size: number, areaStart: number, areaEnd: number): number {
    const lo = areaStart - baseStart;
    const hi = areaEnd - size - baseStart;
    if (hi < lo) return lo;
    return Math.min(hi, Math.max(lo, offset));
}

/** Offset after Alt+Arrow along `axis`, or `null` when the key does not move the panel on that axis. */
export function panelOffsetForKey(key: string, axis: PanelAxis, offset: number): number | null {
    const less = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const more = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (key === less) return offset - PANEL_KEY_STEP;
    if (key === more) return offset + PANEL_KEY_STEP;
    return null;
}

const INTERACTIVE_SELECTOR =
    'button, a, input, textarea, select, summary, label, [role="button"], [role="slider"], [role="textbox"], [contenteditable]:not([contenteditable="false"]), [data-no-panel-drag]';

/** True when the event target is (inside) a control that must keep its own pointer behaviour. */
export function isInteractiveTarget(target: EventTarget | null, boundary: Element): boolean {
    if (!(target instanceof Element)) return false;
    const hit = target.closest(INTERACTIVE_SELECTOR);
    return hit !== null && boundary.contains(hit);
}
