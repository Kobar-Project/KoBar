import { createElement, type HTMLAttributes, type Ref } from 'react';
import { cx } from './cx';

export type SurfaceLevel = 'shell' | 'surface' | 'inset';
export type SurfaceElevation = 'e0' | 'e1' | 'e2' | 'e3';
export type SurfaceRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl';
export type SurfaceElement = 'div' | 'section' | 'aside' | 'header' | 'footer' | 'nav' | 'main';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
    as?: SurfaceElement;
    level?: SurfaceLevel;
    /** e1-e3 always come with the subtle 1 px stroke. */
    elevation?: SurfaceElevation;
    /**
     * Use the --kb-material-* background (translucent when data-material="translucent"). Only for the bar and panel
     * shells, so it applies to level "shell" only.
     */
    material?: boolean;
    radius?: SurfaceRadius;
    ref?: Ref<HTMLElement>;
}

const LEVEL_CLASS: Record<SurfaceLevel, string> = {
    shell: 'bg-shell',
    surface: 'bg-surface',
    inset: 'bg-inset',
};

const ELEVATION_CLASS: Record<SurfaceElevation, string> = {
    e0: '',
    e1: 'border border-stroke shadow-e1',
    e2: 'border border-stroke shadow-e2',
    e3: 'border border-stroke shadow-e3',
};

const RADIUS_CLASS: Record<SurfaceRadius, string> = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
};

/** Background/elevation container. Not interactive itself; it only opts out of the overlay's pointer-events-none. */
export function Surface({
    as = 'div',
    level = 'surface',
    elevation = 'e0',
    material = false,
    radius = 'md',
    className,
    ...rest
}: SurfaceProps) {
    const useMaterial = material && level === 'shell';
    return createElement(as, {
        ...rest,
        className: cx(
            'pointer-events-auto text-fg-1',
            useMaterial ? 'bg-[var(--kb-material-bg)] [backdrop-filter:var(--kb-material-blur)]' : LEVEL_CLASS[level],
            ELEVATION_CLASS[elevation],
            RADIUS_CLASS[radius],
            className
        ),
        'data-level': level,
        'data-elevation': elevation,
    });
}
