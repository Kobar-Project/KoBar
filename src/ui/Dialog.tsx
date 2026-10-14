import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { hasContent } from './fieldProps';
import { focusElement, getFocusable, trapTabKey } from './focus';
import { IconButton } from './IconButton';
import { isInLayerAbove, registerLayer, type Layer } from './layers';

export type DialogCloseReason = 'escape' | 'backdrop' | 'close-button';
export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
    open: boolean;
    /** Requested close (Esc, backdrop click or the header close button). The parent sets `open` to false. */
    onClose: (reason: DialogCloseReason) => void;
    /** Visible heading, linked with aria-labelledby. */
    title: ReactNode;
    /** Linked with aria-describedby. */
    description?: ReactNode;
    children?: ReactNode;
    /** Action row (Buttons), end-aligned. */
    footer?: ReactNode;
    /** "alertdialog" for confirmations that interrupt the user. */
    role?: 'dialog' | 'alertdialog';
    size?: DialogSize;
    closeOnEscape?: boolean;
    closeOnBackdrop?: boolean;
    /** Accessible label of the header close button; the button is shown only when this is set. */
    closeLabel?: string;
    /** Element focused on open (default: the first focusable element that is not the close button). */
    initialFocus?: RefObject<HTMLElement | null>;
    /** Focus the previously focused element again on close (default true). */
    returnFocus?: boolean;
    className?: string;
}

const SIZE_CLASS: Record<DialogSize, string> = {
    sm: 'max-w-80',
    md: 'max-w-md',
    lg: 'max-w-lg',
};

/**
 * Modal dialog: portal on the dialog layer (--kb-z-dialog) over the --kb-scrim backdrop,
 * role="dialog" + aria-modal with aria-labelledby/-describedby, Tab/Shift+Tab trapped inside, initial focus, focus
 * restored on close, Esc and backdrop click close it (configurable). Opening it closes open popovers.
 */
export function Dialog(props: DialogProps) {
    return props.open ? <DialogLayer {...props} /> : null;
}

function DialogLayer({
    onClose,
    title,
    description,
    children,
    footer,
    role = 'dialog',
    size = 'md',
    closeOnEscape = true,
    closeOnBackdrop = true,
    closeLabel,
    initialFocus,
    returnFocus = true,
    className,
}: DialogProps) {
    const autoId = useId();
    const titleId = `${autoId}-title`;
    const descriptionId = hasContent(description) ? `${autoId}-description` : undefined;
    const panelRef = useRef<HTMLDivElement>(null);
    const backdropPressRef = useRef(false);
    const latest = useRef({ onClose, closeOnEscape, returnFocus, initialFocus });
    // Captured during the first render, before any commit-phase focus (autoFocus children, initial focus) moves it.
    const [previousAtOpen] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

    useLayoutEffect(() => {
        latest.current = { onClose, closeOnEscape, returnFocus, initialFocus };
    });

    // One layout effect for the whole lifetime, so the focus guard is gone before focus is restored on close and the
    // layer is registered before nested popovers focus their content.
    useLayoutEffect(() => {
        const layer: Layer = {
            kind: 'dialog',
            contains: (node) => Boolean(panelRef.current?.contains(node)),
            onEscape: () => {
                if (latest.current.closeOnEscape) latest.current.onClose('escape');
            },
            // Only the topmost layer gets this, so a press that closes a popover above the dialog never closes the dialog.
            onOutsidePress: () => {
                backdropPressRef.current = true;
            },
        };
        // Registering closes open popovers first; one that held focus hands it back to its trigger, which is preferred over
        // the element captured at render (that one sits inside the popover and is about to be removed).
        const unregister = registerLayer(layer);
        const handedBack = document.activeElement;
        const previous =
            handedBack instanceof HTMLElement &&
            handedBack !== previousAtOpen &&
            handedBack !== document.body &&
            !panelRef.current?.contains(handedBack)
                ? handedBack
                : previousAtOpen;

        // Focus that escapes the dialog (not into a layer above it) is pulled back in.
        const onFocusIn = (event: FocusEvent) => {
            const panel = panelRef.current;
            const target = event.target;
            if (!panel || !(target instanceof Node) || panel.contains(target) || isInLayerAbove(layer, target)) return;
            focusElement(getFocusable(panel)[0] ?? panel);
        };
        document.addEventListener('focusin', onFocusIn);

        const panel = panelRef.current;
        if (panel) {
            const focusable = getFocusable(panel);
            const preferred = latest.current.initialFocus?.current;
            focusElement(preferred ?? focusable.find((el) => !el.hasAttribute('data-kb-dialog-close')) ?? focusable[0] ?? panel);
        }

        return () => {
            document.removeEventListener('focusin', onFocusIn);
            unregister();
            // A previous element that left the DOM meanwhile is skipped silently; focus then stays where the browser puts it.
            if (latest.current.returnFocus && previous && previous !== document.body && previous.isConnected) focusElement(previous);
        };
    }, [previousAtOpen]);

    const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
        const pressed = backdropPressRef.current;
        backdropPressRef.current = false;
        if (pressed && closeOnBackdrop && event.target === event.currentTarget) onClose('backdrop');
    };

    const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // Keys from portalled children (a Popover inside the dialog) bubble here through React; leave them alone.
        if (event.target instanceof Node && event.currentTarget.contains(event.target)) trapTabKey(event, event.currentTarget);
    };

    return createPortal(
        <div
            className="kb-fade no-drag-region pointer-events-auto fixed inset-0 z-[var(--kb-z-dialog)] flex items-center justify-center bg-[var(--kb-scrim)] p-4"
            onClick={onBackdropClick}
        >
            <div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                onKeyDown={onPanelKeyDown}
                className={cx(
                    'kb-pop flex max-h-full w-full flex-col rounded-lg pb-4 border border-stroke bg-surface text-fg-1 shadow-e3 outline-hidden',
                    SIZE_CLASS[size],
                    className
                )}
            >
                <div className="flex items-start gap-2 px-4 pt-4">
                    <h2 id={titleId} className="min-w-0 flex-1 text-[0.9375rem] leading-6 font-semibold text-fg-1">
                        {title}
                    </h2>
                    {closeLabel && (
                        <IconButton
                            icon="close"
                            label={closeLabel}
                            size={28}
                            tooltip={false}
                            data-kb-dialog-close=""
                            className="-me-1"
                            onClick={() => onClose('close-button')}
                        />
                    )}
                </div>
                {descriptionId && (
                    <p id={descriptionId} className="px-4 pt-1 text-[0.8125rem] leading-5 text-fg-2">
                        {description}
                    </p>
                )}
                {hasContent(children) && <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">{children}</div>}
                {hasContent(footer) && <div className="flex flex-wrap justify-end gap-2 px-4 pt-4">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}
