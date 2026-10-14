import type { CSSProperties } from 'react';
import { cx } from './cx';

export type SkeletonShape = 'line' | 'block' | 'circle';

export interface SkeletonProps {
    shape?: SkeletonShape;
    /** CSS length or px number. Lines default to the full width. */
    width?: number | string;
    /** CSS length or px number. Defaults: line 12 px, block 48 px, circle = width (32 px). */
    height?: number | string;
    /** Line shape only: number of stacked lines (the last one is shorter). */
    lines?: number;
    className?: string;
}

const SHAPE_CLASS: Record<SkeletonShape, string> = {
    line: 'rounded-xs',
    block: 'rounded-md',
    circle: 'rounded-full',
};

const DEFAULT_HEIGHT: Record<SkeletonShape, number> = { line: 12, block: 48, circle: 32 };

// Static fill only: continuous shimmer/pulse is not allowed, so there is nothing to disable under
// prefers-reduced-motion. The block fades in with kb-fade, which keeps its own reduced-motion duration.
const BASE = 'kb-fade block shrink-0 bg-[var(--kb-fill-selected)]';

/** Loading placeholder. Decorative: aria-hidden; mark the loading container with aria-busy instead. */
export function Skeleton({ shape = 'line', width, height, lines = 1, className }: SkeletonProps) {
    const size: CSSProperties = {
        width: width ?? (shape === 'circle' ? DEFAULT_HEIGHT.circle : '100%'),
        height: height ?? (shape === 'circle' ? (width ?? DEFAULT_HEIGHT.circle) : DEFAULT_HEIGHT[shape]),
    };

    if (shape !== 'line' || lines <= 1) {
        return <span aria-hidden="true" data-skeleton="" className={cx(BASE, SHAPE_CLASS[shape], className)} style={size} />;
    }

    return (
        <span aria-hidden="true" data-skeleton="" className={cx('flex w-full flex-col gap-2', className)}>
            {Array.from({ length: lines }, (_, index) => (
                <span
                    key={index}
                    className={cx(BASE, SHAPE_CLASS.line)}
                    style={{ ...size, width: index === lines - 1 ? '60%' : size.width }}
                />
            ))}
        </span>
    );
}
