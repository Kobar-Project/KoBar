import type { ComponentPropsWithRef, HTMLAttributes, KeyboardEvent, Ref } from 'react';
import { CHOICE_ITEM_ATTR, moveRovingFocus, rovingIndex, type ChoiceItem } from './choice';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

export interface SwatchProps extends Omit<ComponentPropsWithRef<'button'>, 'role' | 'aria-checked' | 'type' | 'children' | 'aria-label'> {
    /** Any CSS colour value or a `var(--token)` reference; set through `style`, never through a class. */
    color: string;
    /** Accessible name (the colour's name). Required: a swatch has no visible text. */
    label: string;
    selected?: boolean;
}

/**
 * One 40 px colour circle, a radio of a `SwatchGroup` (or of a custom `role="radiogroup"` that supplies roving tabindex).
 * Selected = check in --kb-on-accent plus a 2 px fg-1 ring with a 3 px gap, so it is not colour alone.
 */
export function Swatch({ color, label, selected = false, className, style, ...rest }: SwatchProps) {
    return (
        <button
            {...rest}
            {...{ [CHOICE_ITEM_ATTR]: '' }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={rest.title ?? label}
            style={{ backgroundColor: color, ...style }}
            className={cx(
                INTERACTIVE,
                'relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--kb-on-accent)] disabled:cursor-not-allowed disabled:opacity-[var(--kb-opacity-disabled)]',
                selected &&
                    'after:pointer-events-none after:absolute after:-inset-[5px] after:rounded-full after:border-2 after:border-fg-1',
                className
            )}
        >
            {selected && <Icon name="check" size={20} />}
        </button>
    );
}

export interface SwatchOption<V extends string = string> {
    value: V;
    label: string;
    color: string;
    disabled?: boolean;
}

export interface SwatchGroupProps<V extends string = string> extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'onChange' | 'role' | 'defaultValue' | 'children'
> {
    options: readonly SwatchOption<V>[];
    value: V;
    onChange: (value: V) => void;
    ref?: Ref<HTMLDivElement>;
}

/**
 * Colour picker: `role="radiogroup"` with roving tabindex; arrows (Left/Right mirrored in RTL, Up/Down too), Home and End move
 * focus and select, like native radios. Name the group with `aria-label` or `aria-labelledby`.
 */
export function SwatchGroup<V extends string = string>({ options, value, onChange, className, onKeyDown, ...rest }: SwatchGroupProps<V>) {
    const items: readonly ChoiceItem<V>[] = options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
    }));
    const focusIndex = rovingIndex(items, value);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const index = moveRovingFocus(event, items, true);
        if (index !== null && options[index].value !== value) onChange(options[index].value);
    };

    return (
        <div
            {...rest}
            role="radiogroup"
            onKeyDown={handleKeyDown}
            className={cx('no-drag-region pointer-events-auto flex flex-wrap items-center gap-3 p-1.5', className)}
        >
            {options.map((option, index) => (
                <Swatch
                    key={option.value}
                    color={option.color}
                    label={option.label}
                    selected={option.value === value}
                    disabled={option.disabled}
                    tabIndex={index === focusIndex ? 0 : -1}
                    onClick={() => {
                        if (option.value !== value) onChange(option.value);
                    }}
                />
            ))}
        </div>
    );
}
