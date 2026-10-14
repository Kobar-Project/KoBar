import { describe, expect, it } from 'vitest';
import { MAIN_LANGS, MAIN_STRINGS, MAIN_STRING_KEYS, normalizeLanguage, parseLanguage, t } from '../electron/lib/mainStrings.cjs';
import type { LanguageCode } from '../src/i18n';
import { readMainSources } from './helpers/mainSource';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('MAIN_STRINGS parity', () => {
    it('supports exactly the app languages', () => {
        const appLangs: LanguageCode[] = ['de', 'ar', 'zh', 'fr', 'hi', 'en', 'es', 'ja', 'ru', 'tr'];
        expect([...MAIN_LANGS].sort()).toEqual([...appLangs].sort());
        expect(Object.keys(MAIN_STRINGS).sort()).toEqual([...appLangs].sort());
    });

    it.each(MAIN_LANGS)('%s has every key, no extras and no empty text', (lang) => {
        expect(Object.keys(MAIN_STRINGS[lang]).sort()).toEqual([...MAIN_STRING_KEYS].sort());
        for (const key of MAIN_STRING_KEYS) expect(MAIN_STRINGS[lang][key].trim().length).toBeGreaterThan(0);
    });

    it.each(MAIN_LANGS)('%s keeps the placeholders of the English text', (lang) => {
        for (const key of MAIN_STRING_KEYS) {
            expect(placeholders(MAIN_STRINGS[lang][key]), `${lang}.${key}`).toEqual(placeholders(MAIN_STRINGS.en[key]));
        }
    });

    it.each(MAIN_LANGS)('%s has no control characters other than newline', (lang) => {
        for (const key of MAIN_STRING_KEYS) {
            // eslint-disable-next-line no-control-regex
            expect(/[\u0000-\u0009\u000b-\u001f\u007f]/.test(MAIN_STRINGS[lang][key]), `${lang}.${key}`).toBe(false);
        }
    });

    it('translates (not copies) the dialog buttons in every non-English language', () => {
        for (const lang of MAIN_LANGS.filter((l) => l !== 'en')) {
            expect(MAIN_STRINGS[lang].cancel, lang).not.toBe(MAIN_STRINGS.en.cancel);
        }
    });
});

describe('t', () => {
    it('inserts parameters literally and leaves unknown placeholders alone', () => {
        expect(t('en', 'uninstallPlugin', { name: '$& {name}' })).toBe('Uninstall plugin "$& {name}"?');
        expect(t('en', 'uninstallPlugin')).toBe('Uninstall plugin "{name}"?');
        expect(t('en', 'uninstallPlugin', { other: 'x' })).toBe('Uninstall plugin "{name}"?');
    });
    it('falls back to English for unknown languages and missing keys', () => {
        expect(t('xx', 'cancel')).toBe('Cancel');
        expect(t(undefined, 'cancel')).toBe('Cancel');
        const original = MAIN_STRINGS.tr.later;
        try {
            (MAIN_STRINGS.tr as Record<string, string>).later = '';
            expect(t('tr', 'later')).toBe('Later');
        } finally {
            MAIN_STRINGS.tr.later = original;
        }
    });
    it('returns the localised text', () => {
        expect(t('tr', 'cancel')).toBe('İptal');
        expect(t('de', 'updateAvailableVersion', { version: '2.0.0' })).toContain('2.0.0');
    });
});

describe('normalizeLanguage', () => {
    it.each([
        ['tr', 'tr'],
        ['tr-TR', 'tr'],
        ['zh-CN', 'zh'],
        ['zh_TW', 'zh'],
        ['EN-us', 'en'],
        [' de ', 'de'],
        ['pt-BR', 'en'],
        ['', 'en'],
        [undefined, 'en'],
        [null, 'en'],
        [42, 'en'],
        [{ language: 'tr' }, 'en'],
    ])('maps %j to %s', (input, expected) => {
        expect(normalizeLanguage(input)).toBe(expected);
    });
    it('parseLanguage returns null for unsupported values', () => {
        expect(parseLanguage('pt')).toBeNull();
        expect(parseLanguage('ja-JP')).toBe('ja');
    });
});

