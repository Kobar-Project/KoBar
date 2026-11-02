import type { MouseEvent } from 'react';
import { useBarItem } from '../components/extensions/barPresentation';
import { useT } from '../i18n/useT';
import type { BarEdge } from './barEdge';
import { BarGlyph, BarItem } from './BarItem';
import { BAR_GRID_ATTR } from './useRovingToolbar';

export interface BarButtonProps {
    /** Registry button: id, Material Symbols name and display name. */
    id: string;
    icon: string;
    name: string;
    /** `thin`: item in the thin bar. `cell`: icon cell in a 2-column grid of the wide bar. */
    variant: 'thin' | 'cell';
    active: boolean;
    /** The user chose a tile but the bar is full, so it is shown as an icon (tooltip says so). */
    autoCollapsed: boolean;
    privacy: boolean;
    reorderMode: boolean;
    /** Grid id for keyboard navigation (cells only). */
    gridKey?: string;
    edge: BarEdge;
    orientation: 'vertical' | 'horizontal';
    tooltipDisabled: boolean;
    reorderLabel: string;
    onOpen: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Icon-size bar item bound to a registered plugin button: glyph (the plugin may swap it through its state), badge
 * (hidden for sensitive plugins in privacy mode) and the "shown as an icon because the bar is full" tooltip.
 */
export function BarButton({
    id,
    icon,
    name,
    variant,
    active,
    autoCollapsed,
    privacy,
    reorderMode,
    gridKey,
    edge,
    orientation,
    tooltipDisabled,
    reorderLabel,
    onOpen,
}: BarButtonProps) {
    const t = useT();
    const { declaration, state } = useBarItem(id);
    const hidden = privacy && !!declaration.sensitive;
    const glyph = hidden ? icon : (state?.icon ?? icon);
    const badge = hidden ? undefined : state?.badge;
    const label = reorderMode ? reorderLabel : autoCollapsed ? t('barAutoCollapsed').replace('{name}', name) : name;
    return (
        <BarItem
            {...(gridKey ? { [BAR_GRID_ATTR]: gridKey } : {})}
            variant={variant}
            label={label}
            active={active}
            badge={badge}
            orientation={orientation}
            edge={edge}
            tooltipDisabled={tooltipDisabled}
            style={{ pointerEvents: reorderMode ? 'none' : 'auto' }}
            onClick={onOpen}
        >
            <BarGlyph name={glyph} filled={active} size={variant === 'cell' ? '18px' : undefined} />
        </BarItem>
    );
}
