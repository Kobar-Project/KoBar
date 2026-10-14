// T-611: Settings > Plugins > Discover. The page reads the catalogue through the read-only mirror and only sends allow-listed `plugin.*`
// actions: refresh, install by id, and two payload-free "open the existing flow" actions. Loading / offline / error / empty states.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction } from '../shared/ipc-contract';

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

import { translations } from '../src/i18n';
import { settingsMirror } from '../src/settings/mirror';
import { PluginsPage } from '../src/settings/pages/Plugins';
import type { PluginCatalog, PluginCatalogItem, PluginSummary } from '../src/store/pluginSummary';
import { cleanup, fire, render } from './ui/render';

const tEn = (key: keyof typeof translations.en) => translations.en[key];
const t = (key: keyof typeof translations.en) => tEn(key);
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const byLabel = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const entry = (id: string, patch: Partial<PluginCatalogItem> = {}): PluginCatalogItem => ({
    id,
    name: id.toUpperCase(),
    description: `About ${id}`,
    author: 'Kobar',
    version: '1.2.3',
    category: 'tools',
    beta: false,
    repo: null,
    installed: false,
    ...patch,
});
const catalog = (patch: Partial<PluginCatalog> = {}): PluginCatalog => ({
    status: 'ready',
    error: null,
    items: [],
    installingId: null,
    lastInstall: null,
    ...patch,
});
const summary = (cat: PluginCatalog | undefined): PluginSummary => ({
    items: [],
    ...(cat ? { catalog: cat } : {}),
    status: { checked: false, checking: false, updating: false },
    lastUpdate: null,
});

let seq = 0;
function publish(plugins: PluginSummary | undefined, state: Record<string, unknown> | null = { language: 'en' }) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(plugins === undefined ? {} : { plugins }) }));
}
const openDiscover = (host: HTMLElement) =>
    click([...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === tEn('settingsPluginsTabDiscover'))!);

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    publish(undefined, null);
});

describe('PluginsPage tabs', () => {
    it('starts on Installed; Discover is a second tab of the same page', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog()));
        const tabs = [...host.querySelectorAll('[role="tab"]')];
        expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
            [tEn('settingsPluginsTabInstalled'), 'true'],
            [tEn('settingsPluginsTabDiscover'), 'false'],
        ]);
        expect(host.textContent).toContain(tEn('settingsPluginsEmpty'));
        openDiscover(host);
        expect(host.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(tEn('settingsPluginsTabDiscover'));
        expect(host.textContent).not.toContain(tEn('settingsPluginsEmpty'));
    });
});

describe('Discover', () => {
    it('asks the main window for the catalogue once when it is idle, and not again on re-render', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(undefined));
        openDiscover(host);
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['plugin.refreshCatalog', {}]]);
        publish(summary(undefined));
        expect(bridge.sent).toHaveLength(1);
        expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it('does not ask before the first snapshot', () => {
        const { host } = render(<PluginsPage t={t} />);
        openDiscover(host);
        expect(bridge.sent).toEqual([]);
        publish(summary(catalog({ status: 'idle' })));
        expect(bridge.sent).toHaveLength(1);
    });

    it('shows a loading state, then a compact list with name, author and category, and NO star or fork counters', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ status: 'loading' })));
        openDiscover(host);
        expect(host.textContent).toContain(tEn('settingsPluginsDiscoverLoading'));
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' }), entry('beta', { name: 'Beta', beta: true })] })));
        const rows = [...host.querySelectorAll('li')];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Alpha');
        expect(rows[0].textContent).toContain('Kobar · tools');
        expect(rows[1].textContent).toContain(tEn('settingsPluginsBeta'));
        expect(host.textContent).not.toMatch(/star|fork|contributor/i);
    });

    it('filters by name, description, author and category, with a no-match state', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' }), entry('beta', { name: 'Beta', category: 'media' })] })));
        openDiscover(host);
        const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
        const type = (value: string) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            act(() => {
                setter.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        type('media');
        expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([expect.stringContaining('Beta')]);
        type('ALPHA');
        expect(host.querySelectorAll('li')).toHaveLength(1);
        type('zzz');
        expect(host.querySelectorAll('li')).toHaveLength(0);
        expect(host.textContent).toContain(tEn('settingsPluginsNoMatch'));
        expect(bridge.sent).toEqual([]);
    });

    it('install dispatches plugin.install with the id only; installed plugins show a badge instead', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' }), entry('beta', { name: 'Beta', installed: true })] })));
        openDiscover(host);
        expect(byLabel(`${tEn('settingsPluginsInstall')}: Beta`)).toBeNull();
        click(byLabel(`${tEn('settingsPluginsInstall')}: Alpha`)!);
        expect(bridge.sent).toHaveLength(1);
        expect(bridge.sent[0]).toMatchObject({ type: 'plugin.install', payload: { id: 'alpha' } });
        expect(Object.keys(bridge.sent[0].payload as object)).toEqual(['id']);
    });

    it('disables installing while one install runs, and reports the outcome in a status region', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' }), entry('beta', { name: 'Beta' })], installingId: 'alpha' })));
        openDiscover(host);
        const buttons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="' + tEn('settingsPluginsInstall') + ':"]')];
        expect(buttons.every((b) => b.disabled || b.getAttribute('aria-disabled') === 'true')).toBe(true);
        publish(
            summary(
                catalog({ items: [entry('alpha', { name: 'Alpha', installed: true })], lastInstall: { id: 'alpha', result: 'success' } })
            )
        );
        expect(host.querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe(
            tEn('settingsPluginsInstallDone').replace('{name}', 'Alpha')
        );
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' })], lastInstall: { id: 'alpha', result: 'failed' } })));
        expect(host.textContent).toContain(tEn('settingsPluginsInstallFailed').replace('{name}', 'Alpha'));
    });

    it('expands a read-only detail (description, author, category, version) and collapses it again', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha', description: 'Long text here' })] })));
        openDiscover(host);
        const toggle = byLabel(`${tEn('settingsPluginsDetails')}: Alpha`)!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        click(toggle);
        expect(host.textContent).toContain('Long text here');
        expect(host.textContent).toContain('v1.2.3');
        const open = byLabel(`${tEn('settingsPluginsDetailsHide')}: Alpha`)!;
        expect(open.getAttribute('aria-expanded')).toBe('true');
        click(open);
        expect(host.textContent).not.toContain('Long text here');
        expect(bridge.sent).toEqual([]);
    });

    it('offline: an explanation and a retry that asks the main window again', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ status: 'error', error: 'offline' })));
        openDiscover(host);
        expect(host.textContent).toContain(tEn('settingsPluginsDiscoverOffline'));
        const retry = [...host.querySelectorAll('button')].find((b) => b.textContent?.endsWith(tEn('settingsPluginsRetry')))!;
        click(retry);
        expect(bridge.sent.map((a) => a.type)).toEqual(['plugin.refreshCatalog']);
    });

    it('error and empty catalogue have their own messages with a retry', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ status: 'error', error: 'failed' })));
        openDiscover(host);
        expect(host.textContent).toContain(tEn('settingsPluginsDiscoverError'));
        expect(host.textContent).not.toContain(tEn('settingsPluginsDiscoverOffline'));
        publish(summary(catalog({ items: [] })));
        expect(host.textContent).toContain(tEn('settingsPluginsDiscoverEmpty'));
        expect([...host.querySelectorAll('button')].some((b) => b.textContent?.endsWith(tEn('settingsPluginsRetry')))).toBe(true);
    });

    it('a stale, out-of-order snapshot never rolls the catalogue back', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary(catalog({ items: [entry('alpha', { name: 'Alpha' })] })));
        openDiscover(host);
        expect(host.querySelectorAll('li')).toHaveLength(1);
        const newer = seq + 1;
        act(() => settingsMirror.receive({ seq: newer, state: { language: 'en' }, ack: 0, plugins: summary(catalog({ items: [] })) }));
        act(() =>
            settingsMirror.receive({
                seq: newer - 1,
                state: { language: 'en' },
                ack: 0,
                plugins: summary(catalog({ items: [entry('alpha')] })),
            })
        );
        expect(host.querySelectorAll('li')).toHaveLength(0);
        seq = newer;
    });
});

