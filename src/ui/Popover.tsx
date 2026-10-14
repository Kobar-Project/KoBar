import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import {
    cloneElement,
    useCallback,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type FocusEvent,
    type HTMLAttributes,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { focusElement, getFocusable } from './focus';
import { isInLayerAbove, registerLayer, type Layer } from './layers';
import { PopoverCloseContext, type PopoverCloseReason } from './popoverContext';

export type PopoverPlacement = Placement;

export type { PopoverCloseReason } from './popoverContext';

export type PopoverRole = 'dialog' | 'menu' | 'none';

export type PopoverInitialFocus = 'first' | 'content' | 'none' | ((content: HTMLElement) => HTMLElement | null | undefined);

/** Props the popover sets on its trigger element. */
export type PopoverTriggerProps = {
    'aria-expanded'?: boolean;
    'aria-haspopup'?: 'dialog' | 'menu';
    'aria-controls'?: string;
};

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
    /** A single focusable element (the trigger). Clicking it toggles the popover; it gets aria-expanded/-controls. */
    trigger: ReactElement<PopoverTriggerProps>;
    /** Content. Descendants can close the popover with `usePopoverClose()`. */
    children: ReactNode;
    /** Controlled open state (pair with `onOpenChange`). Omit for an uncontrolled popover. */
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean, reason: PopoverCloseReason) => void;
    placement?: PopoverPlacement;
    /** Role of the content: "dialog" (default, give it an aria-label), "menu" (used by Menu) or "none" (generic). */
    role?: PopoverRole;
    /** Where focus goes on open: first focusable child (default), the content box, nowhere, or a custom element. */
    initialFocus?: PopoverInitialFocus;
    /** Return focus to the trigger when closed with Esc, a selection, a dialog opening or programmatically (default true). */
    returnFocus?: boolean;
    /** Keydown bubbling from the trigger (Menu opens on Arrow Up/Down with it). */
    onTriggerKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

const GAP_PX = 4;
const VIEWPORT_PADDING_PX = 4;
// 'force' (a dialog opens above) hands focus to the trigger so the dialog restores it there later.
const RETURN_REASONS: ReadonlySet<PopoverCloseReason> = new Set(['escape', 'select', 'programmatic', 'force']);

/** The real trigger element: skips `display: contents` wrappers (e.g. the Tooltip around an IconButton). */
function resolveTrigger(anchor: HTMLElement | null): HTMLElement | null {
    let el = anchor?.firstElementChild ?? null;
    while (el instanceof HTMLElement && (el.classList.contains('contents') || getComputedStyle(el).display === 'contents')) {
        el = el.firstElementChild;
    }
    return el instanceof HTMLElement ? el : null;
}

/**
 * Anchored, non-modal floating surface: portal to document.body on the popover
 * layer (--kb-z-popover), positioned with @floating-ui/dom, closed by Esc, an outside press, focus leaving it or a
 * dialog opening above it. Focus moves into it on open and back to the trigger on close. Other HTML props (aria-label,
 * className...) go to the content box.
 */
