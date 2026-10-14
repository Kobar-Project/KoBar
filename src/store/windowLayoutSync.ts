import { useAppStore } from './useAppStore';
import { subscribeWindowGeometry, type WindowGeometry } from '../utils/windowGeometry';
import { clampEyePosition, computeVisibleArea, defaultEyePosition, hasDisplayInfo, reconcileBarPosition } from '../utils/visibleArea';

/*
 * T-322 (window model A): when main re-fits the window (display added/removed, resolution or scale change, taskbar moved, bar
 * dragged to another display) the window's coordinate space changes. This keeps the bar and the mini-mode eye on screen through the
 * existing store actions (setSidebarPosition, setMiniMode, setScreenBounds); none of these fields is persisted, so no migration.
 *
 * - A free-floating bar snapped to a visible edge is re-snapped to the same edge of the new visible area; otherwise it is clamped in.
 * - The eye (mini mode) is clamped into the new visible area; without a stored position it gets the default spot of the new area.
 * - `screenBounds` gets the new work area (screen coordinates, the value main also sends with edge-changed), so its meaning for
 *   plugins does not change; it is only refreshed sooner.
 * Nothing happens on macOS (main never sends the event there) or while a drag owns the positions (the drop path places them).
 */

/** The eye button is 48px (w-12) scaled by iconScale; this much of it stays on screen. */
const EYE_HALF_SIZE = 24;

function isWindowsRenderer(): boolean {
    try {
        return typeof window !== 'undefined' && window.api?.getPlatform?.() === 'win32';
    } catch {
        return false;
    }
}

/**
 * `edge-changed` from main. Windows (window model A): main re-fits the window on every display / taskbar change and a fitted window
 * always reports 'left', so the edge argument is ignored there and only the work area is taken; the renderer owns the edge (the
 * drop path and setMiniMode(false, pos) compute it). macOS / Linux keep the previous behaviour (edge and bounds).
 */
export function applyEdgeChanged(edge: 'left' | 'right', bounds: unknown): void {
    const state = useAppStore.getState();
    if (!isWindowsRenderer()) state.setEdgePosition(edge);
    if (bounds) state.setScreenBounds(bounds);
}

export function applyWindowGeometryChange(next: Readonly<WindowGeometry>, prev: Readonly<WindowGeometry> | null): void {
    const state = useAppStore.getState();
    if (state.isMac || !hasDisplayInfo(next)) return;

    const workArea = next.workArea;
    const current = state.screenBounds;
    if (
        !current ||
        current.x !== workArea.x ||
        current.y !== workArea.y ||
        current.width !== workArea.width ||
        current.height !== workArea.height
    ) {
        state.setScreenBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height });
    }

    if (state.isDraggingGlobal) return;

    const nextArea = computeVisibleArea(next);
    const prevArea = prev && hasDisplayInfo(prev) ? computeVisibleArea(prev) : null;

    const barPos = state.sidebarPosition;
    if (barPos) {
        const size =
            state.orientation === 'horizontal'
                ? { width: state.lastSidebarWidth, height: state.sidebarWidth }
                : { width: state.sidebarWidth, height: state.lastSidebarHeight };
        const reconciled = reconcileBarPosition(barPos, size, prevArea, nextArea);
        if (reconciled !== barPos) state.setSidebarPosition(reconciled);
    }

    if (state.isMiniMode) {
        const half = EYE_HALF_SIZE * (Number.isFinite(state.iconScale) && state.iconScale > 0 ? state.iconScale : 1);
        const eyePos = state.miniModePosition ?? defaultEyePosition(nextArea, state.edgePosition);
        const clamped = clampEyePosition(eyePos, half, nextArea);
        if (clamped !== state.miniModePosition) state.setMiniMode(true, { x: clamped.x, y: clamped.y });
    }
}

/** Starts following window geometry changes (App mounts it once); returns the unsubscribe function. */
export function installWindowLayoutSync(): () => void {
    return subscribeWindowGeometry((next, prev) => {
        try {
            applyWindowGeometryChange(next, prev);
        } catch (err) {
            console.warn('[KoBar] layout update after a window geometry change failed', err);
        }
    });
}
