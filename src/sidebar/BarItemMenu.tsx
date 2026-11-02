import { barItemOwner } from '../components/extensions/barPresentation';
import { useExtensionRegistry } from '../components/extensions/extensionRegistry';
import { useT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { Menu, type MenuItem } from '../ui/Menu';
import type { PopoverPlacement } from '../ui/Popover';
import type { BarEdge } from './barEdge';

export interface BarItemMenuTarget {
    /** Button or inline widget id. */
    id: string;
    /** Plugin display name (the registered label for buttons). */
    name: string;
    /** Material Symbols name (buttons only; widgets use a generic glyph). */
    icon: string;
    /** v1 inline widget: no size choice, no plugin settings. */
    widget: boolean;
    /** Viewport rect of the item the menu belongs to (the menu is anchored to it). */
    rect: { left: number; top: number; width: number; height: number };
    /** Element that gets focus back when the menu closes. */
    element: HTMLElement | null;
}

export interface BarItemMenuProps {
    target: BarItemMenuTarget | null;
    edge: BarEdge;
    orientation: 'vertical' | 'horizontal';
    onClose: () => void;
    /** Enters the bar's reorder mode. */
    onReorder: () => void;
}

function placementFor(edge: BarEdge, orientation: 'vertical' | 'horizontal'): PopoverPlacement {
    if (orientation === 'horizontal') return edge === 'top' ? 'bottom-start' : 'top-start';
    return edge === 'left' ? 'right-start' : 'left-start';
}

/**
 * Item menu (right-click, context-menu key or Shift+F10 on a bar item). One menu instance for the whole bar: the items
 * are not menu triggers (that would clash with the toolbar's arrow keys), so it anchors to an invisible box placed over
 * the item. Closing puts focus back on the item.
 */
export function BarItemMenu({ target, edge, orientation, onClose, onReorder }: BarItemMenuProps) {
    const t = useT();
    const size = useAppStore((s) => (target ? (s.barItemSizes[target.id] ?? 'icon') : 'icon'));

    const extensionsRegistry = useExtensionRegistry();
    // Host-side lookup (not on window.KoBarExtensions): the plugin that registered this button.
    const owner = target ? barItemOwner(target.id) : null;
    const manifest = owner ? extensionsRegistry.getManifest(owner) : undefined;
    const pluginName: string = typeof manifest?.name === 'string' && manifest.name ? manifest.name : (target?.name ?? '');
    const author: string = typeof manifest?.author === 'string' && manifest.author ? manifest.author : (owner ?? '');
    const hasSettings = !!owner && !!extensionsRegistry.getSettingsPanel(owner);

    const items: MenuItem[] = [];
    if (target) {
        const st = () => useAppStore.getState();
        if (!target.widget) {
            items.push(
                {
                    id: 'size-tile',
                    type: 'radio',
                    icon: 'view_agenda',
                    label: t('barItemShowTile'),
                    checked: size === 'tile',
                    onSelect: () => st().setBarItemSize(target.id, 'tile'),
                },
                {
                    id: 'size-icon',
                    type: 'radio',
                    icon: 'apps',
                    label: t('barItemShowIcon'),
                    checked: size !== 'tile',
                    onSelect: () => st().setBarItemSize(target.id, 'icon'),
                }
            );
            items.push({ type: 'separator', id: 'sep-size' });
            if (hasSettings && owner) {
                items.push({
                    id: 'plugin-settings',
                    icon: 'tune',
                    label: t('settingsPluginsSettings'),
                    onSelect: () => st().openPluginSettings(owner),
                });
            }
        }
        items.push({ id: 'reorder', icon: 'drag_indicator', label: t('barMenuReorder'), onSelect: onReorder });
    }

    const anchor = (
        <span
            aria-hidden="true"
            data-bar-item-anchor=""
            style={{
                position: 'fixed',
                left: target?.rect.left ?? 0,
                top: target?.rect.top ?? 0,
                width: target?.rect.width ?? 0,
                height: target?.rect.height ?? 0,
                pointerEvents: 'none',
            }}
        />
    );

    return (
        <Menu
            open={!!target}
            onOpenChange={(next) => {
                if (next) return;
                const element = target?.element;
                onClose();
                if (element) window.setTimeout(() => (element.isConnected ? element.focus({ preventScroll: true }) : undefined), 0);
            }}
            aria-label={t('barItemMenu').replace('{name}', target?.name ?? '')}
            placement={placementFor(edge, orientation)}
            header={
                target
                    ? {
                          icon: target.icon,
                          title: pluginName,
                          subtitle: t('barItemSource').replace('{plugin}', pluginName).replace('{owner}', author),
                      }
                    : undefined
            }
            items={items}
            trigger={anchor}
        />
    );
}