export function Popover({
    trigger,
    children,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    placement = 'bottom-start',
    role = 'dialog',
    initialFocus = 'first',
    returnFocus = true,
    onTriggerKeyDown,
    id,
    className,
    onFocus,
    onBlur,
    ...rest
}: PopoverProps) {
    const autoId = useId();
    const contentId = id ?? `${autoId}-popover`;
    const [innerOpen, setInnerOpen] = useState(defaultOpen);
    const controlled = openProp !== undefined;
    const open = controlled ? openProp : innerOpen;

    const anchorRef = useRef<HTMLSpanElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const layerRef = useRef<Layer | null>(null);
    const focusWithinRef = useRef(false);
    // null = closed from outside (controlled), true/false = closed by close() with a reason that does / does not return focus.
    const returnFocusRef = useRef<boolean | null>(null);
    const wasOpenRef = useRef(open);
    const onOpenChangeRef = useRef(onOpenChange);
    const initialFocusRef = useRef(initialFocus);

    useLayoutEffect(() => {
        onOpenChangeRef.current = onOpenChange;
        initialFocusRef.current = initialFocus;
    });

    const setOpen = useCallback(
        (next: boolean, reason: PopoverCloseReason) => {
            if (!controlled) setInnerOpen(next);
            onOpenChangeRef.current?.(next, reason);
        },
        [controlled]
    );

    const close = useCallback(
        (reason: PopoverCloseReason = 'programmatic') => {
            const shouldReturn = returnFocus && RETURN_REASONS.has(reason);
            const active = document.activeElement;
            // Move focus synchronously while the content still exists, so a dialog opened by a menu item records the
            // trigger (not a removed node) as the element to restore later.
            if (shouldReturn && active && contentRef.current?.contains(active)) focusElement(resolveTrigger(anchorRef.current));
            returnFocusRef.current = shouldReturn;
            setOpen(false, reason);
        },
        [returnFocus, setOpen]
    );

    const closeRef = useRef(close);
    useLayoutEffect(() => {
        closeRef.current = close;
    });

    // Focus return after closing (runs after the content left the DOM).
    useLayoutEffect(() => {
        if (wasOpenRef.current && !open) {
            const shouldReturn = returnFocusRef.current ?? (returnFocus && focusWithinRef.current);
            const active = document.activeElement;
            if (shouldReturn && (!active || active === document.body)) focusElement(resolveTrigger(anchorRef.current));
            focusWithinRef.current = false;
            returnFocusRef.current = null;
        }
        wasOpenRef.current = open;
    }, [open, returnFocus]);

    // Registered in a layout effect, before initial focus, so an enclosing dialog's focus guard already knows the layer.
    useLayoutEffect(() => {
        if (!open) return;
        const layer: Layer = {
            kind: 'popover',
            contains: (node) => Boolean(contentRef.current?.contains(node) || anchorRef.current?.contains(node)),
            onEscape: () => closeRef.current('escape'),
            onOutsidePress: () => closeRef.current('outside'),
            onForceClose: () => closeRef.current('force'),
        };
        layerRef.current = layer;
        const unregister = registerLayer(layer);
        return () => {
            unregister();
            layerRef.current = null;
        };
    }, [open]);

    // Initial focus on open.
    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!open || !content) return;
        const strategy = initialFocusRef.current;
        if (strategy === 'none') return;
        if (typeof strategy === 'function') focusElement(strategy(content) ?? content);
        else if (strategy === 'content') focusElement(content);
        else focusElement(getFocusable(content)[0] ?? content);
    }, [open]);

    useLayoutEffect(() => {
        const reference = resolveTrigger(anchorRef.current);
        const floating = contentRef.current;
        if (!open || !reference || !floating) return;
        let active = true;
        const stop = autoUpdate(reference, floating, () => {
            void computePosition(reference, floating, {
                strategy: 'fixed',
                placement,
                middleware: [offset(GAP_PX), flip(), shift({ padding: VIEWPORT_PADDING_PX })],
            }).then(({ x, y }) => {
                if (!active) return;
                floating.style.left = `${x}px`;
                floating.style.top = `${y}px`;
            });
        });
        return () => {
            active = false;
            stop();
        };
    }, [open, placement]);

    const onTriggerClick = (event: MouseEvent<HTMLSpanElement>) => {
        if (event.defaultPrevented) return;
        if (open) close('trigger');
        else setOpen(true, 'trigger');
    };

    const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
        onFocus?.(event);
        focusWithinRef.current = true;
    };

    const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
        onBlur?.(event);
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        focusWithinRef.current = false;
        // Focus moved to another element of the page (not to the trigger or a layer above): close without stealing it back.
        if (!(next instanceof Node) || anchorRef.current?.contains(next)) return;
        if (layerRef.current && isInLayerAbove(layerRef.current, next)) return;
        close('blur');
    };

    return (
        <>
            {/* `contents`: no box; it only collects the trigger's bubbling click and keydown. */}
            <span ref={anchorRef} className="contents" onClick={onTriggerClick} onKeyDown={onTriggerKeyDown}>
                {cloneElement(trigger, {
                    'aria-expanded': open,
                    'aria-haspopup': role === 'none' ? undefined : role,
                    'aria-controls': open ? contentId : undefined,
                })}
            </span>
            {open &&
                createPortal(
                    <div
                        {...rest}
                        ref={contentRef}
                        id={contentId}
                        role={role === 'none' ? undefined : role}
                        tabIndex={-1}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        className={cx(
                            'kb-pop no-drag-region pointer-events-auto fixed top-0 left-0 z-[var(--kb-z-popover)] max-w-80 min-w-40 rounded-md border border-stroke bg-surface text-[0.8125rem] leading-5 text-fg-1 shadow-e2 outline-hidden',
                            role !== 'menu' && 'p-3',
                            className
                        )}
                    >
                        <PopoverCloseContext.Provider value={close}>{children}</PopoverCloseContext.Provider>
                    </div>,
                    document.body
                )}
        </>
    );
}
