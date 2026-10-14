// T-610: the main window's plugin-sync (src/store/pluginSync.ts): action validation, unknown-id rejection, queueing and stale
// Settings snapshots, the reuse of the old UI's calls, and its wiring into startSettingsSync (summary publish, ack).
import { describe, expect, it, vi } from 'vitest';
import type { IpcClaimedSettingsSyncBridge, IpcSettingsAction, IpcSettingsPublish } from '../shared/ipc-contract';
import { PLUGIN_ACTIONS, createPluginSync, type PluginSyncApi } from '../src/store/pluginSync';
import { PLUGIN_SUMMARY_LIMITS, normalizePluginRepo, pluginRepoUrl, sanitizePluginSummary } from '../src/store/pluginSummary';
import { startSettingsSync } from '../src/store/sync';

const LIST = [
    { id: 'a', name: 'Alpha', version: '1.0.0', enabled: true, code: 'SECRET-CODE', repo: 'https://example.invalid/a' },
    { id: 'b', name: 'Beta', version: '1.0.0', enabled: false, githubRepo: 'https://github.com/Kobar-Project/beta.git' },
    { id: 'dev-c', name: 'Dev', version: '0.1.0', enabled: true, isPlayground: true },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(apiOverrides: Partial<PluginSyncApi> = {}, panels: string[] = ['a']) {
    const calls: string[] = [];
    const api: PluginSyncApi = {
        toggleExtensionEnabled: vi.fn(async (id: string, enabled: boolean) => void calls.push(`api.toggle:${id}:${enabled}`)),
        uninstallExtension: vi.fn(async (id: string) => (calls.push(`api.uninstall:${id}`), true)),
        checkPluginUpdates: vi.fn(async () => [{ id: 'a', name: 'Alpha', currentVersion: '1.0.0', latestVersion: '2.0.0', repo: 'o/a' }]),
        installExtensionFromGithub: vi.fn(async (id: string) => (calls.push(`api.install:${id}`), { success: true })),
        ...apiOverrides,
    };
    const store = {
        setExtensionEnabledInWorkspace: vi.fn((id: string, enabled: boolean) => void calls.push(`store.enable:${id}:${enabled}`)),
        syncEnabledExtensions: vi.fn(() => void calls.push('store.sync')),
        triggerExtensionReload: vi.fn(() => void calls.push('store.reload')),
        openPluginsTab: vi.fn(() => void calls.push('store.openTab')),
        openPluginSettings: vi.fn((id: string | null) => void calls.push(`store.pluginHost:${id}`)),
        setSelectedPluginId: vi.fn((id: string | null) => void calls.push(`store.select:${id}`)),
    };
    const sync = createPluginSync({ api: () => api, store: () => store, hasSettingsPanel: (id) => panels.includes(id), log: vi.fn() });
    sync.setInstalledList(LIST);
    return { sync, api, store, calls };
}

describe('plugin summary', () => {
    it('contains only list fields: no code, repo, path or description', () => {
        const { sync } = harness();
        const summary = sync.getSummary()!;
        expect(JSON.stringify(summary)).not.toMatch(/SECRET-CODE|example\.invalid|code/);
        // R-16: only a strict owner/name survives as a display link; anything else is null.
        expect(summary.items.map((i) => i.repo)).toEqual([null, 'Kobar-Project/beta', null]);
        expect(summary.items.map((i) => [i.id, i.enabled, i.removable, i.hasSettingsPanel])).toEqual([
            ['a', true, true, true],
            ['b', false, true, false],
            ['dev-c', true, false, false],
        ]);
    });

    it('is null until a list arrived, and ignores garbage lists and duplicate / oversize ids', () => {
        const sync = createPluginSync({ api: () => undefined, store: () => ({}) as never, hasSettingsPanel: () => false, log: vi.fn() });
        expect(sync.getSummary()).toBeNull();
        sync.setInstalledList('nope');
        expect(sync.getSummary()).toBeNull();
        sync.setInstalledList([null, 3, { id: '' }, { id: 'x'.repeat(PLUGIN_SUMMARY_LIMITS.id + 1) }, { id: 'ok' }, { id: 'ok' }]);
        expect(sync.getSummary()!.items.map((i) => i.id)).toEqual(['ok']);
    });

    it('sanitizePluginSummary (Settings side) drops invalid items and returns null for non-summaries', () => {
        expect(sanitizePluginSummary(null)).toBeNull();
        expect(sanitizePluginSummary({ items: 'x' })).toBeNull();
        const out = sanitizePluginSummary({
            items: [{ id: 'a', name: 'A', enabled: true }, { id: 3 }, { id: 'a' }],
            status: {},
            lastUpdate: null,
        });
        expect(out!.items).toHaveLength(1);
        expect(out!.items[0]).toMatchObject({ id: 'a', enabled: true, removable: false, updateAvailable: false });
    });
});

describe('plugin actions: validation', () => {
    it('allow-lists exactly the documented types', () => {
        expect([...PLUGIN_ACTIONS.keys()].sort()).toEqual([
            'plugin.checkUpdates',
            'plugin.install',
            'plugin.installFromFile',
            'plugin.installFromGithub',
            'plugin.openSettings',
            'plugin.refreshCatalog',
            'plugin.setEnabled',
            'plugin.uninstall',
            'plugin.update',
            'plugin.updateAll',
        ]);
        const { sync } = harness();
        expect(sync.owns('plugin.uninstall')).toBe(true);
        expect(sync.owns('setTheme')).toBe(false);
        expect(sync.owns('__proto__')).toBe(false);
    });

    it('rejects unknown types, bad payloads and extra fields without touching window.api or the store', async () => {
        const { sync, calls } = harness();
        const bad: unknown[] = [
            null,
            'x',
            { type: 'plugin.nope', payload: {} },
            { type: '__proto__' },
            { type: 'plugin.setEnabled', payload: { id: 'a' } },
            { type: 'plugin.setEnabled', payload: { id: 'a', enabled: 'true' } },
            { type: 'plugin.setEnabled', payload: { id: 'a', enabled: true, extra: 1 } },
            { type: 'plugin.setEnabled', payload: { id: 7, enabled: true } },
            { type: 'plugin.uninstall', payload: { id: '' } },
            { type: 'plugin.uninstall', payload: { id: 'x'.repeat(129) } },
            { type: 'plugin.uninstall', payload: { id: 'a', force: true } },
            { type: 'plugin.updateAll', payload: { id: 'a' } },
            { type: 'plugin.openSettings', payload: [] },
        ];
        for (const action of bad) {
            expect((await sync.handle(action)).ok).toBe(false);
        }
        expect(calls).toEqual([]);
    });

    it('rejects ids that are not in the published list (never forwarded)', async () => {
        const { sync, api, calls } = harness();
        for (const type of ['plugin.setEnabled', 'plugin.uninstall', 'plugin.update', 'plugin.openSettings'] as const) {
            const payload = type === 'plugin.setEnabled' ? { id: 'ghost', enabled: true } : { id: 'ghost' };
            expect(await sync.handle({ type, payload })).toEqual({ ok: false, reason: 'unknown-plugin' });
        }
        expect(await sync.handle({ type: 'plugin.setEnabled', payload: { id: '../../etc', enabled: true } })).toEqual({
            ok: false,
            reason: 'unknown-plugin',
        });
        expect(calls).toEqual([]);
        expect(api.uninstallExtension).not.toHaveBeenCalled();
    });

    it('is unavailable before the first plugin list', async () => {
        const sync = createPluginSync({ api: () => ({}), store: () => ({}) as never, hasSettingsPanel: () => false, log: vi.fn() });
        expect(await sync.handle({ type: 'plugin.updateAll', payload: {} })).toEqual({ ok: false, reason: 'unavailable' });
    });
});

describe('plugin actions: the old UI code paths', () => {
    it('setEnabled: workspace flag, then the api toggle, then a plugin re-sync', async () => {
        const { sync, calls } = harness();
        expect(await sync.handle({ type: 'plugin.setEnabled', payload: { id: 'b', enabled: true } })).toEqual({ ok: true });
        expect(calls).toEqual(['store.enable:b:true', 'api.toggle:b:true', 'store.sync']);
    });

    it('uninstall: api.uninstallExtension then a re-sync; dev plugins are not removable; a refusal changes nothing', async () => {
        const { sync, calls } = harness();
        expect(await sync.handle({ type: 'plugin.uninstall', payload: { id: 'a' } })).toEqual({ ok: true });
        expect(calls).toEqual(['api.uninstall:a', 'store.sync']);
        expect(await sync.handle({ type: 'plugin.uninstall', payload: { id: 'dev-c' } })).toEqual({ ok: false, reason: 'not-removable' });
        const refused = harness({ uninstallExtension: vi.fn(async () => false) });
        expect(await refused.sync.handle({ type: 'plugin.uninstall', payload: { id: 'a' } })).toEqual({ ok: false, reason: 'failed' });
        expect(refused.calls).toEqual([]);
    });

    it('openSettings: only for plugins with a registered panel; opens the plugin settings host of the main window', async () => {
        const { sync, calls } = harness();
        expect(await sync.handle({ type: 'plugin.openSettings', payload: { id: 'b' } })).toEqual({
            ok: false,
            reason: 'no-settings-panel',
        });
        expect(await sync.handle({ type: 'plugin.openSettings', payload: { id: 'a' } })).toEqual({ ok: true });
        expect(calls).toEqual(['store.pluginHost:a']);
    });

    it('checkUpdates then updateAll: installs only what the check offered (repo from the check) and reloads', async () => {
        const { sync, api, calls } = harness();
        expect(await sync.handle({ type: 'plugin.updateAll', payload: {} })).toEqual({ ok: false, reason: 'no-update' });
        expect(await sync.handle({ type: 'plugin.checkUpdates', payload: {} })).toEqual({ ok: true });
        const summary = sync.getSummary()!;
        expect(summary.status.checked).toBe(true);
        expect(summary.items[0]).toMatchObject({ id: 'a', updateAvailable: true, latestVersion: '2.0.0' });
        expect(JSON.stringify(summary)).not.toContain('o/a');
        expect(await sync.handle({ type: 'plugin.updateAll', payload: {} })).toEqual({ ok: true });
        expect(api.installExtensionFromGithub).toHaveBeenCalledWith('a', 'o/a');
        expect(calls).toEqual(['api.install:a', 'store.reload']);
        expect(sync.getSummary()!.lastUpdate).toEqual({ updated: 1, failed: 0, canceled: 0 });
        expect(sync.getSummary()!.items[0].updateAvailable).toBe(false);
    });

    it('a check result for an unknown plugin is ignored; a single update needs an offered update', async () => {
        const { sync } = harness({ checkPluginUpdates: vi.fn(async () => [{ id: 'ghost', repo: 'o/g', latestVersion: '9' }]) });
        await sync.handle({ type: 'plugin.checkUpdates', payload: {} });
        expect(sync.getSummary()!.items.some((i) => i.updateAvailable)).toBe(false);
        expect(await sync.handle({ type: 'plugin.update', payload: { id: 'a' } })).toEqual({ ok: false, reason: 'no-update' });
    });

    it('a failed install is tallied and does not reload', async () => {
        const { sync, store } = harness({ installExtensionFromGithub: vi.fn(async () => ({ success: false, reason: 'boom' })) });
        await sync.handle({ type: 'plugin.checkUpdates', payload: {} });
        expect(await sync.handle({ type: 'plugin.update', payload: { id: 'a' } })).toEqual({ ok: false, reason: 'failed' });
        expect(sync.getSummary()!.lastUpdate).toEqual({ updated: 0, failed: 1, canceled: 0 });
        expect(store.triggerExtensionReload).not.toHaveBeenCalled();
    });

    it('a thrown api error is contained as a failure', async () => {
        const { sync } = harness({
            uninstallExtension: vi.fn(async () => {
                throw new Error('x');
            }),
        });
        expect(await sync.handle({ type: 'plugin.uninstall', payload: { id: 'a' } })).toEqual({ ok: false, reason: 'failed' });
    });
});

describe('plugin actions: races and stale Settings snapshots', () => {
    it('runs actions one after another and re-checks the id on its turn (a toggle after an uninstall is rejected)', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const { sync, api } = harness({
            uninstallExtension: vi.fn(async () => {
                await gate;
                return true;
            }),
        });
        const first = sync.handle({ type: 'plugin.uninstall', payload: { id: 'a' } });
        const second = sync.handle({ type: 'plugin.setEnabled', payload: { id: 'a', enabled: false } });
        await tick();
        expect(api.toggleExtensionEnabled).not.toHaveBeenCalled();
        release();
        await first;
        // The loader republishes the list without 'a' once the uninstall finished.
        sync.setInstalledList(LIST.filter((p) => p.id !== 'a'));
        expect(await second).toEqual({ ok: false, reason: 'unknown-plugin' });
        expect(api.toggleExtensionEnabled).not.toHaveBeenCalled();
    });

    it('two quick updateAll clicks install once: the second finds no offered update', async () => {
        const { sync, api } = harness();
        await sync.handle({ type: 'plugin.checkUpdates', payload: {} });
        const [one, two] = await Promise.all([
            sync.handle({ type: 'plugin.updateAll', payload: {} }),
            sync.handle({ type: 'plugin.updateAll', payload: {} }),
        ]);
        expect(one).toEqual({ ok: true });
        expect(two).toEqual({ ok: false, reason: 'no-update' });
        expect(api.installExtensionFromGithub).toHaveBeenCalledTimes(1);
    });

    it('drops an offered update once the plugin has that version', async () => {
        const { sync } = harness();
        await sync.handle({ type: 'plugin.checkUpdates', payload: {} });
        expect(sync.getSummary()!.items[0].updateAvailable).toBe(true);
        sync.setInstalledList([{ ...LIST[0], version: '2.0.0' }]);
        expect(sync.getSummary()!.items[0].updateAvailable).toBe(false);
    });

    it('notifies subscribers on list or status changes, and stops after unsubscribe', async () => {
        const { sync } = harness();
        const listener = vi.fn();
        const off = sync.subscribe(listener);
        sync.setInstalledList(LIST);
        await sync.handle({ type: 'plugin.checkUpdates', payload: {} });
        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
        off();
        listener.mockClear();
        sync.setInstalledList(LIST);
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('startSettingsSync with plugins', () => {
    function syncHarness() {
        const published: IpcSettingsPublish[] = [];
        let onAction: (action: IpcSettingsAction) => void = () => {};
        const bridge = {
            publish: (message: IpcSettingsPublish) => void published.push(message),
            onAction: (listener: (action: IpcSettingsAction) => void) => ((onAction = listener), () => {}),
        } as unknown as IpcClaimedSettingsSyncBridge;
        const state = { isHydrated: true, theme: 'ocean' };
        const store = { getState: () => state, subscribe: () => () => {} };
        const pending: (() => void)[] = [];
        const plugin = harness();
        const handle = startSettingsSync({
            store: store as never,
            bridge,
            plugins: plugin.sync,
            schedule: (run) => (pending.push(run), () => {}),
            epoch: 'E',
            log: vi.fn(),
        });
        const flush = () => pending.splice(0).forEach((run) => run());
        return { published, onAction: (a: IpcSettingsAction) => onAction(a), flush, plugin, handle };
    }

    it('publishes the summary with the snapshot and republishes when only the summary changed', () => {
        const h = syncHarness();
        h.flush();
        expect(h.published).toHaveLength(1);
        expect(h.published[0].plugins!.items.map((i) => i.id)).toEqual(['a', 'b', 'dev-c']);
        h.plugin.sync.setInstalledList(LIST.slice(0, 2));
        h.flush();
        expect(h.published).toHaveLength(2);
        expect(h.published[1].plugins!.items).toHaveLength(2);
        h.plugin.sync.setInstalledList(LIST.slice(0, 2));
        h.flush();
        expect(h.published).toHaveLength(2);
        h.handle.stop();
    });

    it('routes plugin.* actions to the plugin handler and acks after they finished', async () => {
        const h = syncHarness();
        h.flush();
        h.onAction({ id: 41, type: 'plugin.setEnabled', payload: { id: 'ghost', enabled: true } });
        await tick();
        h.flush();
        expect(h.published.at(-1)!.ack).toBe(41);
        expect(h.plugin.calls).toEqual([]);
        h.onAction({ id: 42, type: 'plugin.setEnabled', payload: { id: 'b', enabled: true } });
        await tick();
        h.flush();
        expect(h.plugin.calls).toContain('api.toggle:b:true');
        expect(h.published.at(-1)!.ack).toBe(42);
        h.handle.stop();
    });
});

describe('plugin repo link (R-16)', () => {
    it('normalises owner/name and github.com URLs and rejects everything else', () => {
        expect(normalizePluginRepo('Kobar-Project/KoClock')).toBe('Kobar-Project/KoClock');
        expect(normalizePluginRepo('https://github.com/Kobar-Project/KoClock.git')).toBe('Kobar-Project/KoClock');
        for (const bad of [
            null,
            3,
            '',
            'a',
            'a/b/c',
            'a/..',
            'http://github.com/a/b',
            'https://evil.com/a/b',
            'javascript:alert(1)',
            'a b/c',
            '../x',
        ]) {
            expect(normalizePluginRepo(bad)).toBeNull();
        }
        expect(pluginRepoUrl('Kobar-Project/KoClock')).toBe('https://github.com/Kobar-Project/KoClock');
        expect(pluginRepoUrl(null)).toBeNull();
    });

    it('the Settings-side sanitiser drops a malformed repo instead of showing it', () => {
        const raw = {
            items: [
                { id: 'a', repo: 'javascript:alert(1)' },
                { id: 'b', repo: 'o/r' },
            ],
            status: {},
            lastUpdate: null,
        };
        expect(sanitizePluginSummary(raw)!.items.map((i) => i.repo)).toEqual([null, 'o/r']);
    });
});
