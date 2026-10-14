// T-605: shell of the Settings window: left navigation (ListItem, aria-current="page") and
// the selected page on the right. Pages without content yet are placeholders until T-608..T-614. Reads no store and writes
// nothing: the pages read the main window's settings through the T-606 mirror (./mirror: useSettingsState / dispatchSettingsAction).
// T-607: the window's UI language follows the main window's `language` once a snapshot arrived (the query value before that).
import { useCallback, useEffect, useId, useState, type ComponentType } from 'react';
import { translate } from '../i18n/translate';
import type { LanguageCode, TranslationKeys } from '../i18n';
import { EmptyState, ListItem, Surface } from '../ui';
import { useSettingsState } from './mirror';
import { DEFAULT_SETTINGS_PAGE, SETTINGS_PAGES, type SettingsPageId, type SettingsPageProps } from './pages';
import { AboutPage } from './pages/About';
import { AppearancePage } from './pages/Appearance';
import { BackupPage } from './pages/Backup';
import { GeneralPage } from './pages/General';
import { IntegrationsPage } from './pages/Integrations';
import { PluginsPage } from './pages/Plugins';
import { SidebarPage } from './pages/Sidebar';
import { WorkspacesPage } from './pages/Workspaces';
import { isLanguageCode, isSettingsPageId } from './params';

/** Pages that have content; the others show a placeholder. */
const PAGE_CONTENT: Partial<Record<SettingsPageId, ComponentType<SettingsPageProps>>> = {
    general: GeneralPage,
    appearance: AppearancePage,
    sidebar: SidebarPage,
    plugins: PluginsPage,
    workspaces: WorkspacesPage,
    backup: BackupPage,
    integrations: IntegrationsPage,
    about: AboutPage,
};

export interface SettingsAppProps {
    lang: LanguageCode;
    /** T-615: the page the window was opened at (query `page`); the General page when absent. */
    initialPage?: SettingsPageId;
}

export function SettingsApp({ lang: initialLang, initialPage }: SettingsAppProps) {
    const mirrorLang = useSettingsState((s) => s.state?.language);
    const lang = isLanguageCode(mirrorLang) ? mirrorLang : initialLang;
    const t = useCallback((key: TranslationKeys) => translate(lang, key), [lang]);
    const [pageId, setPageId] = useState<SettingsPageId>(initialPage ?? DEFAULT_SETTINGS_PAGE);
    const page = SETTINGS_PAGES.find((p) => p.id === pageId) ?? SETTINGS_PAGES[0];
    const headingId = useId();
    const Content = PAGE_CONTENT[page.id];

    // T-615: the main window asked for a page while this window was already open (`settings:show-page`, validated here again).
    useEffect(() => {
        const bridge = (globalThis as { settingsBridge?: { onShowPage?: (callback: (page: string) => void) => () => void } })
            .settingsBridge;
        return bridge?.onShowPage?.((next) => {
            if (isSettingsPageId(next)) setPageId(next);
        });
    }, []);

    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);

    useEffect(() => {
        document.title = `${t('settings')} - KoBar`;
    }, [t]);

    return (
        <div className="flex h-full w-full overflow-hidden bg-shell text-fg-1">
            <Surface
                as="nav"
                level="shell"
                radius="none"
                aria-label={t('settings')}
                className="flex w-56 shrink-0 flex-col overflow-y-auto border-e border-stroke p-3"
            >
                <ul className="flex flex-col gap-0.5">
                    {SETTINGS_PAGES.map((item) => (
                        <ListItem
                            key={item.id}
                            as="li"
                            title={t(item.labelKey)}
                            leading={item.icon}
                            selected={item.id === page.id}
                            current="page"
                            onClick={() => setPageId(item.id)}
                        />
                    ))}
                </ul>
            </Surface>
            <Surface
                as="main"
                level="surface"
                radius="none"
                aria-labelledby={headingId}
                className="flex min-w-0 flex-1 flex-col overflow-y-auto"
            >
                <header className="px-8 pt-6 pb-4">
                    <h1 id={headingId} className="text-[1.25rem] leading-7 font-semibold text-fg-1">
                        {t(page.labelKey)}
                    </h1>
                </header>
                {Content ? (
                    <div className="px-8 pb-8">
                        <Content t={t} />
                    </div>
                ) : (
                    <div className="flex flex-1 items-center justify-center px-8 pb-8">
                        <EmptyState icon={page.icon} title={t('comingSoon')} />
                    </div>
                )}
            </Surface>
        </div>
    );
}
