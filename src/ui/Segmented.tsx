import type { HTMLAttributes, KeyboardEvent, Ref } from 'react';
import {
    moveRovingFocus,
    rovingIndex,
    SEGMENTED_ITEM,
    SEGMENTED_ITEM_IDLE,
    SEGMENTED_ITEM_SELECTED,
    SEGMENTED_LIST,
    type ChoiceItem,
} from './choice';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

export type SegmentedItem<V extends string = string> = ChoiceItem<V>;

export interface SegmentedProps<V extends string = string> extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'onChange' | 'role' | 'defaultValue' | 'children'
> {
    items: readonly SegmentedItem<V>[];
    /** Controlled selected value. */
    value: V;
    onChange: (value: V) => void;
    /** Stretch to the container width with equal items. */
    fullWidth?: boolean;
    ref?: Ref<HTMLDivElement>;
}

/**
 * Segmented value picker (role="radiogroup"/"radio"; replaces the copied segment controls). Controlled;
 * roving tabindex, all four arrows (Left/Right mirrored in RTL), Home and End move and select like native radios;
 * disabled items are skipped. Name the group with `aria-label` or `aria-labelledby`. Same visuals as
 * `<Tabs variant="segmented">`, which is for switching panels.
 */
export function Segmented<V extends string = string>({
    items,
    value,
    onChange,
    fullWidth = false,
    className,
    onKeyDown,
    ...rest
}: SegmentedProps<V>) {
    const focusIndex = rovingIndex(items, value);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const index = moveRovingFocus(event, items, true);
        if (index !== null && items[index].value !== value) onChange(items[index].value);
    };

    return (
        <div
            {...rest}
            role="radiogroup"
            onKeyDown={handleKeyDown}
            className={cx(SEGMENTED_LIST, fullWidth ? 'flex w-full' : 'inline-flex', className)}
        >
            {items.map((item, index) => {
                const selected = item.value === value;
                return (
                    <button
                        key={item.value}
                        data-kb-choice=""
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        tabIndex={index === focusIndex ? 0 : -1}
                        disabled={item.disabled}
                        onClick={() => {
                            if (!selected) onChange(item.value);
                        }}
                        className={cx(
                            INTERACTIVE,
                            SEGMENTED_ITEM,
                            selected ? SEGMENTED_ITEM_SELECTED : SEGMENTED_ITEM_IDLE,
                            fullWidth && 'flex-1'
                        )}
                    >
                        {item.icon && <Icon name={item.icon} size={16} filled={selected} />}
                        <span>{item.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
