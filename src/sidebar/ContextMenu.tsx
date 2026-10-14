import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { Menu, type MenuItem } from '../ui/Menu';
import { cx, INTERACTIVE } from '../ui/cx';
import { Icon } from '../ui/Icon';

export interface BarContextMenuProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Enters the bar's reorder mode. */
    onReorder: () => void;
    /** Enters mini mode (the caller knows the eye button position). */
    onMiniMode: () => void;
    /** R2-02: custom trigger (the bar header). Defaults to the small more button. */
    trigger?: ReactElement;
}

/** T-619: bar menu (right-click on the handle or the more button). The workspace "submenu" is a second view of the same menu. */
export function BarContextMenu({ open, onOpenChange, onReorder, onMiniMode, trigger }: BarContextMenuProps) {
    const t = useT();
    const [view, setView] = useState<'main' | 'workspaces'>('main');
    const workspaces = useAppStore((s) => s.workspaces);
    const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

    const switchView = (next: 'main' | 'workspaces') => {
        // Menu closes before onSelect runs; reopening in the same batch keeps the popover open on the other view.
        setView(next);
        onOpenChange(true);
    };

    const buildItems = (): MenuItem[] => {
        const st = () => useAppStore.getState();
        if (view === 'workspaces') {
            return [
                { id: 'back', icon: 'arrow_back', label: t('workspaces'), onSelect: () => switchView('main') },
                { type: 'separator', id: 'sep-ws' },
                {
                    id: 'ws-default',
                    type: 'radio',
                    label: t('colorDefault'),
                    checked: activeWorkspaceId === null,
                    onSelect: () => st().setActiveWorkspaceId(null),
                },
                ...workspaces.map((w): MenuItem => ({
                    id: `ws-${w.id}`,
                    type: 'radio',
                    label: w.name,
                    checked: activeWorkspaceId === w.id,
                    onSelect: () => st().setActiveWorkspaceId(w.id),
                })),
            ];
        }
        return [
            { id: 'notes', icon: 'sticky_note_2', label: t('notesList'), onSelect: () => st().toggleNotePanel() },
            { id: 'workspace', icon: 'workspaces', label: `${t('workspaces')} \u25B8`, onSelect: () => switchView('workspaces') },
            { id: 'plugins', icon: 'extension', label: t('plugins'), onSelect: () => st().openPluginsTab() },
            { id: 'settings', icon: 'settings', label: t('settings'), onSelect: () => st().openSettingsTab() },
            { type: 'separator', id: 'sep-1' },
            { id: 'reorder', icon: 'drag_indicator', label: t('barMenuReorder'), onSelect: onReorder },
            { id: 'mini', icon: 'visibility', label: t('miniMode'), onSelect: onMiniMode },
            { type: 'separator', id: 'sep-2' },
            { id: 'quit', icon: 'power_settings_new', label: t('barMenuQuit'), danger: true, onSelect: () => window.api?.quitApp?.() },
        ];
    };
    const items = buildItems();

    // Switching the view replaces the focused row: put focus back on the first row of the new view.
    const prevView = useRef(view);
    useEffect(() => {
        if (prevView.current === view) return;
        prevView.current = view;
        if (open) document.querySelector<HTMLElement>('[role="menu"] [data-kb-menu-item]:not([disabled])')?.focus();
    }, [view, open]);

    return (
        <Menu
            aria-label={t('barMenuMore')}
            open={open}
            onOpenChange={(next) => {
                if (!next) setView('main');
                onOpenChange(next);
            }}
            placement="right-start"
            items={items}
            trigger={
                trigger ?? (
                    <button
                        type="button"
                        aria-label={t('barMenuMore')}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        data-testid="bar-more"
                        onMouseDown={(e) => e.stopPropagation()}
                        className={cx(
                            INTERACTIVE,
                            'no-drag-region flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-3 hover:text-fg-1'
                        )}
                    >
                        <Icon name="more_horiz" size={16} />
                    </button>
                )
            }
        />
    );
}
