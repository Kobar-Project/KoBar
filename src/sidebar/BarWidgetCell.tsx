import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** How long the measurement must stay unchanged before it decides (the first frames are measured before styles settle). */
const SETTLE_MS = 250;

/**
 * A v1 inline widget placed in a wide-bar icon grid cell (`--kb-tile-cell`). Single-button widgets (KoBox, Pin window to top,
 * Focus mode) then sit in the 2-column grid like any icon. Some widgets are larger than a cell (Clipboard Manager's slot grid):
 * this host measures its content and, once the measurement has settled, reports `onFit(false)`; the bar then shows that
 * widget as its own block instead. Without this, every widget split the grid into two pieces and left odd gaps around itself.
 */
export function BarWidgetCell({ id, onFit, children }: { id: string; onFit: (id: string, fits: boolean) => void; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const host = ref.current;
        if (!host) return undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const check = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                // 1 px tolerance for sub-pixel rounding.
                onFit(id, host.scrollWidth <= host.clientWidth + 1 && host.scrollHeight <= host.clientHeight + 1);
            }, SETTLE_MS);
        };
        check();
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
        ro?.observe(host);
        for (const child of Array.from(host.querySelectorAll('*')).slice(0, 20)) ro?.observe(child);
        return () => {
            if (timer) clearTimeout(timer);
            ro?.disconnect();
        };
    }, [id, onFit]);
    return (
        <div
            ref={ref}
            data-bar-widget-host=""
            data-bar-widget-cell=""
            className="flex size-[var(--kb-tile-cell)] items-center justify-center overflow-hidden"
        >
            {children}
        </div>
    );
}
