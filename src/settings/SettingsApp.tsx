// T-605: shell of the Settings window: left navigation (ListItem, aria-current="page") and
// the selected page on the right. Reads no store and writes nothing: the pages read the main window's settings through the
// T-606 mirror (./mirror: useSettingsState / dispatchSettingsAction).
// T-607: the window's UI language follows the main window's `language` once a snapshot arrived (the query value before that).
// CNL-08 (Canlı): 264 px nav on bg-nav (56 px icon rail below 1000 px), workspace card at its bottom, the page on an inset sheet.
import { useCallback, useEffect, useId, useState, type ComponentType } from 'react';
import { translate } from '../i18n/translate';
import type { LanguageCode, TranslationKeys } from '../i18n';
import { EmptyState, IconTile, ListItem, Surface, Tooltip } from '../ui';
import { cx, INTERACTIVE } from '../ui/cx';
import { useSettingsState, useWorkspaceSummary } from './mirror';
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

/** Below this window width the navigation shrinks to a 56 px icon rail (labels stay as accessible names). */
export const NAV_COLLAPSE_WIDTH = 1000;

function useNavCollapsed(): boolean {
    const [collapsed, setCollapsed] = useState(() => window.innerWidth < NAV_COLLAPSE_WIDTH);
    useEffect(() => {
        const onResize = () => setCollapsed(window.innerWidth < NAV_COLLAPSE_WIDTH);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return collapsed;
}

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
    const collapsed = useNavCollapsed();
    const workspaces = useWorkspaceSummary();
    const workspaceName = workspaces?.items.find((item) => item.active)?.name ?? t('barMenuDefaultWorkspace');

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
        <div className="flex h-full w-full overflow-hidden bg-nav text-fg-1">
            <div className={cx('flex shrink-0 flex-col gap-2 pt-1.5 pb-3.5', collapsed ? 'w-14 px-0.5' : 'w-[264px] px-3.5')}>
                <Surface
                    as="nav"
                    level="shell"
                    radius="none"
                    aria-label={t('settings')}
                    className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-transparent"
                >
                    <ul className="flex flex-col gap-[3px] pt-2">
                        {SETTINGS_PAGES.map((item) => {
                            const label = t(item.labelKey);
                            const row = (
                                <ListItem
                                    key={collapsed ? undefined : item.id}
                                    as={collapsed ? 'div' : 'li'}
                                    variant="nav"
                                    title={collapsed ? <span className="sr-only">{label}</span> : label}
                                    leading={item.icon}
                                    selected={item.id === page.id}
                                    current="page"
                                    onClick={() => setPageId(item.id)}
                                />
                            );
                            // Collapsed: icon-only rows with a tooltip; the label stays as the accessible name.
                            return collapsed ? (
                                <li key={item.id}>
                                    <Tooltip content={label} side="right" describe={false}>
                                        {row}
                                    </Tooltip>
                                </li>
                            ) : (
                                row
                            );
                        })}
                    </ul>
                </Surface>
                {/* Workspace card: shows the active workspace and opens the Workspaces page. */}
                <button
                    type="button"
                    onClick={() => setPageId('workspaces')}
                    aria-label={`${t('workspaceManage')}: ${workspaceName}`}
                    className={cx(
                        INTERACTIVE,
                        'no-drag-region flex shrink-0 items-center gap-3 rounded-lg bg-surface p-2.5 text-start hover:bg-[var(--kb-fill-hover)]',
                        collapsed && 'justify-center'
                    )}
                    data-testid="nav-workspace-card"
                >
                    <IconTile icon="space_dashboard" size="sm" />
                    {!collapsed && (
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate [font:var(--kb-type-body-strong)] text-fg-1">{workspaceName}</span>
                            <span className="truncate [font:var(--kb-type-caption)] text-fg-2">{t('workspaceManage')}</span>
                        </span>
                    )}
                </button>
            </div>
            <Surface
                as="main"
                level="shell"
                radius="none"
                aria-labelledby={headingId}
                // relative: absolutely positioned descendants (sr-only live regions) stay inside this scroll pane instead of
                // extending the document below the window.
                className="relative flex min-w-0 flex-1 flex-col overflow-y-auto rounded-ss-xl"
            >
                <div className="mx-auto flex w-full max-w-[800px] flex-col px-9 pt-[22px] pb-7">
                    <header className="flex flex-col gap-1 pb-5">
                        <h1 id={headingId} className="[font:var(--kb-type-headline)] text-fg-1">
                            {t(page.labelKey)}
                        </h1>
                        <p className="[font:var(--kb-type-body)] text-fg-2">{t(page.subtitleKey)}</p>
                    </header>
                    {Content ? (
                        <Content t={t} />
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <EmptyState icon={page.icon} title={t('comingSoon')} />
                        </div>
                    )}
                </div>
            </Surface>
        </div>
    );
}
