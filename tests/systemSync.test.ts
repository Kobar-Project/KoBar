// T-614: the main window's side of Settings > Backup & updates and About: summary, action validation, the update state machine, the
// export result mapping, the Store-build lock, and the wiring into startSettingsSync.
import { describe, expect, it, vi } from 'vitest';
import type { IpcClaimedSettingsSyncBridge, IpcSettingsAction, IpcSettingsPublish } from '../shared/ipc-contract';
import { startSettingsSync } from '../src/store/sync';
import { createSystemSync, SYSTEM_ACTIONS, type SystemSyncApi } from '../src/store/systemSync';
import { sanitizeSystemSummary } from '../src/store/systemSummary';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const act = (type: string, payload?: unknown) => ({ type, payload });

interface HarnessOptions {
    updatesEnabled?: boolean;
    hydrated?: boolean;
    check?: () => Promise<unknown>;
    exportResult?: () => Promise<unknown>;
    noHostActions?: boolean;
}

function harness(opts: HarnessOptions = {}) {
    const calls: string[] = [];
    const handlers: { progress?: (p: { percent: number }) => void; complete?: (v: string) => void; error?: (e: string) => void } = {};
    const api: SystemSyncApi = {
        getAppVersion: async () => '2.0.1',
        checkForUpdatesManual: (opts.check ?? (async () => ({ status: 'success', updateAvailable: true, version: '2.1.0' }))) as never,
        downloadAndInstallUpdate: () => void calls.push('download'),
        quitAndInstallUpdate: () => void calls.push('install'),
        onUpdateDownloadProgress: (cb) => ((handlers.progress = cb), () => void calls.push('off-progress')),
        onUpdateDownloadComplete: (cb) => ((handlers.complete = cb), () => void calls.push('off-complete')),
        onUpdateError: (cb) => ((handlers.error = cb), () => void calls.push('off-error')),
    };
    const exportBackup = vi.fn(async (o: { includeSecrets: boolean }) => {
        calls.push(`export:${o.includeSecrets}`);
        return (opts.exportResult ? await opts.exportResult() : { success: true }) as { success: boolean; reason?: string };
    });
    const sync = createSystemSync({
        api: () => api,
        isHydrated: () => opts.hydrated ?? true,
        updatesEnabled: opts.updatesEnabled ?? true,
        exportBackup,
        ...(opts.noHostActions
            ? {}
            : { openRestore: () => void calls.push('open-restore'), restartTutorial: () => void calls.push('tutorial') }),
        log: vi.fn(),
    });
    const listener = vi.fn();
    const off = sync.subscribe(listener);
    return { sync, calls, handlers, exportBackup, listener, off };
}

describe('system summary', () => {
    it('starts empty, learns the version, and carries only codes and numbers', async () => {
        const h = harness();
        expect(h.sync.getSummary()).toEqual({
            version: '',
            updatesEnabled: true,
            update: { status: 'idle', version: '', percent: 0 },
            backup: { busy: false, last: null },
        });
        await tick();
        expect(h.sync.getSummary()!.version).toBe('2.0.1');
        expect(h.listener).toHaveBeenCalled();
    });

    it('sanitizeSystemSummary clamps and defaults untrusted data', () => {
        const s = sanitizeSystemSummary({
            version: 'x'.repeat(65),
            updatesEnabled: 1,
            update: { status: 'bogus', version: '1.0', percent: 500 },
            backup: { busy: true, last: 'nope' },
        });
        expect(s).toEqual({
            version: '',
            updatesEnabled: false,
            update: { status: 'idle', version: '1.0', percent: 100 },
            backup: { busy: true, last: null },
        });
        expect(sanitizeSystemSummary(null)).toBeNull();
        expect(sanitizeSystemSummary({ update: {}, backup: 3 })).toBeNull();
    });

    it('unsubscribing detaches the update listeners', () => {
        const h = harness();
        h.off();
        expect(h.calls).toEqual(['off-progress', 'off-complete', 'off-error']);
    });
});

