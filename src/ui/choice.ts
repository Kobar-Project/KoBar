import type { KeyboardEvent, ReactNode } from 'react';

/** One option of a Tabs or Segmented group. */
export interface ChoiceItem<V extends string = string> {
    value: V;
    label: ReactNode;
    /** Leading Material Symbols icon name (filled while selected). */
    icon?: string;
    disabled?: boolean;
}

/** Marks the roving items so the key handler can find them among the group's direct children. */
export const CHOICE_ITEM_ATTR = 'data-kb-choice';

/** Index that holds tabIndex 0: the selected enabled item, else the first enabled item (-1 when all are disabled). */
export function rovingIndex(items: readonly ChoiceItem[], value: string | undefined): number {
    const selected = items.findIndex((item) => item.value === value && !item.disabled);
    return selected >= 0 ? selected : items.findIndex((item) => !item.disabled);
}

function isRtl(el: HTMLElement): boolean {
    if (getComputedStyle(el).direction === 'rtl') return true;
    return el.closest('[dir]')?.getAttribute('dir') === 'rtl';
}

/**
 * Arrow / Home / End handling for a roving-tabindex group. Moves focus to the next enabled
 * item (wrapping, disabled items skipped, Left/Right mirrored in RTL) and returns its index; null when the key is not
 * handled. Up/Down are only handled when `vertical` is set (radio groups accept all four arrows).
 */
export function moveRovingFocus(event: KeyboardEvent<HTMLElement>, items: readonly ChoiceItem[], vertical: boolean): number | null {
    if (event.altKey || event.ctrlKey || event.metaKey) return null;
    const group = event.currentTarget;
    const buttons = Array.from(group.querySelectorAll<HTMLElement>(`:scope > [${CHOICE_ITEM_ATTR}]`));
    const current = buttons.indexOf(event.target as HTMLElement);
    if (current < 0) return null;

    const forward = isRtl(group) ? -1 : 1;
    let step: number;
    let start = current;
    switch (event.key) {
        case 'ArrowRight':
            step = forward;
            break;
        case 'ArrowLeft':
            step = -forward;
            break;
        case 'ArrowDown':
            if (!vertical) return null;
            step = 1;
            break;
        case 'ArrowUp':
            if (!vertical) return null;
            step = -1;
            break;
        case 'Home':
            step = 1;
            start = -1;
            break;
        case 'End':
            step = -1;
            start = items.length;
            break;
        default:
            return null;
    }

    const count = items.length;
    for (let i = 1; i <= count; i++) {
        const index = (((start + step * i) % count) + count) % count;
        if (!items[index].disabled) {
            event.preventDefault();
            buttons[index]?.focus();
            return index;
        }
    }
    return null;
}

/** Shared visuals of the segmented control (Tabs variant="segmented" and Segmented). */
export const SEGMENTED_LIST = 'no-drag-region pointer-events-auto gap-0.5 rounded-sm border border-stroke bg-[var(--kb-fill-hover)] p-0.5';

export const SEGMENTED_ITEM =
    'inline-flex min-h-7 items-center justify-center gap-2 rounded-xs px-3 text-[0.8125rem] leading-5 whitespace-nowrap transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:text-fg-3';

// Selected = raised neutral surface + shadow (not colour alone).
export const SEGMENTED_ITEM_SELECTED = 'bg-surface text-fg-1 shadow-e1';

export const SEGMENTED_ITEM_IDLE =
    'bg-transparent text-fg-2 enabled:hover:bg-[var(--kb-fill-hover)] enabled:hover:text-fg-1 enabled:active:bg-[var(--kb-fill-pressed)]';
