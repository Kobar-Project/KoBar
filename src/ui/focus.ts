import type { KeyboardEvent } from 'react';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]',
].join(',');

/** Keyboard-reachable descendants in DOM order (tabindex="-1", hidden and inert subtrees excluded). */
export function getFocusable(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getAttribute('aria-hidden') !== 'true'
    );
}

/** Focuses without scrolling the frameless window. */
export function focusElement(el: HTMLElement | null | undefined): void {
    el?.focus({ preventScroll: true });
}

/** Keeps Tab / Shift+Tab inside `container` (wraps at both ends; focuses the container when nothing is focusable). */
export function trapTabKey(event: KeyboardEvent<HTMLElement>, container: HTMLElement): void {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = getFocusable(container);
    if (items.length === 0) {
        event.preventDefault();
        focusElement(container);
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === container || !container.contains(active))) {
        event.preventDefault();
        focusElement(last);
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        focusElement(first);
    }
}
