import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** Count to show. 0 (or less) renders nothing; 100 and above shows "99+". */
    count?: number;
    /** 8 px dot (attention without a number). A `count` of 0 still hides it. */
    dot?: boolean;
}

/** Notification count pill (accent / on-accent, tabular 11/700) or an 8 px dot. Place it with `className`. */
export function Badge({ count, dot = false, className, ...rest }: BadgeProps) {
    if (count !== undefined && count <= 0) return null;
    if (dot) {
        return (
            <span {...rest} data-badge="dot" className={cx('inline-block size-2 shrink-0 rounded-full bg-[var(--kb-accent)]', className)} />
        );
    }
    if (count === undefined) return null;
    return (
        <span
            {...rest}
            data-badge="count"
            className={cx(
                'kb-num inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--kb-accent)] px-1.5 text-[11px] leading-none font-bold text-[var(--kb-on-accent)]',
                className
            )}
        >
            {count >= 100 ? '99+' : count}
        </span>
    );
}
