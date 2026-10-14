// T-605: query of the Settings window page. Main passes the main window's UI language as `lang`
// (electron/lib/settingsWindow.cts); anything that is not a supported language falls back to English.
import { translations, type LanguageCode } from '../i18n';
import { SETTINGS_PAGES, type SettingsPageId } from './pages';

export const SETTINGS_FALLBACK_LANGUAGE: LanguageCode = 'en';

export interface SettingsParams {
    lang: LanguageCode;
    /** T-615: the page to start on (`page` in the query); undefined when absent or unknown. */
    page?: SettingsPageId;
}

export function isLanguageCode(value: unknown): value is LanguageCode {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(translations, value);
}

export function isSettingsPageId(value: unknown): value is SettingsPageId {
    return typeof value === 'string' && SETTINGS_PAGES.some((page) => page.id === value);
}

export function parseSettingsParams(search: string): SettingsParams {
    const params = new URLSearchParams(search);
    const lang = params.get('lang');
    const page = params.get('page');
    return { lang: isLanguageCode(lang) ? lang : SETTINGS_FALLBACK_LANGUAGE, ...(isSettingsPageId(page) ? { page } : {}) };
}
