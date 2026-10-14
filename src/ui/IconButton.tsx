import type { ComponentPropsWithRef } from 'react';
import { cx, INTERACTIVE } from './cx';
import { Icon, type IconSize } from './Icon';
import { Tooltip, type TooltipSide } from './Tooltip';

export type IconButtonSize = 28 | 32 | 40;

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
    /** Material Symbols ligature name. */
    icon: string;
    /** Required accessible name (aria-label). Also the default tooltip text. */
    label: string;
    size?: IconButtonSize;
    /** Toggle state: sets aria-pressed and shows the filled icon. */
    pressed?: boolean;
    /** `true` (default) shows `label` as a tooltip, a string shows that text (linked via aria-describedby), `false` none. */
    tooltip?: boolean | string;
    tooltipSide?: TooltipSide;
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
    28: 'size-7',
    32: 'size-8',
    40: 'size-10',
};

const ICON_SIZE: Record<IconButtonSize, IconSize> = {
    28: 16,
    32: 20,
    40: 24,
};

export function IconButton({
    icon,
    label,
    size = 32,
    pressed,
    tooltip = true,
    tooltipSide = 'auto',
    type = 'button',
    className,
    ...rest
}: IconButtonProps) {
    const button = (
        <button
            {...rest}
            type={type}
            aria-label={label}
            aria-pressed={pressed}
            className={cx(
                INTERACTIVE,
                'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:opacity-[var(--kb-opacity-disabled)]',
                pressed
                    ? 'bg-[var(--kb-accent-subtle)] text-[var(--kb-accent)]'
                    : 'bg-transparent text-fg-2 enabled:hover:bg-[var(--kb-fill-hover)] enabled:hover:text-fg-1 enabled:active:bg-[var(--kb-fill-pressed)]',
                SIZE_CLASS[size],
                className
            )}
        >
            <Icon name={icon} size={ICON_SIZE[size]} filled={pressed === true} />
        </button>
    );

    if (tooltip === false) return button;
    const custom = typeof tooltip === 'string';
    return (
        <Tooltip content={custom ? tooltip : label} side={tooltipSide} describe={custom && tooltip !== label}>
            {button}
        </Tooltip>
    );
}
