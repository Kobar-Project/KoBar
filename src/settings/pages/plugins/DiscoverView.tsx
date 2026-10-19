// T-611: the Discover view of Settings > Plugins. A compact catalogue list with search, an inline read-only detail per plugin and
// loading / offline / error / empty states with a retry. The catalogue is read and installed by the main window (src/store/pluginSync.ts):
// this view only shows the secret-free summary it published and sends allow-listed `plugin.*` actions. It never sends a URL or a path,
// and it shows no repository statistics. Nothing is optimistic: "Installed" appears when the main window reports it.
import { useEffect, useId, useRef, useState } from 'react';
import { EMPTY_PLUGIN_CATALOG, type PluginCatalogItem } from '../../../store/pluginSummary';
import { Button, EmptyState, IconButton, ListItem, Segmented, Skeleton, Surface, TextField } from '../../../ui';
import { dispatchPluginAction, useSettingsState, usePluginSummary } from '../../mirror';
import type { SettingsPageProps } from '../../pages';
import { getDocumentPlatform } from '../../../platform';
import { isPluginSupportedOn, platformDisplayName } from '../../../../shared/pluginPlatforms';
import { PluginRepoLink } from './PluginRepoLink';

type CatalogFilter = 'all' | 'installed' | 'notInstalled';

const HINT = 'text-[0.6875rem] leading-4 text-fg-2';
const SECTION_LABEL = 'text-[0.8125rem] leading-5 font-semibold text-fg-1';

/** Case-insensitive match on name, description, author and category. */
function matchesQuery(item: PluginCatalogItem, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q === '') return true;
    return [item.name, item.description, item.author, item.category].some((field) => field.toLowerCase().includes(q));
}

