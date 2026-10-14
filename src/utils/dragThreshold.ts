/** Pointer travel (px) below which a press-and-release is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** True once the pointer has moved at least `threshold` px (Euclidean) from where it was pressed. */
export function exceedsDragThreshold(
    start: { x: number; y: number },
    current: { x: number; y: number },
    threshold: number = DRAG_THRESHOLD_PX
): boolean {
    return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
