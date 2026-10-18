// T-607: Settings › General (UI-17, UI-18). Language (one Select, every language by its endonym, plus "System language"),
// launch at startup and "Show tips". Reads the main window's settings through the read-only mirror and changes them only with
// allow-listed actions (setLanguage / setLaunchAtStartup / setShowTooltips, src/store/sync.ts); nothing changes here until the
// main window's snapshot comes back. `setLaunchAtStartup` is applied by the main window, whose setter talks to the OS (with the
// native confirmation) and re-reads the OS state afterwards (src/store/autoLaunchResync.ts). In the Microsoft Store build the
// toggle is replaced by a note, as in the old panel (T-139). T-615a adds "restart tutorial" (a relayed system action).
import { useMemo, type ChangeEvent } from 'react';
import { IS_STORE_FLAVOR } from '../../buildFlags';
import { isMacPlatform } from '../../platform';
import { Button, Surface, Select, Toggle } from '../../ui';
import { getEndonymOptions, readSystemLocales, resolveSystemLanguage } from '../language';
import { dispatchSettingsAction, dispatchSystemAction, useSettingsState, useSystemSummary } from '../mirror';
import type { SettingsPageProps } from '../pages';
import { isLanguageCode } from '../params';

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

    return (
        <div className="flex max-w-xl flex-col gap-4">
            {!ready && (
                <p role="status" className="text-[0.8125rem] leading-5 text-fg-2">
                    {t('settingsWaiting')}
                </p>
            )}
            <Surface
                as="section"
                level="surface"
                elevation="e1"
                radius="lg"
                aria-label={t('settingsGeneral')}
                className="flex flex-col divide-y divide-stroke"
            >
                <div className="p-4">
                    <Select
                        label={t('language')}
                        hint={mac ? t('settingsLanguageHintMac') : t('settingsLanguageHint')}
                        value={current}
                        onChange={onLanguageChange}
                        disabled={!ready}
                    >
                        <option value={SYSTEM_LANGUAGE_OPTION}>{t('settingsSystemLanguage').replace('{language}', systemName)}</option>
                        {options.map((option) => (
                            <option key={option.code} value={option.code} lang={option.code}>
                                {option.name}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="p-4">
                    {/* MAC-024: the Store note is Windows-only; the startup toggle shows on macOS too. */}
                    {storeFlavor && !mac ? (
                        <div className="flex flex-col">
                            <span className="text-[0.8125rem] leading-5 text-fg-1">{t('launchAtStartup')}</span>
                            <span className="text-[0.6875rem] leading-4 text-fg-2" data-testid="autostart-store-note">
                                {t('launchAtStartupStoreNote')}
                            </span>
                        </div>
                    ) : (
                        <Toggle
                            fullWidth
                            label={t('launchAtStartup')}
                            description={mac ? t('settingsLaunchAtStartupDescMac') : t('settingsLaunchAtStartupDesc')}
                            checked={launchAtStartup}
                            disabled={!ready}
                            onChange={(value) => dispatchSettingsAction('setLaunchAtStartup', value)}
                        />
                    )}
                </div>
                <div className="p-4">
                    <Toggle
                        fullWidth
                        label={t('settingsShowTips')}
                        description={t('settingsShowTipsDesc')}
                        checked={showTooltips}
                        disabled={!ready}
                        onChange={(value) => dispatchSettingsAction('setShowTooltips', value)}
                    />
                </div>
                <div className="p-4">
                    {/* T-615a: restarts the tutorial in the main window (relayed `app.restartTutorial`, which also brings it forward). */}
                    <Button
                        variant="secondary"
                        icon="school"
                        disabled={!ready || !summary}
                        onClick={() => dispatchSystemAction('app.restartTutorial', {})}
                    >
                        {t('restartTutorial')}
                    </Button>
                </div>
            </Surface>
        </div>
    );
}
