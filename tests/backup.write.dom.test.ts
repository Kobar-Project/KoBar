import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { PERSIST_META_KEY, serializeLocalWriteMeta } from '../src/storage/fileBackedStorage';
import { parseBackup, type RestorePlan } from '../src/backup/parseBackup';
import type { RestoreDeps } from '../src/backup/restoreBackup';
import { createDebouncedStorage } from '../src/store/persistStorage';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';

// T-213: restore step 2 (pre-restore backup, write with keep-local secrets, rollback, lock). Synthetic data only;
// jsdom's localStorage, never a real profile.

type Restore = typeof import('../src/backup/restoreBackup');
let mod: Restore;

beforeEach(async () => {
    localStorage.clear();
    // Fresh module per test: a successful restore blocks further restores in the same session.
    vi.resetModules();
    mod = await import('../src/backup/restoreBackup');
});

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

function appStore(workspaces: unknown[], extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ state: { notes: [], globalNotes: [], workspaces, language: 'en', ...extra }, version: KOBAR_STORAGE_VERSION });
}

function workspace(id: string, name: string, apiKey: string) {
    return { id, name, isIsolated: true, isolatedData: { notes: [], pluginData: { p: { apiKey } } } };
}

const chat = (key: string, title: string) =>
    JSON.stringify({
        state: { chats: [{ id: 'c1', title, messages: [], model: 'm', updatedAt: 1 }], apiKeys: { openai: key } },
        version: 1,
    });

/** Plan of a backup made (with default redaction) from `source`. */
function planFrom(source: Record<string, string>, extensionsConfig: Record<string, boolean> = {}, installed: string[] = []): RestorePlan {
    const text = serializeBackup(
        buildBackup({ localStorage: source, extensionsConfig, plugins: [], appVersion: '1.1.4', now: new Date(0) })
    );
    const result = parseBackup(text, { installedPluginIds: installed, currentAppVersion: '1.1.4' });
    if (!result.ok) throw new Error(result.error);
    return result.plan;
}

interface Harness {
    deps: RestoreDeps;
    log: string[];
    persist: ReturnType<typeof createDebouncedStorage>;
    backups: string[];
    applied: Record<string, boolean>[];
    resumed: () => number;
    rewrites: () => number;
}

function harness(options: { backup?: { success: boolean; reason?: string }; apply?: { success: boolean; reason?: string } } = {}): Harness {
    const log: string[] = [];
    const backups: string[] = [];
    const applied: Record<string, boolean>[] = [];
    let resumed = 0;
    let rewrites = 0;
    const persist = createDebouncedStorage(() => localStorage, { delayMs: 10_000, maxWaitMs: 10_000 });
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        log.push(`set:${key}`);
        realSet.call(this, key, value);
    });
    const deps: RestoreDeps = {
        api: {
            getBackupSources: async () => ({ extensionsConfig: { 'todolist-plugin': true }, plugins: [] }),
            getAppVersion: async () => '1.1.4',
            createPreRestoreBackup: async (text: string) => {
                log.push('pre-restore-backup');
                backups.push(text);
                return options.backup ?? { success: true };
            },
            applyRestoreAndRelaunch: async (config: Record<string, boolean>) => {
                log.push('apply');
                applied.push(config);
                return options.apply ?? { success: true };
            },
        },
        storage: localStorage,
        persist,
        pauseChatPersist: () => {
            log.push('pause-chat');
            return () => {
                resumed++;
            };
        },
        rewritePersist: () => {
            rewrites++;
        },
        now: () => new Date(0),
    };
    return { deps, log, persist, backups, applied, resumed: () => resumed, rewrites: () => rewrites };
}

function snapshot(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        out[key] = Storage.prototype.getItem.call(localStorage, key);
    }
    return out;
}

