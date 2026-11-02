// T-614: Settings > Backup & updates. Full backup export and the update centre. Reads the system summary (src/store/systemSummary.ts)
// through the read-only mirror and only sends allow-listed `backup.*` / `update.*` actions; the main window runs the SAME functions the
// old Settings panel used (src/store/systemSync.ts), and main shows the save dialog. This window never touches files and the summary
// holds no paths, no error text and no secrets. The update centre is absent in the Microsoft Store build (the Store updates the app).
// T-615b: the settings / notes JSON export and import send `data.*` actions with empty payloads; the main window's dialog does the file
// work (export has its own download button there, import picks and validates the file there). No file content passes through here.
// T-615a: Restore sends `backup.restore {}`; the main window opens its restore dialog (a file picked here could not be handed over).
// CNL-08 (Canlı): a backup card (filled create, tonal restore) and an updates card (version in the tile-value role, status, actions).
// The summary carries no last-backup date, so the `backupLast` line is not shown (it would need a new summary field).
import { useId, useState } from 'react';
import { Button, Card, IconTile, Toggle } from '../../ui';
import { cx, INTERACTIVE } from '../../ui/cx';
import { dispatchSystemAction, useSettingsState, useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import type { SystemActionType } from '../../store/systemSummary';
import { RELEASES_URL } from '../../config/links';
import { PAGE_STACK, WaitingNote } from './shared';

const HINT = '[font:var(--kb-type-caption)] text-fg-2';
const BODY = '[font:var(--kb-type-body)] text-fg-2';
const SUB = '[font:var(--kb-type-body-strong)] text-fg-1';

export function BackupPage({ t }: SettingsPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const summary = useSystemSummary();
    const backupId = useId();
    const updateId = useId();
    const dataId = useId();
    const settingsDataId = useId();
    const notesDataId = useId();
    const [includeSecrets, setIncludeSecrets] = useState(false);

    const canAct = ready && !!summary;
    const backup = summary?.backup;
    const update = summary?.update;
    const status = update?.status ?? 'idle';
    const version = update?.version ?? '';

    let updateText: string | null = null;
    if (status === 'checking') updateText = t('checkingForUpdates');
    else if (status === 'upToDate') updateText = t('alreadyLatest');
    else if (status === 'available') updateText = t('newVersionAvailable').replace('{version}', () => version);
    else if (status === 'downloading') updateText = `${t('downloadingUpdate')} ${update?.percent ?? 0}%`;
    else if (status === 'downloaded') updateText = `${t('downloadComplete')} ${t('restartInstallDesc')}`;
    else if (status === 'error') updateText = t('updateError');

    let backupText: string | null = null;
    if (backup?.busy) backupText = t('settingsBackupExporting');
    else if (backup?.last === 'done') backupText = t('fullBackupDone');
    else if (backup?.last === 'failed') backupText = t('fullBackupFailed');

    const versionLine = (
        <div className="flex items-center gap-3.5">
            <IconTile icon="system_update_alt" />
            <span className="[font:var(--kb-type-tile-value)] text-fg-1 tabular-nums">
                {t('updatesVersion').replace('{version}', () => summary?.version || '…')}
            </span>
        </div>
    );

    return (
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <Card as="section" variant="list" aria-labelledby={backupId} title={<span id={backupId}>{t('fullBackup')}</span>}>
                <p className={BODY}>{t('backupCardDesc')}</p>
                <Toggle
                    label={t('fullBackupIncludeSecrets')}
                    checked={includeSecrets}
                    disabled={!canAct}
                    onChange={setIncludeSecrets}
                    fullWidth
                />
                {includeSecrets && (
                    <p role="alert" className="rounded-md bg-inset px-3 py-2 [font:var(--kb-type-body)] text-warning">
                        {t('fullBackupSecretsWarning')}
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="filled"
                        icon="backup"
                        disabled={!canAct}
                        loading={backup?.busy === true}
                        onClick={() => dispatchSystemAction('backup.export', { includeSecrets })}
                    >
                        {t('fullBackupCreate')}
                    </Button>
                </div>
                <p role="status" className={HINT}>
                    {backupText}
                </p>
                <div className="flex flex-col gap-2 border-t border-fg-3/20 pt-3">
                    <span className={SUB}>{t('backupRestore')}</span>
                    <p className={BODY}>{t('backupRestoreDesc')}</p>
                    <div>
                        <Button
                            variant="tonal"
                            icon="restore"
                            disabled={!canAct || backup?.busy === true}
                            onClick={() => dispatchSystemAction('backup.restore', {})}
                        >
                            {t('backupRestorePick')}
                        </Button>
                    </div>
                </div>
            </Card>
            <Card as="section" variant="list" aria-labelledby={dataId} title={<span id={dataId}>{t('backupSection')}</span>}>
                {(
                    [
                        [settingsDataId, 'exportSettings', 'exportSettingsDesc', 'data.exportSettings', 'data.importSettings'],
                        [notesDataId, 'exportData', 'exportDataDesc', 'data.exportNotes', 'data.importNotes'],
                    ] as const
                ).map(([id, label, desc, exportAction, importAction], index) => (
                    <div
                        key={id}
                        role="group"
                        aria-labelledby={id}
                        className={cx('flex flex-col gap-2', index !== 0 && 'border-t border-fg-3/20 pt-3')}
                    >
                        <span id={id} className={SUB}>
                            {t(label)}
                        </span>
                        <p className={BODY}>{t(desc)}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="tonal"
                                icon="download"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction(exportAction as SystemActionType, {})}
                            >
                                {t('downloadJson')}
                            </Button>
                            <Button
                                variant="tonal"
                                icon="upload"
                                disabled={!canAct || backup?.busy === true}
                                onClick={() => dispatchSystemAction(importAction as SystemActionType, {})}
                            >
                                {t('import')}
                            </Button>
                        </div>
                    </div>
                ))}
            </Card>
            {summary?.manualUpdate && (
                // MAC-016: unsigned macOS build: no self-update. A plain anchor like the About page (main's navigation guard opens it).
                <Card as="section" variant="list" aria-labelledby={updateId} title={<span id={updateId}>{t('updateCenter')}</span>}>
                    {versionLine}
                    <p className={BODY}>{t('updateManualDesc')}</p>
                    <a
                        href={RELEASES_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cx(INTERACTIVE, 'w-fit rounded-xs [font:var(--kb-type-body-strong)] text-accent hover:underline')}
                    >
                        {t('updateManualLink')}
                    </a>
                </Card>
            )}
            {summary?.updatesEnabled && (
                <Card as="section" variant="list" aria-labelledby={updateId} title={<span id={updateId}>{t('updateCenter')}</span>}>
                    {versionLine}
                    <p role="status" className={BODY}>
                        {updateText}
                    </p>
                    {status === 'downloading' && (
                        <div
                            role="progressbar"
                            aria-label={t('downloadingUpdate')}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={update?.percent ?? 0}
                            className="h-1.5 w-full overflow-hidden rounded-full bg-inset"
                        >
                            <div className="h-full bg-accent" style={{ width: `${update?.percent ?? 0}%` }} />
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {status === 'available' ? (
                            <Button
                                variant="filled"
                                icon="download"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction('update.download', {})}
                            >
                                {t('downloadAndInstall')}
                            </Button>
                        ) : status === 'downloaded' ? (
                            <Button
                                variant="filled"
                                icon="restart_alt"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction('update.install', {})}
                            >
                                {t('restartAndInstall')}
                            </Button>
                        ) : (
                            <Button
                                variant="tonal"
                                icon="update"
                                disabled={!canAct || status === 'downloading'}
                                loading={status === 'checking'}
                                onClick={() => dispatchSystemAction('update.check', {})}
                            >
                                {t('checkForUpdates')}
                            </Button>
                        )}
                    </div>
                </Card>
            )}
            {summary && !summary.updatesEnabled && !summary.manualUpdate && (
                // The Microsoft Store build: the Store installs updates, so there is nothing to check here (just the version).
                <Card
                    as="section"
                    variant="list"
                    title={t('updatesVersion').replace('{version}', () => summary.version || '…')}
                    description={t('updatesStoreNote')}
                />
            )}
        </div>
    );
}