describe('main.cts uses no raw English text in native dialogs and notices', () => {
    // T-307: notices and the updater/auto-launch dialogs moved to electron/main/services/*.cts; scan main.cts plus every electron/main/ module.
    const main = readMainSources();
    const ALLOWED_LITERALS = new Set(['KoBar', 'warning', 'info', 'error', 'question', 'none', 'electron']);

    /** Source text from `start` up to the matching closing bracket of the first opener at or after it. */
    function balanced(start: number, open: string, close: string): string {
        const from = main.indexOf(open, start);
        let depth = 0;
        for (let i = from; i < main.length; i++) {
            if (main[i] === open) depth++;
            else if (main[i] === close && --depth === 0) return main.slice(start, i + 1);
        }
        throw new Error('unbalanced');
    }

    const regions: { label: string; text: string }[] = [];
    for (const m of main.matchAll(/dialog\.showMessageBox\(|new Notification\(|confirmWithUser\(/g)) {
        const before = main.slice(Math.max(0, m.index - 20), m.index);
        if (/function\s+$/.test(before)) continue; // the definition, not a call
        regions.push({ label: m[0] + '@' + m.index, text: balanced(m.index, '(', ')') });
    }
    const optionsAt = main.indexOf('const options: Electron.MessageBoxOptions = {');
    if (optionsAt >= 0) regions.push({ label: 'confirmWithUser options', text: balanced(optionsAt, '{', '}') });

    it('finds the dialog and notification call sites', () => {
        expect(regions.length).toBeGreaterThanOrEqual(8);
        expect(optionsAt).toBeGreaterThan(-1);
    });

    it('passes only keys from lib/mainStrings or technical literals', () => {
        for (const { label, text } of regions) {
            // t(lang, 'key', ...) keys are fine; everything else quoted must be an allowed technical literal.
            const stripped = text.replace(/\bt\(\s*[\w.()]+,\s*'\w+'/g, 't(').replace(/showRateLimitedNotice\(/g, '');
            expect(stripped, label).not.toMatch(/`/);
            for (const lit of stripped.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
                expect(ALLOWED_LITERALS.has(lit[1]), `${label}: raw literal '${lit[1]}'`).toBe(true);
            }
        }
    });

    it('keeps Cancel as the default and cancel button of confirmWithUser', () => {
        const at = main.indexOf('async function confirmWithUser(');
        const fn = main.slice(at, main.indexOf('\n}\n', at));
        expect(fn).toMatch(/buttons: \[confirmLabel \?\? t\(lang, 'open'\), t\(lang, 'cancel'\)\],\s*defaultId: 1,\s*cancelId: 1,/);
        expect(fn).toMatch(/return result\.response === 0;/);
    });

    it('builds the open-address and network-location dialog texts from keys', () => {
        const external = main.slice(main.indexOf('async function openExternalChecked('), main.indexOf("ipcMain.on('launch-file'"));
        expect(external).toContain("t(lang, 'openAddress'");
        expect(external).toContain("t(lang, 'onlyContinueIfTrust')");
        const launchAt = main.indexOf("ipcMain.on('launch-file'");
        const launch = main.slice(launchAt, launchAt + 1500);
        expect(launch).toContain("t(lang, 'openNetworkLocation'");
        expect(launch).toContain("t(lang, 'networkCredentialsRisk')");
        // The message/detail const lines next to each confirmWithUser call hold no raw quoted text.
        for (const m of main.matchAll(/const (?:message|detail) = [^\n]*;/g)) {
            const stripped = m[0].replace(/\bt\(lang, '\w+'/g, 't(').replace(/'\\n\\n'/g, '');
            expect(stripped, m[0]).not.toMatch(/'[^']*[A-Za-z][^']*'/);
        }
    });

    it('showRateLimitedNotice calls only pass string keys', () => {
        for (const m of main.matchAll(/showRateLimitedNotice\(\w+, ([^)]*\)?)\)/g)) {
            expect(m[1]).toMatch(/^('\w+'|koBoxCopyFailedKey\(reason\))$/);
        }
    });
});
