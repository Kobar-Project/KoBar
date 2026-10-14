import type { TooltipSide } from '../ui/Tooltip';

export type BarEdge = 'left' | 'right' | 'top' | 'bottom';

/** The tooltip opens on the side facing away from the docked edge. */
export function tooltipSideForEdge(edge: BarEdge): TooltipSide {
    switch (edge) {
        case 'left':
            return 'right';
        case 'right':
            return 'left';
        case 'top':
            return 'bottom';
        default:
            return 'top';
    }
}
