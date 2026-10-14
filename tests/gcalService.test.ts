// R2-15: the Google Calendar service with every dependency faked: default OFF, disabled -> [], reconnect-needed on invalid_grant,
// disconnect revokes and deletes, no network and no timer while disabled.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateLoopbackServer, FetchLike } from '../electron/lib/gcalOAuth.cjs';
import { createGcalService } from '../electron/lib/gcalService.cjs';
import { createGcalTokenStore } from '../electron/lib/gcalTokenStore.cjs';

afterEach(() => vi.useRealTimers());

const range = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };

function setup(options: { configured?: boolean; encryption?: boolean; refreshError?: string; hasToken?: boolean } = {}) {
    const { configured = true, encryption = true, refreshError, hasToken = true } = options;
    const files = new Map<string, string>();
    const store = createGcalTokenStore({
        tokenFile: '/t.json',
        flagFile: '/f.json',
        cipher: {
            isEncryptionAvailable: () => encryption,
            encryptString: (s) => Buffer.from(`enc:${s}`),
            decryptString: (b) => b.toString().replace(/^enc:/, ''),
        },
        fs: {
            readFile: async (p) => {
                const text = files.get(p);
                if (text === undefined) throw new Error('ENOENT');
                return text;
            },
            writeFile: async (p, text) => void files.set(p, text),
            unlink: async (p) => void files.delete(p),
        },
    });
    if (hasToken)
        files.set('/t.json', JSON.stringify({ version: 1, refreshToken: Buffer.from('enc:refresh').toString('base64'), savedAt: 1 }));
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
        calls.push(url);
        if (url.includes('/token')) {
            return refreshError
                ? { ok: false, status: 400, json: async () => ({ error: refreshError }) }
                : { ok: true, status: 200, json: async () => ({ access_token: 'acc', expires_in: 3600 }) };
        }
        if (url.includes('/revoke')) return { ok: true, status: 200, json: async () => ({}) };
        return {
            ok: true,
            status: 200,
            json: async () => ({ items: [{ id: '1', summary: 'Lunch', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }] }),
        };
    };
    let now = 1_000_000;
    const service = createGcalService({
        loadConfig: async () => (configured ? { clientId: 'id', clientSecret: 's' } : null),
        store,
        fetch: fetchFn,
        openExternal: () => undefined,
        createServer: (() => {
            throw new Error('no server in this test');
        }) as unknown as CreateLoopbackServer,
        now: () => now,
    });
    return { service, files, calls, advance: (ms: number) => void (now += ms) };
}

describe('gcal service', () => {
    it('is OFF by default: listEvents answers [] without any network call', async () => {
        const { service, calls } = setup();
        expect((await service.status()).enabled).toBe(false);
        expect(await service.listEvents(range)).toEqual([]);
        expect(calls).toEqual([]);
    });

    it('reports not-configured / not-connected / connected', async () => {
        expect((await setup({ configured: false }).service.status()).state).toBe('not-configured');
        expect((await setup({ hasToken: false }).service.status()).state).toBe('not-connected');
        const { service } = setup();
        expect(await service.status()).toMatchObject({ state: 'connected', connected: true, configured: true });
    });

    it('returns the events once enabled and caches them for the next call', async () => {
        const { service, calls } = setup();
        await service.setEnabled(true);
        const events = await service.listEvents(range);
        expect(events).toEqual([
            { id: 'google:1', title: 'Lunch', start: '2026-01-05', end: '2026-01-05', allDay: true, calendar: 'google' },
        ]);
        const before = calls.length;
        await service.listEvents(range);
        expect(calls.length).toBe(before);
        expect((await service.status()).lastRefreshAt).not.toBeNull();
        service.dispose();
    });

    it('turns invalid_grant into reconnect-needed and then answers []', async () => {
        const { service } = setup({ refreshError: 'invalid_grant' });
        await service.setEnabled(true);
        expect(await service.listEvents(range)).toEqual([]);
        expect(await service.status()).toMatchObject({ state: 'reconnect-needed', connected: false });
        service.dispose();
    });

    it('disabling clears the cache and goes back to []', async () => {
        const { service } = setup();
        await service.setEnabled(true);
        await service.listEvents(range);
        await service.setEnabled(false);
        expect(await service.listEvents(range)).toEqual([]);
        expect((await service.status()).lastRefreshAt).toBeNull();
    });

    it('disconnect revokes the token and deletes the token file but keeps the switch', async () => {
        const { service, files, calls } = setup();
        await service.setEnabled(true);
        const status = await service.disconnect();
        expect(status).toMatchObject({ state: 'not-connected', enabled: true });
        expect(calls.some((url) => url.includes('/revoke'))).toBe(true);
        expect(files.has('/t.json')).toBe(false);
        expect(files.has('/f.json')).toBe(true);
    });

    it('refuses to connect while disabled, unconfigured, or without encryption (no browser, no server)', async () => {
        expect(await setup().service.connect()).toMatchObject({ success: false, reason: 'disabled' });
        const unconfigured = setup({ configured: false });
        await unconfigured.service.setEnabled(true);
        expect(await unconfigured.service.connect()).toMatchObject({ success: false, reason: 'not-configured' });
        const noCrypto = setup({ encryption: false, hasToken: false });
        await noCrypto.service.setEnabled(true);
        expect(await noCrypto.service.connect()).toMatchObject({ success: false, reason: 'encryption-unavailable' });
    });

    it('refreshes every 15 minutes only while connected and enabled', async () => {
        vi.useFakeTimers();
        const { service, calls } = setup();
        await service.start();
        await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
        expect(calls).toEqual([]); // disabled: no timer, no network
        await service.setEnabled(true);
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 10);
        expect(calls.some((url) => url.includes('/calendars/primary/events'))).toBe(true);
        service.dispose();
    });
});
