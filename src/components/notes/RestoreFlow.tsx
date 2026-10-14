import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import type { RestorePlan, RestorePreview } from '../../backup/parseBackup';
import { prepareRestoreFromFile, restoreErrorKey } from '../../backup/prepareRestore';
import { restoreFullBackup } from '../../backup/restoreBackup';
import { isHydrationFailed } from '../../store/hydrationError';
import { restoreFromRecovery } from '../../store/hydrationRecovery';
import { BackupWarnings } from './BackupWarnings';

// Restore part of the backup UI (T-212/T-213/T-215), shared (formerly also by the old settings panel) with the main window's
// restore dialog that the Settings window opens through the relayed `backup.restore` action (T-615a): file input, validation,
// the automatic pre-restore safety backup, the confirmation with the warnings (plugin flags included) and the relaunch.

export const BACKUP_BUTTON =
    'w-full py-2 rounded-lg bg-inset border border-stroke hover:bg-fill-hover hover:border-primary/50 text-fg-1 hover:text-primary text-xs font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-wait';
const BUTTON = BACKUP_BUTTON;

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
                <span className="text-sm text-fg-1 font-medium">{t('backupRestore')}</span>
                <span className="text-xs text-fg-2">{t('backupRestoreDesc')}</span>
            </div>
            <input
                data-testid="backup-file"
                type="file"
                accept=".json"
                className="hidden"
                ref={fileRef}
                onChange={(e) => void handleFile(e)}
            />
            <button data-testid="backup-pick" onClick={() => fileRef.current?.click()} disabled={busy} className={BUTTON}>
                <span className="material-symbols-outlined text-[16px]">upload_file</span>
                {t('backupRestorePick')}
            </button>

            {message && (
                <div
                    role={message.tone === 'error' ? 'alert' : 'status'}
                    data-testid="backup-message"
                    className={`rounded-lg border px-2 py-1.5 text-xs ${message.tone === 'error' ? 'border-red-500/40 bg-red-500/10 text-danger' : 'border-stroke bg-fill-hover text-fg-1'}`}
                >
                    {message.text}
                </div>
            )}

            {pending && preview && (
                <div data-testid="backup-confirm" className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/10 p-2">
                    <span className="text-sm text-fg-1 font-medium">{t('backupConfirmTitle')}</span>
                    <div className="text-xs text-fg-1 flex flex-col gap-0.5">
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
                    <ul className="text-xs text-fg-2 list-disc pl-4 flex flex-col gap-0.5">
                        <li>{t('backupWarnOwn')}</li>
                        <BackupWarnings preview={preview} t={t} />
                        {preview.missingPlugins.length > 0 && (
                            <li>
                                {t('backupWarnMissingPlugins')} {preview.missingPlugins.map((p) => p.name || p.id).join(', ')}
                            </li>
                        )}
                    </ul>
                    <span className="text-xs text-fg-1">{t('backupConfirmBody')}</span>
                    <div className="flex gap-2">
                        <button data-testid="backup-cancel" onClick={() => setPending(null)} disabled={busy} className={BUTTON}>
                            {t('backupCancel')}
                        </button>
                        <button data-testid="backup-confirm-button" onClick={() => void handleConfirm()} disabled={busy} className={BUTTON}>
                            <span className="material-symbols-outlined text-[16px]">restore</span>
                            {t('backupConfirmButton')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RestoreFlow;