describe('restoreFullBackup: write path', () => {
    it('backs up first, writes the entries, keeps local secrets by id and local keys absent from the backup', async () => {
        // Backup source: workspaces in the order ws1, ws2; different secrets that the redaction blanks.
        const plan = planFrom(
            {
                'kobar-storage': appStore([workspace('ws1', 'One (backup)', 'backup-1'), workspace('ws2', 'Two (backup)', 'backup-2')]),
                'kobar-chat-storage': chat('backup-openai', 'from backup'),
                kobar_plugin_todos: '[{"id":1,"text":"backup todo"}]',
            },
            { 'todolist-plugin': false },
            ['todolist-plugin']
        );
        expect(plan.keepLocalFields.length).toBeGreaterThanOrEqual(3);
        // Local data: the same workspaces in the opposite order with the user's current secrets.
        localStorage.setItem('kobar-storage', appStore([workspace('ws2', 'Two', 'local-2'), workspace('ws1', 'One', 'local-1')]));
        localStorage.setItem('kobar-chat-storage', chat('local-openai', 'local'));
        localStorage.setItem('only-local', 'kept');
        const h = harness();

        const result = await mod.restoreFullBackup(plan, h.deps);

        expect(result).toEqual({ success: true });
        // Order: pre-restore backup, then the writes, then main's apply + relaunch.
        const firstSet = h.log.findIndex((entry) => entry.startsWith('set:'));
        expect(h.log.indexOf('pre-restore-backup')).toBeGreaterThan(-1);
        expect(h.log.indexOf('pre-restore-backup')).toBeLessThan(firstSet);
        expect(h.log[h.log.length - 1]).toBe('apply');
        // The pre-restore backup holds the old data without secrets.
        const pre = JSON.parse(h.backups[0]);
        expect(pre.includesSecrets).toBe(false);
        expect(pre.localStorage['only-local']).toBe('kept');
        expect(h.backups[0]).not.toContain('local-openai');
        expect(h.backups[0]).not.toContain('local-1');

        const written = JSON.parse(localStorage.getItem('kobar-storage')!);
        expect(written.state.workspaces.map((w: { name: string }) => w.name)).toEqual(['One (backup)', 'Two (backup)']);
        expect(written.state.workspaces[0].isolatedData.pluginData.p.apiKey).toBe('local-1');
        expect(written.state.workspaces[1].isolatedData.pluginData.p.apiKey).toBe('local-2');
        const writtenChat = JSON.parse(localStorage.getItem('kobar-chat-storage')!);
        expect(writtenChat.state.apiKeys.openai).toBe('local-openai');
        expect(writtenChat.state.chats[0].title).toBe('from backup');
        expect(localStorage.getItem('kobar_plugin_todos')).toBe('[{"id":1,"text":"backup todo"}]');
        expect(localStorage.getItem('only-local')).toBe('kept');
        expect(h.applied).toEqual([{ 'todolist-plugin': false }]);
    });

    it('never overwrites a non-empty local secret with the blank left by the redaction (T-158c)', async () => {
        // Backup: a plugin value whose `apiKey` field is blanked, a secret-named plugin key that is dropped entirely and
        // a chat store whose key is blanked.
        const plan = planFrom(
            {
                'kobar-storage': appStore([]),
                'kobar-chat-storage': chat('backup-openai', 'from backup'),
                kobar_plugin_todos: '[{"id":7,"text":"backup todo","apiKey":"backup-key"}]',
                kobar_plugin_events: JSON.stringify({ apiKey: 'backup-events-key', note: 'backup' }),
                'todolist-plugin_api_key': 'backup-removed-key',
            },
            {},
            ['todolist-plugin', 'ko-calender-plugin']
        );
        // The redaction really blanked the field in the plan (the blank is what could overwrite the local key).
        expect(JSON.parse(plan.entries.find((e) => e.key === 'kobar_plugin_todos')!.value)[0].apiKey).toBe('');
        expect(plan.entries.some((e) => e.key === 'todolist-plugin_api_key')).toBe(false);
        localStorage.setItem('kobar-chat-storage', chat('local-openai', 'local'));
        localStorage.setItem('kobar_plugin_todos', '[{"id":7,"text":"local todo","apiKey":"local-key"}]');
        localStorage.setItem('kobar_plugin_events', JSON.stringify({ apiKey: '', note: 'local' }));
        localStorage.setItem('todolist-plugin_api_key', 'local-removed-key');
        const h = harness();

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

        expect(JSON.parse(localStorage.getItem('kobar-chat-storage')!).state.apiKeys.openai).toBe('local-openai');
        const todos = JSON.parse(localStorage.getItem('kobar_plugin_todos')!);
        expect(todos[0].apiKey).toBe('local-key');
        expect(todos[0].text).toBe('backup todo');
        // An empty local key stays empty (nothing to keep), the rest comes from the backup.
        expect(JSON.parse(localStorage.getItem('kobar_plugin_events')!)).toEqual({ apiKey: '', note: 'backup' });
        // A key dropped by the redaction is not written at all, so the local value stays.
        expect(localStorage.getItem('todolist-plugin_api_key')).toBe('local-removed-key');
    });

    // T-159: a crafted backup must not make the restore write a local key next to someone else's endpoint.
    describe('endpoint guard for local secrets', () => {
        const KEY = 'aihub-plugin-storage-key-placeholder';
        const aihub = (apiKey: string, baseUrl: string) =>
            JSON.stringify({ state: { providers: { custom: { apiKey, baseUrl, model: 'm' } } }, version: 1 });
        const AIHUB = 'kobar-aihub-plugin-storage';

        it('writes the backup value and keeps the key blank when the endpoint differs', async () => {
            const plan = planFrom(
                { 'kobar-storage': appStore([]), [AIHUB]: aihub('backup-key-1', 'https://evil.example.invalid/v1') },
                {},
                ['com.kobar.aihub']
            );
            expect(plan.keepLocalFields).toEqual([{ key: AIHUB, path: ['state', 'providers', 'custom', 'apiKey'] }]);
            localStorage.setItem(AIHUB, aihub(KEY, 'https://api.example.test/v1'));
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            const written = JSON.parse(localStorage.getItem(AIHUB)!);
            expect(written.state.providers.custom).toEqual({ apiKey: '', baseUrl: 'https://evil.example.invalid/v1', model: 'm' });
            // Nothing of the local key was written anywhere by the restore.
            for (let i = 0; i < localStorage.length; i++) {
                expect(Storage.prototype.getItem.call(localStorage, localStorage.key(i)!)).not.toContain(KEY);
            }
        });

        it('carries the key over when the endpoint is the same (after normalization)', async () => {
            const plan = planFrom({ 'kobar-storage': appStore([]), [AIHUB]: aihub('backup-key-1', 'https://api.example.test/v1/') }, {}, [
                'com.kobar.aihub',
            ]);
            localStorage.setItem(AIHUB, aihub(KEY, 'https://API.example.test/v1'));
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            expect(JSON.parse(localStorage.getItem(AIHUB)!).state.providers.custom.apiKey).toBe(KEY);
        });

        // T-161: the endpoint may live in another branch than the key, outside a nested JSON string, or in a separate key.
        it('blocks the key when the endpoint is in another branch of the same record', async () => {
            const shape = (apiKey: string, baseUrl: string) => JSON.stringify({ provider: { baseUrl }, auth: { apiKey } });
            const plan = planFrom(
                { 'kobar-storage': appStore([]), [AIHUB]: shape('backup-key-1', 'https://evil.example.invalid/v1') },
                {},
                ['com.kobar.aihub']
            );
            localStorage.setItem(AIHUB, shape(KEY, 'https://api.example.test/v1'));
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            expect(JSON.parse(localStorage.getItem(AIHUB)!)).toEqual({
                provider: { baseUrl: 'https://evil.example.invalid/v1' },
                auth: { apiKey: '' },
            });
        });

        it('blocks the key inside a nested JSON string when the endpoint is outside it', async () => {
            const shape = (apiKey: string, baseUrl: string) => JSON.stringify({ baseUrl, inner: JSON.stringify({ apiKey }) });
            const plan = planFrom(
                { 'kobar-storage': appStore([]), [AIHUB]: shape('backup-key-1', 'https://evil.example.invalid/v1') },
                {},
                ['com.kobar.aihub']
            );
            localStorage.setItem(AIHUB, shape(KEY, 'https://api.example.test/v1'));
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            const written = JSON.parse(localStorage.getItem(AIHUB)!);
            expect(JSON.parse(written.inner).apiKey).toBe('');
            expect(localStorage.getItem(AIHUB)).not.toContain(KEY);
        });

        it('does not write an endpoint key that would sit next to a secret key kept from the local data', async () => {
            const SECRET = 'todolist-plugin_api_key';
            const ENDPOINT = 'todolist-plugin_base_url';
            const plan = planFrom(
                {
                    'kobar-storage': appStore([]),
                    [SECRET]: 'backup-removed-key',
                    [ENDPOINT]: 'https://evil.example.invalid/v1',
                    kobar_plugin_todos: '[{"id":1,"text":"backup todo"}]',
                },
                {},
                ['todolist-plugin']
            );
            expect(plan.keepLocalKeys).toEqual([SECRET]);
            expect(plan.entries.some((e) => e.key === ENDPOINT)).toBe(true);
            localStorage.setItem(SECRET, KEY);
            localStorage.setItem(ENDPOINT, 'https://api.example.test/v1');
            localStorage.setItem('only-local', 'kept');
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            // The local endpoint stays with the local key; nothing is deleted; the other keys are restored as usual.
            expect(localStorage.getItem(ENDPOINT)).toBe('https://api.example.test/v1');
            expect(localStorage.getItem(SECRET)).toBe(KEY);
            expect(localStorage.getItem('only-local')).toBe('kept');
            expect(localStorage.getItem('kobar_plugin_todos')).toBe('[{"id":1,"text":"backup todo"}]');
            expect(h.log).not.toContain(`set:${ENDPOINT}`);
        });

        it('writes the endpoint key as usual when it is the same, even with a local secret key', async () => {
            const SECRET = 'todolist-plugin_api_key';
            const ENDPOINT = 'todolist-plugin_base_url';
            localStorage.setItem(SECRET, KEY);
            localStorage.setItem(ENDPOINT, 'https://api.example.test/v1');
            const plan = planFrom(
                { 'kobar-storage': appStore([]), [SECRET]: 'backup-removed-key', [ENDPOINT]: 'https://api.example.test/v1/' },
                {},
                ['todolist-plugin']
            );

            expect(await mod.restoreFullBackup(plan, harness().deps)).toEqual({ success: true });

            expect(localStorage.getItem(ENDPOINT)).toBe('https://api.example.test/v1/');
            expect(localStorage.getItem(SECRET)).toBe(KEY);
        });

        it('writes a different endpoint key when there is no local secret to protect (fresh install)', async () => {
            const ENDPOINT = 'todolist-plugin_base_url';
            const plan = planFrom(
                {
                    'kobar-storage': appStore([]),
                    'todolist-plugin_api_key': 'backup-removed-key',
                    [ENDPOINT]: 'https://other.example.test/v1',
                },
                {},
                ['todolist-plugin']
            );

            expect(await mod.restoreFullBackup(plan, harness().deps)).toEqual({ success: true });

            expect(localStorage.getItem(ENDPOINT)).toBe('https://other.example.test/v1');
        });

        it('keeps the chat store key although its local URL differs (cloud keys only go to fixed hosts)', async () => {
            const chatWith = (key: string, localUrl: string) =>
                JSON.stringify({ state: { chats: [], apiKeys: { openai: key, localUrl } }, version: 1 });
            const plan = planFrom({ 'kobar-storage': appStore([]), 'kobar-chat-storage': chatWith('backup-key', 'http://localhost:1234') });
            localStorage.setItem('kobar-chat-storage', chatWith(KEY, 'http://localhost:11434'));
            const h = harness();

            expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

            const written = JSON.parse(localStorage.getItem('kobar-chat-storage')!);
            expect(written.state.apiKeys).toEqual({ openai: KEY, localUrl: 'http://localhost:1234' });
        });
    });

    it('cancels the pending debounced write and keeps persist locked until the relaunch', async () => {
        const plan = planFrom({ kobar_language: 'tr' });
        const h = harness();
        h.persist.setItem('kobar-storage', 'pending-edit');
        h.deps.api.createPreRestoreBackup = async (text: string) => {
            h.backups.push(text);
            // An edit while the restore runs must never reach storage.
            h.persist.setItem('kobar-storage', 'late-edit');
            return { success: true };
        };

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

        // The pending value was flushed into the pre-restore backup, the late edit was dropped.
        expect(JSON.parse(h.backups[0]).localStorage['kobar-storage']).toBe('pending-edit');
        h.persist.flush();
        expect(localStorage.getItem('kobar-storage')).toBe('pending-edit');
        expect(h.persist.isLocked()).toBe(true);
        expect(h.persist.lockReason()).toBe(mod.RESTORE_LOCK_REASON);
        expect(h.rewrites()).toBe(0);
        expect(h.log).toContain('pause-chat');
        expect(h.resumed()).toBe(0);
        // A second restore in the same session is refused.
        expect(await mod.restoreFullBackup(plan, h.deps)).toMatchObject({ success: false, reason: 'busy' });
    });

    it('never writes a host-internal key from a plan, even a hand-made one; the marker is its own (T-412)', async () => {
        const value = appStore([]);
        const plan: RestorePlan = {
            entries: [
                { key: 'kobar-storage', value, category: 'core' },
                { key: PERSIST_META_KEY, value: 'from-the-plan', category: 'core' },
            ],
            keepLocalFields: [],
            keepLocalKeys: [],
            extensionsConfig: {},
        };
        const h = harness();

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

        expect(localStorage.getItem('kobar-storage')).toBe(value);
        expect(localStorage.getItem(PERSIST_META_KEY)).toBe(serializeLocalWriteMeta(value, 0));
        expect(h.log.filter((entry) => entry === `set:${PERSIST_META_KEY}`)).toHaveLength(1);
    });

    it('restores a 1.2.0 backup (old format): current version, plugin data, local chat API key kept (T-412)', async () => {
        const text = readFileSync(resolve(__dirname, 'fixtures/backup/app-1.2.0-schema-v1.json'), 'utf8');
        const parsed = parseBackup(text, { installedPluginIds: ['fake-plugin', 'todolist-plugin'], currentAppVersion: '1.3.0' });
        if (!parsed.ok) throw new Error(parsed.error);
        localStorage.setItem('kobar-chat-storage', chat('local-openai', 'local'));
        const h = harness();

        expect(await mod.restoreFullBackup(parsed.plan, h.deps)).toEqual({ success: true });

        expect(JSON.parse(localStorage.getItem('kobar-storage')!).version).toBe(KOBAR_STORAGE_VERSION);
        expect(localStorage.getItem('fake-plugin-data_iso_ws-iso')).toBe('{"hello":"isolated synthetic"}');
        expect(localStorage.getItem('kobar_plugin_todos')).toBe('[{"id":1,"text":"synthetic todo","done":false}]');
        const writtenChat = JSON.parse(localStorage.getItem('kobar-chat-storage')!);
        expect(writtenChat.state.apiKeys.openai).toBe('local-openai');
        expect(writtenChat.state.chats[0].title).toBe('Synthetic chat');
        expect(h.applied).toEqual([{ 'fake-plugin': true, 'todolist-plugin': false }]);
    });

    it('a hand-made plan cannot enable a plugin through a workspace record; checked against the state at write time (T-415)', async () => {
        const value = appStore([{ id: 'ws1', name: 'One', isIsolated: false, enabledExtensions: { on: true, off: true, gone: true } }], {
            currentExtensionsConfig: { off: true },
            defaultExtensionsConfig: { off: true },
        });
        const plan: RestorePlan = {
            entries: [{ key: 'kobar-storage', value, category: 'core' }],
            keepLocalFields: [],
            keepLocalKeys: [],
            extensionsConfig: {},
        };
        const h = harness();
        h.deps.api.getBackupSources = async () => ({
            extensionsConfig: { on: true, off: false },
            plugins: [
                { id: 'on', folder: 'on', name: 'On', version: '1.0.0', enabled: true, githubRepo: '' },
                { id: 'off', folder: 'off', name: 'Off', version: '1.0.0', enabled: false, githubRepo: '' },
            ],
        });

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: true });

        const written = JSON.parse(localStorage.getItem('kobar-storage')!).state;
        expect(written.workspaces[0].enabledExtensions).toEqual({ on: true });
        expect(written.currentExtensionsConfig).toEqual({});
        expect(written.defaultExtensionsConfig).toEqual({});
        // The marker belongs to the value that was actually written.
        expect(localStorage.getItem(PERSIST_META_KEY)).toBe(serializeLocalWriteMeta(localStorage.getItem('kobar-storage')!, 0));
    });
});