describe('system actions: validation', () => {
    it('owns only the allow-listed types', () => {
        expect([...SYSTEM_ACTIONS.keys()].sort()).toEqual([
            'app.restartTutorial',
            'backup.export',
            'backup.restore',
            'data.exportNotes',
            'data.exportSettings',
            'data.importNotes',
            'data.importSettings',
            'update.check',
            'update.download',
            'update.install',
        ]);
        const { sync } = harness();
        expect(sync.owns('backup.restore')).toBe(true);
        expect(sync.owns('app.restartTutorial')).toBe(true);
        expect(sync.owns('backup.restore.x')).toBe(false);
        expect(sync.owns('backup.__proto__')).toBe(false);
        expect(sync.owns('__proto__')).toBe(false);
    });

    it('rejects unknown actions and bad payloads without running anything', async () => {
        const h = harness();
        const bad: [string, unknown][] = [
            ['backup.restore', { path: 'C:/x' }],
            ['backup.restore', 'now'],
            ['backup.restore', { includeSecrets: false }],
            ['app.restartTutorial', { force: true }],
            ['app.restartTutorial', [1]],
            ['__proto__', {}],
            ['backup.export', {}],
            ['backup.export', { includeSecrets: 'yes' }],
            ['backup.export', { includeSecrets: true, path: 'C:\\x' }],
            ['update.check', { force: true }],
            ['update.install', 'now'],
        ];
        for (const [type, payload] of bad) {
            const r = await h.sync.handle(act(type, payload));
            expect(r.ok).toBe(false);
        }
        expect((await h.sync.handle(null)).ok).toBe(false);
        expect(h.exportBackup).not.toHaveBeenCalled();
        expect(h.calls.filter((c) => c === 'download' || c === 'install' || c === 'open-restore' || c === 'tutorial')).toEqual([]);
    });

    it('rejects everything before hydration', async () => {
        const h = harness({ hydrated: false });
        expect(await h.sync.handle(act('backup.export', { includeSecrets: false }))).toEqual({ ok: false, reason: 'unavailable' });
        expect(await h.sync.handle(act('update.check'))).toEqual({ ok: false, reason: 'unavailable' });
        expect(await h.sync.handle(act('backup.restore', {}))).toEqual({ ok: false, reason: 'unavailable' });
        expect(await h.sync.handle(act('app.restartTutorial', {}))).toEqual({ ok: false, reason: 'unavailable' });
        expect(h.exportBackup).not.toHaveBeenCalled();
        expect(h.calls).toEqual([]);
    });

    it('backup.restore and app.restartTutorial run the host callbacks (empty or missing payload only)', async () => {
        const h = harness();
        expect(await h.sync.handle(act('backup.restore', {}))).toEqual({ ok: true });
        expect(await h.sync.handle(act('backup.restore'))).toEqual({ ok: true });
        expect(await h.sync.handle(act('app.restartTutorial', {}))).toEqual({ ok: true });
        expect(h.calls).toEqual(['open-restore', 'open-restore', 'tutorial']);
        const bare = harness({ noHostActions: true });
        expect(await bare.sync.handle(act('backup.restore', {}))).toEqual({ ok: false, reason: 'unavailable' });
    });
});

describe('backup.export', () => {
    it('runs the shared export and reports done', async () => {
        const h = harness();
        expect(await h.sync.handle(act('backup.export', { includeSecrets: false }))).toEqual({ ok: true });
        expect(h.calls).toContain('export:false');
        expect(h.sync.getSummary()!.backup).toEqual({ busy: false, last: 'done' });
    });

    it('maps cancel and failure, and goes busy while running', async () => {
        const canceled = harness({ exportResult: async () => ({ success: false, reason: 'canceled' }) });
        expect(await canceled.sync.handle(act('backup.export', { includeSecrets: true }))).toEqual({ ok: true });
        expect(canceled.sync.getSummary()!.backup.last).toBe('canceled');
        const failed = harness({ exportResult: async () => ({ success: false, reason: 'error' }) });
        expect(await failed.sync.handle(act('backup.export', { includeSecrets: false }))).toEqual({ ok: false, reason: 'failed' });
        expect(failed.sync.getSummary()!.backup).toEqual({ busy: false, last: 'failed' });
        let release: (v: unknown) => void = () => {};
        const slow = harness({ exportResult: () => new Promise((resolve) => (release = resolve)) });
        const p = slow.sync.handle(act('backup.export', { includeSecrets: false }));
        await tick();
        expect(slow.sync.getSummary()!.backup.busy).toBe(true);
        release({ success: true });
        await p;
        expect(slow.sync.getSummary()!.backup.busy).toBe(false);
    });
});

