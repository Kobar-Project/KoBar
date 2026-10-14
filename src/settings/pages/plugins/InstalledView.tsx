// T-610 / T-611: the Installed view of Settings > Plugins (the page shell with the Installed | Discover tabs is ../Plugins.tsx). The installed plugins (read-only summary published by the main window, src/store/pluginSummary.ts),
// an enable toggle, uninstall behind a ConfirmDialog, update checks / "Update all", and a "Plugin settings" button that asks the
// main window to open the v1 settings panel of a plugin (those panels render plugin code and exist only in the main window).
// Everything goes through allow-listed `plugin.*` actions validated by the main window against its live plugin list; nothing is
// optimistic: what a row shows is what the main window reported. The summary carries no code, repo URL or path.
import { useId, useState } from 'react';
import type { PluginSummaryItem } from '../../../store/pluginSummary';
import { Button, ConfirmDialog, EmptyState, IconButton, ListItem, Surface, Toggle } from '../../../ui';
import { dispatchPluginAction, useSettingsState, usePluginSummary } from '../../mirror';
import type { SettingsPageProps } from '../../pages';
import { PluginRepoLink } from './PluginRepoLink';

const HINT = 'text-[0.6875rem] leading-4 text-fg-2';
const SECTION_LABEL = 'text-[0.8125rem] leading-5 font-semibold text-fg-1';

export function InstalledView({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = usePluginSummary();
    const installedId = useId();
    const updatesId = useId();
    const [uninstallId, setUninstallId] = useState<string | null>(null);

    const items = summary?.items ?? [];
    const status = summary?.status;
    const busy = !!status && (status.checking || status.updating);
    const updatable = items.filter((item) => item.updateAvailable);
    // The dialog follows the live list: when the plugin is gone (uninstalled, or the main window reloaded) it closes by itself.
    const uninstalling = uninstallId === null ? undefined : items.find((item) => item.id === uninstallId);
    const last = summary?.lastUpdate ?? null;

    const resultText = last
        ? t('settingsPluginsResult')
              .replace('{updated}', String(last.updated))
              .replace('{failed}', String(last.failed))
              .replace('{canceled}', String(last.canceled))
        : '';

    const renderRow = (item: PluginSummaryItem) => (
        <ListItem
            key={item.id}
            as="li"
            leading="extension"
            title={item.name}
            description={
                <>
                    {item.version ? `v${item.version}` : ''}
                    {!item.removable ? ` · ${t('settingsPluginsDevBadge')}` : ''}
                    {item.updateAvailable && item.latestVersion
                        ? ` · ${t('settingsPluginsUpdateAvailable').replace('{version}', item.latestVersion)}`
                        : ''}
                    {item.repo && (
                        <span className="mt-0.5 block min-w-0">
                            <PluginRepoLink repo={item.repo} label={t('settingsPluginsGithubLink').replace('{name}', item.name)} />
                        </span>
                    )}
                </>
            }
            trailing={
                <>
                    {item.hasSettingsPanel && (
                        <IconButton
                            icon="tune"
                            label={`${t('settingsPluginsSettings')}: ${item.name}`}
                            tooltip={t('settingsPluginsSettingsHint')}
                            size={28}
                            disabled={!ready}
                            onClick={() => dispatchPluginAction('plugin.openSettings', { id: item.id })}
                        />
                    )}
                    {item.updateAvailable && (
                        <Button
                            size="sm"
                            variant="secondary"
                            disabled={!ready || busy}
                            aria-label={`${t('settingsPluginsUpdate')}: ${item.name}`}
                            onClick={() => dispatchPluginAction('plugin.update', { id: item.id })}
                        >
                            {t('settingsPluginsUpdate')}
                        </Button>
                    )}
                    {item.removable && (
                        <IconButton
                            icon="delete"
                            label={`${t('settingsPluginsUninstall')}: ${item.name}`}
                            tooltip={t('settingsPluginsUninstall')}
                            size={28}
                            disabled={!ready}
                            onClick={() => setUninstallId(item.id)}
                        />
                    )}
                    <Toggle
                        hideLabel
                        label={t('settingsPluginsEnableLabel').replace('{name}', item.name)}
                        checked={item.enabled}
                        disabled={!ready}
                        onChange={(enabled) => dispatchPluginAction('plugin.setEnabled', { id: item.id, enabled })}
                    />
                </>
            }
        />
    );

    return (
        <div className="flex flex-col gap-4">
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-labelledby={updatesId}
                className="flex flex-col gap-2 p-4"
            >
                <span id={updatesId} className={SECTION_LABEL}>
                    {t('settingsPluginsUpdates')}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        icon="refresh"
                        loading={!!status?.checking}
                        disabled={!ready || !summary || busy}
                        onClick={() => dispatchPluginAction('plugin.checkUpdates', {})}
                    >
                        {status?.checking ? t('settingsPluginsChecking') : t('settingsPluginsCheck')}
                    </Button>
                    <Button
                        variant="primary"
                        icon="system_update_alt"
                        loading={!!status?.updating}
                        disabled={!ready || updatable.length === 0 || busy}
                        onClick={() => dispatchPluginAction('plugin.updateAll', {})}
                    >
                        {status?.updating ? t('settingsPluginsUpdating') : t('settingsPluginsUpdateAll')}
                    </Button>
                </div>
                <span role="status" aria-live="polite" className={HINT}>
                    {resultText || (status?.checked && updatable.length === 0 && !busy ? t('settingsPluginsUpToDate') : '')}
                </span>
            </Surface>
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-labelledby={installedId}
                className="flex flex-col gap-2 p-4"
            >
                <span id={installedId} className={SECTION_LABEL}>
                    {t('settingsPluginsInstalled')}
                </span>
                {!summary ? (
                    <span role="status" className={HINT}>
                        {t('settingsPluginsLoading')}
                    </span>
                ) : items.length === 0 ? (
                    <EmptyState icon="extension" title={t('settingsPluginsEmpty')} />
                ) : (
                    <ul aria-labelledby={installedId} className="flex flex-col gap-0.5">
                        {items.map(renderRow)}
                    </ul>
                )}
            </Surface>
            <ConfirmDialog
                open={!!uninstalling}
                danger
                title={t('settingsPluginsUninstallTitle').replace('{name}', uninstalling?.name ?? '')}
                description={t('settingsPluginsUninstallBody')}
                confirmLabel={t('settingsPluginsUninstall')}
                cancelLabel={t('cancel')}
                onCancel={() => setUninstallId(null)}
                onConfirm={() => {
                    if (uninstalling) dispatchPluginAction('plugin.uninstall', { id: uninstalling.id });
                    setUninstallId(null);
                }}
            />
        </div>
    );
}
