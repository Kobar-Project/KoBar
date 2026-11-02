import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx, INTERACTIVE } from '../ui/cx';
import { Tooltip } from '../ui/Tooltip';
import { tooltipSideForEdge, type BarEdge } from './barEdge';

export interface BarItemProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
    /** Accessible name and tooltip text. */
    label: string;
    /** Active item (open panel): shows the indicator and sets aria-pressed. */
    active?: boolean;
    /** `accent` replaces the neutral idle colours. */
    tone?: 'neutral' | 'accent';
    /** `thin`: the thin-bar item (--kb-bar-item square, radius 14). `cell`: a 2-column grid cell in the wide bar (--kb-tile-cell, radius 10). */
    variant?: 'thin' | 'cell';
    orientation: 'vertical' | 'horizontal';
    edge: BarEdge;
    /** Suppresses the tooltip (settings, dragging, mini mode). */
    tooltipDisabled?: boolean;
    /** Plugin badge: a number (capped at 99+) or a dot. Not rendered for 0. */
    badge?: number | 'dot';
    children: ReactNode;
}

/** Badge shared by items and tiles: 16 px pill (or dot) in the top-end corner. Decorative: the host label carries the meaning. */
export function BarBadge({ value, className }: { value?: number | 'dot'; className?: string }) {
    if (value === undefined || value === 0) return null;
    if (value === 'dot') {
        return (
            <span
                aria-hidden="true"
                data-bar-badge="dot"
                className={cx('pointer-events-none absolute end-0.5 top-0.5 size-2 rounded-full bg-[var(--kb-accent)]', className)}
            />
        );
    }
    return (
        <span
            aria-hidden="true"
            data-bar-badge="number"
            className={cx(
                'kb-num pointer-events-none absolute end-0 top-0 h-4 min-w-4 rounded-full bg-[var(--kb-accent)] px-1 text-center text-[0.625rem] leading-4 font-bold text-[var(--kb-on-accent)]',
                className
            )}
        >
            {value > 99 ? '99+' : value}
        </span>
    );
}

/**
 * Active indicator: 4 px thick, on the side of the bar that faces the screen centre (a bar docked left points right).
 * `outset` moves it past the host's edge (CSS length, negative = outside), `length` is its size along the bar.
 */
export function ActiveIndicator({
    orientation,
    edge,
    length = 18,
    outset = '0px',
}: {
    orientation: 'vertical' | 'horizontal';
    edge: BarEdge;
    length?: number;
    outset?: string;
}) {
    const horizontal = orientation === 'horizontal';
    const side = horizontal ? (edge === 'top' ? 'bottom' : 'top') : edge === 'left' ? 'right' : 'left';
    return (
        <span
            aria-hidden="true"
            data-bar-indicator=""
            data-side={side}
            className={cx(
                'pointer-events-none absolute rounded-full bg-[var(--kb-accent)]',
                horizontal ? 'start-1/2 h-1 -translate-x-1/2 rtl:translate-x-1/2' : 'top-1/2 w-1 -translate-y-1/2'
            )}
            style={{ [side]: outset, ...(horizontal ? { width: length } : { height: length }) }}
        />
    );
}

/**
 * Bar item: square button sized by the density tokens, no resting background (hover fill only), no glow and no scale effect.
 * The active item has an accent glyph (callers pass a filled icon), a 4x18 indicator facing the screen centre and aria-pressed.
 */
export function BarItem({
    label,
    active,
    tone = 'neutral',
    variant = 'thin',
    orientation,
    edge,
    tooltipDisabled = false,
    badge,
    type = 'button',
    className,
    children,
    ...rest
}: BarItemProps) {
    return (
        <Tooltip content={label} side={tooltipSideForEdge(edge)} disabled={tooltipDisabled} describe={false}>
            <button
                {...rest}
                type={type}
                data-bar-item=""
                data-bar-variant={variant}
                aria-label={label}
                aria-pressed={active}
                data-active={active ? 'true' : undefined}
                className={cx(
                    INTERACTIVE,
                    'relative flex shrink-0 items-center justify-center transition-colors duration-[var(--kb-dur-fast)]',
                    variant === 'cell' ? 'size-[var(--kb-tile-cell)] rounded-sm' : 'size-[var(--kb-bar-item)] rounded-md',
                    active || tone === 'accent'
                        ? 'bg-transparent text-[var(--kb-accent)] hover:bg-[var(--kb-fill-hover)] active:bg-[var(--kb-fill-pressed)]'
                        : 'bg-transparent text-fg-2 hover:bg-[var(--kb-fill-hover)] hover:text-fg-1 active:bg-[var(--kb-fill-pressed)]',
                    className
                )}
            >
                {active && <ActiveIndicator orientation={orientation} edge={edge} outset={variant === 'thin' ? '-5px' : '1px'} />}
                {children}
                <BarBadge value={badge} />
            </button>
        </Tooltip>
    );
}

/**
 * Plugin glyph inside a bar item or tile. `size` is a CSS length (default: the --kb-bar-icon token); `filled` selects the
 * filled Material Symbols variant (active item). Decorative: the button's aria-label names it.
 */
export function BarGlyph({
    name,
    filled = false,
    size = 'var(--kb-bar-icon)',
    className,
}: {
    name: string;
    filled?: boolean;
    size?: string;
    className?: string;
}) {
    return (
        <span
            aria-hidden="true"
            translate="no"
            data-filled={filled ? '' : undefined}
            className={cx('kb-icon pointer-events-none leading-none', className)}
            style={{ fontSize: size, fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24` }}
        >
            {name}
        </span>
    );
}

/** Grid cell of the wide bar (icon-size item inside a 2-column grid). */
export function BarCell(props: Omit<BarItemProps, 'variant'>): ReactNode {
    return <BarItem {...props} variant="cell" />;
}