describe('update actions', () => {
    it('check, available, download, progress, complete, install', async () => {
        const h = harness();
        expect(await h.sync.handle(act('update.check'))).toEqual({ ok: true });
        expect(h.sync.getSummary()!.update).toEqual({ status: 'available', version: '2.1.0', percent: 0 });
        expect(await h.sync.handle(act('update.download'))).toEqual({ ok: true });
        expect(h.calls).toContain('download');
        h.handlers.progress!({ percent: 41.6 });
        expect(h.sync.getSummary()!.update).toMatchObject({ status: 'downloading', percent: 42 });
        h.handlers.complete!('2.1.0');
        expect(h.sync.getSummary()!.update).toEqual({ status: 'downloaded', version: '2.1.0', percent: 100 });
        expect(await h.sync.handle(act('update.install'))).toEqual({ ok: true });
        expect(h.calls).toContain('install');
    });

    it('install and download are refused in the wrong state', async () => {
        const h = harness();
        expect(await h.sync.handle(act('update.install'))).toEqual({ ok: false, reason: 'bad-state' });
        expect(await h.sync.handle(act('update.download'))).toEqual({ ok: false, reason: 'bad-state' });
        expect(h.calls.filter((c) => c === 'download' || c === 'install')).toEqual([]);
    });

    it('up to date, disabled, error result and a throwing check', async () => {
        const upToDate = harness({ check: async () => ({ status: 'success', updateAvailable: false }) });
        await upToDate.sync.handle(act('update.check'));
        expect(upToDate.sync.getSummary()!.update.status).toBe('upToDate');
        const disabled = harness({ check: async () => ({ status: 'disabled' }) });
        await disabled.sync.handle(act('update.check'));
        expect(disabled.sync.getSummary()!.update.status).toBe('idle');
        const errored = harness({ check: async () => ({ status: 'error', message: 'C:\\secret\\path' }) });
        await errored.sync.handle(act('update.check'));
        expect(errored.sync.getSummary()!.update.status).toBe('error');
        expect(JSON.stringify(errored.sync.getSummary())).not.toContain('secret');
        const thrown = harness({ check: async () => Promise.reject(new Error('boom')) });
        expect(await thrown.sync.handle(act('update.check'))).toEqual({ ok: false, reason: 'failed' });
        expect(thrown.sync.getSummary()!.update.status).toBe('error');
    });

    it('a bad version string from the updater is dropped', async () => {
        const h = harness({ check: async () => ({ status: 'success', updateAvailable: true, version: '<script>' }) });
        await h.sync.handle(act('update.check'));
        expect(h.sync.getSummary()!.update.status).toBe('upToDate');
    });

    it('the Store build rejects every update action and attaches no update listeners', async () => {
        const h = harness({ updatesEnabled: false });
        expect(h.handlers.progress).toBeUndefined();
        for (const type of ['update.check', 'update.download', 'update.install']) {
            expect(await h.sync.handle(act(type))).toEqual({ ok: false, reason: 'unavailable' });
        }
        expect(h.sync.getSummary()!.updatesEnabled).toBe(false);
    });
});

function wiring(system?: ReturnType<typeof harness>['sync']) {
    const published: IpcSettingsPublish[] = [];
    let onAction: (action: IpcSettingsAction) => void = () => {};
    const bridge = {
        publish: (m: IpcSettingsPublish) => void published.push(m),
        onAction: (l: (a: IpcSettingsAction) => void) => ((onAction = l), () => {}),
    } as unknown as IpcClaimedSettingsSyncBridge;
    const pending: (() => void)[] = [];
    const state = { isHydrated: true, theme: 'ocean' };
    const handle = startSettingsSync({
        store: { getState: () => state, subscribe: () => () => {} } as never,
        bridge,
        ...(system ? { system } : {}),
        schedule: (run) => (pending.push(run), () => {}),
        epoch: 'E',
        log: vi.fn(),
    });
    const flush = () => pending.splice(0).forEach((run) => run());
    return { published, handle, flush, send: (a: IpcSettingsAction) => onAction(a) };
}

describe('startSettingsSync with system', () => {
    it('publishes the system section and acks a system action after it finished', async () => {
        const h = harness();
        const w = wiring(h.sync);
        w.flush();
        expect(w.published[0].system?.updatesEnabled).toBe(true);
        w.send({ id: 7, type: 'update.check', payload: {} });
        await tick();
        w.flush();
        const last = w.published.at(-1)!;
        expect(last.ack).toBe(7);
        expect(last.system?.update.status).toBe('available');
        w.handle.stop();
    });

    it('without a system handler the section is absent and system actions change nothing', async () => {
        const w = wiring();
        w.flush();
        expect(w.published[0].system).toBeUndefined();
        w.send({ id: 3, type: 'backup.export', payload: { includeSecrets: false } });
        await tick();
        w.flush();
        expect(w.published.at(-1)!.system).toBeUndefined();
        w.handle.stop();
    });
});
