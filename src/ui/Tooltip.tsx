import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'auto' | 'top' | 'bottom' | 'left' | 'right';

type DescribableProps = { 'aria-describedby'?: string };

export interface TooltipProps {
    content: ReactNode;
    /** A single focusable element (the trigger). It receives aria-describedby while the tooltip is open. */
    children: ReactElement<DescribableProps>;
    side?: TooltipSide;
    /** Hover delay in ms; keyboard focus shows the tooltip immediately. */
    delay?: number;
    /** Suppresses the tooltip (e.g. the "show tooltips" setting). */
    disabled?: boolean;
    /**
     * Link the tooltip to the trigger with aria-describedby (default). Turn off when the content repeats the
     * trigger's accessible name (IconButton label) so screen readers do not announce it twice.
     */
    describe?: boolean;
}

const GAP_PX = 6;
const VIEWPORT_PADDING_PX = 4;

/**
 * Hover + keyboard-focus tooltip: role="tooltip", portal to document.body on the
 * tooltip layer (--kb-z-tooltip), Esc dismisses, positioned with @floating-ui/dom.
 */
export function Tooltip({ content, children, side = 'auto', delay = 500, disabled = false, describe = true }: TooltipProps) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<number | undefined>(undefined);
    const focusedRef = useRef(false);
    // Set by pointerdown until the end of the task, so the focus that a mouse click causes does not open the tooltip.
    const pointerFocusRef = useRef(false);
    const pointerTimerRef = useRef<number | undefined>(undefined);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== undefined) {
            window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
    }, []);

    const hide = useCallback(() => {
        clearTimer();
        setOpen(false);
    }, [clearTimer]);

    // Turning `disabled` on while open hides the tooltip (state adjusted during render, not in an effect).
    const [prevDisabled, setPrevDisabled] = useState(disabled);
    if (disabled !== prevDisabled) {
        setPrevDisabled(disabled);
        if (disabled) setOpen(false);
    }
    const visible = open && !disabled;

    const show = (wait: number) => {
        clearTimer();
        if (disabled) return;
        if (wait <= 0) setOpen(true);
        else timerRef.current = window.setTimeout(() => setOpen(true), wait);
    };

    useEffect(() => {
        if (disabled) clearTimer();
    }, [disabled, clearTimer]);

    useEffect(
        () => () => {
            clearTimer();
            window.clearTimeout(pointerTimerRef.current);
        },
        [clearTimer]
    );

    useEffect(() => {
        if (!visible) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hide();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [visible, hide]);

    useLayoutEffect(() => {
        const trigger = anchorRef.current?.firstElementChild;
        const tip = tipRef.current;
        if (!visible || !trigger || !tip) return;
        const placement: Placement = side === 'auto' ? 'top' : side;
        let active = true;
        const stop = autoUpdate(trigger, tip, () => {
            void computePosition(trigger, tip, {
                strategy: 'fixed',
                placement,
                middleware: [offset(GAP_PX), flip(), shift({ padding: VIEWPORT_PADDING_PX })],
            }).then(({ x, y }) => {
                if (!active) return;
                tip.style.left = `${x}px`;
                tip.style.top = `${y}px`;
                tip.style.visibility = 'visible';
            });
        });
        return () => {
            active = false;
            stop();
        };
    }, [visible, side]);

    const onPointerDown = () => {
        hide();
        pointerFocusRef.current = true;
        window.clearTimeout(pointerTimerRef.current);
        pointerTimerRef.current = window.setTimeout(() => {
            pointerFocusRef.current = false;
        }, 0);
    };

    const onFocus = () => {
        // Only keyboard focus keeps the tooltip open after the mouse leaves.
        focusedRef.current = !pointerFocusRef.current;
        if (focusedRef.current) show(0);
    };

    const onBlur = () => {
        focusedRef.current = false;
        hide();
    };

    const describedBy =
        visible && describe ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'];

    return (
        <>
            {/* `contents`: the wrapper adds no box; it only collects bubbling events from the trigger. */}
            <span
                ref={anchorRef}
                className="contents"
                onMouseEnter={() => show(delay)}
                onMouseLeave={() => {
                    if (!focusedRef.current) hide();
                }}
                onPointerDown={onPointerDown}
                onFocus={onFocus}
                onBlur={onBlur}
            >
                {cloneElement(children, { 'aria-describedby': describedBy })}
            </span>
            {visible &&
                createPortal(
                    <div
                        ref={tipRef}
                        id={id}
                        role="tooltip"
                        className="kb-fade pointer-events-none fixed top-0 left-0 z-[var(--kb-z-tooltip)] max-w-60 rounded-md border border-stroke bg-surface px-2 py-1 text-[0.6875rem] leading-4 text-fg-1 shadow-e2"
                        style={{ visibility: 'hidden' }}
                    >
                        {content}
                    </div>,
                    document.body
                )}
        </>
    );
}
