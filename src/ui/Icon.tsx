import type { ComponentPropsWithRef } from 'react';
import { cx } from './cx';

/** Icon sizes from the fixed size scale. */
export type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
    /** Material Symbols ligature name, e.g. "settings". */
    name: string;
    /** Selected/active state: 'FILL' 1. */
    filled?: boolean;
    size?: IconSize;
    /** Accessible name. Without it the icon is decorative and hidden from assistive technology. */
    label?: string;
}

const SIZE_CLASS: Record<IconSize, string> = {
    16: 'size-4 text-base',
    20: 'size-5 text-xl',
    24: 'size-6 text-2xl',
};

export function Icon({ name, filled = false, size = 20, label, className, style, ...rest }: IconProps) {
    const labelled = Boolean(label);
    return (
        <span
            {...rest}
            className={cx(
                'material-symbols-outlined inline-flex shrink-0 items-center justify-center leading-none',
                SIZE_CLASS[size],
                className
            )}
            style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 300, 'GRAD' 0, 'opsz' ${size === 24 ? 24 : 20}`, ...style }}
            translate="no"
            role={labelled ? 'img' : undefined}
            aria-label={labelled ? label : undefined}
            aria-hidden={labelled ? undefined : true}
            data-filled={filled ? '' : undefined}
        >
            {name}
        </span>
    );
}
