import type { SVGAttributes } from 'react';
import { cx } from './cx';

export type ProgressRingSize = 'tile' | 'orb' | 'panel';

export interface ProgressRingProps extends Omit<SVGAttributes<SVGSVGElement>, 'children' | 'role'> {
    /** Progress 0-1 (clamped). */
    value: number;
    /** tile 54 / stroke 4, orb 54 / stroke 3, panel 200 / stroke 12. */
    size?: ProgressRingSize;
    /** Accessible name. Without it the ring is decorative (aria-hidden): the host element's label carries the meaning. */
    label?: string;
}

const GEOMETRY: Record<ProgressRingSize, { box: number; stroke: number }> = {
    tile: { box: 54, stroke: 4 },
    orb: { box: 54, stroke: 3 },
    panel: { box: 200, stroke: 12 },
};

/** Circular progress. Track = --kb-ring-track, arc = accent drawn with stroke-dasharray, starting at 12 o'clock. */
export function ProgressRing({ value, size = 'tile', label, className, ...rest }: ProgressRingProps) {
    const { box, stroke } = GEOMETRY[size];
    const radius = (box - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const labelled = Boolean(label);
    return (
        <svg
            {...rest}
            width={box}
            height={box}
            viewBox={`0 0 ${box} ${box}`}
            role={labelled ? 'img' : undefined}
            aria-label={labelled ? label : undefined}
            aria-hidden={labelled ? undefined : true}
            data-size={size}
            className={cx('shrink-0 -rotate-90', className)}
        >
            <circle cx={box / 2} cy={box / 2} r={radius} fill="none" strokeWidth={stroke} stroke="var(--kb-ring-track)" />
            <circle
                cx={box / 2}
                cy={box / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                stroke="var(--kb-accent)"
                strokeDasharray={`${clamped * circumference} ${circumference}`}
                // A round cap draws a dot even for an empty arc; at 0 the ring shows only its track.
                strokeOpacity={clamped > 0 ? 1 : 0}
                data-ring-arc=""
                style={{ transition: 'stroke-dasharray var(--kb-dur-progress) var(--kb-ease-standard)' }}
            />
        </svg>
    );
}
