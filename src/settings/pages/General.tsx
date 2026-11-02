// T-607: Settings › General (UI-17, UI-18). Language (one Select, every language by its endonym, plus "System language"),
// launch at startup and "Show tips". Reads the main window's settings through the read-only mirror and changes them only with
// allow-listed actions (setLanguage / setLaunchAtStartup / setShowTooltips, src/store/sync.ts); nothing changes here until the
// main window's snapshot comes back. `setLaunchAtStartup` is applied by the main window, whose setter talks to the OS (with the
// native confirmation) and re-reads the OS state afterwards (src/store/autoLaunchResync.ts). In the Microsoft Store build the
// toggle is replaced by a note, as in the old panel (T-139). T-615a adds "restart tutorial" (a relayed system action).
// CNL-08: bento cards (language, two stat cards, tour).
import { useMemo, type ChangeEvent } from 'react';
import { IS_STORE_FLAVOR } from '../../buildFlags';
import { isMacPlatform } from '../../platform';
import { Button, Card, Select, Toggle } from '../../ui';
import { getEndonymOptions, readSystemLocales, resolveSystemLanguage } from '../language';
import { dispatchSettingsAction, dispatchSystemAction, useSettingsState, useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { isLanguageCode } from '../params';
import { PAGE_STACK, WaitingNote } from './shared';

/** Value of the "System language" option (never persisted: it is resolved to a LanguageCode when chosen). */
export const SYSTEM_LANGUAGE_OPTION = 'system';

export interface GeneralPageProps extends SettingsPageProps {
    /** Shows the Microsoft Store note instead of the startup toggle (defaults to the build flavor). */
    storeFlavor?: boolean;
    /** MAC-024: macOS wording (defaults to the platform of this window). */
    mac?: boolean;
}

export function GeneralPage({ t, storeFlavor = IS_STORE_FLAVOR, mac = isMacPlatform() }: GeneralPageProps) {
    const ready = useSettingsState((s) => s.status === 'ready' && s.state !== null);
    const language = useSettingsState((s) => s.state?.language);
    const launchAtStartup = useSettingsState((s) => s.state?.launchAtStartup === true);
    const showTooltips = useSettingsState((s) => s.state?.showTooltips === true);

    const summary = useSystemSummary();
    const options = useMemo(() => getEndonymOptions(), []);
    const systemLanguage = useMemo(() => resolveSystemLanguage(readSystemLocales()), []);
    const systemName = options.find((o) => o.code === systemLanguage)?.name ?? systemLanguage;
    const current = isLanguageCode(language) ? language : SYSTEM_LANGUAGE_OPTION;

    const onLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        const next = value === SYSTEM_LANGUAGE_OPTION ? systemLanguage : isLanguageCode(value) ? value : null;
        if (next && next !== language) dispatchSettingsAction('setLanguage', next);
    };

    // MAC-024: the Store note is Windows-only; the startup toggle shows on macOS too.
    const storeNote = storeFlavor && !mac;

    return (
        <div className={PAGE_STACK}>
            {!ready && <WaitingNote>{t('settingsWaiting')}</WaitingNote>}
            <Card
                as="section"
                icon="language"
                title={t('language')}
                description={mac ? t('settingsLanguageHintMac') : t('settingsLanguageHint')}
                aria-label={t('settingsGeneral')}
                control={
                    <Select label={t('language')} hideLabel value={current} onChange={onLanguageChange} disabled={!ready} className="w-56">
                        <option value={SYSTEM_LANGUAGE_OPTION}>{t('settingsSystemLanguage').replace('{language}', systemName)}</option>
                        {options.map((option) => (
                            <option key={option.code} value={option.code} lang={option.code}>
                                {option.name}
                            </option>
                        ))}
                    </Select>
                }
            />
            <div className="grid grid-cols-2 gap-3">
                <Card
                    variant="stat"
                    icon="power_settings_new"
                    title={t('launchAtStartup')}
                    description={
                        storeNote ? (
                            <span data-testid="autostart-store-note">{t('launchAtStartupStoreNote')}</span>
                        ) : mac ? (
                            t('settingsLaunchAtStartupDescMac')
                        ) : (
                            t('settingsLaunchAtStartupDesc')
                        )
                    }
                    control={
                        storeNote ? undefined : (
                            <Toggle
                                hideLabel
                                label={t('launchAtStartup')}
                                checked={launchAtStartup}
                                disabled={!ready}
                                onChange={(value) => dispatchSettingsAction('setLaunchAtStartup', value)}
                            />
                        )
                    }
                />
                <Card
                    variant="stat"
                    icon="lightbulb"
                    title={t('settingsShowTips')}
                    description={t('settingsShowTipsDesc')}
                    control={
                        <Toggle
                            hideLabel
                            label={t('settingsShowTips')}
                            checked={showTooltips}
                            disabled={!ready}
                            onChange={(value) => dispatchSettingsAction('setShowTooltips', value)}
                        />
                    }
                />
            </div>
            <Card
                icon="school"
                title={t('settingsTourTitle')}
                description={t('settingsTourHint')}
                control={
                    // T-615a: restarts the tutorial in the main window (relayed `app.restartTutorial`, which also brings it forward).
                    <Button
                        variant="tonal"
                        icon="school"
                        disabled={!ready || !summary}
                        onClick={() => dispatchSystemAction('app.restartTutorial', {})}
                    >
                        {t('restartTutorial')}
                    </Button>
                }
            />
        </div>
    );
}
