// T-610: Settings > Plugins. The page reads the plugin summary through the read-only mirror and only sends allow-listed `plugin.*`
// actions; uninstall needs the ConfirmDialog; stale / out-of-order snapshots never roll the list back.
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
import { SettingsApp } from '../src/settings/SettingsApp';
import { settingsMirror } from '../src/settings/mirror';
import { PluginsPage } from '../src/settings/pages/Plugins';
import type { PluginSummary, PluginSummaryItem } from '../src/store/pluginSummary';
import { cleanup, fire, render } from './ui/render';

const tEn = (key: keyof typeof translations.en) => translations.en[key];
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const byLabel = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const item = (id: string, patch: Partial<PluginSummaryItem> = {}): PluginSummaryItem => ({
    id,
    name: id.toUpperCase(),
    version: '1.0.0',
    enabled: true,
    removable: true,
    updateAvailable: false,
    latestVersion: null,
    hasSettingsPanel: false,
    repo: null,
    ...patch,
});
const summary = (items: PluginSummaryItem[], patch: Partial<PluginSummary> = {}): PluginSummary => ({
    items,
    status: { checked: false, checking: false, updating: false },
    lastUpdate: null,
    ...patch,
});

let seq = 0;
function publish(plugins: PluginSummary | null | undefined, state: Record<string, unknown> | null = { language: 'en' }) {
    seq += 1;
    act(() => settingsMirror.receive({ seq, state, ack: 0, ...(plugins === undefined ? {} : { plugins }) }));
}
const t = (key: keyof typeof translations.en) => tEn(key);

afterEach(() => {
    cleanup();
    bridge.sent.length = 0;
    publish(undefined, null);
});

describe('PluginsPage', () => {
    it('waits for the first snapshot: status message, nothing can be dispatched', () => {
        const { host } = render(<PluginsPage t={t} />);
        expect(host.querySelector('[role="status"]')!.textContent).toContain(tEn('settingsWaiting'));
        const enabled = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
            (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getAttribute('role') !== 'tab'
        );
        expect(enabled).toEqual([]);
        expect(bridge.sent).toEqual([]);
    });

    it('shows a loading note until the main window published its plugin list, then an empty state', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(undefined);
        expect(host.textContent).toContain(tEn('settingsPluginsLoading'));
        publish(summary([]));
        expect(host.textContent).toContain(tEn('settingsPluginsEmpty'));
    });

    it('lists the installed plugins with name, version and an enable switch that dispatches plugin.setEnabled', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary([item('alpha', { name: 'Alpha' }), item('beta', { name: 'Beta', enabled: false })]));
        const items = host.querySelectorAll('li');
        expect(items).toHaveLength(2);
        expect(items[0].textContent).toContain('Alpha');
        expect(items[0].textContent).toContain('v1.0.0');
        const switches = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
        expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
        expect(switches[1].getAttribute('aria-label') ?? host.textContent).toBeTruthy();
        click(switches[1]);
        expect(bridge.sent).toHaveLength(1);
        expect(bridge.sent[0]).toMatchObject({ type: 'plugin.setEnabled', payload: { id: 'beta', enabled: true } });
        // Read-only mirror: the switch only moves when the main window reports it.
        expect(switches[1].getAttribute('aria-checked')).toBe('false');
        publish(summary([item('alpha'), item('beta', { enabled: true })]));
        expect([...host.querySelectorAll('[role="switch"]')].map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    });

    it('uninstall needs the confirmation: cancel sends nothing, confirm sends plugin.uninstall; dev plugins have no uninstall', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary([item('alpha', { name: 'Alpha' }), item('dev-x', { name: 'DevX', removable: false })]));
        expect(byLabel(`${tEn('settingsPluginsUninstall')}: DevX`)).toBeNull();
        click(byLabel(`${tEn('settingsPluginsUninstall')}: Alpha`)!);
        const dialog = document.body.querySelector('[role="alertdialog"]')!;
        expect(dialog.textContent).toContain('Alpha');
        expect(bridge.sent).toEqual([]);
        click([...dialog.querySelectorAll('button')].find((b) => b.textContent === tEn('cancel'))!);
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
        expect(bridge.sent).toEqual([]);
        click(byLabel(`${tEn('settingsPluginsUninstall')}: Alpha`)!);
        const again = document.body.querySelector('[role="alertdialog"]')!;
        click([...again.querySelectorAll('button')].find((b) => b.textContent === tEn('settingsPluginsUninstall'))!);
        expect(bridge.sent).toHaveLength(1);
        expect(bridge.sent[0]).toMatchObject({ type: 'plugin.uninstall', payload: { id: 'alpha' } });
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
        void host;
    });

    it('closes the confirmation by itself when the plugin disappears from the list', () => {
        render(<PluginsPage t={t} />);
        publish(summary([item('alpha', { name: 'Alpha' })]));
        click(byLabel(`${tEn('settingsPluginsUninstall')}: Alpha`)!);
        expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
        publish(summary([]));
        expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
        expect(bridge.sent).toEqual([]);
    });

    it('check for updates and Update all dispatch plugin.checkUpdates / plugin.updateAll; Update all needs an offered update', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary([item('alpha')]));
        const button = (label: string) =>
            [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(label))!;
        expect(
            button(tEn('settingsPluginsUpdateAll')).getAttribute('aria-disabled') === 'true' ||
                button(tEn('settingsPluginsUpdateAll')).disabled
        ).toBe(true);
        click(button(tEn('settingsPluginsUpdateAll')));
        expect(bridge.sent).toEqual([]);
        click(button(tEn('settingsPluginsCheck')));
        expect(bridge.sent[0]).toMatchObject({ type: 'plugin.checkUpdates', payload: {} });
        publish(
            summary([item('alpha', { updateAvailable: true, latestVersion: '2.0.0' })], {
                status: { checked: true, checking: false, updating: false },
            })
        );
        expect(host.textContent).toContain(tEn('settingsPluginsUpdateAvailable').replace('{version}', '2.0.0'));
        click(button(tEn('settingsPluginsUpdateAll')));
        expect(bridge.sent[1]).toMatchObject({ type: 'plugin.updateAll', payload: {} });
        click(byLabel(`${tEn('settingsPluginsUpdate')}: ALPHA`)!);
        expect(bridge.sent[2]).toMatchObject({ type: 'plugin.update', payload: { id: 'alpha' } });
    });

    it('shows the result of the last update run and disables the update buttons while one runs', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(
            summary([item('alpha', { updateAvailable: true, latestVersion: '2.0.0' })], {
                status: { checked: true, checking: false, updating: true },
                lastUpdate: { updated: 1, failed: 2, canceled: 3 },
            })
        );
        expect(host.textContent).toContain('1 updated, 2 failed, 3 canceled');
        const update = byLabel(`${tEn('settingsPluginsUpdate')}: ALPHA`) as HTMLButtonElement;
        expect(update.disabled || update.getAttribute('aria-disabled') === 'true').toBe(true);
    });

    it('"Plugin settings" appears only for plugins with a v1 panel and dispatches plugin.openSettings', () => {
        render(<PluginsPage t={t} />);
        publish(summary([item('alpha', { name: 'Alpha', hasSettingsPanel: true }), item('beta', { name: 'Beta' })]));
        expect(byLabel(`${tEn('settingsPluginsSettings')}: Beta`)).toBeNull();
        click(byLabel(`${tEn('settingsPluginsSettings')}: Alpha`)!);
        expect(bridge.sent).toHaveLength(1);
        expect(bridge.sent[0]).toMatchObject({ type: 'plugin.openSettings', payload: { id: 'alpha' } });
    });

    it('is registered in the Settings window (Plugins page)', () => {
        const { host } = render(<SettingsApp lang="en" />);
        publish(summary([item('alpha', { name: 'Alpha' })]));
        const nav = [...host.querySelectorAll<HTMLButtonElement>('nav button')];
        const plugins = nav.find((b) => b.textContent?.includes(tEn('plugins')))!;
        click(plugins);
        expect(host.querySelectorAll('main li')).toHaveLength(1);
    });
});

