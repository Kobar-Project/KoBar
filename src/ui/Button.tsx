import type { ComponentPropsWithRef, MouseEvent } from 'react';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

/**
 * Canlı variants. The v1 names stay as aliases so no call site breaks: `primary` = filled, `secondary` = tonal,
 * `subtle` = text.
 */
export type ButtonVariant = 'filled' | 'tonal' | 'outline' | 'text' | 'danger' | 'primary' | 'secondary' | 'subtle';
export type ButtonSize = 'sm' | 'md';

type CanonicalVariant = 'filled' | 'tonal' | 'outline' | 'text' | 'danger';

const VARIANT_ALIAS: Record<ButtonVariant, CanonicalVariant> = {
    filled: 'filled',
    tonal: 'tonal',
    outline: 'outline',
    text: 'text',
    danger: 'danger',
    primary: 'filled',
    secondary: 'tonal',
    subtle: 'text',
};

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
    /** At most one `filled` (alias `primary`) button per screen. */
    variant?: ButtonVariant;
    /** `md` follows the density token --kb-control-h, `sm` is 32 px with the label font. */
    size?: ButtonSize;
    /** Leading Material Symbols icon name. */
    icon?: string;
    /** Shows a spinner, sets aria-busy and ignores clicks while keeping focus (no native `disabled`). */
    loading?: boolean;
    fullWidth?: boolean;
}

const BASE =
    'inline-flex items-center justify-center gap-2 rounded-full border whitespace-nowrap transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed aria-disabled:cursor-not-allowed';

const SIZE_CLASS: Record<ButtonSize, string> = {
    sm: 'h-8 px-3.5 [font:var(--kb-type-label)]',
    md: 'h-[var(--kb-control-h)] px-[18px] [font:var(--kb-type-body-strong)]',
};

// Hover and pressed mix --kb-fg-1 into the fill (6 % / 10 %, the --kb-fill-* strengths); pressed is never a scale.
const VARIANT_CLASS: Record<CanonicalVariant, string> = {
    filled: 'border-transparent bg-[var(--kb-accent)] text-[var(--kb-on-accent)] enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-accent))] enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-accent))] disabled:bg-inset disabled:text-fg-3',
    tonal: 'border-transparent bg-container text-on-container enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-container))] enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-bg-container))] disabled:bg-inset disabled:text-fg-3',
    outline:
        'border-[var(--kb-stroke-control)] bg-transparent text-fg-1 enabled:hover:bg-[var(--kb-fill-hover)] enabled:active:bg-[var(--kb-fill-pressed)] disabled:bg-inset disabled:text-fg-3',
    text: 'border-transparent bg-transparent text-accent-text enabled:hover:bg-[var(--kb-fill-hover)] enabled:active:bg-[var(--kb-fill-pressed)] disabled:text-fg-3',
    danger: 'border-transparent bg-[var(--kb-danger)] text-[var(--kb-on-danger)] enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-danger))] enabled:active:bg-[color-mix(in_oklab,var(--kb-fg-1)_10%,var(--kb-danger))] disabled:bg-inset disabled:text-fg-3',
};

export function Button({
    variant = 'tonal',
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
            className={cx(INTERACTIVE, BASE, SIZE_CLASS[size], VARIANT_CLASS[VARIANT_ALIAS[variant]], fullWidth && 'w-full', className)}
            aria-busy={loading || undefined}
            aria-disabled={loading || rest['aria-disabled'] || undefined}
            onClick={handleClick}
        >
            {loading ? (
                <Icon name="progress_activity" size={size === 'sm' ? 16 : 18} className="kb-spin animate-spin motion-reduce:animate-none" />
            ) : (
                icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />
            )}
            {children}
        </button>
    );
}
