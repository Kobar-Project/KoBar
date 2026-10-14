// T-622: first-run onboarding, replacing the v1 timer-driven eye tutorial. Three cards (welcome, the bar and notes,
// starter pack) in one modal Dialog; no timers anywhere, every step waits for the user. The last card offers the starter
// pack: one click per plugin, installed through the main window's plugin sync, so the MAIN process validates and asks for
// consent (no new IPC, no bypass). Offline or failed installs never block finishing.
// Shown when `onboarding.status` is `pending` (fresh install; existing users were set to `completed` by the v29
// migration) or when `isManualTutorialTrigger` is set (Settings "restart tutorial", relayed as `app.restartTutorial`).
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { pluginSync } from '../store/pluginSyncHost';
import { useAppStore } from '../store/useAppStore';
import { Button, Dialog, Icon } from '../ui';
import {
    installStarter,
    isStarterInstalled,
    loadCatalog,
    STARTER_PACK,
    type CatalogPhase,
    type InstallPhase,
    type StarterSync,
} from './starterPack';

const CARD_COUNT = 3;

export interface OnboardingProps {
    /** Injected in tests; defaults to the main window's plugin sync. */
    sync?: StarterSync;
}

export function Onboarding({ sync = pluginSync }: OnboardingProps) {
    const isHydrated = useAppStore((s) => s.isHydrated);
    const status = useAppStore((s) => s.onboarding.status);
    const manual = useAppStore((s) => s.isManualTutorialTrigger);
    if (!isHydrated || (status !== 'pending' && !manual)) return null;
    return <OnboardingDialog sync={sync} />;
}

function OnboardingDialog({ sync }: { sync: StarterSync }) {
    const t = useT();
    const [card, setCard] = useState(0);
    const [catalog, setCatalog] = useState<CatalogPhase>('loading');
    const [phases, setPhases] = useState<Record<string, InstallPhase>>({});
    const [, bump] = useState(0);
    const requested = useRef(false);

    // A click-through ghost window must take input while the dialog is open.
    useEffect(() => {
        try {
            window.api?.setIgnoreMouseEvents?.(false);
        } catch {
            /* best effort */
        }
    }, []);

    useEffect(() => sync.subscribe(() => bump((n) => n + 1)), [sync]);

    const load = () => {
        setCatalog('loading');
        void loadCatalog(sync).then(setCatalog);
    };

    // The registry is only fetched when the starter pack card is reached.
    useEffect(() => {
        if (card !== CARD_COUNT - 1 || requested.current) return;
        requested.current = true;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [card]);

    const finish = (result: 'completed' | 'skipped') => {
        const state = useAppStore.getState();
        state.setOnboarding({ status: result });
        state.setIsManualTutorialTrigger(false);
        // Keeps the v1 flag consistent for plugins and downgrades that still read it.
        state.setTutorialState({ status: 'completed', snoozeUntil: undefined });
    };

    const install = (id: string) => {
        setPhases((p) => ({ ...p, [id]: 'installing' }));
        void installStarter(sync, id).then((phase) => setPhases((p) => ({ ...p, [id]: phase })));
    };

    const titles = [t('onboardingWelcomeTitle'), t('onboardingBarTitle'), t('onboardingPackTitle')];
    const bodies = [t('onboardingWelcomeBody'), t('onboardingBarBody'), t('onboardingPackBody')];
    const last = card === CARD_COUNT - 1;

    return (
        <Dialog
            open
            size="md"
            title={titles[card]}
            description={bodies[card]}
            onClose={() => finish('skipped')}
            closeOnBackdrop={false}
            closeLabel={t('onboardingSkip')}
            footer={
                <>
                    <span className="mr-auto text-xs text-fg-3" aria-hidden="true">
                        {card + 1} / {CARD_COUNT}
                    </span>
                    {!last && (
                        <Button variant="subtle" onClick={() => finish('skipped')}>
                            {t('onboardingSkip')}
                        </Button>
                    )}
                    {card > 0 && <Button onClick={() => setCard(card - 1)}>{t('onboardingBack')}</Button>}
                    {last ? (
                        <Button variant="primary" onClick={() => finish('completed')}>
                            {t('onboardingDone')}
                        </Button>
                    ) : (
                        <Button variant="primary" onClick={() => setCard(card + 1)}>
                            {t('onboardingNext')}
                        </Button>
                    )}
                </>
            }
        >
            {last && (
                <div className="flex flex-col gap-2" data-onboarding-pack>
                    {catalog === 'loading' && <p className="text-xs text-fg-2">{t('onboardingLoading')}</p>}
                    {(catalog === 'offline' || catalog === 'failed') && (
                        <div className="flex items-center gap-2">
                            <p className="mr-auto text-xs text-fg-2" role="status">
                                {catalog === 'offline' ? t('onboardingOffline') : t('onboardingFailed')}
                            </p>
                            <Button size="sm" onClick={load}>
                                {t('onboardingRetry')}
                            </Button>
                        </div>
                    )}
                    <ul className="flex flex-col gap-1">
                        {STARTER_PACK.map((plugin) => {
                            const phase = phases[plugin.id] ?? 'idle';
                            const installed = phase === 'installed' || isStarterInstalled(sync, plugin.id);
                            return (
                                <li key={plugin.id} className="flex items-center gap-3 rounded-sm bg-[var(--kb-fill-hover)] px-3 py-2">
                                    <Icon name={plugin.icon} size={24} className="text-fg-2" />
                                    <div className="mr-auto min-w-0">
                                        <div className="text-[0.8125rem] font-semibold text-fg-1">{plugin.name}</div>
                                        <div className="text-xs text-fg-2">{t(plugin.descriptionKey)}</div>
                                    </div>
                                    {installed ? (
                                        <span className="inline-flex items-center gap-1 text-xs text-fg-2" role="status">
                                            <Icon name="check" size={16} />
                                            {t('onboardingInstalled')}
                                        </span>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            loading={phase === 'installing'}
                                            disabled={catalog !== 'ready'}
                                            aria-label={`${t('onboardingInstall')} ${plugin.name}`}
                                            onClick={() => install(plugin.id)}
                                        >
                                            {phase === 'failed' ? t('onboardingRetry') : t('onboardingInstall')}
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </Dialog>
    );
}
