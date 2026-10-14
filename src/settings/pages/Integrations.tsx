// R2-15: Settings > Integrations > Google Calendar (Experimental, read-only, default OFF). Talks to the main process through the
// Settings window's narrow bridge (window.settingsBridge.gcal*): the answers are plain status codes, never a token, an e-mail
// address or an event title. The enabled flag lives in the main process (not in kobar-storage).
import { useCallback, useEffect, useId, useState } from 'react';
import type { IpcGcalConnectFailure, IpcGcalStatus, IpcSettingsWindowBridge } from '../../../shared/ipc-contract';
import type { TranslationKeys } from '../../i18n';
import { Button, Surface, Toggle } from '../../ui';
import type { SettingsPageProps } from '../pages';

const BODY = 'text-[0.8125rem] leading-5 text-fg-2';
const HINT = 'text-[0.6875rem] leading-4 text-fg-2';
const SECTION_LABEL = 'text-[0.8125rem] leading-5 font-semibold text-fg-1';

type GcalBridge = Pick<IpcSettingsWindowBridge, 'gcalStatus' | 'gcalConnect' | 'gcalDisconnect' | 'gcalSetEnabled' | 'gcalRefresh'>;

function getBridge(): Partial<GcalBridge> | undefined {
    return (globalThis as { settingsBridge?: Partial<GcalBridge> }).settingsBridge;
}

const STATE_KEYS: Record<IpcGcalStatus['state'], TranslationKeys> = {
    'not-configured': 'gcalStateNotConfigured',
    'not-connected': 'gcalStateNotConnected',
    connected: 'gcalStateConnected',
    'reconnect-needed': 'gcalStateReconnect',
};

const FAILURE_KEYS: Partial<Record<IpcGcalConnectFailure, TranslationKeys>> = {
    disabled: 'gcalFailDisabled',
    'not-configured': 'gcalStateNotConfigured',
    'encryption-unavailable': 'gcalFailEncryption',
    busy: 'gcalFailBusy',
    timeout: 'gcalFailTimeout',
    denied: 'gcalFailDenied',
};

export function IntegrationsPage({ t }: SettingsPageProps) {
    const headingId = useId();
    const [status, setStatus] = useState<IpcGcalStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<TranslationKeys | null>(null);

    useEffect(() => {
        let alive = true;
        void getBridge()
            ?.gcalStatus?.()
            .then((next) => {
                if (alive) setStatus(next);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    const run = useCallback(
        async (
            action: () => Promise<IpcGcalStatus | { success: boolean; reason?: IpcGcalConnectFailure; status: IpcGcalStatus }> | undefined
        ) => {
            setBusy(true);
            setFailure(null);
            try {
                const result = await action();
                if (!result) return;
                if ('status' in result) {
                    setStatus(result.status);
                    if (!result.success) setFailure(FAILURE_KEYS[result.reason as IpcGcalConnectFailure] ?? 'gcalFailGeneric');
                } else {
                    setStatus(result);
                }
            } catch {
                setFailure('gcalFailGeneric');
            } finally {
                setBusy(false);
            }
        },
        []
    );

    const bridge = getBridge();
    const enabled = status?.enabled === true;
    const state = status?.state ?? 'not-configured';
    const canConnect = enabled && state !== 'not-configured' && state !== 'connected';
    const hasAccount = state === 'connected' || state === 'reconnect-needed';

    return (
        <div className="flex max-w-xl flex-col gap-4">
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-labelledby={headingId}
                className="flex flex-col gap-3 p-4"
            >
                <span id={headingId} className={SECTION_LABEL}>
                    {t('gcalTitle')}
                </span>
                <p className={BODY}>{t('gcalDesc')}</p>
                <Toggle
                    label={t('gcalEnable')}
                    checked={enabled}
                    disabled={busy || status === null}
                    onChange={(next) => void run(() => bridge?.gcalSetEnabled?.(next))}
                    fullWidth
                />
                <p role="status" className={BODY} data-testid="gcal-state">
                    {t(STATE_KEYS[state])}
                </p>
                {state === 'reconnect-needed' && <p className={HINT}>{t('gcalReconnectNote')}</p>}
                {failure && (
                    <p role="alert" className={HINT}>
                        {t(failure)}
                    </p>
                )}
                {enabled && state === 'connected' && (
                    <p className={HINT}>
                        {t('gcalLastRefresh')}{' '}
                        {status?.lastRefreshAt ? new Date(status.lastRefreshAt).toLocaleString() : t('gcalNeverRefreshed')}
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    {state !== 'connected' && (
                        <Button
                            variant="primary"
                            icon="login"
                            disabled={!canConnect || busy}
                            loading={busy}
                            onClick={() => void run(() => bridge?.gcalConnect?.())}
                        >
                            {t(state === 'reconnect-needed' ? 'gcalReconnect' : 'gcalConnect')}
                        </Button>
                    )}
                    {state === 'connected' && (
                        <Button
                            variant="secondary"
                            icon="refresh"
                            disabled={!enabled || busy}
                            onClick={() => void run(() => bridge?.gcalRefresh?.())}
                        >
                            {t('gcalRefresh')}
                        </Button>
                    )}
                    {hasAccount && (
                        <Button
                            variant="secondary"
                            icon="logout"
                            disabled={busy}
                            onClick={() => void run(() => bridge?.gcalDisconnect?.())}
                        >
                            {t('gcalDisconnect')}
                        </Button>
                    )}
                </div>
            </Surface>
        </div>
    );
}