describe('restoreFullBackup: failures leave data untouched', () => {
    const source = { kobar_language: 'tr', kobar_onboarding_completed: 'true', 'kobar-chat-storage': chat('', 'b') };

    it('writes nothing when the pre-restore backup fails, and unlocks', async () => {
        const plan = planFrom(source);
        localStorage.setItem('kobar_language', 'en');
        const before = snapshot();
        const h = harness({ backup: { success: false, reason: 'write-failed' } });

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({
            success: false,
            reason: 'backup-failed',
            detail: 'write-failed',
            rolledBack: true,
        });
        expect(snapshot()).toEqual(before);
        expect(h.log).not.toContain('apply');
        expect(h.persist.isLocked()).toBe(false);
        expect(h.resumed()).toBe(1);
        // Edits dropped by the lock are written once after the unlock.
        expect(h.rewrites()).toBe(1);
    });

    it('rolls back every written key when a write fails midway', async () => {
        const plan = planFrom(source);
        localStorage.setItem('kobar_language', 'en');
        localStorage.setItem('kobar-chat-storage', chat('local', 'local'));
        const before = snapshot();
        const realSet = Storage.prototype.setItem;
        const h = harness();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === 'kobar_onboarding_completed' && value === 'true') throw new DOMException('full', 'QuotaExceededError');
            realSet.call(this, key, value);
        });

        expect(await mod.restoreFullBackup(plan, h.deps)).toEqual({ success: false, reason: 'write-failed', rolledBack: true });
        expect(snapshot()).toEqual(before);
        expect(h.log).not.toContain('apply');
        expect(h.persist.isLocked()).toBe(false);
    });

    it('rolls back when main cannot apply, and restores an earlier lock', async () => {
        const plan = planFrom(source);
        localStorage.setItem('kobar_language', 'en');
        const before = snapshot();
        const h = harness({ apply: { success: false, reason: 'config-write-failed' } });
        h.persist.lockWrites('hydration-failed');

        expect(await mod.restoreFullBackup(plan, h.deps)).toMatchObject({ success: false, reason: 'apply-failed', rolledBack: true });
        expect(snapshot()).toEqual(before);
        expect(h.persist.lockReason()).toBe('hydration-failed');
        // Still locked: no rewrite of the (unhydrated) state.
        expect(h.rewrites()).toBe(0);
    });
});