describe('the "..." menu', () => {
    const openMenu = () => click(byLabel(tEn('settingsPluginsMore'))!);
    const menuItem = (text: string) =>
        [...document.body.querySelectorAll('[role^="menuitem"]')].find((el) => el.textContent?.includes(text))!;

    it('is disabled before the first snapshot and sends nothing', () => {
        render(<PluginsPage t={t} />);
        expect((byLabel(tEn('settingsPluginsMore')) as HTMLButtonElement).disabled).toBe(true);
        expect(bridge.sent).toEqual([]);
    });

    it('offers install from file and from GitHub (Advanced); each sends a payload-free action', () => {
        render(<PluginsPage t={t} />);
        publish(summary(catalog()));
        openMenu();
        expect([...document.body.querySelectorAll('[role^="menuitem"]')].map((el) => el.textContent)).toEqual([
            'folder_zip' + tEn('settingsPluginsFromFile'),
            'code' + tEn('settingsPluginsFromGithub'),
        ]);
        click(menuItem(tEn('settingsPluginsFromFile')));
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([['plugin.installFromFile', {}]]);
        openMenu();
        click(menuItem(tEn('settingsPluginsFromGithub')));
        expect(bridge.sent.map((a) => [a.type, a.payload])).toEqual([
            ['plugin.installFromFile', {}],
            ['plugin.installFromGithub', {}],
        ]);
    });
});

describe('texts', () => {
    it('every new key exists in all 10 languages (no hard-coded strings)', () => {
        const keys = Object.keys(translations.en).filter((k) =>
            /^settingsPlugins(Tab|Search|Discover|Retry|Refresh|NoMatch|Install|Beta|Detail|NoDesc|Author|Category|More|From)/.test(k)
        );
        expect(keys.length).toBeGreaterThanOrEqual(28);
        for (const [lang, table] of Object.entries(translations)) {
            for (const key of keys) {
                expect((table as Record<string, string>)[key], `${lang}.${key}`).toBeTruthy();
            }
        }
    });
});

describe('Discover: GitHub link (R-16)', () => {
    it('shows a safe github.com link only for entries with a valid repo', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(
            summary(
                catalog({
                    items: [entry('alpha', { name: 'Alpha', repo: 'Kobar-Project/alpha' }), entry('beta', { name: 'Beta', repo: null })],
                })
            )
        );
        openDiscover(host);
        const links = [...host.querySelectorAll<HTMLAnchorElement>('a[href]')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://github.com/Kobar-Project/alpha']);
        expect(links[0].getAttribute('target')).toBe('_blank');
        expect(links[0].textContent).toContain('Kobar-Project/alpha');
    });
});
