import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconSize } from './Icon';

export type IconTileSize = 'sm' | 'md' | 'xl';

export interface IconTileProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** Material Symbols ligature name. */
    icon: string;
    /** sm 34 (menus), md 44 (default: cards, panel headers), xl 64 (empty states). */
    size?: IconTileSize;
    /** Quiet form: inset fill + fg-2 glyph instead of container + accent. */
    muted?: boolean;
}

const SIZE_CLASS: Record<IconTileSize, string> = {
    sm: 'size-[34px] rounded-[11px]',
    md: 'size-11 rounded-[15px]',
    xl: 'size-16 rounded-[22px]',
};

const ICON_SIZE: Record<IconTileSize, IconSize> = { sm: 18, md: 24, xl: 32 };

/** Rounded square behind a glyph. Purely decorative: aria-hidden, so the neighbouring text carries the meaning. */
export function IconTile({ icon, size = 'md', muted = false, className, ...rest }: IconTileProps) {
    return (
        <span
            {...rest}
            aria-hidden="true"
            className={cx(
                'inline-flex shrink-0 items-center justify-center',
                SIZE_CLASS[size],
                muted ? 'bg-inset text-fg-2' : 'bg-container text-accent',
                className
            )}
        >
            <Icon name={icon} size={ICON_SIZE[size]} filled={!muted} />
        </span>
    );
}
