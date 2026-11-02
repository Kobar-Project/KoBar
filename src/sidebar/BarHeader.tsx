import type { MouseEvent } from 'react';
import { useT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { cx, INTERACTIVE } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { BarContextMenu } from './ContextMenu';

export interface BarHeaderProps {
    orientation: 'vertical' | 'horizontal';
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onReorder: () => void;
    onMiniMode: () => void;
    /** Left press on the header: starts the bar drag (the caller applies the pixel threshold before it moves). */
    onDragStart: (e: MouseEvent) => void;
    /** Returns true (once) when the press that just ended was a real drag, so the click must not open the menu. */
    consumeDrag: () => boolean;
}

/**
 * R2-02: bar header (top end of a vertical bar, left end of a horizontal one). The whole header is one button:
 * press-and-hold + move drags the bar, a left or right click (no drag) opens the bar menu. A divider spanning the full
 * bar width separates it from the plugin buttons; the empty part shows a three-line grip icon.
 */
export function BarHeader({ orientation, open, onOpenChange, onReorder, onMiniMode, onDragStart, consumeDrag }: BarHeaderProps) {
    const t = useT();
    const privacyMode = useAppStore((s) => s.privacyMode);
    const horizontal = orientation === 'horizontal';
    const trigger = (
        <button
            type="button"
            aria-label={t('barMenuMore')}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="bar-header"
            data-bar-header=""
            onMouseDown={(e) => {
                if (e.button === 0) onDragStart(e);
            }}
            onClick={(e) => {
                // A drag ends with a click on the same element: swallow it so the menu does not open (Popover skips defaultPrevented).
                if (consumeDrag()) e.preventDefault();
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onOpenChange(true);
            }}
            className={cx(
                INTERACTIVE,
                'no-drag-region flex shrink-0 cursor-grab items-center justify-center gap-0.5 rounded-sm transition-colors duration-[var(--kb-dur-fast)] active:cursor-grabbing',
                open
                    ? 'bg-[var(--kb-bg-container)] text-accent'
                    : 'text-fg-3 hover:bg-[var(--kb-fill-hover)] hover:text-fg-1 active:bg-[var(--kb-fill-pressed)]',
                horizontal ? 'h-full w-[22px] flex-col self-stretch' : 'h-[22px] w-full'
            )}
        >
            <span data-testid="bar-grip" className="pointer-events-none flex">
                <Icon name="drag_indicator" size={18} className={horizontal ? '' : 'rotate-90'} />
            </span>
            {privacyMode && (
                <span data-testid="bar-privacy-mark" title={t('privacyModeOnHint')} className="pointer-events-none flex text-fg-2">
                    <Icon name="visibility_off" size={16} />
                </span>
            )}
        </button>
    );
    return <BarContextMenu open={open} onOpenChange={onOpenChange} onReorder={onReorder} onMiniMode={onMiniMode} trigger={trigger} />;
}
