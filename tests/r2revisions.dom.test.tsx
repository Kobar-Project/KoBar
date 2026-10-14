// R2-03..R2-08: new i18n keys, About credits/sponsors, no Shortcuts page, Discover filter keys.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translations, type LanguageCode } from '../src/i18n';
import { SETTINGS_PAGES } from '../src/settings/pages';

const langs = Object.keys(translations) as LanguageCode[];
const KEYS = [
    'noteEditorPlaceholder',
    'noteBold',
    'noteItalic',
    'noteUnderline',
    'noteBulletList',
    'noteNumberedList',
    'noteInsertImage',
    'aboutMaker',
    'aboutSponsors',
    'aboutSponsorsBody',
    'settingsPluginsFilter',
    'settingsPluginsFilterAll',
    'settingsPluginsFilterInstalled',
    'settingsPluginsFilterNotInstalled',
] as const;

describe('R2 i18n', () => {
    it.each(langs)('%s has every new key', (lang) => {
        const table = translations[lang] as Record<string, string>;
        for (const k of KEYS) expect(table[k]?.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
        expect(table.aboutMaker).toContain('{author}');
        expect(table.shortcuts).toBeUndefined();
        expect(table.settingsShortcutsHint).toBeUndefined();
    });
    it('non-English locales do not copy the English placeholder', () => {
        for (const lang of langs.filter((l) => l !== 'en')) {
            expect((translations[lang] as Record<string, string>).noteEditorPlaceholder, lang).not.toBe(
                translations.en.noteEditorPlaceholder
            );
        }
        expect(translations.tr.aboutMaker).toBe('KoBar {author} tarafından yapılmıştır.');
    });
});

describe('R2 settings', () => {
    it('has no Shortcuts page', () => {
        expect(SETTINGS_PAGES.map((p) => p.id)).not.toContain('shortcuts' as never);
        expect(fs.existsSync('src/settings/pages/Shortcuts.tsx')).toBe(false);
    });
    it('About links the maker to GitHub and shows the sponsors e-mail', () => {
        const src = fs.readFileSync('src/settings/pages/About.tsx', 'utf8');
        expect(src).toContain('AUTHOR_URL');
        expect(src).toContain("t('aboutSponsorsBody')");
        expect(fs.readFileSync('src/config/links.ts', 'utf8')).toContain("AUTHOR_URL = 'https://github.com/eedali'");
        expect(src).toMatch(/target="_blank" rel="noopener noreferrer"/);
    });
    it('NoteEditor has no hard-coded English labels', () => {
        const src = fs.readFileSync('src/components/notes/NoteEditor.tsx', 'utf8');
        expect(src).not.toMatch(/title="[A-Z]/);
        expect(src).not.toContain('Start writing');
    });
});
