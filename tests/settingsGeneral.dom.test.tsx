// T-607: Settings › General. The page reads the main window's settings through the mirror and changes them only with allow-listed
// actions; the language list uses endonyms plus a "System language" option that is resolved to a LanguageCode when chosen (the
// persisted shape is unchanged); launch at startup re-reads the OS state in the main window after an applied action.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction } from '../shared/ipc-contract';

// The Settings window's mirror is created from `globalThis.settingsBridge` when src/settings/mirror.ts is first imported.
const bridge = vi.hoisted(() => {
    const sent: IpcSettingsAction[] = [];
    const fake = {
        sent,
        onState: (): (() => void) => () => {},
        requestState: () => {},
        dispatch: (action: IpcSettingsAction) => void sent.push(action),
    };
    (globalThis as { settingsBridge?: unknown }).settingsBridge = fake;
    return fake;
});

import { translations, type LanguageCode } from '../src/i18n';
import { SettingsApp } from '../src/settings/SettingsApp';
import { getEndonymOptions, readSystemLocales, resolveSystemLanguage } from '../src/settings/language';
import { settingsMirror } from '../src/settings/mirror';
import { GeneralPage, SYSTEM_LANGUAGE_OPTION } from '../src/settings/pages/General';
import { createAutoLaunchResync } from '../src/store/autoLaunchResync';
import { applySettingsAction, startSettingsSync } from '../src/store/sync';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, fire, render } from './ui/render';

const NEW_KEYS = [
    'settingsSystemLanguage',
    'settingsLanguageHint',
    'settingsShowTips',
    'settingsShowTipsDesc',
    'settingsLaunchAtStartupDesc',
    'settingsWaiting',
] as const;

let seq = 0;
function snapshot(state: Record<string, unknown> | null) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0 }));
}
const ready = (patch: Record<string, unknown> = {}) => snapshot({ language: 'en', launchAtStartup: false, showTooltips: true, ...patch });

