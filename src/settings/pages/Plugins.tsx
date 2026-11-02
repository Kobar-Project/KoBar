// T-610 / T-611: Settings > Plugins. The page shell: an Installed (n) | Discover (n) tab strip (the views live in ./plugins/) and a tonal
// "Install" button that opens a menu with the two advanced install paths. Both menu items only ask the main window to start its own
// existing flow: the file picker is a native dialog owned by main, and for a GitHub link the main window shows its Plugins tab (the
// link is typed there). The Settings window never sends a path or a URL.
// CNL-08: Canlı chrome (counts in the tabs, tonal install button).
import { useId, useState } from 'react';
import { Button, Menu, Tabs } from '../../ui';
import { dispatchPluginAction, usePluginSummary, useSettingsState } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { DiscoverView } from './plugins/DiscoverView';
import { InstalledView } from './plugins/InstalledView';
import { PAGE_STACK, WaitingNote } from './shared';

type PluginsTab = 'installed' | 'discover';

export function PluginsPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = usePluginSummary();
    const [tab, setTab] = useState<PluginsTab>('installed');
    const baseId = useId();
    const panelId = `${baseId}-panel`;
    const tabId = (value: PluginsTab) => `${baseId}-tab-${value}`;
    const installedCount = summary?.items.length ?? 0;
    const discoverCount = summary?.catalog?.items.length ?? 0;

    return (
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <div className="flex items-center justify-between gap-2">
                <Tabs
                    aria-label={t('settingsPluginsTabsLabel')}
                    value={tab}
                    onChange={setTab}
                    items={[
                        {
                            value: 'installed',
                            label: `${t('settingsPluginsTabInstalled')} (${installedCount})`,
                            id: tabId('installed'),
                            panelId,
                        },
                        {
                            value: 'discover',
                            label: `${t('settingsPluginsTabDiscover')} (${discoverCount})`,
                            id: tabId('discover'),
                            panelId,
                        },
                    ]}
                />
                <Menu
                    aria-label={t('settingsPluginsMore')}
                    placement="bottom-end"
                    trigger={
                        <Button variant="tonal" size="sm" icon="add" disabled={!ready}>
                            {t('pluginInstallFromFileOrGithub')}
                        </Button>
                    }
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