export function DiscoverView({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = usePluginSummary();
    const listId = useId();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<CatalogFilter>('all');
    const [openId, setOpenId] = useState<string | null>(null);
    const requested = useRef(false);

    const catalog = summary?.catalog ?? EMPTY_PLUGIN_CATALOG;
    const { status } = catalog;
    const loading = status === 'loading';
    const installing = catalog.installingId !== null;

    // The catalogue is only fetched when this view is shown (once per idle state; a retry is an explicit click).
    useEffect(() => {
        if (status !== 'idle') {
            requested.current = false;
            return;
        }
        if (ready && summary && !requested.current) {
            requested.current = true;
            dispatchPluginAction('plugin.refreshCatalog', {});
        }
    }, [ready, summary, status]);

    const visible = catalog.items.filter(
        (item) => matchesQuery(item, query) && (filter === 'all' || (filter === 'installed' ? item.installed : !item.installed))
    );
    const last = catalog.lastInstall;
    const lastName = last ? (catalog.items.find((item) => item.id === last.id)?.name ?? last.id) : '';
    const resultText = !last
        ? ''
        : t(
              last.result === 'success'
                  ? 'settingsPluginsInstallDone'
                  : last.result === 'canceled'
                    ? 'settingsPluginsInstallCanceled'
                    : 'settingsPluginsInstallFailed'
          ).replace('{name}', lastName);

    const retry = (
        <Button icon="refresh" disabled={!ready || loading} onClick={() => dispatchPluginAction('plugin.refreshCatalog', {})}>
            {t('settingsPluginsRetry')}
        </Button>
    );

    const renderRow = (item: PluginCatalogItem) => {
        const open = openId === item.id;
        const detailId = `${listId}-${item.id}`;
        const platform = getDocumentPlatform();
        const unsupported = platform !== null && !isPluginSupportedOn(item.id, platform);
        const unsupportedText = platform ? t('pluginUnsupportedOnPlatform').replace('{platform}', platformDisplayName(platform)) : '';
        const meta = [item.author, item.category].filter((part) => part !== '').join(' · ');
        return (
            <li key={item.id} className="flex flex-col">
                <ListItem
                    leading="extension"
                    title={
                        <>
                            {item.name}
                            {item.beta && <span className="ms-2 text-[0.6875rem] font-normal text-fg-2">{t('settingsPluginsBeta')}</span>}
                            {unsupported && <span className="ms-2 text-[0.6875rem] font-normal text-danger">{unsupportedText}</span>}
                        </>
                    }
                    description={meta || item.description}
                    trailing={
                        <>
                            <IconButton
                                icon={open ? 'expand_less' : 'expand_more'}
                                label={`${open ? t('settingsPluginsDetailsHide') : t('settingsPluginsDetails')}: ${item.name}`}
                                size={28}
                                aria-expanded={open}
                                aria-controls={detailId}
                                onClick={() => setOpenId(open ? null : item.id)}
                            />
                            {item.installed ? (
                                <span className={HINT}>{t('settingsPluginsInstalledBadge')}</span>
                            ) : (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    loading={catalog.installingId === item.id}
                                    disabled={!ready || installing || unsupported}
                                    title={unsupported ? unsupportedText : undefined}
                                    aria-label={`${t('settingsPluginsInstall')}: ${item.name}`}
                                    onClick={() => dispatchPluginAction('plugin.install', { id: item.id })}
                                >
                                    {catalog.installingId === item.id ? t('settingsPluginsInstalling') : t('settingsPluginsInstall')}
                                </Button>
                            )}
                        </>
                    }
                />
                {item.repo && (
                    <div className="min-w-0 px-3 pb-1 ps-11">
                        <PluginRepoLink repo={item.repo} label={t('settingsPluginsGithubLink').replace('{name}', item.name)} />
                    </div>
                )}
                {open && (
                    <div id={detailId} className="flex flex-col gap-1 px-3 pb-3 ps-11">
                        <p className="text-[0.75rem] leading-4 text-fg-1">{item.description || t('settingsPluginsNoDescription')}</p>
                        <p className={HINT}>
                            {[
                                item.author ? t('settingsPluginsAuthor').replace('{author}', item.author) : '',
                                item.category ? t('settingsPluginsCategory').replace('{category}', item.category) : '',
                                item.version ? `v${item.version}` : '',
                            ]
                                .filter((part) => part !== '')
                                .join(' · ')}
                        </p>
                    </div>
                )}
            </li>
        );
    };

    let body;
    if (!summary || status === 'idle' || (loading && catalog.items.length === 0)) {
        body = (
            <div aria-busy="true" className="flex flex-col gap-2">
                <span role="status" className={HINT}>
                    {t('settingsPluginsDiscoverLoading')}
                </span>
                <Skeleton shape="block" height={40} />
                <Skeleton shape="block" height={40} />
                <Skeleton shape="block" height={40} />
            </div>
        );
    } else if (status === 'error') {
        const offline = catalog.error === 'offline';
        body = (
            <EmptyState
                icon={offline ? 'cloud_off' : 'error'}
                title={t(offline ? 'settingsPluginsDiscoverOffline' : 'settingsPluginsDiscoverError')}
                description={t(offline ? 'settingsPluginsDiscoverOfflineBody' : 'settingsPluginsDiscoverErrorBody')}
                action={retry}
            />
        );
    } else if (catalog.items.length === 0) {
        body = <EmptyState icon="extension" title={t('settingsPluginsDiscoverEmpty')} action={retry} />;
    } else if (visible.length === 0) {
        body = <EmptyState icon="search_off" title={t('settingsPluginsNoMatch')} />;
    } else {
        body = (
            <ul aria-labelledby={listId} className="flex flex-col gap-0.5">
                {visible.map(renderRow)}
            </ul>
        );
    }

    return (
        <Surface as="section" level="surface" elevation="e1" radius="lg" aria-labelledby={listId} className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
                <span id={listId} className={SECTION_LABEL}>
                    {t('settingsPluginsTabDiscover')}
                </span>
                <IconButton
                    icon="refresh"
                    label={t('settingsPluginsRefresh')}
                    size={28}
                    disabled={!ready || loading || installing}
                    onClick={() => dispatchPluginAction('plugin.refreshCatalog', {})}
                />
            </div>
            <TextField
                hideLabel
                icon="search"
                type="search"
                label={t('settingsPluginsSearch')}
                placeholder={t('settingsPluginsSearch')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />
            <Segmented<CatalogFilter>
                aria-label={t('settingsPluginsFilter')}
                items={[
                    { value: 'all', label: t('settingsPluginsFilterAll') },
                    { value: 'installed', label: t('settingsPluginsFilterInstalled') },
                    { value: 'notInstalled', label: t('settingsPluginsFilterNotInstalled') },
                ]}
                value={filter}
                onChange={setFilter}
            />
            <span role="status" aria-live="polite" className={HINT}>
                {resultText}
            </span>
            {body}
        </Surface>
    );
}
