// T-605: the pages of the Settings window, in menu order. CNL-08 restyled them as Canlı bento pages.
import type { TranslationKeys } from '../i18n';

export type SettingsPageId = 'general' | 'appearance' | 'sidebar' | 'plugins' | 'workspaces' | 'backup' | 'integrations' | 'about';

export interface SettingsPage {
    id: SettingsPageId;
    labelKey: TranslationKeys;
    /** One-line page subtitle shown under the page headline. */
    subtitleKey: TranslationKeys;
    /** Material Symbols name. */
    icon: string;
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
    { id: 'general', labelKey: 'settingsGeneral', subtitleKey: 'settingsSubtitleGeneral', icon: 'tune' },
    { id: 'appearance', labelKey: 'appearance', subtitleKey: 'settingsSubtitleAppearance', icon: 'palette' },
    { id: 'sidebar', labelKey: 'settingsSidebar', subtitleKey: 'settingsSubtitleSidebar', icon: 'dock_to_right' },
    { id: 'plugins', labelKey: 'plugins', subtitleKey: 'settingsSubtitlePlugins', icon: 'extension' },
    { id: 'workspaces', labelKey: 'workspaces', subtitleKey: 'settingsSubtitleWorkspaces', icon: 'space_dashboard' },
    { id: 'backup', labelKey: 'settingsBackupUpdates', subtitleKey: 'settingsSubtitleBackup', icon: 'cloud_sync' },
    { id: 'integrations', labelKey: 'settingsIntegrations', subtitleKey: 'settingsSubtitleIntegrations', icon: 'hub' },
    { id: 'about', labelKey: 'about', subtitleKey: 'settingsSubtitleAbout', icon: 'info' },
];

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general';

/** Props every implemented page gets from the shell (src/settings/SettingsApp.tsx). */
export interface SettingsPageProps {
    /** Translates into the window's current UI language. */
    t: (key: TranslationKeys) => string;
}
