// T-610 / T-611: the Installed view of Settings > Plugins (the page shell with the Installed | Discover tabs is ../Plugins.tsx). The installed plugins (read-only summary published by the main window, src/store/pluginSummary.ts),
// an enable toggle, uninstall behind a ConfirmDialog, update checks / "Update all", and a "Plugin settings" button that asks the
// main window to open the v1 settings panel of a plugin (those panels render plugin code and exist only in the main window).
// Everything goes through allow-listed `plugin.*` actions validated by the main window against its live plugin list; nothing is
// optimistic: what a row shows is what the main window reported. The summary carries no code, repo URL or path.
// CNL-08 (Canlı): an updates card on top, then a 2-column grid of plugin rows (icon tile, name, origin line, chips, actions, switch).
import { useId, useState } from 'react';
import type { PluginSummaryItem } from '../../../store/pluginSummary';
import { Button, Card, ConfirmDialog, EmptyState, IconButton, IconTile, Toggle } from '../../../ui';
import { dispatchPluginAction, useSettingsState, usePluginSummary } from '../../mirror';
import type { SettingsPageProps } from '../../pages';
import { getDocumentPlatform } from '../../../platform';
import { isPluginSupportedOn, platformDisplayName } from '../../../../shared/pluginPlatforms';
import { PAGE_STACK, StaticChip } from '../shared';
import { PluginOrigin } from './PluginOrigin';
import { PluginRepoLink } from './PluginRepoLink';

const HINT = '[font:var(--kb-type-caption)] text-fg-2';

export function InstalledView({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = usePluginSummary();
    const installedId = useId();
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
    const statusText = resultText || (status?.checked && updatable.length === 0 && !busy ? t('settingsPluginsUpToDate') : '');

    const platform = getDocumentPlatform();
    const renderRow = (item: PluginSummaryItem) => (
        <li key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg bg-surface p-3.5">
            <IconTile icon="extension" size="md" muted={!item.enabled} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate [font:var(--kb-type-body-strong)] text-fg-1">{item.name}</span>
                <span className={HINT}>
                    {item.version ? `v${item.version}` : ''}
                    {item.updateAvailable && item.latestVersion
                        ? ` · ${t('settingsPluginsUpdateAvailable').replace('{version}', item.latestVersion)}`
                        : ''}
                </span>
                <PluginOrigin t={t} repo={item.repo} />
                {!item.removable && (
                    <span className="flex flex-wrap gap-1.5">
                        <StaticChip tone="inset">{t('settingsPluginsDevBadge')}</StaticChip>
                    </span>
                )}
                {platform !== null && !isPluginSupportedOn(item.id, platform) && (
                    <span className="[font:var(--kb-type-caption)] text-danger">
                        {t('pluginUnsupportedWarning').replace('{platform}', platformDisplayName(platform))}
                    </span>
                )}
                {item.repo && (
                    <span className="min-w-0">
                        <PluginRepoLink repo={item.repo} label={t('settingsPluginsGithubLink').replace('{name}', item.name)} />
                    </span>
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {item.hasSettingsPanel && (
                    <IconButton
                        icon="tune"
                        label={`${t('settingsPluginsSettings')}: ${item.name}`}
                        tooltip={t('settingsPluginsSettingsHint')}
                        size={32}
                        disabled={!ready}
                        onClick={() => dispatchPluginAction('plugin.openSettings', { id: item.id })}
                    />
                )}
                {item.updateAvailable && (
                    <Button
                        size="sm"
                        variant="tonal"
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
                        size={32}
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
            </div>
        </li>
    );

    return (
        <div className={PAGE_STACK}>
            <Card
                as="section"
                icon="refresh"
                title={t('settingsPluginsUpdates')}
                description={
                    <span role="status" aria-live="polite">
                        {statusText}
                    </span>
                }
                control={
                    <>
                        <Button
                            variant="tonal"
                            icon="refresh"
                            loading={!!status?.checking}
                            disabled={!ready || !summary || busy}
                            onClick={() => dispatchPluginAction('plugin.checkUpdates', {})}
                        >
                            {status?.checking ? t('settingsPluginsChecking') : t('settingsPluginsCheck')}
                        </Button>
                        <Button
                            variant="filled"
                            icon="system_update_alt"
                            loading={!!status?.updating}
                            disabled={!ready || updatable.length === 0 || busy}
                            onClick={() => dispatchPluginAction('plugin.updateAll', {})}
                        >
                            {status?.updating ? t('settingsPluginsUpdating') : t('settingsPluginsUpdateAll')}
                        </Button>
                    </>
                }
            />
            <Card as="section" variant="list" title={<span id={installedId}>{t('settingsPluginsInstalled')}</span>}>
                {!summary ? (
                    <span role="status" className={HINT}>
                        {t('settingsPluginsLoading')}
                    </span>
                ) : items.length === 0 ? (
                    <EmptyState icon="extension" title={t('settingsPluginsEmpty')} />
                ) : (
                    <ul aria-labelledby={installedId} className="grid grid-cols-2 gap-2.5 max-[900px]:grid-cols-1">
                        {items.map(renderRow)}
                    </ul>
                )}
            </Card>
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