describe('applyKeepLocalFields', () => {
    it('matches objects by id, never takes the secret of an object without id', () => {
        const written = JSON.stringify({ list: [{ id: 2, key: '' }, { key: '' }] });
        const local = JSON.stringify({ list: [{ key: 'other' }, { id: 2, key: 'mine' }] });
        const out = JSON.parse(
            mod.applyKeepLocalFields(written, local, [
                ['list', '0', 'key'],
                ['list', '1', 'key'],
            ])
        );
        expect(out.list).toEqual([{ id: 2, key: 'mine' }, { key: '' }]);
    });

    it('fills a numeric PIN, enters nested JSON strings and never replaces a non-blank value', () => {
        const written = JSON.stringify({ pin: null, inner: JSON.stringify({ token: '' }), name: 'backup' });
        const local = JSON.stringify({ pin: 1234, inner: JSON.stringify({ token: 'local-token' }), name: 'local' });
        const out = JSON.parse(mod.applyKeepLocalFields(written, local, [['pin'], ['inner', 'token'], ['name']]));
        expect(out.pin).toBe(1234);
        expect(JSON.parse(out.inner).token).toBe('local-token');
        expect(out.name).toBe('backup');
    });

    it('returns the written value unchanged without a usable local value', () => {
        const written = '{"a":""}';
        expect(mod.applyKeepLocalFields(written, null, [['a']])).toBe(written);
        expect(mod.applyKeepLocalFields(written, 'not json', [['a']])).toBe(written);
        expect(mod.applyKeepLocalFields(written, '{"a":{"x":1}}', [['a']])).toBe(written);
        expect(mod.applyKeepLocalFields(written, '{"__proto__":{"a":"x"}}', [['a']])).toBe(written);
    });
});

describe('pauseChatPersist (production)', () => {
    it('stops chat store writes while paused and writes the current state again on resume', async () => {
        const { useChatStore } = await import('../src/store/useChatStore');
        localStorage.setItem('kobar-chat-storage', 'restored-value');
        const resume = mod.pauseChatPersist();
        useChatStore.setState({ chats: [] });
        useChatStore.setState({});
        expect(localStorage.getItem('kobar-chat-storage')).toBe('restored-value');

        resume();
        const written = JSON.parse(localStorage.getItem('kobar-chat-storage')!);
        expect(written.version).toBe(1);
        expect(written.state.chats).toEqual([]);
    });
});
