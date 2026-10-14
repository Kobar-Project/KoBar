import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx, INTERACTIVE } from '../ui/cx';
import { Tooltip } from '../ui/Tooltip';
import { tooltipSideForEdge, type BarEdge } from './barEdge';

export interface BarItemProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
    /** Accessible name and tooltip text. */
    label: string;
    /** Active item (open panel): shows the indicator bar and sets aria-pressed. */
    active?: boolean;
    /** `accent` replaces the neutral idle colours (eye button). */
    tone?: 'neutral' | 'accent';
    orientation: 'vertical' | 'horizontal';
    edge: BarEdge;
    /** Suppresses the tooltip (settings, dragging, mini mode). */
    tooltipDisabled?: boolean;
    children: ReactNode;
}

/**
 * Bar item (T-618): square button sized by the density tokens (--kb-bar-item), no resting background (hover highlight
 * only, R-10), no glow and no scale effect. The active item carries an accent indicator bar on the left (vertical bar)
 * or the bottom (horizontal bar) and aria-pressed.
 */
export function BarItem({
    label,
    active,
    tone = 'neutral',
    orientation,
    edge,
    tooltipDisabled = false,
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
                aria-label={label}
                aria-pressed={active}
                data-active={active ? 'true' : undefined}
                className={cx(
                    INTERACTIVE,
                    'relative flex size-[var(--kb-bar-item)] shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--kb-dur-fast)]',
                    active
                        ? 'bg-transparent text-[var(--kb-accent)] hover:bg-[var(--kb-fill-hover)] active:bg-[var(--kb-fill-pressed)]'
                        : tone === 'accent'
                          ? 'bg-transparent text-[var(--kb-accent)] hover:bg-[var(--kb-fill-hover)] active:bg-[var(--kb-fill-pressed)]'
                          : 'bg-transparent text-fg-2 hover:bg-[var(--kb-fill-hover)] hover:text-fg-1 active:bg-[var(--kb-fill-pressed)]',
                    className
                )}
            >
                {active && (
                    <span
                        aria-hidden="true"
                        data-bar-indicator=""
                        className={cx(
                            'pointer-events-none absolute rounded-full bg-[var(--kb-accent)]',
                            orientation === 'horizontal' ? 'inset-x-2 bottom-0 h-[3px]' : 'inset-y-2 left-0 w-[3px]'
                        )}
                    />
                )}
                {children}
            </button>
        </Tooltip>
    );
}
