import {
    cloneElement,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import { cx, INTERACTIVE } from './cx';
import { focusElement } from './focus';
import { Icon } from './Icon';
import { IconTile } from './IconTile';
import { Popover, type PopoverCloseReason, type PopoverPlacement, type PopoverTriggerProps } from './Popover';
import { usePopoverClose } from './popoverContext';

interface MenuItemBase {
    id: string;
    label: ReactNode;
    /** Leading Material Symbols icon name. */
    icon?: string;
    disabled?: boolean;
}

export interface MenuActionItem extends MenuItemBase {
    type?: 'item';
    /** Visual hint only, e.g. "Ctrl+D". */
    shortcut?: string;
    /** Destructive action: danger text colour. */
    danger?: boolean;
    onSelect?: () => void;
}

export interface MenuCheckboxItem extends MenuItemBase {
    type: 'checkbox';
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    /** Close the menu after toggling (default false: several options can be toggled in a row). */
    closeOnSelect?: boolean;
}

/**
 * One option of a radio set. A Menu holds a single radio set: the caller keeps exactly one radio item `checked`
 * (grouping several sets with role="group" is not supported).
 */
export interface MenuRadioItem extends MenuItemBase {
    type: 'radio';
    checked: boolean;
    onSelect: () => void;
}

export interface MenuSeparator {
    type: 'separator';
    id?: string;
}

export type MenuItem = MenuActionItem | MenuCheckboxItem | MenuRadioItem | MenuSeparator;

type MenuTriggerProps = PopoverTriggerProps & { id?: string };

/** Optional heading block above the items: icon tile 34 + title + subtitle. */
export interface MenuHeader {
    icon?: string;
    title: ReactNode;
    subtitle?: ReactNode;
}

export interface MenuProps {
    /** A single focusable element. Click, Enter/Space or Arrow Down opens the menu (Arrow Up focuses the last item). */
    trigger: ReactElement<MenuTriggerProps>;
    /** Danger actions belong last, after a separator (the caller orders them). */
    items: readonly MenuItem[];
    header?: MenuHeader;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean, reason: PopoverCloseReason) => void;
    placement?: PopoverPlacement;
    /** Accessible name of the menu; without it the menu is labelled by the trigger. */
    'aria-label'?: string;
    className?: string;
}

const ITEM_SELECTOR = '[data-kb-menu-item]:not([disabled])';
const TYPEAHEAD_RESET_MS = 500;

const ITEM =
    'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-start text-[0.90625rem] leading-5 font-medium transition-colors duration-[var(--kb-dur-fast)] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-fg-3';

// Highlight (hover / keyboard focus) = inset fill; checked radio / checkbox = container + accent icon.
const ITEM_IDLE = 'text-fg-1 hover:bg-inset focus:bg-inset active:bg-[var(--kb-fill-pressed)]';
const ITEM_CHECKED = 'bg-container text-on-container';

// The popover base sets radius, fill, elevation and width; these win with `!` so the menu keeps its own look.
const MENU_BOX = 'flex flex-col rounded-xl! bg-nav! p-2 shadow-e3! min-w-[248px]! max-w-[300px]!';

function enabledItems(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/** Label text only (icon ligatures and shortcuts are excluded from typeahead). */
function labelOf(item: HTMLElement): string {
    return (item.querySelector('[data-kb-menu-label]')?.textContent ?? '').trim().toLocaleLowerCase();
}

function roleOf(item: Exclude<MenuItem, MenuSeparator>): 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' {
    if (item.type === 'checkbox') return 'menuitemcheckbox';
    if (item.type === 'radio') return 'menuitemradio';
    return 'menuitem';
}

/**
 * Action menu on top of Popover: role="menu" with menuitem / menuitemcheckbox / menuitemradio and
 * separators. Arrow Up/Down (wrapping), Home/End and typeahead move focus over enabled items; Enter/Space activates;
 * Esc or Tab closes and returns focus to the trigger.
 */
