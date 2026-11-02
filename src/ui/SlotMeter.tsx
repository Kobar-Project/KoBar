import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface SlotMeterProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role'> {
    /** Number of segments (1-12, clamped). */
    total: number;
    /** Segments filled from the start (clamped to `total`). */
    filled: number;
    /** Outline the first empty segment as the one that comes next. */
    showNext?: boolean;
    /** Accessible name, e.g. "4 of 10 done". Without it the meter is decorative (aria-hidden). */
    label?: string;
}

export const SLOT_METER_MAX = 12;

/** Segmented meter: 5 px high segments (radius 3, gap 3), five per row. Filled = accent, next = accent outline, empty = --kb-slot-empty. */
export function SlotMeter({ total, filled, showNext = false, label, className, ...rest }: SlotMeterProps) {
    const count = Math.min(SLOT_METER_MAX, Math.max(0, Math.floor(total)));
    const done = Math.min(count, Math.max(0, Math.floor(filled)));
    const labelled = Boolean(label);
    return (
        <span
            {...rest}
            role={labelled ? 'img' : undefined}
            aria-label={labelled ? label : undefined}
            aria-hidden={labelled ? undefined : true}
            className={cx('grid w-full grid-cols-5 gap-[3px]', className)}
        >
            {Array.from({ length: count }, (_, index) => {
                const state = index < done ? 'filled' : showNext && index === done ? 'next' : 'empty';
                return (
                    <span
                        key={index}
                        data-slot={state}
                        className={cx(
                            'block h-[5px] rounded-[3px]',
                            state === 'filled' && 'bg-[var(--kb-accent)]',
                            state === 'next' && 'bg-[var(--kb-slot-empty)] shadow-[inset_0_0_0_1.5px_var(--kb-accent)]',
                            state === 'empty' && 'bg-[var(--kb-slot-empty)]'
                        )}
                    />
                );
            })}
        </span>
    );
}
