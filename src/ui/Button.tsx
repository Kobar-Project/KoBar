import type { ComponentPropsWithRef, MouseEvent } from 'react';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
    /** At most one `primary` button per screen. */
    variant?: ButtonVariant;
    /** `md` follows the density token --kb-control-h, `sm` is the 28 px minimum target. */
    size?: ButtonSize;
    /** Leading Material Symbols icon name. */
    icon?: string;
    /** Shows a spinner, sets aria-busy and ignores clicks while keeping focus (no native `disabled`). */
    loading?: boolean;
    fullWidth?: boolean;
}

const BASE =
    'inline-flex items-center justify-center gap-2 rounded-sm border text-[0.8125rem] leading-5 font-semibold whitespace-nowrap transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed aria-disabled:cursor-not-allowed';

const SIZE_CLASS: Record<ButtonSize, string> = {
    sm: 'h-7 px-2',
    md: 'h-[var(--kb-control-h)] px-3',
};

// Pressed state is a fill change, never a scale.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
    primary:
        'border-transparent bg-[var(--kb-accent)] text-[var(--kb-on-accent)] enabled:hover:bg-[var(--kb-accent-hover)] enabled:active:bg-[var(--kb-accent-pressed)] disabled:bg-[var(--kb-fill-selected)] disabled:text-fg-3',
    secondary:
        'border-stroke bg-[var(--kb-fill-hover)] text-fg-1 enabled:hover:bg-[var(--kb-fill-selected)] enabled:active:bg-[var(--kb-fill-pressed)] disabled:text-fg-3',
    subtle: 'border-transparent bg-transparent text-fg-1 enabled:hover:bg-[var(--kb-fill-hover)] enabled:active:bg-[var(--kb-fill-pressed)] disabled:text-fg-3',
    danger: 'border-transparent bg-[var(--kb-danger)] text-shell enabled:hover:bg-[color-mix(in_oklab,var(--kb-danger)_88%,transparent)] enabled:active:bg-[color-mix(in_oklab,var(--kb-danger)_80%,transparent)] disabled:bg-[var(--kb-fill-selected)] disabled:text-fg-3',
};

export function Button({
    variant = 'secondary',
    size = 'md',
    icon,
    loading = false,
    fullWidth = false,
    type = 'button',
    className,
    children,
    onClick,
    ...rest
}: ButtonProps) {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        if (loading) {
            event.preventDefault();
            return;
        }
        onClick?.(event);
    };

    return (
        <button
            {...rest}
            type={type}
            className={cx(INTERACTIVE, BASE, SIZE_CLASS[size], VARIANT_CLASS[variant], fullWidth && 'w-full', className)}
            aria-busy={loading || undefined}
            aria-disabled={loading || rest['aria-disabled'] || undefined}
            onClick={handleClick}
        >
            {loading ? (
                <Icon name="progress_activity" size={16} className="kb-spin animate-spin motion-reduce:animate-none" />
            ) : (
                icon && <Icon name={icon} size={16} />
            )}
            {children}
        </button>
    );
}
