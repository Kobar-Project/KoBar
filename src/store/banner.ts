// Small dismissible in-app banner built with plain DOM (no React, no store), shared by the hydration error banner
// (T-201) and the persist write warning (T-202). Both can be needed before or without any React tree, and this module
// must not import the store. Text is set with textContent only.

export interface BannerOptions {
    /** DOM id; showing a banner with an id that is already shown returns the existing element (idempotent). */
    id: string;
    title: string;
    body: string;
    dismissLabel: string;
    /** Text direction, e.g. 'rtl' for Arabic. */
    dir?: 'ltr' | 'rtl';
    /** Vertical offset in px added below the first banner, so several banners do not overlap. */
    topOffset?: number;
}

/**
 * Top-centre position (CSS `left`/`top`, used with `translateX(-50%)`) on the display the window is on. The main
 * window is a large ghost window that moves with the sidebar, so callers recompute this when the window or the display
 * changes (T-152).
 */
export function computeBannerPosition(topOffset = 0): { left: string; top: string } {
    const scr = window.screen as Screen & { availLeft?: number; availTop?: number };
    const availWidth = scr?.availWidth ?? 0;
    if (availWidth > 0 && typeof window.screenX === 'number') {
        const left = (scr.availLeft ?? 0) - window.screenX + availWidth / 2;
        const top = (scr.availTop ?? 0) - window.screenY + 16 + topOffset;
        return { left: `${Math.max(0, left)}px`, top: `${Math.max(0, top)}px` };
    }
    return { left: '50%', top: `${16 + topOffset}px` };
}

/** Resize listener of each shown banner, detached when the banner is dismissed or removed (T-152). */
const resizeListeners = new WeakMap<HTMLElement, () => void>();

function detachResize(banner: HTMLElement): void {
    const listener = resizeListeners.get(banner);
    if (listener) window.removeEventListener('resize', listener);
    resizeListeners.delete(banner);
}

function placeBanner(banner: HTMLElement, topOffset: number) {
    const { left, top } = computeBannerPosition(topOffset);
    banner.style.left = left;
    banner.style.top = top;
}

/** Appends the dismissible banner to document.body (once per id). Returns the element, or null without a DOM. */
export function showBanner(options: BannerOptions): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(options.id);
    if (existing) return existing;
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => showBanner(options), { once: true });
        return null;
    }

    const banner = document.createElement('div');
    banner.id = options.id;
    banner.setAttribute('role', 'alert');
    // `pointer-events-auto` makes App's click-through logic treat the banner as solid UI.
    banner.className = 'pointer-events-auto';
    banner.dir = options.dir ?? 'ltr';
    Object.assign(banner.style, {
        position: 'fixed',
        zIndex: '2147483647',
        transform: 'translateX(-50%)',
        width: 'min(480px, calc(100vw - 32px))',
        boxSizing: 'border-box',
        padding: '12px 40px 12px 14px',
        borderRadius: '10px',
        border: '1px solid #b91c1c',
        background: '#1f1414',
        color: '#fde8e8',
        font: '13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        pointerEvents: 'auto',
    });
    const topOffset = options.topOffset ?? 0;
    placeBanner(banner, topOffset);
    // Re-place on window resize (display change). Detached by dismiss/removeBanner, or by itself if the banner was
    // removed some other way (T-152).
    const onResize = () => {
        if (!banner.isConnected) {
            detachResize(banner);
            return;
        }
        placeBanner(banner, topOffset);
    };
    resizeListeners.set(banner, onResize);
    window.addEventListener('resize', onResize);

    const title = document.createElement('div');
    title.textContent = options.title;
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';

    const body = document.createElement('div');
    body.textContent = options.body;

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', options.dismissLabel);
    dismiss.title = options.dismissLabel;
    Object.assign(dismiss.style, {
        position: 'absolute',
        top: '6px',
        insetInlineEnd: '8px',
        width: '26px',
        height: '26px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: 'inherit',
        fontSize: '18px',
        lineHeight: '26px',
        cursor: 'pointer',
    });
    dismiss.addEventListener('click', () => {
        detachResize(banner);
        banner.remove();
    });

    banner.append(title, body, dismiss);
    document.body.appendChild(banner);
    return banner;
}

/** Removes the banner with this id if it is shown. */
export function removeBanner(id: string): void {
    if (typeof document === 'undefined') return;
    const banner = document.getElementById(id);
    if (!banner) return;
    detachResize(banner);
    banner.remove();
}
