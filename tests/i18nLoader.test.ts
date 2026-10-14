import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import { enTable, getLocaleTable, translations } from '../src/i18n';
import { translate } from '../src/i18n/translate';

const LANGS = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ru', 'tr', 'zh'];

describe('i18n loader (T-625/T-626)', () => {
    it('every language is served from its JSON file, synchronously', () => {
        expect(Object.keys(translations).sort()).toEqual(LANGS);
        for (const lang of LANGS) {
            const json = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8'));
            expect(getLocaleTable(lang), lang).toEqual(json);
        }
        expect(getLocaleTable('en')).toBe(enTable);
        expect(enTable).toBe(en);
        expect(getLocaleTable('xx')).toBeUndefined();
        expect(getLocaleTable('toString')).toBeUndefined();
    });

    it('translate keeps fallback order: language, English, key', () => {
        expect(translate('en', 'plugins')).toBe('Plugins');
        expect(translate('xx', 'plugins')).toBe('Plugins');
        expect(translate('en', 'noSuchKey' as never)).toBe('noSuchKey');
    });
});
