import { useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';
import { hasContent } from './fieldProps';
import { focusElement, getFocusable, trapTabKey } from './focus';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { registerLayer, type Layer } from './layers';
import { Surface } from './Surface';

export type PanelShellSize = 's' | 'm' | 'l';
/** Screen edge the bar is docked to; the panel slides in from that side. */
export type PanelShellPosition = 'left' | 'right' | 'top' | 'bottom';
export type PanelShellCloseReason = 'escape' | 'close-button';

export interface PanelShellProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'role' | 'children'> {
    /** Visible heading, linked with aria-labelledby. */
    title: ReactNode;
    /** Material Symbols ligature name shown before the title (decorative). */
    icon?: string;
    /** Header actions (IconButtons), placed before the close button. */
    actions?: ReactNode;
    /** Requested close (Esc or the close button). The host unmounts the panel. */
    onClose: (reason: PanelShellCloseReason) => void;
    /** Required accessible label of the close button. */
    closeLabel: string;
    /** Scrollable body. */
    children?: ReactNode;
    /** Optional action row under the body, end-aligned. */
    footer?: ReactNode;
    /** Size preset: s 320x440, m 400x560 (default), l 480x640 (max height; the content decides below that). */
    size?: PanelShellSize;
    position?: PanelShellPosition;
    closeOnEscape?: boolean;
    /** Element focused on open (default: the first focusable element of the body, then of the header actions). */
    initialFocus?: RefObject<HTMLElement | null>;
    /** Focus the opener again on close while focus is still inside the panel (default true). */
    returnFocus?: boolean;
    /** 16 px body padding (default true); false for edge-to-edge lists. */
    padded?: boolean;
}

const SIZE_CLASS: Record<PanelShellSize, string> = {
    s: 'w-80 max-h-110',
    m: 'w-100 max-h-140',
    l: 'w-120 max-h-160',
};

// kb-slide reads its start offset from these properties (src/index.css): the panel comes in from the bar's side.
const POSITION_CLASS: Record<PanelShellPosition, string> = {
    right: '[--kb-slide-x:8px] [--kb-slide-y:0px]',
    left: '[--kb-slide-x:-8px] [--kb-slide-y:0px]',
    top: '[--kb-slide-x:0px] [--kb-slide-y:-8px]',
    bottom: '[--kb-slide-x:0px] [--kb-slide-y:8px]',
};

const CLOSE_ATTR = 'data-kb-panel-close';

/**
 * Host panel frame: a 44 px header (icon, title, actions, close), a scrollable
 * body and an optional footer on the panel layer (--kb-z-panel), panel material and e3 elevation. Non-modal
 * role="dialog" (no aria-modal, no scrim, outside presses do nothing). Esc closes it through the shared layer stack only
 * while it is the top layer, so an open Popover or Dialog inside closes first. Focus moves in on open, Tab wraps inside,
 * and focus returns to the opener on close. The host mounts it while open and positions it: no position class is set
 * here, so the host passes one (fixed/absolute/relative via className or style), which --kb-z-panel needs to apply.
 */
export function PanelShell({
    title,
    icon,
    actions,
    onClose,
    closeLabel,
    children,
    footer,
    size = 'm',
    position = 'right',
    closeOnEscape = true,
    initialFocus,
    returnFocus = true,
    padded = true,
    className,
    onKeyDown,
    ...rest
}: PanelShellProps) {
    const titleId = `${useId()}-title`;
    const panelRef = useRef<HTMLElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ onClose, closeOnEscape, returnFocus, initialFocus });
    // Captured during the first render, before any commit-phase focus moves it.
    const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

    useLayoutEffect(() => {
        latest.current = { onClose, closeOnEscape, returnFocus, initialFocus };
    });

    // Registered in a layout effect so layers opened later from inside the panel stack above it.
    useLayoutEffect(() => {
        const layer: Layer = {
            kind: 'panel',
            contains: (node) => Boolean(panelRef.current?.contains(node)),
            onEscape: () => {
                if (latest.current.closeOnEscape) latest.current.onClose('escape');
            },
        };
        const unregister = registerLayer(layer);

        const panel = panelRef.current;
        if (panel) {
            const preferred = latest.current.initialFocus?.current;
            const inBody = bodyRef.current ? getFocusable(bodyRef.current)[0] : undefined;
            const inHeader = getFocusable(panel).find((el) => !el.hasAttribute(CLOSE_ATTR));
            focusElement(preferred ?? inBody ?? inHeader ?? panel);
        }

        return () => {
            unregister();
            // Non-modal: if the user already moved focus elsewhere (e.g. the bar), leave it there.
            const active = document.activeElement;
            const focusInside = !active || active === document.body || Boolean(panel?.contains(active));
            if (latest.current.returnFocus && focusInside && opener && opener !== document.body && opener.isConnected) focusElement(opener);
        };
    }, [opener]);

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(event);
        // Keys from portalled children (a Popover inside the panel) bubble here through React; leave them alone.
        if (!event.defaultPrevented && event.target instanceof Node && event.currentTarget.contains(event.target)) {
            trapTabKey(event, event.currentTarget);
        }
    };

    return (
        <Surface
            {...rest}
            ref={panelRef}
            as="section"
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            level="shell"
            material
            elevation="e3"
            radius="lg"
            data-size={size}
            data-position={position}
            onKeyDown={handleKeyDown}
            className={cx(
                'kb-slide no-drag-region z-[var(--kb-z-panel)] flex max-w-full flex-col overflow-hidden outline-hidden',
                SIZE_CLASS[size],
                POSITION_CLASS[position],
                className
            )}
        >
            <div className="flex h-11 shrink-0 items-center gap-2 ps-4 pe-2">
                {icon && <Icon name={icon} size={20} className="text-fg-2" />}
                <h2 id={titleId} className="min-w-0 flex-1 truncate text-[0.9375rem] leading-[1.375rem] font-semibold text-fg-1">
                    {title}
                </h2>
                {hasContent(actions) && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
                <IconButton
                    icon="close"
                    label={closeLabel}
                    tooltip={false}
                    data-kb-panel-close=""
                    onClick={() => onClose('close-button')}
                />
            </div>
            <div ref={bodyRef} className={cx('min-h-0 flex-1 overflow-y-auto', padded && 'px-4 pb-4')}>
                {children}
            </div>
            {hasContent(footer) && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stroke px-4 py-3">{footer}</div>
            )}
        </Surface>
    );
}
