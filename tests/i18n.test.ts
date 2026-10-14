import { describe, expect, it } from 'vitest';
import { translations } from '../src/i18n';

// The translations object is flat: translations[lang][key] -> string. `en` is the reference.
// KNOWN_MISSING records known gaps. A NEW missing key fails the test, and a FIXED gap fails it too.

// T-627: every gap is filled (es/zh strings are machine translations), so nothing is known-missing any more.
const KNOWN_MISSING: Record<string, string[]> = {};

const all = translations as unknown as Record<string, Record<string, unknown>>;
const enKeys = Object.keys(all.en);
const langs = Object.keys(all).filter((l) => l !== 'en');

describe('i18n key coverage relative to en', () => {
    it('has the 10 supported languages', () => {
        expect(Object.keys(all).sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'hi', 'ja', 'ru', 'tr', 'zh']);
    });

    it('en has only string values', () => {
        expect(enKeys.filter((k) => typeof all.en[k] !== 'string')).toEqual([]);
    });

    it.each(langs)('%s: missing keys match the recorded known gaps', (lang) => {
        const keys = new Set(Object.keys(all[lang]));
        const missing = enKeys.filter((k) => !keys.has(k));
        const known = KNOWN_MISSING[lang] ?? [];
        const added = missing.filter((k) => !known.includes(k));
        const fixed = known.filter((k) => !missing.includes(k));
        expect(added, `${lang}: NEW missing keys (translate them or add to KNOWN_MISSING)`).toEqual([]);
        expect(fixed, `${lang}: gaps now FIXED - remove them from KNOWN_MISSING in tests/i18n.test.ts`).toEqual([]);
    });

    it.each(langs)('%s: has no keys that en lacks', (lang) => {
        const en = new Set(enKeys);
        expect(Object.keys(all[lang]).filter((k) => !en.has(k))).toEqual([]);
    });

    it('has no known gaps left', () => {
        expect(Object.keys(KNOWN_MISSING)).toEqual([]);
    });
});