describe('mirror: plugin summary and stale snapshots', () => {
    it('keeps the summary of the newest snapshot only (older seq is dropped, even when it carries other plugins)', () => {
        seq += 10;
        act(() => settingsMirror.receive({ seq, state: { language: 'en' }, ack: 0, plugins: summary([item('new')]) }));
        act(() => settingsMirror.receive({ seq: seq - 3, state: { language: 'en' }, ack: 0, plugins: summary([item('old')]) }));
        expect(settingsMirror.store.getState().plugins!.items.map((i) => i.id)).toEqual(['new']);
    });

    it('state null (main window reloading) clears the summary; malformed summaries are sanitised or dropped', () => {
        publish(summary([item('alpha')]));
        expect(settingsMirror.store.getState().plugins).not.toBeNull();
        publish(undefined, null);
        expect(settingsMirror.store.getState().plugins).toBeNull();
        seq += 1;
        act(() => settingsMirror.receive({ seq, state: { language: 'en' }, ack: 0, plugins: { items: [{ id: 'ok' }, { id: 5 }, 'x'] } }));
        expect(settingsMirror.store.getState().plugins!.items.map((i) => i.id)).toEqual(['ok']);
        seq += 1;
        act(() => settingsMirror.receive({ seq, state: { language: 'en' }, ack: 0, plugins: 'garbage' }));
        expect(settingsMirror.store.getState().plugins).toBeNull();
    });

    it('dispatchPlugin refuses while the mirror is not ready', () => {
        publish(undefined, null);
        expect(settingsMirror.dispatchPlugin('plugin.updateAll', {})).toBeNull();
        expect(bridge.sent).toEqual([]);
    });
});

describe('Installed: GitHub link (R-16)', () => {
    it('shows a github.com link only for plugins with a valid repo', () => {
        const { host } = render(<PluginsPage t={t} />);
        publish(summary([item('alpha', { repo: 'Kobar-Project/alpha' }), item('beta')]));
        const links = [...host.querySelectorAll<HTMLAnchorElement>('a[href]')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://github.com/Kobar-Project/alpha']);
    });
});
