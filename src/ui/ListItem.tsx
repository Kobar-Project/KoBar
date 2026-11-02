import { createElement, type HTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import { cx, INTERACTIVE } from './cx';
import { hasContent } from './fieldProps';
import { Icon } from './Icon';

export type ListItemCurrent = 'page' | 'step' | 'location' | 'date' | 'time' | 'true';

export interface ListItemProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onClick'> {
    /** Root element; use "li" inside a <ul>/<ol>. */
    as?: 'div' | 'li';
    title: ReactNode;
    description?: ReactNode;
    /** Material Symbols name (decorative 20 px icon, filled while selected) or any custom node. */
    leading?: ReactNode;
    /** Slot after the text (Toggle, chevron, badge...). Rendered outside the row button, so it may hold controls. */
    trailing?: ReactNode;
    /** Makes the row interactive: title/description/leading become one native <button>. */
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    /** `row` (default): radius 14 list row. `nav`: full-radius navigation pill (min 44 px, labels wrap, current = container + filled accent icon). */
    variant?: 'row' | 'nav';
    /** Selected/active row: container fill + 3 px accent bar + aria-current (nav: container fill + accent filled icon). */
    selected?: boolean;
    /** aria-current token used while `selected` (default "true"; "page" for navigation). */
    current?: ListItemCurrent;
    disabled?: boolean;
    ref?: Ref<HTMLElement>;
    /** Ref of the row button (only when `onClick` is set). */
    buttonRef?: Ref<HTMLButtonElement>;
}

const ROOT =
    'no-drag-region pointer-events-auto relative flex min-h-[var(--kb-row-h)] items-center rounded-md transition-colors duration-[var(--kb-dur-fast)]';

// 3 px accent bar on the start edge for the selected row.
const SELECTED =
    'bg-container before:absolute before:start-0 before:inset-y-2 before:w-0.75 before:rounded-full before:bg-[var(--kb-accent)]';

const ROOT_NAV =
    'no-drag-region pointer-events-auto relative flex min-h-11 items-center rounded-full transition-colors duration-[var(--kb-dur-fast)]';

const SELECTED_NAV = 'bg-container text-on-container';

const BODY = 'flex min-w-0 flex-1 items-center gap-3 self-stretch px-3 py-2 text-start';

const BODY_NAV = 'flex min-w-0 flex-1 items-center gap-3 self-stretch px-4 py-2 text-start';

/**
 * Base row of settings, store and navigation lists. Interactive rows use a native button (Enter/Space,
 * focus ring); the trailing slot stays outside it so a Toggle or IconButton there is never nested in a button.
 * `className`, `ref` and other HTML props go to the root.
 */
export function ListItem({
    as = 'div',
    title,
    description,
    leading,
    trailing,
    onClick,
    variant = 'row',
    selected = false,
    current = 'true',
    disabled = false,
    buttonRef,
    className,
    ...rest
}: ListItemProps) {
    const interactive = Boolean(onClick);
    const nav = variant === 'nav';
    const ariaCurrent = selected ? current : undefined;

    const content = (
        <>
            {leading !== undefined && leading !== null && (
                <span className={cx('flex shrink-0 items-center', disabled ? 'text-fg-3' : nav && selected ? 'text-accent' : 'text-fg-2')}>
                    {typeof leading === 'string' ? <Icon name={leading} size={20} filled={selected} /> : leading}
                </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
                <span
                    className={cx(
                        nav ? 'text-[0.875rem] leading-[1.25] break-words' : 'truncate [font:var(--kb-type-body)]',
                        nav && (selected ? 'font-bold' : 'font-medium'),
                        disabled ? 'text-fg-3' : nav && selected ? 'text-on-container' : 'text-fg-1'
                    )}
                >
                    {title}
                </span>
                {hasContent(description) && <span className="[font:var(--kb-type-caption)] text-fg-2">{description}</span>}
            </span>
        </>
    );

    return createElement(
        as,
        {
            ...rest,
            className: cx(
                nav ? ROOT_NAV : ROOT,
                selected ? (nav ? SELECTED_NAV : SELECTED) : interactive && !disabled && 'hover:bg-[var(--kb-fill-hover)]',
                disabled && 'cursor-not-allowed',
                className
            ),
            'aria-current': interactive ? rest['aria-current'] : (ariaCurrent ?? rest['aria-current']),
            'aria-disabled': !interactive && disabled ? true : rest['aria-disabled'],
            'data-selected': selected ? '' : undefined,
        },
        interactive ? (
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                aria-current={ariaCurrent}
                onClick={onClick}
                className={cx(
                    INTERACTIVE,
                    nav ? BODY_NAV : BODY,
                    'cursor-pointer disabled:cursor-not-allowed',
                    nav ? 'rounded-full' : 'rounded-md'
                )}
            >
                {content}
            </button>
        ) : (
            <div className={nav ? BODY_NAV : BODY}>{content}</div>
        ),
        trailing !== undefined && trailing !== null && <span className="flex shrink-0 items-center gap-2 pe-3">{trailing}</span>
    );
}
