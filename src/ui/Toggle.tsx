import { useId, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from 'react';
import { cx, INTERACTIVE } from './cx';
import { hasContent } from './fieldProps';
import { Icon } from './Icon';

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
    'relative inline-flex h-8 w-13 shrink-0 items-center rounded-full border-2 transition-colors duration-[var(--kb-dur-fast)] before:absolute before:-inset-1 disabled:cursor-not-allowed disabled:opacity-[var(--kb-opacity-disabled)]';

// Thumb travel: the 48 px inner track minus the 24 px on-thumb minus its 2 px gap = 22 px; the 16 px off-thumb sits 6 px in.
const THUMB =
    'absolute start-0 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full transition-[translate,width,height,background-color] duration-[var(--kb-dur-fast)]';

/**
 * Switch: native <button role="switch" aria-checked>, so Space/Enter and focus come from the
 * browser. 52x32 track (the hit area is enlarged by 4 px), off = inset fill + 2 px control ring + small fg-2 thumb,
 * on = --kb-accent track + 24 px on-accent thumb carrying an accent check. RTL mirrors. `className` styles the wrapper; `ref`,
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
                        '[font:var(--kb-type-body)] select-none',
                        disabled ? 'cursor-not-allowed text-fg-3' : 'cursor-pointer text-fg-1'
                    )}
                >
                    {label}
                </label>
                {descriptionId && (
                    <span id={descriptionId} className="[font:var(--kb-type-caption)] text-fg-2">
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
                        ? 'border-transparent bg-[var(--kb-accent)] enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-accent))]'
                        : 'border-[var(--kb-stroke-control)] bg-inset enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-inset))]'
                )}
            >
                <span
                    aria-hidden="true"
                    className={cx(
                        THUMB,
                        checked
                            ? 'size-6 translate-x-[22px] bg-[var(--kb-on-accent)] rtl:-translate-x-[22px]'
                            : 'size-4 translate-x-1.5 bg-fg-2 rtl:-translate-x-1.5'
                    )}
                >
                    {checked && <Icon name="check" size={16} className="text-accent" />}
                </span>
            </button>
        </div>
    );
}
