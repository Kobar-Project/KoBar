// T-605: the pages of the Settings window, in menu order. Each page is a placeholder
// until its own task: General T-607, Appearance T-608, Sidebar T-609, Plugins T-610/T-611, Workspaces T-612,
// Backup & Updates and About T-614.
import type { TranslationKeys } from '../i18n';

export type SettingsPageId = 'general' | 'appearance' | 'sidebar' | 'plugins' | 'workspaces' | 'backup' | 'integrations' | 'about';

export interface SettingsPage {
    id: SettingsPageId;
    labelKey: TranslationKeys;
    /** Material Symbols name. */
    icon: string;
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
    { id: 'general', labelKey: 'settingsGeneral', icon: 'tune' },
    { id: 'appearance', labelKey: 'appearance', icon: 'palette' },
    { id: 'sidebar', labelKey: 'settingsSidebar', icon: 'view_sidebar' },
    { id: 'plugins', labelKey: 'plugins', icon: 'extension' },
    { id: 'workspaces', labelKey: 'workspaces', icon: 'space_dashboard' },
    { id: 'backup', labelKey: 'settingsBackupUpdates', icon: 'backup' },
    { id: 'integrations', labelKey: 'settingsIntegrations', icon: 'hub' },
    { id: 'about', labelKey: 'about', icon: 'info' },
];

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general';

/** Props every implemented page gets from the shell (src/settings/SettingsApp.tsx). */
export interface SettingsPageProps {
    /** Translates into the window's current UI language. */
    t: (key: TranslationKeys) => string;
}
