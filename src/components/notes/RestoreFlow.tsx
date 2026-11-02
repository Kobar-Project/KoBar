import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import type { RestorePlan, RestorePreview } from '../../backup/parseBackup';
import { prepareRestoreFromFile, restoreErrorKey } from '../../backup/prepareRestore';
import { restoreFullBackup } from '../../backup/restoreBackup';
import { isHydrationFailed } from '../../store/hydrationError';
import { restoreFromRecovery } from '../../store/hydrationRecovery';
import { Button } from '../../ui';
import { BackupWarnings } from './BackupWarnings';

// Restore part of the backup UI (T-212/T-213/T-215), shared (formerly also by the old settings panel) with the main window's
// restore dialog that the Settings window opens through the relayed `backup.restore` action (T-615a): file input, validation,
// the automatic pre-restore safety backup, the confirmation with the warnings (plugin flags included) and the relaunch.

function formatCreatedAt(value: string, language: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
        return date.toLocaleString(language);
    } catch {
        return value;
    }
}

interface Pending {
    plan: RestorePlan;
    preview: RestorePreview;
}

interface RestoreFlowProps {
    /** Locks the flow from outside (the old panel while an export runs). */
    disabled?: boolean;
    /** Reports whether a restore step is running, so the host can block closing / exporting meanwhile. */
    onBusyChange?: (busy: boolean) => void;
}

const RestoreFlow: React.FC<RestoreFlowProps> = ({ disabled = false, onBusyChange }) => {
    const t = useT();
    const language = useAppStore((s) => s.language);
    const fileRef = useRef<HTMLInputElement>(null);
    const [ownBusy, setBusy] = useState(false);
    const busy = ownBusy || disabled;
    useEffect(() => {
        onBusyChange?.(ownBusy);
    }, [ownBusy, onBusyChange]);
    const [pending, setPending] = useState<Pending | null>(null);
    const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file || busy) return;
        setBusy(true);
        setPending(null);
        setMessage(null);
        try {
            // prepareRestoreFromFile never rejects (failures come back with a translation key).
            const prepared = await prepareRestoreFromFile(file);
            if (!prepared.ok) setMessage({ text: t(prepared.errorKey), tone: 'error' });
            else setPending({ plan: prepared.plan, preview: prepared.preview });
        } catch {
            setMessage({ text: t(restoreErrorKey('read-failed')), tone: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleConfirm = async () => {
        if (busy || !pending) return;
        setBusy(true);
        try {
            // T-152: after a failed hydration the unreadable store gets its verbatim copy before anything is replaced.
            const result = isHydrationFailed() ? await restoreFromRecovery(pending.plan) : await restoreFullBackup(pending.plan);
            if (result.success) {
                // Main relaunches the app right after this.
                // Stay busy: the buttons remain disabled until the relaunch.
                setMessage({ text: t('backupRestoring'), tone: 'info' });
                setPending(null);
                return;
            }
            if (result.reason === 'copy-failed') setMessage({ text: t('recoveryCopyFailed'), tone: 'error' });
            else setMessage({ text: t(result.rolledBack ? 'backupRestoreFailed' : 'backupRestoreFailedPartial'), tone: 'error' });
        } catch {
            setMessage({ text: t('backupRestoreFailed'), tone: 'error' });
        }
        setPending(null);
        setBusy(false);
    };

    const preview = pending?.preview;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
                <span className="[font:var(--kb-type-body-strong)] text-fg-1">{t('backupRestore')}</span>
                <span className="[font:var(--kb-type-caption)] text-fg-2">{t('backupRestoreDesc')}</span>
            </div>
            <input
                data-testid="backup-file"
                type="file"
                accept=".json"
                className="hidden"
                ref={fileRef}
                onChange={(e) => void handleFile(e)}
            />
            <Button data-testid="backup-pick" variant="outline" icon="upload_file" onClick={() => fileRef.current?.click()} disabled={busy}>
                {t('backupRestorePick')}
            </Button>

            {message && (
                <div
                    role={message.tone === 'error' ? 'alert' : 'status'}
                    data-testid="backup-message"
                    className={`rounded-md px-3 py-2 [font:var(--kb-type-caption)] ${message.tone === 'error' ? 'bg-[color-mix(in_oklab,var(--kb-danger)_14%,transparent)] text-danger' : 'bg-inset text-fg-1'}`}
                >
                    {message.text}
                </div>
            )}

            {pending && preview && (
                <div data-testid="backup-confirm" className="flex flex-col gap-2 rounded-lg bg-container p-3 text-on-container">
                    <span className="[font:var(--kb-type-body-strong)]">{t('backupConfirmTitle')}</span>
                    <div className="flex flex-col gap-0.5 [font:var(--kb-type-caption)]">
                        {preview.createdAt && (
                            <span>
                                {t('backupCreatedAt')}: {formatCreatedAt(preview.createdAt, language)}
                            </span>
                        )}
                        {preview.appVersion && (
                            <span>
                                {t('backupAppVersion')}: {preview.appVersion}
                            </span>
                        )}
                        <span>
                            {t('backupCountNotes')}: {preview.counts.notes}
                        </span>
                        <span>
                            {t('backupCountWorkspaces')}: {preview.counts.workspaces}
                        </span>
                        <span>
                            {t('backupCountChats')}: {preview.counts.chats}
                        </span>
                    </div>
                    <ul className="flex list-disc flex-col gap-0.5 ps-4 [font:var(--kb-type-caption)]">
                        <li>{t('backupWarnOwn')}</li>
                        <BackupWarnings preview={preview} t={t} />
                        {preview.missingPlugins.length > 0 && (
                            <li>
                                {t('backupWarnMissingPlugins')} {preview.missingPlugins.map((p) => p.name || p.id).join(', ')}
                            </li>
                        )}
                    </ul>
                    <span className="[font:var(--kb-type-caption)]">{t('backupConfirmBody')}</span>
                    <div className="flex justify-end gap-2">
                        <Button data-testid="backup-cancel" variant="text" size="sm" onClick={() => setPending(null)} disabled={busy}>
                            {t('backupCancel')}
                        </Button>
                        <Button
                            data-testid="backup-confirm-button"
                            variant="filled"
                            size="sm"
                            icon="restore"
                            onClick={() => void handleConfirm()}
                            disabled={busy}
                        >
                            {t('backupConfirmButton')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RestoreFlow;
