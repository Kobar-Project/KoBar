// T-611: the catalogue (Discover) side of the main window's plugin-sync (src/store/pluginSync.ts): schema validation of the new actions,
// unknown-id rejection at execution time, "install from file / GitHub" never taking a path or URL, stale snapshots and races.
import { describe, expect, it, vi } from 'vitest';
import { PLUGIN_CANCELED_REASON } from '../src/components/plugins/pluginResults';
import { createPluginSync, type PluginSyncApi } from '../src/store/pluginSync';
import { PLUGIN_SUMMARY_LIMITS, sanitizePluginCatalog, sanitizePluginSummary } from '../src/store/pluginSummary';

const REGISTRY = [
    {
        id: 'alpha',
        name: 'Alpha',
        description: 'First',
        author: 'Kobar',
        category: 'tools',
        githubRepo: 'Kobar-Project/alpha',
        secret: 'S3CRET',
    },
    { id: 'beta', name: 'Beta', description: 'Second', author: 'Kobar', githubRepo: 'Kobar-Project/beta', isBeta: true },
    { id: 'gamma', name: 'Gamma', description: 'No repo' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(opts: { registry?: () => Promise<unknown>; online?: () => boolean; api?: Partial<PluginSyncApi> } = {}) {
    const calls: string[] = [];
    const api: PluginSyncApi = {
        installExtensionFromGithub: vi.fn(async (id: string, repo: string) => (calls.push(`install:${id}:${repo}`), { success: true })),
        installExtensionFromFile: vi.fn(async (...args: unknown[]) => (calls.push(`file:${args.length}`), { success: true })),
        ...opts.api,
    };
    const store = {
        setExtensionEnabledInWorkspace: vi.fn(),
        syncEnabledExtensions: vi.fn(),
        triggerExtensionReload: vi.fn(() => void calls.push('reload')),
        openPluginsTab: vi.fn(() => void calls.push('openTab')),
        openPluginSettings: vi.fn((id: string | null) => void calls.push(`pluginHost:${id}`)),
        setSelectedPluginId: vi.fn((id: string | null) => void calls.push(`select:${id}`)),
    };
    const fetchRegistry = vi.fn(opts.registry ?? (async () => REGISTRY));
    const sync = createPluginSync({
        api: () => api,
        store: () => store,
        hasSettingsPanel: () => false,
        fetchRegistry,
        isOnline: opts.online,
        log: vi.fn(),
    });
    sync.setInstalledList([{ id: 'beta', name: 'Beta', version: '1.0.0', enabled: true }]);
    return { sync, api, store, calls, fetchRegistry };
}

describe('catalogue: summary', () => {
    it('is idle until asked, and the registry is not read before plugin.refreshCatalog', () => {
        const { sync, fetchRegistry } = harness();
        expect(sync.getSummary()!.catalog).toEqual({ status: 'idle', error: null, items: [], installingId: null, lastInstall: null });
        expect(fetchRegistry).not.toHaveBeenCalled();
    });

    it('publishes id, name, description, author, version, category, beta and the live installed flag: a strict display repo, no extra fields', async () => {
        const { sync } = harness();
        expect(await sync.handle({ type: 'plugin.refreshCatalog', payload: {} })).toEqual({ ok: true });
        const catalog = sync.getSummary()!.catalog!;
        expect(catalog.status).toBe('ready');
        expect(catalog.items.map((i) => [i.id, i.installed, i.beta, i.category, i.author])).toEqual([
            ['alpha', false, false, 'tools', 'Kobar'],
            ['beta', true, true, '', 'Kobar'],
            ['gamma', false, false, '', ''],
        ]);
        expect(catalog.items.map((i) => i.repo)).toEqual(['Kobar-Project/alpha', 'Kobar-Project/beta', null]);
        expect(JSON.stringify(sync.getSummary())).not.toMatch(/S3CRET|githubRepo/);
        // The installed flag follows the installed list at once.
        sync.setInstalledList([]);
        expect(sync.getSummary()!.catalog!.items.find((i) => i.id === 'beta')!.installed).toBe(false);
    });

    it('survives the Settings-side sanitiser, and the sanitiser never throws on garbage', async () => {
        const { sync } = harness();
        await sync.handle({ type: 'plugin.refreshCatalog' });
        const raw = JSON.parse(JSON.stringify(sync.getSummary()));
        expect(sanitizePluginSummary(raw)!.catalog).toEqual(raw.catalog);
        for (const junk of [null, 3, 'x', [], { status: 'ready', items: 'x' }, { items: [null, { id: 1 }, { id: 'a' }, { id: 'a' }] }]) {
            expect(() => sanitizePluginCatalog(junk)).not.toThrow();
        }
        expect(sanitizePluginCatalog({ items: [null, { id: 1 }, { id: 'a' }, { id: 'a' }] }).items.map((i) => i.id)).toEqual(['a']);
        expect(sanitizePluginCatalog({ status: 'error', error: 'weird' }).error).toBe('failed');
    });

    it('caps the catalogue and drops invalid entries', async () => {
        const many = Array.from({ length: PLUGIN_SUMMARY_LIMITS.catalogItems + 20 }, (_, i) => ({ id: `p${i}`, name: 'x' }));
        const { sync } = harness({ registry: async () => [null, 4, { id: '' }, { id: 'x'.repeat(200) }, ...many] });
        await sync.handle({ type: 'plugin.refreshCatalog' });
        expect(sync.getSummary()!.catalog!.items.length).toBeLessThanOrEqual(PLUGIN_SUMMARY_LIMITS.catalogItems);
    });
});

describe('catalogue: loading, offline and error states', () => {
    it('shows loading while the registry is read, then the result', async () => {
        let release: (value: unknown) => void = () => {};
        const { sync } = harness({ registry: () => new Promise((resolve) => (release = resolve)) });
        const done = sync.handle({ type: 'plugin.refreshCatalog' });
        await tick();
        expect(sync.getSummary()!.catalog!.status).toBe('loading');
        release(REGISTRY);
        await done;
        expect(sync.getSummary()!.catalog!.status).toBe('ready');
    });

    it('reports offline without touching the network, and recovers on retry', async () => {
        let online = false;
        const { sync, fetchRegistry } = harness({ online: () => online });
        expect(await sync.handle({ type: 'plugin.refreshCatalog' })).toEqual({ ok: false, reason: 'failed' });
        expect(sync.getSummary()!.catalog).toMatchObject({ status: 'error', error: 'offline', items: [] });
        expect(fetchRegistry).not.toHaveBeenCalled();
        online = true;
        expect(await sync.handle({ type: 'plugin.refreshCatalog' })).toEqual({ ok: true });
        expect(sync.getSummary()!.catalog!.status).toBe('ready');
    });

    it('a failed or malformed registry read is an error state (not offline), with no stale items', async () => {
        for (const registry of [async () => Promise.reject(new Error('boom')), async () => ({ not: 'a list' }), async () => 'x']) {
            const { sync } = harness({ registry });
            expect(await sync.handle({ type: 'plugin.refreshCatalog' })).toEqual({ ok: false, reason: 'failed' });
            expect(sync.getSummary()!.catalog).toMatchObject({ status: 'error', error: 'failed', items: [] });
        }
    });

    it('without a registry reader the catalogue is unavailable', async () => {
        const sync = createPluginSync({ api: () => undefined, store: () => ({}) as never, hasSettingsPanel: () => false, log: vi.fn() });
        sync.setInstalledList([]);
        expect(await sync.handle({ type: 'plugin.refreshCatalog' })).toEqual({ ok: false, reason: 'unavailable' });
    });
});

describe('catalogue: plugin.install', () => {
    it('installs a catalogue plugin with the repo of ITS entry (held here), then reloads like the old detail view', async () => {
        const { sync, calls } = harness();
        await sync.handle({ type: 'plugin.refreshCatalog' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } })).toEqual({ ok: true });
        expect(calls).toEqual(['install:alpha:Kobar-Project/alpha', 'reload']);
        expect(sync.getSummary()!.catalog!.lastInstall).toEqual({ id: 'alpha', result: 'success' });
        expect(sync.getSummary()!.catalog!.installingId).toBeNull();
    });

    it('rejects an id that is not in the live catalogue, before and after a refresh, without calling window.api', async () => {
        const { sync, api } = harness();
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } })).toEqual({ ok: false, reason: 'unknown-plugin' });
        await sync.handle({ type: 'plugin.refreshCatalog' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'ghost' } })).toEqual({ ok: false, reason: 'unknown-plugin' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: '__proto__' } })).toEqual({
            ok: false,
            reason: 'unknown-plugin',
        });
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
    });

    it('rejects an installed plugin and an entry without a repo link', async () => {
        const { sync, api } = harness();
        await sync.handle({ type: 'plugin.refreshCatalog' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'beta' } })).toEqual({ ok: false, reason: 'already-installed' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'gamma' } })).toEqual({ ok: false, reason: 'unavailable' });
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
    });

    it('never accepts a repo, URL or path in the payload (strict schema)', async () => {
        const { sync, api } = harness();
        await sync.handle({ type: 'plugin.refreshCatalog' });
        for (const payload of [
            { id: 'alpha', repo: 'evil/repo' },
            { id: 'alpha', url: 'https://example.invalid/x.zip' },
            { id: 'alpha', path: 'C:\\x.zip' },
            { repo: 'evil/repo' },
            {},
            { id: 7 },
        ]) {
            expect(await sync.handle({ type: 'plugin.install', payload })).toEqual({ ok: false, reason: 'invalid-payload' });
        }
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
    });

    it('stale snapshot: a catalogue refreshed in between wins, an id that vanished is rejected on its turn', async () => {
        let list: unknown[] = REGISTRY;
        const { sync, api } = harness({ registry: async () => list });
        await sync.handle({ type: 'plugin.refreshCatalog' });
        list = [REGISTRY[1]];
        // The Settings window still shows `alpha`: refresh and install are queued back to back.
        const refresh = sync.handle({ type: 'plugin.refreshCatalog' });
        const install = sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } });
        expect(await refresh).toEqual({ ok: true });
        expect(await install).toEqual({ ok: false, reason: 'unknown-plugin' });
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
    });

    it('double click installs once: the second finds the plugin installed after the loader republished', async () => {
        const ref: { sync?: ReturnType<typeof harness>['sync'] } = {};
        const { sync, api, calls } = harness({
            api: {
                installExtensionFromGithub: vi.fn(async () => {
                    ref.sync!.setInstalledList([{ id: 'beta' }, { id: 'alpha' }]);
                    return { success: true };
                }),
            },
        });
        ref.sync = sync;
        await sync.handle({ type: 'plugin.refreshCatalog' });
        const first = sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } });
        const second = sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } });
        expect(await first).toEqual({ ok: true });
        expect(await second).toEqual({ ok: false, reason: 'already-installed' });
        expect(api.installExtensionFromGithub).toHaveBeenCalledTimes(1);
        expect(calls.filter((c) => c === 'reload')).toHaveLength(1);
    });

    it('shows the install in progress, and tells failed from canceled (neither reloads)', async () => {
        let finish: (value: { success: boolean; reason?: string }) => void = () => {};
        const { sync, calls } = harness({ api: { installExtensionFromGithub: () => new Promise((resolve) => (finish = resolve)) } });
        await sync.handle({ type: 'plugin.refreshCatalog' });
        const run = sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } });
        await tick();
        expect(sync.getSummary()!.catalog!.installingId).toBe('alpha');
        finish({ success: false, reason: 'cancelled-by-user' });
        await run;
        expect(sync.getSummary()!.catalog!.lastInstall!.result).toBe('failed');
        const canceled = harness({ api: { installExtensionFromGithub: async () => ({ success: false, reason: PLUGIN_CANCELED_REASON }) } });
        await canceled.sync.handle({ type: 'plugin.refreshCatalog' });
        expect(await canceled.sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } })).toEqual({ ok: true });
        expect(canceled.sync.getSummary()!.catalog!.lastInstall).toEqual({ id: 'alpha', result: 'canceled' });
        expect(calls).not.toContain('reload');
        expect(canceled.calls).not.toContain('reload');
    });

    it('a thrown api error is contained as a failure', async () => {
        const { sync, calls } = harness({
            api: {
                installExtensionFromGithub: async () => {
                    throw new Error('boom');
                },
            },
        });
        await sync.handle({ type: 'plugin.refreshCatalog' });
        expect(await sync.handle({ type: 'plugin.install', payload: { id: 'alpha' } })).toEqual({ ok: false, reason: 'failed' });
        expect(calls).not.toContain('reload');
        expect(sync.getSummary()!.catalog!.installingId).toBeNull();
    });
});

