import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../src/i18n';
import { SettingsApp } from '../src/settings/SettingsApp';
import { DEFAULT_SETTINGS_PAGE, SETTINGS_PAGES } from '../src/settings/pages';
import { SETTINGS_FALLBACK_LANGUAGE, parseSettingsParams } from '../src/settings/params';
import { cleanup, fire, render } from './ui/render';

// T-605: the Settings window renderer shell. Left navigation with the pages on the left, page content on the right, and no store:
// nothing in src/settings/ may import the app store, and rendering it writes nothing to localStorage. T-606: the read-only mirror
// (src/settings/mirror.ts) is a plain zustand store WITHOUT persist (zustand core / vanilla only, never zustand/middleware).

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('parseSettingsParams', () => {
    it('takes a supported language from the query', () => {
        expect(parseSettingsParams('?lang=tr')).toEqual({ lang: 'tr' });
        expect(parseSettingsParams('?lang=ja&x=1')).toEqual({ lang: 'ja' });
    });

    it.each(['', '?lang=', '?lang=xx', '?lang=__proto__', '?lang=toString', '?lang=EN'])('falls back to English for %j', (search) => {
        expect(parseSettingsParams(search)).toEqual({ lang: SETTINGS_FALLBACK_LANGUAGE });
    });
});

describe('SETTINGS_PAGES', () => {
    it('lists the planned pages in menu order with keys that exist in every language', () => {
        expect(SETTINGS_PAGES.map((p) => p.id)).toEqual([
            'general',
            'appearance',
            'sidebar',
            'plugins',
            'workspaces',
            'backup',
            'integrations',
            'about',
        ]);
        expect(DEFAULT_SETTINGS_PAGE).toBe('general');
        for (const page of SETTINGS_PAGES) expect(translations.en[page.labelKey], page.id).toBeTruthy();
        for (const key of ['settingsGeneral', 'settingsSidebar', 'settingsBackupUpdates'] as const) {
            for (const lang of Object.keys(translations) as (keyof typeof translations)[]) {
                expect((translations[lang] as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
            }
        }
    });
});

describe('SettingsApp', () => {
    it('renders the navigation in the given language with the first page current', () => {
        const { host } = render(<SettingsApp lang="tr" />);
        const nav = host.querySelector('nav')!;
        expect(nav.getAttribute('aria-label')).toBe(translations.tr.settings);
        const buttons = [...nav.querySelectorAll('button')];
        // The leading icon is a Material Symbols ligature (its name is text), so compare the title span.
        expect(buttons.map((b) => b.querySelector('.truncate')?.textContent)).toEqual(
            SETTINGS_PAGES.map((p) => translations.tr[p.labelKey])
        );
        expect(buttons[0].getAttribute('aria-current')).toBe('page');
        expect(buttons.slice(1).every((b) => !b.hasAttribute('aria-current'))).toBe(true);
        expect(host.querySelector('h1')!.textContent).toBe(translations.tr.settingsGeneral);
        expect(host.querySelector('main')!.getAttribute('aria-labelledby')).toBe(host.querySelector('h1')!.id);
        expect(document.title).toBe(`${translations.tr.settings} - KoBar`);
    });

    it('switches the page from the menu', () => {
        const { host } = render(<SettingsApp lang="en" />);
        const buttons = [...host.querySelectorAll('nav button')];
        click(buttons[7]);
        expect(host.querySelector('h1')!.textContent).toBe('About');
        expect(buttons[7].getAttribute('aria-current')).toBe('page');
        expect(buttons[0].hasAttribute('aria-current')).toBe(false);
        expect(host.querySelector('main')!.textContent).toContain('KoBar was made by Ekrem EDALI.');
    });

    it('writes nothing to storage and sets no plugin globals', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { host } = render(<SettingsApp lang="en" />);
        click(host.querySelectorAll('nav button')[2]);
        expect(setItem).not.toHaveBeenCalled();
        const w = window as unknown as Record<string, unknown>;
        expect(w.useAppStore).toBeUndefined();
        expect(w.KoBarExtensions).toBeUndefined();
    });
});

describe('src/settings sources', () => {
    const dir = resolve(__dirname, '../src/settings');
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
        .map((e) => join(e.parentPath, e.name));

    it('found the entry and the shell', () => {
        expect(files.some((f) => f.endsWith('main.tsx'))).toBe(true);
        expect(files.some((f) => f.endsWith('SettingsApp.tsx'))).toBe(true);
    });

    it.each(files)('%s imports no app store, no zustand middleware (persist) and no window.api', (file) => {
        const text = readFileSync(file, 'utf8');
        expect(text).not.toMatch(/from ['"][^'"]*useAppStore['"]/);
        expect(text).not.toMatch(/from ['"][^'"]*useChatStore['"]/);
        // T-606: zustand itself is allowed for the mirror (src/settings/mirror.ts), its middleware (persist) is not.
        expect(text).not.toMatch(/from ['"]zustand\/middleware/);
        expect(text.match(/from ['"]zustand[^'"]*['"]/g) ?? []).toEqual(
            file.endsWith('mirror.ts') ? ["from 'zustand'", "from 'zustand/vanilla'"] : []
        );
        // The action table lives in the main window (src/store/sync.ts); this window only imports its types.
        for (const line of text.split('\n').filter((l) => /from ['"][^'"]*store\/sync['"]/.test(l))) {
            expect(line, file).toMatch(/^import type /);
        }
        expect(text).not.toMatch(/persistStorage|storage\/client|localStorageIsolation/);
        expect(text).not.toMatch(/window\.api\b|window\.useAppStore\s*=|window\.React\s*=/);
    });
});
