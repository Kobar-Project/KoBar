import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';
import { cx, INTERACTIVE } from '../../ui/cx';
import { exceedsDragThreshold } from '../../utils/dragThreshold';
import {
    clampPanelOffset,
    isInteractiveTarget,
    panelAxisFor,
    panelOffsetForKey,
    PANEL_DRAG_STRIP_PX,
    type PanelAxis,
} from './panelPosition';

/** The usable rectangle in window coordinates (a subset of VisibleArea). */
export interface PanelArea {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface PluginPanelHostProps {
    pluginId: string;
    orientation: 'horizontal' | 'vertical';
    area: PanelArea;
    children: ReactNode;
}

/**
 * R-15: host-owned wrapper around a plugin panel. The plugin renders and positions its own root element (unchanged contract);
 * the host moves that root with the CSS `translate` property (which does not touch the plugin's own `transform`) along the
 * bar's free axis only: left/right in a horizontal bar, up/down in a vertical bar. The offset is stored per plugin id, clamped
 * to the usable area every time it is applied (also after a resize or an edge change), and never written back clamped.
 * Drag starts from the top strip of the panel (outside buttons/inputs/links) or from the host-owned grip above it.
 */
export function PluginPanelHost({ pluginId, orientation, area, children }: PluginPanelHostProps) {
    const t = useT();
    const axis = panelAxisFor(orientation);
    const stored = useAppStore((s) => s.pluginPanelOffsets[pluginId]?.[axis]);
    const setOffset = useAppStore((s) => s.setPluginPanelOffset);

    const hostRef = useRef<HTMLDivElement>(null);
    const applied = useRef<{ axis: PanelAxis; value: number }>({ axis, value: 0 });
    const live = useRef<number | null>(null);
    const latest = useRef({ axis, stored, area });
    // Assigned in a layout effect (declared before the sync effect below) so render stays pure.
    useLayoutEffect(() => {
        latest.current = { axis, stored, area };
    });
    const drag = useRef<{ x: number; y: number; startOffset: number; active: boolean; target: Element | null; pointerId: number } | null>(
        null
    );
    // The grip is positioned imperatively (it follows the plugin-owned panel rect, which only the DOM knows).
    const handleRef = useRef<HTMLDivElement>(null);

    const sync = useCallback(() => {
        const host = hostRef.current;
        const el = host?.firstElementChild as HTMLElement | null | undefined;
        const grip = handleRef.current;
        if (!host || !el) {
            if (grip) grip.style.display = 'none';
            return;
        }
        const { axis: ax, stored: storedOffset, area: a } = latest.current;
        if (applied.current.axis !== ax) {
            el.style.translate = '';
            applied.current = { axis: ax, value: 0 };
        }
        let r = el.getBoundingClientRect();
        const desired = live.current ?? storedOffset ?? 0;
        let next = 0;
        if (desired !== 0) {
            const baseStart = (ax === 'x' ? r.left : r.top) - applied.current.value;
            next =
                ax === 'x'
                    ? clampPanelOffset(desired, baseStart, r.width, a.left, a.right)
                    : clampPanelOffset(desired, baseStart, r.height, a.top, a.bottom);
        }
        if (next !== applied.current.value) {
            el.style.translate = next === 0 ? '' : ax === 'x' ? `${next}px 0px` : `0px ${next}px`;
            applied.current = { axis: ax, value: next };
            r = el.getBoundingClientRect();
        }
        const parent = host.parentElement?.getBoundingClientRect();
        const left = r.left - (parent?.left ?? 0) + r.width / 2 - 20;
        const top = Math.max(r.top - (parent?.top ?? 0) - 10, a.top - (parent?.top ?? 0));
        if (grip) {
            grip.style.display = '';
            grip.style.left = `${left}px`;
            grip.style.top = `${top}px`;
        }
    }, []);

    // Re-apply after every render (area, orientation, stored offset or the plugin's own re-render may have changed).
    useLayoutEffect(() => {
        sync();
    });

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const onMutation = (records: MutationRecord[]) => {
            const root = host.firstElementChild;
            if (records.some((m) => m.target === root || (m.type === 'childList' && m.target === host))) sync();
        };
        const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onMutation);
        mo?.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync());
        if (host.firstElementChild) ro?.observe(host.firstElementChild);
        window.addEventListener('resize', sync);
        return () => {
            mo?.disconnect();
            ro?.disconnect();
            window.removeEventListener('resize', sync);
        };
    }, [sync]);

    const commit = () => {
        const value = applied.current.value;
        live.current = null;
        setOffset(pluginId, latest.current.axis, value === 0 ? null : value);
    };

    const onMoveRef = useRef<(e: globalThis.PointerEvent) => void>(() => {});
    const onUpRef = useRef<(e: globalThis.PointerEvent) => void>(() => {});
    // Stable listener functions that forward to the latest closures above.
    const move = useRef((e: globalThis.PointerEvent) => onMoveRef.current(e)).current;
    const up = useRef((e: globalThis.PointerEvent) => onUpRef.current(e)).current;

    const stopDrag = useCallback(() => {
        const d = drag.current;
        drag.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        document.body.style.userSelect = '';
        if (d?.active) {
            if (d.target?.hasPointerCapture?.(d.pointerId)) d.target.releasePointerCapture(d.pointerId);
            // The press that ended a real drag must not click whatever is under the pointer.
            const swallow = (ev: Event) => ev.stopPropagation();
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        }
    }, [move, up]);

    useLayoutEffect(() => {
        onMoveRef.current = (e) => {
            const d = drag.current;
            if (!d || e.pointerId !== d.pointerId) return;
            if (!d.active) {
                if (!exceedsDragThreshold({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) return;
                d.active = true;
                document.body.style.userSelect = 'none';
                try {
                    d.target?.setPointerCapture?.(d.pointerId);
                } catch {
                    /* the pointer is already gone: the window listeners still finish the drag */
                }
            }
            const delta = latest.current.axis === 'x' ? e.clientX - d.x : e.clientY - d.y;
            live.current = d.startOffset + delta;
            sync();
        };
        onUpRef.current = (e) => {
            const d = drag.current;
            if (!d || e.pointerId !== d.pointerId) return;
            const wasActive = d.active;
            stopDrag();
            if (wasActive) commit();
            else live.current = null;
        };
    });
    useEffect(() => () => stopDrag(), [stopDrag]);

    const begin = (e: PointerEvent<Element>) => {
        if (e.button !== 0 || drag.current) return;
        drag.current = {
            x: e.clientX,
            y: e.clientY,
            startOffset: applied.current.value,
            active: false,
            target: e.target instanceof Element ? e.target : null,
            pointerId: e.pointerId,
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    const inTopStrip = (e: { clientX: number; clientY: number; target: EventTarget | null }) => {
        const panel = hostRef.current?.firstElementChild;
        if (!panel) return false;
        const r = panel.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.top + PANEL_DRAG_STRIP_PX;
        return inside && !isInteractiveTarget(e.target, panel);
    };

    const reset = () => {
        live.current = null;
        setOffset(pluginId, latest.current.axis, null);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (!e.altKey) return;
        const next = panelOffsetForKey(e.key, latest.current.axis, applied.current.value);
        if (next === null) return;
        e.preventDefault();
        live.current = next;
        sync();
        commit();
    };

    return (
        <>
            <div
                ref={hostRef}
                data-scheme="dark"
                className="contents"
                onPointerDown={(e) => {
                    if (inTopStrip(e)) begin(e);
                }}
                onDoubleClick={(e) => {
                    if (inTopStrip(e)) reset();
                }}
            >
                {children}
            </div>
            <div
                ref={handleRef}
                data-scheme="dark"
                role="button"
                tabIndex={0}
                aria-label={t('pluginPanelMoveHandle')}
                data-plugin-panel-handle={pluginId}
                onPointerDown={begin}
                onDoubleClick={reset}
                onKeyDown={onKeyDown}
                className={cx(
                    INTERACTIVE,
                    'group absolute flex h-2.5 w-10 touch-none items-center justify-center pointer-events-auto',
                    orientation === 'horizontal' ? 'cursor-ew-resize' : 'cursor-ns-resize'
                )}
                style={{ display: 'none', zIndex: 40 }}
            >
                <span
                    aria-hidden="true"
                    className="h-1 w-8 rounded-full bg-[var(--kb-fg-3)] opacity-40 transition-opacity duration-[var(--kb-dur-fast)] group-hover:bg-[var(--kb-accent)] group-hover:opacity-100"
                />
            </div>
        </>
    );
}
