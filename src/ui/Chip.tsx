import type { ComponentPropsWithRef } from 'react';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-pressed'> {
    /** Selected state: sets aria-pressed, container fill and a leading check (no outline). */
    selected?: boolean;
}

/** Filter / quick-choice chip (32 px, radius 10). A toggle button: `aria-pressed` reflects `selected`. */
export function Chip({ selected = false, type = 'button', className, children, ...rest }: ChipProps) {
    return (
        <button
            {...rest}
            type={type}
            aria-pressed={selected}
            className={cx(
                INTERACTIVE,
                'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border px-3 [font:var(--kb-type-label)] whitespace-nowrap transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-inset disabled:text-fg-3',
                selected
                    ? 'border-transparent bg-container text-on-container enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-container))]'
                    : 'border-[var(--kb-stroke-control)] bg-transparent text-fg-1 enabled:hover:bg-[var(--kb-fill-hover)] enabled:active:bg-[var(--kb-fill-pressed)]',
                className
            )}
        >
            {selected && <Icon name="check" size={16} className="text-accent" />}
            {children}
        </button>
    );
}
