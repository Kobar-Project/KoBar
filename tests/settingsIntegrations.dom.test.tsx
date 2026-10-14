// R2-15: Settings > Integrations > Google Calendar (Experimental): default off, status texts, connect/disconnect/refresh buttons.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcGcalStatus } from '../shared/ipc-contract';

const bridge = vi.hoisted(() => {
    const target = {
        gcalStatus: () => Promise.resolve({}),
        gcalConnect: () => Promise.resolve({}),
        gcalDisconnect: () => Promise.resolve({}),
        gcalSetEnabled: () => Promise.resolve({}),
        gcalRefresh: () => Promise.resolve({}),
    } as Record<string, (...args: unknown[]) => Promise<unknown>>;
    (globalThis as { settingsBridge?: unknown }).settingsBridge = target;
    return target;
});

import { translations } from '../src/i18n';
import { IntegrationsPage } from '../src/settings/pages/Integrations';
import { cleanup, render } from './ui/render';

const en = translations.en;
const t = (key: keyof typeof en) => en[key];

const status = (over: Partial<IpcGcalStatus> = {}): IpcGcalStatus => ({
    state: 'not-connected',
    enabled: false,
    configured: true,
    connected: false,
    lastRefreshAt: null,
    ...over,
});

async function mount(initial: IpcGcalStatus) {
    bridge.gcalStatus = vi.fn(() => Promise.resolve(initial));
    const view = render(<IntegrationsPage t={t} />);
    await act(async () => {});
    return view;
}

const buttonByText = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

afterEach(cleanup);

describe('IntegrationsPage', () => {
    it('is switched off by default and cannot connect until the switch is on', async () => {
        const { host } = await mount(status());
        expect(host.textContent).toContain(en.gcalTitle);
        expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
        expect(host.querySelector('[data-testid="gcal-state"]')?.textContent).toBe(en.gcalStateNotConnected);
        expect((buttonByText(host, en.gcalConnect) as HTMLButtonElement).disabled).toBe(true);
    });

    it('sends the switch to the main process', async () => {
        const { host } = await mount(status());
        const setEnabled = vi.fn(() => Promise.resolve(status({ enabled: true })));
        bridge.gcalSetEnabled = setEnabled;
        await act(async () => {
            (host.querySelector('[role="switch"]') as HTMLButtonElement).click();
        });
        expect(setEnabled).toHaveBeenCalledWith(true);
        expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
        expect((buttonByText(host, en.gcalConnect) as HTMLButtonElement).disabled).toBe(false);
    });

    it('shows a failure text when connecting is refused', async () => {
        const { host } = await mount(status({ enabled: true }));
        bridge.gcalConnect = vi.fn(() =>
            Promise.resolve({ success: false, reason: 'encryption-unavailable', status: status({ enabled: true }) })
        );
        await act(async () => {
            (buttonByText(host, en.gcalConnect) as HTMLButtonElement).click();
        });
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.gcalFailEncryption);
    });

    it('shows the connected state with last refresh, Refresh and Disconnect', async () => {
        const { host } = await mount(
            status({ enabled: true, state: 'connected', connected: true, lastRefreshAt: Date.UTC(2026, 0, 2, 3, 4) })
        );
        expect(host.querySelector('[data-testid="gcal-state"]')?.textContent).toBe(en.gcalStateConnected);
        expect(host.textContent).toContain(en.gcalLastRefresh);
        expect(host.textContent).not.toContain(en.gcalNeverRefreshed);
        const refresh = vi.fn(() => Promise.resolve(status({ enabled: true, state: 'connected', connected: true, lastRefreshAt: 5 })));
        bridge.gcalRefresh = refresh;
        await act(async () => {
            (buttonByText(host, en.gcalRefresh) as HTMLButtonElement).click();
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        const disconnect = vi.fn(() => Promise.resolve(status({ enabled: true })));
        bridge.gcalDisconnect = disconnect;
        await act(async () => {
            (buttonByText(host, en.gcalDisconnect) as HTMLButtonElement).click();
        });
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(host.querySelector('[data-testid="gcal-state"]')?.textContent).toBe(en.gcalStateNotConnected);
    });

    it('explains the 7-day Testing-mode expiry when a reconnect is needed', async () => {
        const { host } = await mount(status({ enabled: true, state: 'reconnect-needed' }));
        expect(host.querySelector('[data-testid="gcal-state"]')?.textContent).toBe(en.gcalStateReconnect);
        expect(host.textContent).toContain(en.gcalReconnectNote);
        expect(buttonByText(host, en.gcalReconnect)).toBeDefined();
    });

    it('shows not configured when the build has no Google client settings', async () => {
        const { host } = await mount(status({ state: 'not-configured', configured: false, enabled: true }));
        expect(host.querySelector('[data-testid="gcal-state"]')?.textContent).toBe(en.gcalStateNotConfigured);
        expect((buttonByText(host, en.gcalConnect) as HTMLButtonElement).disabled).toBe(true);
    });
});
