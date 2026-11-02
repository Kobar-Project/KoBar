import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RestorePlan, RestorePreview } from '../../backup/parseBackup';
import { prepareRestoreFromFile } from '../../backup/prepareRestore';
import { translate } from '../../i18n/translate';
import type { TranslationKeys } from '../../i18n';
import { computeBannerPosition, removeBanner } from '../../store/banner';
import {
    HYDRATION_ERROR_BANNER_ID,
    isHydrationFailed,
    pickHydrationErrorLanguage,
    subscribeHydrationFailure,
} from '../../store/hydrationError';
import { restoreFromRecovery, startFreshAfterHydrationFailure } from '../../store/hydrationRecovery';
import { useAppStore } from '../../store/useAppStore';
import { Button, Icon } from '../../ui';
import { BackupWarnings } from '../notes/BackupWarnings';

// Recovery panel after a failed `kobar-storage` hydration (T-152). Replaces the plain T-201 banner once React is up.
// Writes stay locked until the user picks an action; "Continue without saving" only collapses the panel (the session
// keeps running in memory, as before). Positioned at the top centre of the current display, recomputed when the
// window or display changes (resize, edge/screen change from main, and a light poll because moving the ghost window
// fires no DOM event). Colours are inline/explicit: the theme is not applied while the store is not hydrated.

const POSITION_POLL_MS = 1000;

// Only the placement is inline; colours come from the Canlı tokens, whose dark defaults resolve before the store is hydrated.
const PANEL_STYLE: React.CSSProperties = {
    position: 'fixed',
    zIndex: 2147483647,
    transform: 'translateX(-50%)',
    width: 'min(480px, calc(100vw - 32px))',
    boxSizing: 'border-box',
    pointerEvents: 'auto',
};
const PANEL_CLASS = 'rounded-xl border border-[var(--kb-danger)] bg-shell text-fg-1 shadow-e3 [font:var(--kb-type-body)]';

function usePanelPosition(): { left: string; top: string } {
    const [pos, setPos] = useState(() => computeBannerPosition());
    useEffect(() => {
        const update = () =>
            setPos((prev) => {
                const next = computeBannerPosition();
                return prev.left === next.left && prev.top === next.top ? prev : next;
            });
        window.addEventListener('resize', update);
        const timer = window.setInterval(update, POSITION_POLL_MS);
        // Teleport / display change: main reports the new edge and screen bounds (App stores them).
        const unsubscribe = useAppStore.subscribe((state, prev) => {
            if (state.screenBounds !== prev.screenBounds || state.edgePosition !== prev.edgePosition) update();
        });
        return () => {
            window.removeEventListener('resize', update);
            window.clearInterval(timer);
            unsubscribe();
        };
    }, []);
    return pos;
}

function formatCreatedAt(value: string, language: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
        return date.toLocaleString(language);
    } catch {
        return value;
    }
}

type View = 'main' | 'confirm-fresh' | 'confirm-restore';

interface Pending {
    plan: RestorePlan;
    preview: RestorePreview;
}