const tEn = (key: keyof typeof translations.en) => translations.en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
function choose(select: HTMLSelectElement, value: string) {
    select.value = value;
    fire(select, new Event('change', { bubbles: true }));
}
const switches = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    snapshot(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('i18n', () => {
    it('every new string exists in all 10 languages', () => {
        const langs = Object.keys(translations) as LanguageCode[];
        expect(langs).toHaveLength(10);
        for (const lang of langs) {
            for (const key of NEW_KEYS) expect((translations[lang] as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
            expect(translations[lang].settingsSystemLanguage, lang).toContain('{language}');
        }
    });
});

describe('language helpers', () => {
    it('lists every language once by its endonym, sorted by that name', () => {
        const options = getEndonymOptions();
        expect(options.map((o) => o.code).sort()).toEqual(Object.keys(translations).sort());
        const byCode = Object.fromEntries(options.map((o) => [o.code, o.name]));
        expect(byCode).toMatchObject({ de: 'Deutsch', en: 'English', tr: 'Türkçe', ja: '日本語', ar: 'العربية', ru: 'Русский' });
        const collator = new Intl.Collator('en');
        expect(options.map((o) => o.name)).toEqual([...options.map((o) => o.name)].sort(collator.compare));
    });

    it('resolves the OS locales to a supported language, else English', () => {
        expect(resolveSystemLanguage(['de-DE', 'en-US'])).toBe('de');
        expect(resolveSystemLanguage(['xx', 'zh-Hans-CN'])).toBe('zh');
        expect(resolveSystemLanguage(['TR'])).toBe('tr');
        expect(resolveSystemLanguage(['pt-BR', 42, '__proto__', 'toString'])).toBe('en');
        expect(resolveSystemLanguage([])).toBe('en');
        expect(readSystemLocales({ languages: ['fr-FR'], language: 'fr-FR' })).toEqual(['fr-FR', 'fr-FR']);
        expect(readSystemLocales({} as Navigator)).toEqual([]);
    });
});

describe('GeneralPage', () => {
    it('is disabled with a status message until the main window sent a snapshot', () => {
        const { host } = render(<GeneralPage t={tEn} storeFlavor={false} />);
        expect(host.querySelector('[role="status"]')!.textContent).toBe(tEn('settingsWaiting'));
        expect(host.querySelector('select')!.disabled).toBe(true);
        expect(switches(host).every((s) => s.disabled)).toBe(true);
        click(switches(host)[0]);
        expect(bridge.sent).toEqual([]);
    });

    it('shows the mirrored values with labelled controls', () => {
        ready({ language: 'tr', launchAtStartup: true, showTooltips: false });
        const { host } = render(<GeneralPage t={tEn} storeFlavor={false} />);
        expect(host.querySelector('[role="status"]')).toBeNull();
        const select = host.querySelector('select')!;
        expect(select.value).toBe('tr');
        expect(host.querySelector(`label[for="${select.id}"]`)!.textContent).toBe(tEn('language'));
        const options = [...select.querySelectorAll('option')];
        expect(options[0].value).toBe(SYSTEM_LANGUAGE_OPTION);
        expect(options.slice(1).map((o) => o.lang)).toEqual(getEndonymOptions().map((o) => o.code));
        const [startup, tips] = switches(host);
        expect(startup.getAttribute('aria-checked')).toBe('true');
        expect(tips.getAttribute('aria-checked')).toBe('false');
        expect(host.querySelector(`label[for="${startup.id}"]`)!.textContent).toBe(tEn('launchAtStartup'));
        expect(host.querySelector(`label[for="${tips.id}"]`)!.textContent).toBe(tEn('settingsShowTips'));
    });

    it('dispatches allow-listed actions and never changes a value by itself', () => {
        ready();
        const { host } = render(<GeneralPage t={tEn} storeFlavor={false} />);
        choose(host.querySelector('select')!, 'ja');
        click(switches(host)[0]);
        click(switches(host)[1]);
        expect(bridge.sent.map(({ type, payload }) => ({ type, payload }))).toEqual([
            { type: 'setLanguage', payload: 'ja' },
            { type: 'setLaunchAtStartup', payload: true },
            { type: 'setShowTooltips', payload: false },
        ]);
        // Read-only mirror: the screen still shows the main window's values until a new snapshot arrives.
        expect(switches(host)[0].getAttribute('aria-checked')).toBe('false');
        // Every sent action passes the main window's allow-list and schema.
        useAppStore.setState({ isHydrated: true });
        for (const action of bridge.sent)
            expect(
                applySettingsAction(useAppStore, action, () => {}),
                action.type
            ).toMatchObject({ ok: true });
    });

    it('"System language" sends the language that matches the OS locale', () => {
        vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-AT', 'en-US']);
        ready({ language: 'en' });
        const { host } = render(<GeneralPage t={tEn} storeFlavor={false} />);
        const select = host.querySelector('select')!;
        expect(select.querySelector('option')!.textContent).toBe('System language (Deutsch)');
        choose(select, SYSTEM_LANGUAGE_OPTION);
        expect(bridge.sent.map(({ type, payload }) => ({ type, payload }))).toEqual([{ type: 'setLanguage', payload: 'de' }]);
    });

    it('in the Microsoft Store build shows the note instead of the startup toggle', () => {
        ready();
        const { host } = render(<GeneralPage t={tEn} storeFlavor />);
        expect(host.querySelector('[data-testid="autostart-store-note"]')!.textContent).toBe(tEn('launchAtStartupStoreNote'));
        expect(switches(host)).toHaveLength(1);
    });
});

describe('SettingsApp language', () => {
    it('follows the main window language once a snapshot arrived', () => {
        const { host } = render(<SettingsApp lang="en" />);
        expect(host.querySelector('h1')!.textContent).toBe('General');
        ready({ language: 'tr' });
        expect(host.querySelector('h1')!.textContent).toBe(translations.tr.settingsGeneral);
        expect(document.documentElement.lang).toBe('tr');
    });
});

describe('launch at startup re-read in the main window', () => {
    function fakeWindow(focused: boolean) {
        const target = new EventTarget();
        return Object.assign(target, { document: { hasFocus: () => focused } });
    }

    it('re-reads the OS state on the next focus (after the native confirmation) and only then', async () => {
        const win = fakeWindow(false);
        const read = vi.fn(() => Promise.resolve(false));
        const apply = vi.fn();
        const trigger = createAutoLaunchResync({ win, read, apply, delayMs: 10 });
        trigger();
        await new Promise((r) => setTimeout(r, 20));
        expect(read).not.toHaveBeenCalled();
        win.dispatchEvent(new Event('focus'));
        await Promise.resolve();
        await Promise.resolve();
        expect(apply).toHaveBeenCalledWith(false);
        win.dispatchEvent(new Event('focus'));
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('drops a read that a newer toggle made stale', async () => {
        const win = fakeWindow(true);
        const resolvers: Array<(value: boolean) => void> = [];
        const read = vi.fn(() => new Promise<boolean>((resolve) => resolvers.push(resolve)));
        const apply = vi.fn();
        const trigger = createAutoLaunchResync({ win, read, apply, delayMs: 5 });
        trigger();
        await new Promise((r) => setTimeout(r, 20));
        expect(read).toHaveBeenCalledTimes(1);
        // A newer toggle before the first read answered: the old answer must not be applied.
        trigger();
        resolvers[0](false);
        await new Promise((r) => setTimeout(r, 20));
        expect(read).toHaveBeenCalledTimes(2);
        expect(apply).not.toHaveBeenCalled();
        resolvers[1](true);
        await new Promise((r) => setTimeout(r, 0));
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith(true);
    });

    it('falls back to a timed read when the main window has focus (no dialog)', async () => {
        const win = fakeWindow(true);
        const apply = vi.fn();
        const trigger = createAutoLaunchResync({ win, read: () => Promise.resolve(true), apply, delayMs: 5 });
        trigger();
        await new Promise((r) => setTimeout(r, 20));
        expect(apply).toHaveBeenCalledWith(true);
    });

    it('keeps pending after a timer read that ran before the dialog opened (second read on focus)', async () => {
        const win = fakeWindow(true);
        const read = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const apply = vi.fn();
        const trigger = createAutoLaunchResync({ win, read, apply, delayMs: 5 });
        trigger();
        await new Promise((r) => setTimeout(r, 20));
        expect(read).toHaveBeenCalledTimes(1);
        // The user confirmed in the dialog afterwards: focus returns and the second read still runs.
        win.dispatchEvent(new Event('focus'));
        await new Promise((r) => setTimeout(r, 0));
        expect(read).toHaveBeenCalledTimes(2);
        expect(apply).toHaveBeenLastCalledWith(true);
    });

    it('startSettingsSync reports the applied key, and a throwing callback is harmless', () => {
        useAppStore.setState({ isHydrated: true, showTooltips: true });
        let deliver: ((action: unknown) => void) | null = null;
        const applied: string[] = [];
        const sync = startSettingsSync({
            store: useAppStore,
            bridge: {
                publish: () => {},
                openSettings: () => {},
                onAction: (callback) => {
                    deliver = callback as (action: unknown) => void;
                    return () => {};
                },
            },
            schedule: () => () => {},
            log: () => {},
            onApplied: (key) => {
                applied.push(key);
                throw new Error('boom');
            },
        });
        deliver!({ id: 1, type: 'setShowTooltips', payload: false });
        deliver!({ id: 2, type: 'setShowTooltips', payload: 'no' });
        expect(applied).toEqual(['showTooltips']);
        expect(useAppStore.getState().showTooltips).toBe(false);
        expect(sync.stats().applied).toBe(1);
        sync.stop();
    });
});
