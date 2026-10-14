import { useId, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from 'react';
import { cx, INTERACTIVE } from './cx';
import { hasContent } from './fieldProps';

export interface ToggleProps extends Omit<
    ComponentPropsWithRef<'button'>,
    'onChange' | 'children' | 'role' | 'aria-checked' | 'type' | 'value'
> {
    checked: boolean;
    onChange: (checked: boolean) => void;
    /** Visible label, associated via <label htmlFor> (clicking it toggles too). */
    label: ReactNode;
    /** Secondary text below the label, linked with aria-describedby. */
    description?: ReactNode;
    /** Keeps label/description for assistive technology only (e.g. in a ListItem whose title already shows it). */
    hideLabel?: boolean;
    /** Block layout spanning the container (label start, switch end) instead of inline. */
    fullWidth?: boolean;
}

const TRACK =
    'relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-[var(--kb-dur-fast)] before:absolute before:-inset-1 disabled:cursor-not-allowed disabled:opacity-[var(--kb-opacity-disabled)]';

/**
 * Switch: native <button role="switch" aria-checked>, so Space/Enter and focus come from the
 * browser. 40x20 track (the hit area is enlarged to 48x28), on = --kb-accent. `className` styles the wrapper; `ref`,
 * `id` and other button props go to the switch.
 */
export function Toggle({
    checked,
    onChange,
    label,
    description,
    hideLabel = false,
    fullWidth = false,
    disabled,
    id,
    className,
    onClick,
    ...rest
}: ToggleProps) {
    const autoId = useId();
    const switchId = id ?? `${autoId}-switch`;
    const descriptionId = hasContent(description) ? `${autoId}-description` : undefined;

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange(!checked);
    };

    return (
        <div className={cx('no-drag-region pointer-events-auto items-center gap-3', fullWidth ? 'flex w-full' : 'inline-flex', className)}>
            <span className={cx('flex min-w-0 flex-1 flex-col', hideLabel && 'sr-only')}>
                <label
                    htmlFor={switchId}
                    className={cx(
                        'text-[0.8125rem] leading-5 select-none',
                        disabled ? 'cursor-not-allowed text-fg-3' : 'cursor-pointer text-fg-1'
                    )}
                >
                    {label}
                </label>
                {descriptionId && (
                    <span id={descriptionId} className="text-[0.6875rem] leading-4 text-fg-2">
                        {description}
                    </span>
                )}
            </span>
            <button
                {...rest}
                id={switchId}
                type="button"
                role="switch"
                aria-checked={checked}
                aria-describedby={cx(descriptionId, rest['aria-describedby']) || undefined}
                disabled={disabled}
                onClick={handleClick}
                className={cx(
                    INTERACTIVE,
                    TRACK,
                    checked
                        ? 'border-transparent bg-[var(--kb-accent)] enabled:hover:bg-[var(--kb-accent-hover)]'
                        : 'border-[var(--kb-stroke-control)] bg-transparent enabled:hover:bg-[var(--kb-fill-hover)]'
                )}
            >
                <span
                    aria-hidden="true"
                    className={cx(
                        'size-3 rounded-full transition-transform duration-[var(--kb-dur-fast)]',
                        checked ? 'translate-x-5.5 bg-[var(--kb-on-accent)] rtl:-translate-x-5.5' : 'translate-x-0 bg-fg-2'
                    )}
                />
            </button>
        </div>
    );
}