const RecoveryPanel: React.FC = () => {
    // The stored language is unreadable: same choice as the T-201 banner.
    const [language] = useState(pickHydrationErrorLanguage);
    const t = useCallback((key: TranslationKeys) => translate(language, key), [language]);
    const pos = usePanelPosition();
    const fileRef = useRef<HTMLInputElement>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [view, setView] = useState<View>('main');
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

    // This panel carries the same message plus the actions.
    useEffect(() => {
        removeBanner(HYDRATION_ERROR_BANNER_ID);
    }, []);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file || busy) return;
        setBusy(true);
        setPending(null);
        setMessage(null);
        // prepareRestoreFromFile never rejects.
        const prepared = await prepareRestoreFromFile(file);
        if (prepared.ok) {
            setPending({ plan: prepared.plan, preview: prepared.preview });
            setView('confirm-restore');
        } else setMessage({ text: t(prepared.errorKey), tone: 'error' });
        setBusy(false);
    };

    const handleConfirmRestore = async () => {
        if (busy || !pending) return;
        setBusy(true);
        const result = await restoreFromRecovery(pending.plan);
        setPending(null);
        setView('main');
        if (result.success) {
            // Main relaunches the app; stay busy until then.
            setMessage({ text: t('backupRestoring'), tone: 'info' });
            return;
        }
        if (result.reason === 'copy-failed') setMessage({ text: t('recoveryCopyFailed'), tone: 'error' });
        else setMessage({ text: t(result.rolledBack ? 'backupRestoreFailed' : 'backupRestoreFailedPartial'), tone: 'error' });
        setBusy(false);
    };

    const handleConfirmFresh = () => {
        if (busy) return;
        setBusy(true);
        const result = startFreshAfterHydrationFailure();
        if (result.success) return; // The panel unmounts (the failure flag is cleared).
        setView('main');
        setMessage({ text: t(result.reason === 'copy-failed' ? 'recoveryCopyFailed' : 'recoveryFreshFailed'), tone: 'error' });
        setBusy(false);
    };

    const dir = language === 'ar' ? 'rtl' : 'ltr';
    const position = { left: pos.left, top: pos.top };

    if (collapsed) {
        return (
            <button
                type="button"
                data-testid="recovery-reopen"
                className={`${PANEL_CLASS} pointer-events-auto flex cursor-pointer items-center gap-2 px-3 py-1.5`}
                dir={dir}
                style={{ ...PANEL_STYLE, ...position, width: 'auto', maxWidth: 'calc(100vw - 32px)' }}
                onClick={() => setCollapsed(false)}
            >
                <Icon name="warning" size={16} className="text-danger" />
                <span className="[font:var(--kb-type-label)]">{t('recoveryReopen')}</span>
            </button>
        );
    }

    const preview = pending?.preview;

    return (
        <div
            data-testid="recovery-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="kobar-recovery-title"
            className={`${PANEL_CLASS} pointer-events-auto flex flex-col gap-3 p-4`}
            dir={dir}
            style={{ ...PANEL_STYLE, ...position }}
        >
            <div className="flex flex-col gap-1">
                <div id="kobar-recovery-title" className="font-heading [font:var(--kb-type-title)]">
                    {t('hydrationFailedTitle')}
                </div>
                <div className="[font:var(--kb-type-caption)] text-fg-2">{t('recoveryBody')}</div>
            </div>

            {message && (
                <div
                    role={message.tone === 'error' ? 'alert' : 'status'}
                    data-testid="recovery-message"
                    className={`rounded-md px-3 py-2 [font:var(--kb-type-caption)] ${message.tone === 'error' ? 'bg-[color-mix(in_oklab,var(--kb-danger)_14%,transparent)] text-danger' : 'bg-inset text-fg-1'}`}
                >
                    {message.text}
                </div>
            )}

            <input
                data-testid="recovery-file"
                type="file"
                accept=".json"
                className="hidden"
                ref={fileRef}
                onChange={(e) => void handleFile(e)}
            />

            {view === 'main' && (
                <div className="flex flex-col gap-2">
                    <Button
                        data-testid="recovery-restore"
                        variant="tonal"
                        icon="upload_file"
                        fullWidth
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                    >
                        {t('recoveryRestore')}
                    </Button>
                    <Button
                        data-testid="recovery-fresh"
                        variant="outline"
                        icon="restart_alt"
                        fullWidth
                        disabled={busy}
                        onClick={() => {
                            setMessage(null);
                            setView('confirm-fresh');
                        }}
                    >
                        {t('recoveryStartFresh')}
                    </Button>
                    <Button data-testid="recovery-later" variant="text" fullWidth disabled={busy} onClick={() => setCollapsed(true)}>
                        {t('recoveryLater')}
                    </Button>
                    <div className="[font:var(--kb-type-caption)] text-fg-3">{t('recoveryBackupsHint')}</div>
                </div>
            )}

            {view === 'confirm-fresh' && (
                <div data-testid="recovery-fresh-panel" className="flex flex-col gap-2 rounded-lg bg-inset p-3">
                    <span className="[font:var(--kb-type-body-strong)]">{t('recoveryFreshConfirmTitle')}</span>
                    <span className="[font:var(--kb-type-caption)] text-fg-2">{t('recoveryFreshConfirmBody')}</span>
                    <div className="flex justify-end gap-2">
                        <Button
                            data-testid="recovery-fresh-cancel"
                            variant="text"
                            size="sm"
                            disabled={busy}
                            onClick={() => setView('main')}
                        >
                            {t('backupCancel')}
                        </Button>
                        <Button
                            data-testid="recovery-fresh-confirm"
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={handleConfirmFresh}
                        >
                            {t('recoveryFreshConfirmButton')}
                        </Button>
                    </div>
                </div>
            )}

            {view === 'confirm-restore' && preview && (
                <div data-testid="recovery-restore-panel" className="flex flex-col gap-2 rounded-lg bg-inset p-3">
                    <span className="[font:var(--kb-type-body-strong)]">{t('backupConfirmTitle')}</span>
                    <div className="flex flex-col gap-0.5 [font:var(--kb-type-caption)]">
                        {preview.createdAt && (
                            <span>
                                {t('backupCreatedAt')}: {formatCreatedAt(preview.createdAt, language)}
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
                    <ul className="flex list-disc flex-col gap-0.5 ps-4 [font:var(--kb-type-caption)] text-fg-2">
                        <li>{t('backupWarnOwn')}</li>
                        <BackupWarnings preview={preview} t={t} />
                    </ul>
                    <span className="[font:var(--kb-type-caption)]">{t('backupConfirmBody')}</span>
                    <div className="flex justify-end gap-2">
                        <Button
                            data-testid="recovery-restore-cancel"
                            variant="text"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                                setPending(null);
                                setView('main');
                            }}
                        >
                            {t('backupCancel')}
                        </Button>
                        <Button
                            data-testid="recovery-restore-confirm"
                            variant="danger"
                            size="sm"
                            icon="restore"
                            disabled={busy}
                            onClick={() => void handleConfirmRestore()}
                        >
                            {t('backupConfirmButton')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

/** Shown only after a failed hydration (until "Start fresh" succeeds). */
const HydrationRecovery: React.FC = () => {
    const failed = useSyncExternalStore(subscribeHydrationFailure, isHydrationFailed, isHydrationFailed);
    return failed ? <RecoveryPanel /> : null;
};

export default HydrationRecovery;
