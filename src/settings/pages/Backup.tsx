// T-614: Settings > Backup & updates. Full backup export and the update centre. Reads the system summary (src/store/systemSummary.ts)
// through the read-only mirror and only sends allow-listed `backup.*` / `update.*` actions; the main window runs the SAME functions the
// old Settings panel used (src/store/systemSync.ts), and main shows the save dialog. This window never touches files and the summary
// holds no paths, no error text and no secrets. The update centre is absent in the Microsoft Store build (the Store updates the app).
// T-615b: the settings / notes JSON export and import send `data.*` actions with empty payloads; the main window's dialog does the file
// work (export has its own download button there, import picks and validates the file there). No file content passes through here.
// T-615a: Restore sends `backup.restore {}`; the main window opens its restore dialog (a file picked here could not be handed over).
import { useId, useState } from 'react';
import { Button, Surface, Toggle } from '../../ui';
import { dispatchSystemAction, useSettingsState, useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import type { SystemActionType } from '../../store/systemSummary';

const HINT = 'text-[0.6875rem] leading-4 text-fg-2';
const SECTION_LABEL = 'text-[0.8125rem] leading-5 font-semibold text-fg-1';
const BODY = 'text-[0.8125rem] leading-5 text-fg-2';

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

    return (
        <div className="flex max-w-xl flex-col gap-4">
            {!ready && (
                <p role="status" className={BODY}>
                    {t('settingsWaiting')}
                </p>
            )}
            <Surface as="section" level="surface" elevation="e1" radius="lg" aria-labelledby={backupId} className="flex flex-col gap-3 p-4">
                <span id={backupId} className={SECTION_LABEL}>
                    {t('fullBackup')}
                </span>
                <p className={BODY}>{t('fullBackupDesc')}</p>
                <Toggle
                    label={t('fullBackupIncludeSecrets')}
                    checked={includeSecrets}
                    disabled={!canAct}
                    onChange={setIncludeSecrets}
                    fullWidth
                />
                {includeSecrets && (
                    <p
                        role="alert"
                        className="rounded-sm border border-stroke bg-[var(--kb-fill-hover)] px-2 py-1.5 text-[0.8125rem] leading-5 text-fg-1"
                    >
                        {t('fullBackupSecretsWarning')}
                    </p>
                )}
                <div>
                    <Button
                        variant="primary"
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
                <div className="flex flex-col gap-2 border-t border-stroke pt-3">
                    <span className={SECTION_LABEL}>{t('backupRestore')}</span>
                    <p className={BODY}>{t('backupRestoreDesc')}</p>
                    <div>
                        <Button
                            variant="secondary"
                            icon="restore"
                            disabled={!canAct || backup?.busy === true}
                            onClick={() => dispatchSystemAction('backup.restore', {})}
                        >
                            {t('backupRestorePick')}
                        </Button>
                    </div>
                </div>
            </Surface>
            <Surface as="section" level="surface" elevation="e1" radius="lg" aria-labelledby={dataId} className="flex flex-col gap-3 p-4">
                <span id={dataId} className={SECTION_LABEL}>
                    {t('backupSection')}
                </span>
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
                        className={`flex flex-col gap-2 ${index === 0 ? '' : 'border-t border-stroke pt-3'}`}
                    >
                        <span id={id} className={SECTION_LABEL}>
                            {t(label)}
                        </span>
                        <p className={BODY}>{t(desc)}</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="secondary"
                                icon="download"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction(exportAction as SystemActionType, {})}
                            >
                                {t('downloadJson')}
                            </Button>
                            <Button
                                variant="secondary"
                                icon="upload"
                                disabled={!canAct || backup?.busy === true}
                                onClick={() => dispatchSystemAction(importAction as SystemActionType, {})}
                            >
                                {t('import')}
                            </Button>
                        </div>
                    </div>
                ))}
            </Surface>
            {summary?.updatesEnabled && (
                <Surface
                    as="section"
                    level="surface"
                    elevation="e1"
                    radius="lg"
                    aria-labelledby={updateId}
                    className="flex flex-col gap-3 p-4"
                >
                    <span id={updateId} className={SECTION_LABEL}>
                        {t('updateCenter')}
                    </span>
                    <p className={BODY}>
                        {t('version')}: <span className="font-mono text-fg-1">{summary.version || '…'}</span>
                    </p>
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
                            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--kb-fill-selected)]"
                        >
                            <div className="h-full bg-[var(--kb-accent)]" style={{ width: `${update?.percent ?? 0}%` }} />
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {status === 'available' ? (
                            <Button
                                variant="primary"
                                icon="download"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction('update.download', {})}
                            >
                                {t('downloadAndInstall')}
                            </Button>
                        ) : status === 'downloaded' ? (
                            <Button
                                variant="primary"
                                icon="restart_alt"
                                disabled={!canAct}
                                onClick={() => dispatchSystemAction('update.install', {})}
                            >
                                {t('restartAndInstall')}
                            </Button>
                        ) : (
                            <Button
                                variant="secondary"
                                icon="update"
                                disabled={!canAct || status === 'downloading'}
                                loading={status === 'checking'}
                                onClick={() => dispatchSystemAction('update.check', {})}
                            >
                                {t('checkForUpdates')}
                            </Button>
                        )}
                    </div>
                </Surface>
            )}
        </div>
    );
}