describe('install from file / GitHub: nothing comes from the Settings window', () => {
    it('plugin.installFromFile runs the existing picker with NO arguments and reloads on success', async () => {
        const { sync, api, calls } = harness();
        expect(await sync.handle({ type: 'plugin.installFromFile', payload: {} })).toEqual({ ok: true });
        expect(api.installExtensionFromFile).toHaveBeenCalledWith();
        expect(calls).toEqual(['file:0', 'reload']);
    });

    it('a canceled picker is not a failure and does not reload; other failures are failures', async () => {
        const canceled = harness({ api: { installExtensionFromFile: async () => ({ success: false, reason: PLUGIN_CANCELED_REASON }) } });
        expect(await canceled.sync.handle({ type: 'plugin.installFromFile' })).toEqual({ ok: true });
        expect(canceled.calls).not.toContain('reload');
        const failed = harness({ api: { installExtensionFromFile: async () => ({ success: false, reason: 'bad zip' }) } });
        expect(await failed.sync.handle({ type: 'plugin.installFromFile' })).toEqual({ ok: false, reason: 'failed' });
        expect(failed.calls).not.toContain('reload');
    });

    it('plugin.installFromGithub only opens the main window plugin host (link form) and calls no install function', async () => {
        const { sync, api, calls } = harness();
        expect(await sync.handle({ type: 'plugin.installFromGithub', payload: {} })).toEqual({ ok: true });
        expect(calls).toEqual(['pluginHost:null']);
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
        expect(api.installExtensionFromFile).not.toHaveBeenCalled();
    });

    it('both reject ANY payload field (path, url, repo, id): invalid-payload, nothing runs', async () => {
        const { sync, api, calls } = harness();
        for (const type of ['plugin.installFromFile', 'plugin.installFromGithub', 'plugin.refreshCatalog']) {
            for (const payload of [
                { path: 'C:\\x.zip' },
                { url: 'https://github.com/o/r' },
                { repo: 'o/r' },
                { id: 'alpha' },
                'C:\\x.zip',
                [1],
                5,
            ]) {
                expect(await sync.handle({ type, payload })).toEqual({ ok: false, reason: 'invalid-payload' });
            }
        }
        expect(api.installExtensionFromFile).not.toHaveBeenCalled();
        expect(api.installExtensionFromGithub).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });
});
