import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import ja from './locales/ja.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';
import zh from './locales/zh.json';

/**
 * i18n loader. Locale JSON files are imported statically, so the bundler inlines them and every
 * window (main, Settings, pip) has its language table synchronously, before first render and
 * before plugin script injection. This keeps `store.t` synchronous (plugin v1 contract).
 */
export type LocaleTable = Record<string, string>;

/** Keys are typed from the English JSON, which is the reference locale. */
export type TranslationKeys = keyof typeof en;

export type LanguageCode = 'de' | 'ar' | 'zh' | 'fr' | 'hi' | 'en' | 'es' | 'ja' | 'ru' | 'tr';

// Each language's name, translated into every supported language (alphabetical by code)
const languageNames: Record<LanguageCode, Record<LanguageCode, string>> = {
    de: {
        de: 'Deutsch',
        ar: 'الألمانية',
        zh: '德语',
        fr: 'Allemand',
        hi: 'जर्मन',
        en: 'German',
        es: 'Alemán',
        ja: 'ドイツ語',
        ru: 'Немецкий',
        tr: 'Almanca',
    },
    ar: {
        de: 'Arabisch',
        ar: 'العربية',
        zh: '阿拉伯语',
        fr: 'Arabe',
        hi: 'अरबी',
        en: 'Arabic',
        es: 'Árabe',
        ja: 'アラビア語',
        ru: 'Арабский',
        tr: 'Arapça',
    },
    zh: {
        de: 'Chinesisch',
        ar: 'الصينية',
        zh: '中文',
        fr: 'Chinois',
        hi: 'चीनी',
        en: 'Chinese',
        es: 'Chino',
        ja: '中国語',
        ru: 'Китайский',
        tr: 'Çince',
    },
    fr: {
        de: 'Französisch',
        ar: 'الفرنسية',
        zh: '法语',
        fr: 'Français',
        hi: 'फ़्रेंच',
        en: 'French',
        es: 'Francés',
        ja: 'フランス語',
        ru: 'Французский',
        tr: 'Fransızca',
    },
    hi: {
        de: 'Hindi',
        ar: 'الهندية',
        zh: '印地语',
        fr: 'Hindi',
        hi: 'हिन्दी',
        en: 'Hindi',
        es: 'Hindi',
        ja: 'ヒンディー語',
        ru: 'Хинди',
        tr: 'Hintçe',
    },
    en: {
        de: 'Englisch',
        ar: 'الإنجليزية',
        zh: '英语',
        fr: 'Anglais',
        hi: 'अंग्रेज़ी',
        en: 'English',
        es: 'Inglés',
        ja: '英語',
        ru: 'Английский',
        tr: 'İngilizce',
    },
    es: {
        de: 'Spanisch',
        ar: 'الإسبانية',
        zh: '西班牙语',
        fr: 'Espagnol',
        hi: 'स्पैनिश',
        en: 'Spanish',
        es: 'Español',
        ja: 'スペイン語',
        ru: 'Испанский',
        tr: 'İspanyolca',
    },
    ja: {
        de: 'Japanisch',
        ar: 'اليابانية',
        zh: '日语',
        fr: 'Japonais',
        hi: 'जापानी',
        en: 'Japanese',
        es: 'Japonés',
        ja: '日本語',
        ru: 'Японский',
        tr: 'Japonca',
    },
    ru: {
        de: 'Russisch',
        ar: 'الروسية',
        zh: '俄语',
        fr: 'Russe',
        hi: 'रूसी',
        en: 'Russian',
        es: 'Ruso',
        ja: 'ロシア語',
        ru: 'Русский',
        tr: 'Rusça',
    },
    tr: {
        de: 'Türkisch',
        ar: 'التركية',
        zh: '土耳其语',
        fr: 'Turc',
        hi: 'तुर्की',
        en: 'Turkish',
        es: 'Turco',
        ja: 'トルコ語',
        ru: 'Турецкий',
        tr: 'Türkçe',
    },
};

// Alphabetical order of language codes for display
const languageOrder: LanguageCode[] = ['de', 'ar', 'zh', 'fr', 'hi', 'en', 'es', 'ja', 'ru', 'tr'];

/** Returns language options with display names localized to the given active language */
export function getLanguageOptions(activeLang: LanguageCode): { code: LanguageCode; name: string }[] {
    return languageOrder.map((code) => ({
        code,
        name: languageNames[code][activeLang],
    }));
}

/** All locale tables, keyed by language code. Non-English tables may lack keys (callers fall back to English). */
export const translations: Record<Exclude<LanguageCode, 'en'>, LocaleTable> & { en: typeof en } = {
    ar,
    de,
    en,
    es,
    fr,
    hi,
    ja,
    ru,
    tr,
    zh,
};

/** Synchronously returns the string table for a language. */
export function getLocaleTable(language: string): LocaleTable | undefined {
    return Object.prototype.hasOwnProperty.call(translations, language) ? translations[language as LanguageCode] : undefined;
}

/** The English reference table. */
export const enTable: LocaleTable = en;
