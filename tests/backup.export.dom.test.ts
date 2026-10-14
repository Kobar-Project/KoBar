import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ExportFullBackupDeps, exportFullBackup, snapshotLocalStorage } from '../src/backup/exportBackup';

// T-211: renderer side of the full backup export (localStorage snapshot + hand-off to main). Synthetic data only.

describe('snapshotLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('reads every key through Storage.prototype.getItem on the storage itself (raw keys, no isolation rewrite)', () => {
        localStorage.setItem('kobar-storage', '{"state":{},"version":23}');
        localStorage.setItem('plugin_data', 'shared');
        localStorage.setItem('plugin_data_iso_ws1', 'isolated');
        const spy = vi.spyOn(Storage.prototype, 'getItem');

        expect(snapshotLocalStorage(localStorage)).toEqual({
            'kobar-storage': '{"state":{},"version":23}',
            plugin_data: 'shared',
            plugin_data_iso_ws1: 'isolated',
        });
        expect(spy.mock.calls.map((call) => call[0]).sort()).toEqual(['kobar-storage', 'plugin_data', 'plugin_data_iso_ws1']);
        expect(spy.mock.contexts.every((context) => context === localStorage)).toBe(true);
    });

    it('does not change storage', () => {
        localStorage.setItem('a', '1');
        snapshotLocalStorage(localStorage);
        expect(localStorage.length).toBe(1);
        expect(localStorage.getItem('a')).toBe('1');
    });
});

type SaveResult = { success: boolean; path?: string; reason?: string };

function deps(options: { save?: SaveResult; sourcesFail?: boolean } = {}) {
    const store = new Map<string, string>([
        ['kobar-chat-storage', JSON.stringify({ state: { apiKeys: { openai: 'plain-fake-key-xyz' } }, version: 1 })],
        ['kobar-storage', JSON.stringify({ state: { notes: [] }, version: 23 })],
    ]);
    const storage = {
        get length() {
            return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        getItem: (k: string) => store.get(k) ?? null,
    };
    const save = vi.fn<(text: string) => Promise<SaveResult>>(async () => options.save ?? { success: true, path: 'kobar-backup.json' });
    const flush = vi.fn();
    const deps: ExportFullBackupDeps = {
        api: {
            getBackupSources: async () => {
                if (options.sourcesFail) throw new Error('ipc down');
                return {
                    extensionsConfig: { todo: true },
                    plugins: [{ id: 'todo', folder: 'todo', name: 'ToDo', version: '1.0.0', enabled: true, githubRepo: '' }],
                };
            },
            getAppVersion: async () => '1.1.4',
            saveFullBackup: save,
        },
        storage,
        flush,
        now: () => new Date('2026-10-12T10:00:00.000Z'),
    };
    return { deps, save, flush };
}

describe('exportFullBackup', () => {
    it('flushes, builds a redacted backup and hands the text to main', async () => {
        const d = deps();
        const result = await exportFullBackup({}, d.deps);
        expect(result.success).toBe(true);
        expect(d.flush).toHaveBeenCalledTimes(1);
        expect(d.save).toHaveBeenCalledTimes(1);
        const text = d.save.mock.calls[0][0];
        expect(text).not.toContain('plain-fake-key-xyz');
        const parsed = JSON.parse(text);
        expect(parsed).toMatchObject({
            format: 'kobar-backup',
            schemaVersion: 1,
            includesSecrets: false,
            app: { version: '1.1.4' },
            extensionsConfig: { todo: true },
        });
        expect(Object.keys(parsed.localStorage).sort()).toEqual(['kobar-chat-storage', 'kobar-storage']);
    });

    it('keeps secrets only with includeSecrets', async () => {
        const d = deps();
        await exportFullBackup({ includeSecrets: true }, d.deps);
        const text = d.save.mock.calls[0][0];
        const parsed = JSON.parse(text);
        expect(parsed.includesSecrets).toBe(true);
        expect(typeof parsed.secretsWarning).toBe('string');
        expect(text).toContain('plain-fake-key-xyz');
    });

    it('still redacts for a truthy value other than true', async () => {
        const d = deps();
        await exportFullBackup({ includeSecrets: 'yes' as unknown as boolean }, d.deps);
        const text = d.save.mock.calls[0][0];
        expect(JSON.parse(text).includesSecrets).toBe(false);
        expect(text).not.toContain('plain-fake-key-xyz');
    });

    it('flushes after the async sources arrive, right before reading storage', async () => {
        const order: string[] = [];
        const d = deps();
        const getItem = d.deps.storage.getItem;
        d.deps.flush = () => order.push('flush');
        d.deps.storage = { ...d.deps.storage, length: d.deps.storage.length, getItem: (k: string) => (order.push('read'), getItem(k)) };
        const sources = d.deps.api.getBackupSources;
        d.deps.api = { ...d.deps.api, getBackupSources: () => (order.push('sources'), sources()) };
        await exportFullBackup({}, d.deps);
        expect(order.slice(0, 3)).toEqual(['sources', 'flush', 'read']);
    });

    it('passes through a cancelled dialog and never throws', async () => {
        const cancelled = deps({ save: { success: false, reason: 'canceled' } });
        await expect(exportFullBackup({}, cancelled.deps)).resolves.toEqual({ success: false, reason: 'canceled' });

        const failing = deps({ sourcesFail: true });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(exportFullBackup({}, failing.deps)).resolves.toEqual({ success: false, reason: 'error' });
            expect(failing.save).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});
