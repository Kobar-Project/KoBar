// T-607: language helpers of Settings › General (UI-18). Each language is listed by its endonym (its own name), sorted by that
// name, so a user who switched to a language they cannot read still finds theirs. "System language" is resolved here, at the
// moment it is chosen: the persisted `language` stays a plain LanguageCode (no 'system' value, no persisted-shape change), so
// choosing it sets the language that matches the OS display language once; it does not follow later OS changes.
import { getLanguageOptions, type LanguageCode } from '../i18n';
import { isLanguageCode } from './params';

export const SYSTEM_LANGUAGE_FALLBACK: LanguageCode = 'en';

export interface EndonymOption {
    code: LanguageCode;
    /** The language's name in that language (Deutsch, Türkçe, 日本語, ...). */
    name: string;
}

/** Every supported language by its endonym, sorted by that name (stable across UI languages). */
export function getEndonymOptions(): EndonymOption[] {
    const codes = getLanguageOptions('en').map((option) => option.code);
    const options = codes.map((code) => ({ code, name: getLanguageOptions(code).find((o) => o.code === code)!.name }));
    const collator = new Intl.Collator('en');
    return options.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.code, b.code));
}

/** First supported language among the OS locales (`de-DE` -> `de`, `zh-Hans-CN` -> `zh`), else English. */
export function resolveSystemLanguage(locales: readonly unknown[]): LanguageCode {
    for (const locale of locales) {
        if (typeof locale !== 'string') continue;
        const primary = locale.trim().split(/[-_]/)[0]?.toLowerCase();
        if (isLanguageCode(primary)) return primary;
    }
    return SYSTEM_LANGUAGE_FALLBACK;
}

/** The OS locales as the renderer sees them (Electron reports the OS display language here). */
export function readSystemLocales(nav: Pick<Navigator, 'languages' | 'language'> | undefined = globalThis.navigator): string[] {
    if (!nav) return [];
    const list = Array.isArray(nav.languages) ? [...nav.languages] : [];
    if (typeof nav.language === 'string') list.push(nav.language);
    return list;
}