export function Menu({
    trigger,
    items,
    header,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    placement = 'bottom-start',
    'aria-label': ariaLabel,
    className,
}: MenuProps) {
    const autoId = useId();
    const triggerId = trigger.props.id ?? `${autoId}-trigger`;
    const [innerOpen, setInnerOpen] = useState(defaultOpen);
    const open = openProp ?? innerOpen;
    const focusLastRef = useRef(false);
    const typeaheadRef = useRef({ text: '', timer: undefined as number | undefined });

    useEffect(() => {
        const typeahead = typeaheadRef.current;
        return () => window.clearTimeout(typeahead.timer);
    }, []);

    const setOpen = useCallback(
        (next: boolean, reason: PopoverCloseReason) => {
            if (openProp === undefined) setInnerOpen(next);
            onOpenChange?.(next, reason);
        },
        [openProp, onOpenChange]
    );

    const onTriggerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
        event.preventDefault();
        focusLastRef.current = event.key === 'ArrowUp';
        if (!open) setOpen(true, 'trigger');
    };

    const initialFocus = (menu: HTMLElement) => {
        const list = enabledItems(menu);
        const target = focusLastRef.current ? list[list.length - 1] : list[0];
        focusLastRef.current = false;
        return target;
    };

    const typeahead = (menu: HTMLElement, key: string) => {
        const state = typeaheadRef.current;
        window.clearTimeout(state.timer);
        state.text += key.toLocaleLowerCase();
        state.timer = window.setTimeout(() => {
            state.text = '';
        }, TYPEAHEAD_RESET_MS);
        const list = enabledItems(menu);
        const current = list.indexOf(document.activeElement as HTMLElement);
        // A repeated single letter cycles through the matches; longer input searches from the current item.
        const start = state.text.length === 1 ? current + 1 : Math.max(current, 0);
        for (let i = 0; i < list.length; i++) {
            const item = list[(start + i) % list.length];
            if (labelOf(item).startsWith(state.text)) {
                focusElement(item);
                return;
            }
        }
    };

    const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const menu = event.currentTarget;
        const list = enabledItems(menu);
        const current = list.indexOf(document.activeElement as HTMLElement);
        let next: HTMLElement | undefined;
        switch (event.key) {
            case 'ArrowDown':
                next = list[(current + 1) % list.length];
                break;
            case 'ArrowUp':
                next = list[current <= 0 ? list.length - 1 : current - 1];
                break;
            case 'Home':
                next = list[0];
                break;
            case 'End':
                next = list[list.length - 1];
                break;
            case 'Tab':
                // No Tab stop inside a menu: close it; Popover returns focus to the trigger.
                event.preventDefault();
                setOpen(false, 'programmatic');
                return;
            default:
                if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    typeahead(menu, event.key);
                }
                return;
        }
        event.preventDefault();
        focusElement(next);
    };

    const hasLeading = items.some((item) => item.type === 'checkbox' || item.type === 'radio' || ('icon' in item && item.icon));

    return (
        <Popover
            trigger={cloneElement(trigger, { id: triggerId })}
            onTriggerKeyDown={onTriggerKeyDown}
            open={open}
            onOpenChange={setOpen}
            placement={placement}
            role="menu"
            initialFocus={initialFocus}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : triggerId}
            aria-orientation="vertical"
            className={cx(MENU_BOX, className)}
            onKeyDown={onMenuKeyDown}
        >
            {header && (
                <div className="flex items-center gap-3 px-3 pt-2 pb-3">
                    {header.icon && <IconTile icon={header.icon} size="sm" />}
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate [font:var(--kb-type-body-strong)] text-fg-1">{header.title}</span>
                        {header.subtitle && <span className="truncate [font:var(--kb-type-caption)] text-fg-2">{header.subtitle}</span>}
                    </div>
                </div>
            )}
            {items.map((item, index) =>
                item.type === 'separator' ? (
                    <div key={item.id ?? `separator-${index}`} role="separator" className="my-1 border-t border-stroke" />
                ) : (
                    <MenuRow key={item.id} item={item} reserveLeading={hasLeading} />
                )
            )}
        </Popover>
    );
}

function MenuRow({ item, reserveLeading }: { item: Exclude<MenuItem, MenuSeparator>; reserveLeading: boolean }) {
    const close = usePopoverClose();
    const checkable = item.type === 'checkbox' || item.type === 'radio';
    const action = item.type === 'checkbox' || item.type === 'radio' ? undefined : item;

    const select = () => {
        if (item.type === 'checkbox') {
            if (item.closeOnSelect) close('select');
            item.onCheckedChange(!item.checked);
            return;
        }
        // Close first: focus is back on the trigger before onSelect may open a dialog that records it.
        close('select');
        item.onSelect?.();
    };

    const leadingIcon = checkable ? (item.checked ? 'check' : undefined) : item.icon;
    return (
        <button
            type="button"
            role={roleOf(item)}
            tabIndex={-1}
            disabled={item.disabled}
            aria-checked={checkable ? item.checked : undefined}
            data-kb-menu-item=""
            onClick={select}
            className={cx(
                INTERACTIVE,
                ITEM,
                checkable && item.checked
                    ? ITEM_CHECKED
                    : action?.danger
                      ? 'text-[var(--kb-danger)] hover:bg-inset focus:bg-inset'
                      : ITEM_IDLE
            )}
        >
            {reserveLeading && (
                <span
                    className={cx(
                        'flex size-5 shrink-0 items-center justify-center',
                        checkable && item.checked ? 'text-accent' : action?.danger ? 'text-[var(--kb-danger)]' : 'text-fg-2'
                    )}
                >
                    {leadingIcon && <Icon name={leadingIcon} size={20} filled={checkable} />}
                </span>
            )}
            <span data-kb-menu-label="" className="min-w-0 flex-1 truncate">
                {item.label}
            </span>
            {action?.shortcut && <span className="shrink-0 ps-4 [font:var(--kb-type-caption)] text-fg-3">{action.shortcut}</span>}
        </button>
    );
}
