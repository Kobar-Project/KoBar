import type { ComponentPropsWithRef } from 'react';
import { cx, INTERACTIVE } from './cx';
import { Icon, type IconSize } from './Icon';
import { Tooltip, type TooltipSide } from './Tooltip';

/** 32 / 36 / 44 are the Canlı circle sizes; 28 (dense inline) and 40 stay for existing call sites. */
export type IconButtonSize = 28 | 32 | 36 | 40 | 44;
export type IconButtonVariant = 'standard' | 'tonal' | 'filled';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
    /** Material Symbols ligature name. */
    icon: string;
    /** Required accessible name (aria-label). Also the default tooltip text. */
    label: string;
    size?: IconButtonSize;
    /** standard: transparent, fg-2. tonal: inset fill. filled: accent. `pressed` overrides all three with container + accent glyph. */
    variant?: IconButtonVariant;
    /** Toggle state: sets aria-pressed and shows the filled icon. */
    pressed?: boolean;
    /** `true` (default) shows `label` as a tooltip, a string shows that text (linked via aria-describedby), `false` none. */
    tooltip?: boolean | string;
    tooltipSide?: TooltipSide;
}

const SIZE_CLASS: Record<IconButtonSize, string> = {
    28: 'size-7',
    32: 'size-8',
    36: 'size-9',
    40: 'size-10',
    44: 'size-11',
};

const ICON_SIZE: Record<IconButtonSize, IconSize> = {
    28: 16,
    32: 20,
    36: 20,
    40: 24,
    44: 24,
};

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
    standard:
        'bg-transparent text-fg-2 enabled:hover:bg-[var(--kb-fill-hover)] enabled:hover:text-fg-1 enabled:active:bg-[var(--kb-fill-pressed)]',
    tonal: 'bg-inset text-fg-2 enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-inset))] enabled:hover:text-fg-1 enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-bg-inset))]',
    filled: 'bg-[var(--kb-accent)] text-[var(--kb-on-accent)] enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-accent))] enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-accent))]',
};

const PRESSED_CLASS =
    'bg-container text-accent enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-container))] enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-bg-container))]';

export function IconButton({
    icon,
    label,
    size = 32,
    variant = 'standard',
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
                'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:bg-inset disabled:text-fg-3',
                pressed ? PRESSED_CLASS : VARIANT_CLASS[variant],
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
