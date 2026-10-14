// T-610 / T-611: Settings > Plugins. The page shell: an Installed | Discover tab strip (the views live in ./plugins/) and a "..." menu
// with the two advanced install paths. Both menu items only ask the main window to start its own existing flow: the file picker is a
// native dialog owned by main, and for a GitHub link the main window shows its Plugins tab (the link is typed there). The Settings
// window never sends a path or a URL.
import { useId, useState } from 'react';
import { IconButton, Menu, Tabs } from '../../ui';
import { dispatchPluginAction, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { DiscoverView } from './plugins/DiscoverView';
import { InstalledView } from './plugins/InstalledView';

type PluginsTab = 'installed' | 'discover';

export function PluginsPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const [tab, setTab] = useState<PluginsTab>('installed');
    const baseId = useId();
    const panelId = `${baseId}-panel`;
    const tabId = (value: PluginsTab) => `${baseId}-tab-${value}`;

    return (
        <div className="flex max-w-xl flex-col gap-4">
            {!ready && (
                <p role="status" className="text-[0.8125rem] leading-5 text-fg-2">
                    {t('settingsWaiting')}
                </p>
            )}
            <div className="flex items-end justify-between gap-2">
                <Tabs
                    aria-label={t('settingsPluginsTabsLabel')}
                    value={tab}
                    onChange={setTab}
                    items={[
                        { value: 'installed', label: t('settingsPluginsTabInstalled'), id: tabId('installed'), panelId },
                        { value: 'discover', label: t('settingsPluginsTabDiscover'), id: tabId('discover'), panelId },
                    ]}
                />
                <Menu
                    aria-label={t('settingsPluginsMore')}
                    placement="bottom-end"
                    trigger={<IconButton icon="more_horiz" label={t('settingsPluginsMore')} size={28} disabled={!ready} />}
                    items={[
                        {
                            id: 'from-file',
                            icon: 'folder_zip',
                            label: t('settingsPluginsFromFile'),
                            onSelect: () => dispatchPluginAction('plugin.installFromFile', {}),
                        },
                        { type: 'separator', id: 'advanced' },
                        {
                            id: 'from-github',
                            icon: 'code',
                            label: t('settingsPluginsFromGithub'),
                            onSelect: () => dispatchPluginAction('plugin.installFromGithub', {}),
                        },
                    ]}
                />
            </div>
            <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
                {tab === 'installed' ? <InstalledView t={t} /> : <DiscoverView t={t} />}
            </div>
        </div>
    );
}
