import type { ComponentPropsWithRef, ReactNode } from 'react';
import { CHOICE_ITEM_ATTR } from './choice';
import { cx, INTERACTIVE } from './cx';
import { Icon } from './Icon';

export interface OptionTileProps extends Omit<ComponentPropsWithRef<'button'>, 'role' | 'aria-checked' | 'type' | 'children'> {
    /** Visible label; it also names the radio. */
    label: ReactNode;
    /** Leading Material Symbols icon in the label row. */
    icon?: string;
    /** Illustration shown in the 58 px art box (decorative; hidden from assistive technology). */
    art?: ReactNode;
    selected?: boolean;
}

/**
 * Radio-like picker with an illustration (colour mode, density, orientation). Place several inside a `role="radiogroup"`
 * and give them roving tabindex (`tabIndex`, arrow keys); the tile marks itself for `moveRovingFocus` in `choice.ts`.
 * Selected = 2 px accent border + a 20 px check badge, never colour alone.
 */
export function OptionTile({ label, icon, art, selected = false, className, ...rest }: OptionTileProps) {
    return (
        <button
            {...rest}
            {...{ [CHOICE_ITEM_ATTR]: '' }}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cx(
                INTERACTIVE,
                'relative flex min-w-0 flex-col gap-2 rounded-[18px] bg-inset px-2 pt-2 pb-2.5 text-start transition-colors duration-[var(--kb-dur-fast)] enabled:hover:bg-[color-mix(in_oklab,var(--kb-fg-1)_6%,var(--kb-bg-inset))] disabled:cursor-not-allowed disabled:text-fg-3',
                selected &&
                    'after:pointer-events-none after:absolute after:inset-0 after:rounded-[18px] after:border-2 after:border-[var(--kb-accent)]',
                className
            )}
        >
            <span aria-hidden="true" className="flex h-[58px] w-full items-center justify-center overflow-hidden rounded-[12px] bg-shell">
                {art}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 px-1 text-fg-1 [font:var(--kb-type-label)]">
                {icon && <Icon name={icon} size={18} className="text-fg-2" />}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {selected && (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--kb-accent)] text-[var(--kb-on-accent)]">
                        <Icon name="check" size={16} className="text-[var(--kb-on-accent)]" />
                    </span>
                )}
            </span>
        </button>
    );
}
