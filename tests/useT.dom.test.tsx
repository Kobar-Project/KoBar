import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { useT } from '../src/i18n/useT';
import { translations } from '../src/i18n';
import { translate } from '../src/i18n/translate';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// T-130: useT subscribes to the language; store.t (plugin v1 contract) stays unchanged.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe: React.FC = () => {
    const t = useT();
    return <span data-testid="probe">{t('miniMode')}</span>;
};

describe('useT', () => {
    it('re-renders with the new text when the language changes', async () => {
        useAppStore.setState({ language: 'en' });
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<Probe />);
        });
        expect(host.textContent).toBe(translations.en.miniMode);

        await act(async () => {
            useAppStore.setState({ language: 'tr' });
        });
        expect(host.textContent).toBe(translations.tr.miniMode);
        expect(translations.tr.miniMode).not.toBe(translations.en.miniMode);

        await act(async () => root.unmount());
        host.remove();
    });

    it('keeps store.t available and consistent with useT', async () => {
        useAppStore.setState({ language: 'tr' });
        const t = useAppStore.getState().t;
        expect(typeof t).toBe('function');
        expect(t('miniMode')).toBe(translations.tr.miniMode);
        expect(t('__missing_key__' as never)).toBe('__missing_key__');

        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<Probe />);
        });
        expect(host.textContent).toBe(useAppStore.getState().t('miniMode'));
        await act(async () => root.unmount());
        host.remove();
    });
});

describe('translate', () => {
    const original = useAppStore.getState().language;
    afterEach(() => {
        useAppStore.setState({ language: original });
    });

    it('store.t equals translate(lang, key) for every key in all languages', () => {
        const langs = Object.keys(translations) as (keyof typeof translations)[];
        expect(langs.length).toBe(10);
        const keys = Object.keys(translations.en) as (keyof typeof translations.en)[];
        for (const lang of langs) {
            useAppStore.setState({ language: lang });
            for (const key of keys) {
                expect(useAppStore.getState().t(key)).toBe(translate(lang, key));
            }
        }
    });

    it('keeps the fallback chain: language, then en, then the key', () => {
        expect(translate(undefined, 'miniMode')).toBe(translations.tr.miniMode);
        expect(translate('xx', 'miniMode')).toBe(translations.en.miniMode);
        expect(translate('tr', '__missing__' as never)).toBe('__missing__');
        const table = translations as unknown as Record<string, Record<string, string>>;
        const saved = table.tr.miniMode;
        try {
            table.tr.miniMode = '';
            expect(translate('tr', 'miniMode')).toBe(translations.en.miniMode);
        } finally {
            table.tr.miniMode = saved;
        }
    });
});

describe('components follow language changes', () => {
    it('no source file reads store.t at render time', () => {
        const offenders: string[] = [];
        const bad = [
            /useAppStore\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.t\s*\)/,
            /\{[^}]*\bt\b[^}]*\}\s*=\s*useAppStore\(\s*\)/,
            /useAppStore\(\s*\)\.t\b/,
        ];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const full = join(dir, name);
                if (statSync(full).isDirectory()) {
                    if (name !== 'store' && name !== 'i18n') walk(full);
                } else if (/\.tsx?$/.test(name)) {
                    // Only `useAppStore.getState().t` (call-time lookup) is allowed.
                    const src = readFileSync(full, 'utf8');
                    if (bad.some((re) => re.test(src))) offenders.push(full);
                }
            }
        };
        walk(join(__dirname, '..', 'src'));
        expect(offenders).toEqual([]);
    });

    it('two independent consumers both update', async () => {
        const Other: React.FC = () => {
            const t = useT();
            return <b>{t('settings')}</b>;
        };
        useAppStore.setState({ language: 'en' });
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <>
                    <Probe />
                    <Other />
                </>
            );
        });
        expect(host.textContent).toBe(translations.en.miniMode + translations.en.settings);
        await act(async () => {
            useAppStore.setState({ language: 'tr' });
        });
        expect(host.textContent).toBe(translations.tr.miniMode + translations.tr.settings);
        await act(async () => root.unmount());
        host.remove();
    });
});
