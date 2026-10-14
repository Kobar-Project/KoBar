import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { CHAT_STORE_VERSION, RESTORE_LIMITS, exceedsDepth, validateAppStoreValue, validateChatStoreValue } from '../src/backup/coreValues';
import { CORE_KEYS, OFFICIAL_PLUGIN_ID_LIST, OFFICIAL_PLUGIN_KEYS, classifyBackupKey } from '../src/backup/keyPolicy';
import {
    OWN_BACKUPS_ONLY_WARNING,
    RESTORE_MAX_BYTES,
    compareAppVersions,
    displayText,
    parseBackup,
    type ParseBackupOptions,
    type ParseBackupResult,
} from '../src/backup/parseBackup';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';
import { FULL_BACKUP_MAX_BYTES } from '../electron/lib/fullBackup.cjs';
import { OFFICIAL_PLUGIN_IDS } from '../electron/lib/officialPlugins.cjs';

// T-212: restore step 1 (parse, validate, preview). Synthetic fixtures only; nothing is written anywhere.

const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HOSTILE = fixture('backup/hostile-backup.json');

const INSTALLED = ['todolist-plugin', 'com.kobar.aihub', 'com.thirdparty.notes', 'kobar'];
const OPTIONS: ParseBackupOptions = { installedPluginIds: INSTALLED, currentAppVersion: '1.1.4' };

function expectOk(result: ParseBackupResult) {
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    return result;
}

function skippedReasons(result: ParseBackupResult): Record<string, string> {
    const ok = expectOk(result);
    return Object.fromEntries(ok.preview.skipped.map((s) => [s.key, s.reason]));
}

/** A minimal valid backup around the given localStorage map. */
function backupText(localStorage: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        format: 'kobar-backup',
        schemaVersion: 1,
        createdAt: '2026-10-12T10:00:00.000Z',
        app: { name: 'KoBar', version: '1.1.4' },
        includesSecrets: false,
        secretsWarning: null,
        redactions: { removedKeys: [], redactedFields: [] },
        excluded: [],
        localStorage,
        extensionsConfig: {},
        plugins: [],
        ...extra,
    });
}

const APP_STORE = JSON.stringify({
    state: {
        notes: [{ id: 1, title: 'n', icon: 'FileText', emoji: null, content: 'c' }],
        globalNotes: [{ id: 1, title: 'n', icon: 'FileText', emoji: null, content: 'c' }],
        workspaces: [{ id: 'ws1', name: 'W', isIsolated: true }],
        language: 'en',
    },
    version: KOBAR_STORAGE_VERSION,
});

describe('parseBackup: hostile fixture', () => {
    const result = parseBackup(HOSTILE, OPTIONS);

    it('is accepted, but only for the keys the policy allows', () => {
        const ok = expectOk(result);
        expect(ok.plan.entries.map((e) => e.key)).toEqual([
            'com.thirdparty.notes:data',
            'kobar-storage',
            'kobar_plugin_todos',
            'kobar_plugin_todos_iso_ws1',
        ]);
        expect(ok.plan.entries.find((e) => e.key === 'kobar_plugin_todos_iso_ws1')).toMatchObject({
            category: 'isolated',
            pluginId: 'todolist-plugin',
            workspaceId: 'ws1',
        });
        expect(ok.plan.entries.find((e) => e.key === 'com.thirdparty.notes:data')).toMatchObject({
            category: 'plugin',
            pluginId: 'com.thirdparty.notes',
            value: '{"items":["synthetic"]}',
        });
    });

    it('lists every rejected key with its reason', () => {
        expect(skippedReasons(result)).toEqual({
            setItem: 'junk-key',
            getItem: 'junk-key',
            removeItem: 'junk-key',
            clear: 'junk-key',
            'kobar-chat-storage': 'invalid-core-value',
            kobar_license_key: 'retired-key',
            kobar_force_theme_color: 'invalid-core-value',
            kobar_language: 'invalid-value',
            // Not a known workspace: a shared key, and nobody owns `kobar_plugin_todos_iso_ghost`.
            kobar_plugin_todos_iso_ghost: 'unknown-owner',
            kobar_plugin_events: 'plugin-not-installed',
            'kobar-storage_iso_ws1': 'invalid-isolated-key',
            'kobar-aihub-plugin-storage': 'invalid-value',
            'com.thirdparty.notesextra': 'unknown-owner',
            kobar_evil: 'unknown-owner',
            'random-unknown-key': 'unknown-owner',
            'bad\uFFFDkey': 'invalid-key',
            _iso_ws1: 'unknown-owner',
        });
        const ok = expectOk(result);
        expect(ok.preview.counts.skippedKeys).toBe(17);
        expect(ok.preview.skipped.find((s) => s.key === 'kobar_plugin_events')?.pluginId).toBe('ko-calender-plugin');
    });

    it('strips prototype keys without polluting anything', () => {
        const ok = expectOk(result);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.prototype).not.toHaveProperty('polluted');
        const appStore = JSON.parse(ok.plan.entries.find((e) => e.key === 'kobar-storage')!.value);
        expect(Object.getPrototypeOf(appStore.state)).toBe(Object.prototype);
        expect(Object.keys(appStore.state)).not.toContain('constructor');
        for (const ws of appStore.state.workspaces) expect(Object.getPrototypeOf(ws)).toBe(Object.prototype);
        expect(ok.preview.warnings).toContain('forbidden-keys-stripped');
    });

    it('migrates kobar-storage to the current version and keeps only valid persisted fields', () => {
        const ok = expectOk(result);
        const appStore = JSON.parse(ok.plan.entries.find((e) => e.key === 'kobar-storage')!.value);
        expect(appStore.version).toBe(KOBAR_STORAGE_VERSION);
        expect(appStore.state.setTheme).toBeUndefined();
        expect(appStore.state.theme).toBeUndefined();
        expect(appStore.state.sidebarWidth).toBeUndefined();
        expect(appStore.state.language).toBe('tr');
        expect(appStore.state.workspaces.map((w: { id: string }) => w.id)).toEqual(['ws1', 'ws2']);
        expect(appStore.state.workspaces[1]).toMatchObject({ id: 'ws2', name: 'ws2', isIsolated: false, theme: 'ocean' });
        expect(ok.preview.droppedCoreFields).toEqual(expect.arrayContaining(['theme', 'sidebarWidth', 'workspaces[]']));
        expect(ok.preview.counts).toMatchObject({ notes: 3, workspaces: 2, droppedNotes: 2 });
    });

    it('marks redacted secrets so a restore keeps the local values', () => {
        const ok = expectOk(result);
        expect(ok.plan.keepLocalFields).toEqual([
            { key: 'kobar-storage', path: ['state', 'globalPluginData', 'com.thirdparty.notes', 'apiKey'] },
            { key: 'com.thirdparty.notes:data', path: ['items', '0'] },
        ]);
        // Refused: prototype names, a path that does not exist, the whole value, and paths to objects/arrays.
        expect(ok.preview.counts.droppedKeepLocalFields).toBe(7);
        expect(ok.plan.keepLocalKeys).toEqual(['com.thirdparty.notes:apiKey']);
        expect(ok.preview.counts.redactedTexts).toBe(1);
        expect(ok.preview.warnings).toEqual(expect.arrayContaining(['secrets-kept-local', 'redacted-text']));
    });

    it('keeps enabled flags only for installed plugins and never asks to install anything', () => {
        const ok = expectOk(result);
        expect(ok.plan.extensionsConfig).toEqual({ 'todolist-plugin': true });
        expect(ok.preview.missingPlugins).toEqual([{ id: 'ko-calender-plugin', name: 'KoCalendar', version: '1.0.0' }]);
        expect(ok.preview.counts.pluginsInBackup).toBe(2);
        expect(ok.preview.warnings).toEqual(expect.arrayContaining(['missing-plugins', 'invalid-plugin-list']));
    });

    it('summarizes the backup for the preview', () => {
        const ok = expectOk(result);
        expect(ok.preview.createdAt).toBeNull();
        expect(ok.preview.appVersion).toBe('99.0.0');
        expect(ok.preview.fromNewerApp).toBe(true);
        expect(ok.preview.includesSecrets).toBe(false);
        expect(ok.preview.warnings[0]).toBe(OWN_BACKUPS_ONLY_WARNING);
        expect(ok.preview.warnings).toEqual(expect.arrayContaining(['from-newer-app', 'skipped-keys', 'core-fields-dropped']));
        expect(ok.preview.counts).toMatchObject({ coreKeys: 1, isolatedKeys: 1, pluginKeys: 2, acceptedKeys: 4 });
    });

    it('does not change the fixture text it was given (pure function)', () => {
        expect(parseBackup(HOSTILE, OPTIONS)).toEqual(result);
    });
});

describe('parseBackup: envelope', () => {
    it('rejects input that is not a backup', () => {
        expect(parseBackup(42, OPTIONS)).toEqual({ ok: false, error: 'not-string' });
        expect(parseBackup('{not json', OPTIONS)).toEqual({ ok: false, error: 'invalid-json' });
        expect(parseBackup('[]', OPTIONS)).toEqual({ ok: false, error: 'not-a-backup' });
        expect(parseBackup('{"format":"other"}', OPTIONS)).toEqual({ ok: false, error: 'not-a-backup' });
    });

    it('rejects a newer or unknown schema version', () => {
        const base = JSON.parse(backupText({ 'kobar-storage': APP_STORE }));
        expect(parseBackup(JSON.stringify({ ...base, schemaVersion: 2 }), OPTIONS)).toEqual({ ok: false, error: 'schema-newer' });
        expect(parseBackup(JSON.stringify({ ...base, schemaVersion: 0 }), OPTIONS)).toEqual({ ok: false, error: 'schema-unsupported' });
        expect(parseBackup(JSON.stringify({ ...base, schemaVersion: '1' }), OPTIONS)).toEqual({ ok: false, error: 'schema-unsupported' });
        expect(parseBackup(JSON.stringify({ ...base, schemaVersion: 1.5 }), OPTIONS)).toEqual({ ok: false, error: 'schema-unsupported' });
    });

    it('rejects wrong envelope types', () => {
        const base = JSON.parse(backupText({ 'kobar-storage': APP_STORE }));
        expect(parseBackup(JSON.stringify({ ...base, includesSecrets: 'no' }), OPTIONS)).toEqual({ ok: false, error: 'invalid-envelope' });
        expect(parseBackup(JSON.stringify({ ...base, localStorage: [] }), OPTIONS)).toEqual({ ok: false, error: 'invalid-envelope' });
        expect(parseBackup(JSON.stringify({ ...base, localStorage: 'x' }), OPTIONS)).toEqual({ ok: false, error: 'invalid-envelope' });
    });

    it('refuses a redacted backup without valid redaction records (could blank API keys)', () => {
        const base = JSON.parse(backupText({ 'kobar-storage': APP_STORE }));
        expect(parseBackup(JSON.stringify({ ...base, redactions: undefined }), OPTIONS)).toEqual({
            ok: false,
            error: 'invalid-redactions',
        });
        const badPath = { removedKeys: [], redactedFields: [{ key: 'kobar-storage', path: 'state.x', reason: 'field' }] };
        expect(parseBackup(JSON.stringify({ ...base, redactions: badPath }), OPTIONS)).toEqual({ ok: false, error: 'invalid-redactions' });
        // A backup that includes secrets has nothing blanked: missing records are fine there.
        expect(parseBackup(JSON.stringify({ ...base, includesSecrets: true, redactions: undefined }), OPTIONS).ok).toBe(true);
    });

    it('enforces the file size limit (same bound as the main process)', () => {
        expect(RESTORE_MAX_BYTES).toBe(FULL_BACKUP_MAX_BYTES);
        expect(parseBackup('x'.repeat(RESTORE_MAX_BYTES + 1), OPTIONS)).toEqual({ ok: false, error: 'too-large' });
        // Multi-byte text over the limit in UTF-8 bytes, under it in characters.
        expect(parseBackup('é'.repeat(RESTORE_MAX_BYTES / 2 + 1), OPTIONS)).toEqual({ ok: false, error: 'too-large' });
    });

    it('rejects a kobar-storage from a newer app instead of restoring around it', () => {
        const newer = JSON.stringify({ state: { language: 'en' }, version: KOBAR_STORAGE_VERSION + 1 });
        expect(parseBackup(backupText({ 'kobar-storage': newer }), OPTIONS)).toEqual({ ok: false, error: 'storage-version-newer' });
    });

    it('reports nothing to restore when no key is accepted', () => {
        expect(parseBackup(backupText({ setItem: 'x', unknown: 'y' }), OPTIONS)).toEqual({ ok: false, error: 'nothing-to-restore' });
    });

    it('treats a schema-valid backup without kobar-storage as a partial restore with a warning', () => {
        const ok = expectOk(parseBackup(backupText({ kobar_plugin_todos: '[]' }), OPTIONS));
        expect(ok.preview.warnings).toContain('core-storage-missing');
        expect(ok.plan.entries.map((e) => e.key)).toEqual(['kobar_plugin_todos']);
    });
});

describe('parseBackup: oversized and bomb values', () => {
    it('skips huge keys and oversized values', () => {
        const hugeKey = `com.thirdparty.notes:${'k'.repeat(600)}`;
        const ok = expectOk(
            parseBackup(
                backupText({
                    'kobar-storage': APP_STORE,
                    [hugeKey]: 'x',
                    'com.thirdparty.notes:big': 'v'.repeat(RESTORE_LIMITS.maxValueChars + 1),
                }),
                OPTIONS
            )
        );
        const reasons = Object.fromEntries(ok.preview.skipped.map((s) => [s.key, s.reason]));
        expect(reasons['com.thirdparty.notes:big']).toBe('value-too-large');
        const listedHuge = ok.preview.skipped.find((s) => s.reason === 'invalid-key');
        expect(listedHuge?.key.length).toBeLessThanOrEqual(123);
    });

    it('caps the listed skipped keys and refuses absurd key counts', () => {
        const storage: Record<string, string> = { 'kobar-storage': APP_STORE };
        for (let i = 0; i < 9_000; i++) storage[`junk-${String(i).padStart(5, '0')}`] = 'x';
        const ok = expectOk(parseBackup(backupText(storage), OPTIONS));
        expect(ok.preview.counts.skippedKeys).toBe(9_000);
        expect(ok.preview.skipped).toHaveLength(500);
        for (let i = 9_000; i < 10_000; i++) storage[`junk-${String(i).padStart(5, '0')}`] = 'x';
        expect(parseBackup(backupText(storage), OPTIONS)).toEqual({ ok: false, error: 'too-many-keys' });
    });

    it('rejects nesting bombs in core values without overflowing the stack', () => {
        const bomb = `{"state":{"chats":${'['.repeat(200_000)}${']'.repeat(200_000)}},"version":1}`;
        expect(validateChatStoreValue(bomb).ok).toBe(false);
        const appBomb = `{"state":{"globalPluginData":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}},"version":23}`;
        expect(validateAppStoreValue(appBomb)).toEqual({ ok: false, problem: expect.stringMatching(/too-deep|invalid-json/) });
        const ok = expectOk(parseBackup(backupText({ 'kobar-storage': APP_STORE, 'kobar-chat-storage': bomb }), OPTIONS));
        expect(ok.preview.skipped).toContainEqual({ key: 'kobar-chat-storage', reason: 'invalid-core-value' });
        expect(exceedsDepth({ a: { b: { c: 1 } } }, 2)).toBe(true);
        expect(exceedsDepth({ a: { b: 1 } }, 2)).toBe(false);
    });
});

describe('core value validation', () => {
    it('handles missing, hostile and newer kobar-storage versions', () => {
        expect(validateAppStoreValue('{"state":{"language":"en"}}')).toEqual({ ok: false, problem: 'invalid-version' });
        expect(validateAppStoreValue('{"state":{"language":"en"},"version":"23"}')).toEqual({ ok: false, problem: 'invalid-version' });
        expect(validateAppStoreValue('{"state":{"language":"en"},"version":-1}')).toEqual({ ok: false, problem: 'invalid-version' });
        expect(validateAppStoreValue('{"state":{"language":"en"},"version":1e400}')).toEqual({ ok: false, problem: 'invalid-version' });
        expect(validateAppStoreValue(`{"state":{"language":"en"},"version":${KOBAR_STORAGE_VERSION + 1}}`)).toEqual({
            ok: false,
            problem: 'version-newer',
        });
        expect(validateAppStoreValue('{"state":[],"version":23}')).toEqual({ ok: false, problem: 'invalid-shape' });
        expect(validateAppStoreValue('{"state":{"unknown":1},"version":23}')).toEqual({ ok: false, problem: 'invalid-shape' });
        expect(validateAppStoreValue('"just a string"')).toEqual({ ok: false, problem: 'invalid-shape' });
    });

    it('runs old kobar-storage values through the migration chain', () => {
        const v21 = JSON.parse(fixture('kobar-storage/v21.json'));
        const res = validateAppStoreValue(JSON.stringify(v21));
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const out = JSON.parse(res.value);
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
        expect(out.state).toHaveProperty('toggleWidth');
    });

    it('accepts only the current chat store version with valid chats', () => {
        expect(validateChatStoreValue('{"state":{"chats":[]},"version":2}')).toEqual({ ok: false, problem: 'version-newer' });
        expect(validateChatStoreValue('{"state":{"chats":[]},"version":0}')).toEqual({ ok: false, problem: 'invalid-version' });
        const res = validateChatStoreValue(
            JSON.stringify({
                state: {
                    chats: [
                        { id: 'c1', title: 't', messages: [{ id: 'm', role: 'user', content: 'hi' }], model: 'x', updatedAt: 1 },
                        { id: 'c2', title: 't', messages: [{ id: 'm', role: 'evil', content: 'hi' }], model: 'x', updatedAt: 1 },
                    ],
                    activeChatId: 'c1',
                    setApiKeys: 'not-a-function',
                },
                version: CHAT_STORE_VERSION,
            })
        );
        expect(res).toMatchObject({ ok: true, chats: 1 });
        if (res.ok) expect(Object.keys(JSON.parse(res.value).state).sort()).toEqual(['activeChatId', 'chats']);
    });
});

describe('key policy', () => {
    const installed = new Set(['todolist-plugin', 'com.thirdparty.notes', 'com.thirdparty', 'kobar']);
    const workspaces = new Set(['ws1']);
    const cls = (key: string) => classifyBackupKey(key, installed, workspaces);

    it('accepts core keys, isolated keys of known bases and keys of installed plugins', () => {
        expect(cls('kobar-storage')).toMatchObject({ accepted: true, category: 'core' });
        expect(cls('kobar-chat-storage_iso_ws1')).toMatchObject({ accepted: true, category: 'core', workspaceId: 'ws1' });
        expect(cls('kobar_plugin_todos')).toMatchObject({ accepted: true, pluginId: 'todolist-plugin' });
        expect(classifyBackupKey('com.thirdparty.notes', new Set(['com.thirdparty.notes']), workspaces)).toMatchObject({
            accepted: true,
            category: 'plugin',
            pluginId: 'com.thirdparty.notes',
        });
    });

    it('gives an id-prefixed key to the longest matching plugin id', () => {
        // `com.thirdparty` and `com.thirdparty.notes` both prefix these: the longer id owns them.
        expect(cls('com.thirdparty.notes.x')).toMatchObject({ accepted: true, pluginId: 'com.thirdparty.notes' });
        expect(cls('com.thirdparty.notes')).toMatchObject({ accepted: true, pluginId: 'com.thirdparty.notes' });
        expect(cls('com.thirdparty:x')).toMatchObject({ accepted: true, pluginId: 'com.thirdparty' });
        // A third-party `todolist` never claims keys of the official `todolist-plugin` (not installed here).
        expect(classifyBackupKey('todolist-plugin-extra', new Set(['todolist']), workspaces)).toEqual({
            accepted: false,
            reason: 'plugin-not-installed',
            pluginId: 'todolist-plugin',
        });
        expect(classifyBackupKey('todolist:data', new Set(['todolist']), workspaces)).toMatchObject({
            accepted: true,
            pluginId: 'todolist',
        });
        // `com.kobar` never claims keys of the official `com.kobar.aihub`.
        expect(classifyBackupKey('com.kobar.aihub.state', new Set(['com.kobar']), workspaces)).toEqual({
            accepted: false,
            reason: 'plugin-not-installed',
            pluginId: 'com.kobar.aihub',
        });
        expect(classifyBackupKey('notes-pro:data', new Set(['notes', 'notes-pro']), workspaces)).toMatchObject({
            accepted: true,
            pluginId: 'notes-pro',
        });
        // Plugins listed in the backup (not installed) also count as owners.
        expect(classifyBackupKey('notes-pro:data', new Set(['notes']), workspaces, new Set(['notes-pro']))).toEqual({
            accepted: false,
            reason: 'plugin-not-installed',
            pluginId: 'notes-pro',
        });
        expect(classifyBackupKey('notes:data', new Set(['notes']), workspaces, new Set(['notes-pro']))).toMatchObject({
            accepted: true,
            pluginId: 'notes',
        });
    });

    it('treats a key as isolated only for the exact `<base>_iso_<known workspace>` shape', () => {
        const owner = new Set(['my']);
        // Shared keys that merely contain `_iso_` are classified as a whole.
        expect(classifyBackupKey('my_iso_settings', owner, workspaces)).toEqual({ accepted: true, category: 'plugin', pluginId: 'my' });
        expect(classifyBackupKey('cal_iso_week', new Set(['cal']), workspaces)).toMatchObject({ accepted: true, pluginId: 'cal' });
        // Exact shape with a workspace of the backup: isolated.
        expect(classifyBackupKey('my_iso_settings_iso_ws1', owner, workspaces)).toEqual({
            accepted: true,
            category: 'plugin',
            pluginId: 'my',
            workspaceId: 'ws1',
            baseKey: 'my_iso_settings',
        });
        // Unknown workspace: a shared key under the base rules (accepted when the owner rule passes).
        expect(classifyBackupKey('my_iso_ghost', owner, workspaces)).toEqual({ accepted: true, category: 'plugin', pluginId: 'my' });
        expect(classifyBackupKey('other_iso_ghost', owner, workspaces)).toEqual({ accepted: false, reason: 'unknown-owner' });
        expect(classifyBackupKey('todolist-plugin_iso_ghost', owner, workspaces)).toEqual({
            accepted: false,
            reason: 'plugin-not-installed',
            pluginId: 'todolist-plugin',
        });
    });

    it('rejects reserved-namespace, retired, junk and system isolated keys', () => {
        expect(cls('kobar_custom')).toEqual({ accepted: false, reason: 'unknown-owner' });
        expect(cls('kobar_force_theme_color_iso_ws1')).toMatchObject({ accepted: false, reason: 'invalid-isolated-key' });
        expect(cls('kobar_license_key')).toEqual({ accepted: false, reason: 'retired-key' });
        for (const junk of ['setItem', 'getItem', 'removeItem', 'clear'])
            expect(cls(junk)).toEqual({ accepted: false, reason: 'junk-key' });
        expect(cls('__proto__')).toEqual({ accepted: false, reason: 'forbidden-key' });
        expect(cls('setItem_iso_ws1')).toMatchObject({ accepted: false, reason: 'junk-key' });
    });

    it('lets official plugins claim id-prefixed keys in the reserved namespace', () => {
        const withShortcuts = new Set(['kobar.shortcuts']);
        expect(classifyBackupKey('kobar.shortcuts.layout', withShortcuts, workspaces)).toMatchObject({
            accepted: true,
            pluginId: 'kobar.shortcuts',
        });
        expect(classifyBackupKey('kobar.shortcuts.layout', new Set(), workspaces)).toMatchObject({
            accepted: false,
            reason: 'plugin-not-installed',
            pluginId: 'kobar.shortcuts',
        });
    });

    it('pins the confirmed localStorage keys of the official plugins', () => {
        // Checked against the plugin sources (T-212). Focus Mode, KoPlayer and Pin Window keep no localStorage key.
        expect(OFFICIAL_PLUGIN_KEYS).toEqual({
            'com.kobar.aihub': ['kobar-aihub-plugin-storage'],
            'com.kobar.calculator.plugin': ['kobar_calc_plugin_mode', 'kobar_calc_scientific', 'kobar_exchange_rates'],
            'com.kobar.clipboardmanager': ['kobar-plugin-clipboard-settings'],
            'com.kobar.kobox': ['kobox-plugin-settings'],
            'focus-mode-plugin': [],
            'ko-calender-plugin': ['kobar_plugin_events', 'kobar_plugin_calendar_color'],
            'kobar-colorpicker-plugin': ['kobar-plugin-colorpicker-color', 'kobar-plugin-colorpicker-palettes'],
            'kobar.shortcuts': ['kobar-plugin-shortcuts-data', 'kobar-plugin-shortcuts-settings'],
            'koplayer-plugin': [],
            'pin-window-to-top': [],
            'screenshot-studio-overlay': ['kobar_screenshot_save_path'],
            'snippetvault-plugin': ['kobar-plugin-snippetvault-data', 'kobar-plugin-snippetvault-compact'],
            'todolist-plugin': ['kobar_plugin_todos'],
        });
    });

    it('knows the same official plugin ids as the main process', () => {
        expect([...OFFICIAL_PLUGIN_ID_LIST].sort()).toEqual([...OFFICIAL_PLUGIN_IDS].sort());
    });

    it('has core keys matching the isolation layer system keys', () => {
        const source = readFileSync(new URL('../src/utils/localStorageIsolation.ts', import.meta.url), 'utf8');
        for (const [key, info] of Object.entries(CORE_KEYS)) {
            expect(source.includes(`'${key}'`)).toBe(info.system);
        }
    });
});

describe('keep-local paths and note rules', () => {
    it('rewrites redaction paths to the positions in the value written and drops paths into removed elements', () => {
        const pluginNote = { id: 2, title: 'kept', icon: 'note', emoji: null, content: 'c' };
        const appStore = JSON.stringify({
            state: {
                globalNotes: [{ id: 'bad' }, pluginNote],
                workspaces: [
                    { id: 5 },
                    {
                        id: 'w2',
                        name: 'W2',
                        isIsolated: true,
                        isolatedData: { notes: [{ id: 1, content: 7 }, pluginNote], pluginData: { p: { apiKey: '' } } },
                    },
                ],
            },
            version: KOBAR_STORAGE_VERSION,
        });
        const redactedFields = [
            { key: 'kobar-storage', path: ['state', 'workspaces', '1', 'isolatedData', 'pluginData', 'p', 'apiKey'], reason: 'field' },
            { key: 'kobar-storage', path: ['state', 'workspaces', '1', 'isolatedData', 'notes', '1', 'title'], reason: 'field' },
            { key: 'kobar-storage', path: ['state', 'globalNotes', '1', 'title'], reason: 'field' },
            // Into the dropped workspace / dropped note / a field that does not exist: nothing to keep.
            { key: 'kobar-storage', path: ['state', 'workspaces', '0', 'secret'], reason: 'field' },
            { key: 'kobar-storage', path: ['state', 'globalNotes', '0', 'title'], reason: 'field' },
            { key: 'kobar-storage', path: ['state', 'workspaces', '1', 'missingField'], reason: 'field' },
        ];
        const ok = expectOk(
            parseBackup(backupText({ 'kobar-storage': appStore }, { redactions: { removedKeys: [], redactedFields } }), OPTIONS)
        );
        expect(ok.plan.keepLocalFields).toEqual([
            { key: 'kobar-storage', path: ['state', 'workspaces', '0', 'isolatedData', 'pluginData', 'p', 'apiKey'] },
            { key: 'kobar-storage', path: ['state', 'workspaces', '0', 'isolatedData', 'notes', '0', 'title'] },
            { key: 'kobar-storage', path: ['state', 'globalNotes', '0', 'title'] },
        ]);
        expect(ok.preview.counts.droppedKeepLocalFields).toBe(3);
        const written = JSON.parse(ok.plan.entries[0].value);
        expect(written.state.workspaces[0].isolatedData.pluginData.p.apiKey).toBe('');
    });

    it('maps chat positions and enters nested JSON strings in plugin values', () => {
        const chat = JSON.stringify({
            state: {
                chats: [{ id: 'bad' }, { id: 'c2', title: 't', messages: [], model: 'm', updatedAt: 1 }],
                apiKeys: { openai: '' },
            },
            version: 1,
        });
        const redactedFields = [
            { key: 'kobar-chat-storage', path: ['state', 'chats', '1', 'title'], reason: 'field' },
            { key: 'kobar-chat-storage', path: ['state', 'chats', '0', 'title'], reason: 'field' },
            { key: 'kobar-chat-storage', path: ['state', 'apiKeys', 'openai'], reason: 'field' },
            { key: 'kobar_plugin_todos', path: ['0', 'token'], reason: 'field' },
        ];
        const ok = expectOk(
            parseBackup(
                backupText(
                    { 'kobar-storage': APP_STORE, 'kobar-chat-storage': chat, kobar_plugin_todos: '[{"token":""}]' },
                    { redactions: { removedKeys: [], redactedFields } }
                ),
                OPTIONS
            )
        );
        expect(ok.plan.keepLocalFields).toEqual([
            { key: 'kobar-chat-storage', path: ['state', 'chats', '0', 'title'] },
            { key: 'kobar-chat-storage', path: ['state', 'apiKeys', 'openai'] },
            { key: 'kobar_plugin_todos', path: ['0', 'token'] },
        ]);
        expect(ok.preview.counts.droppedKeepLocalFields).toBe(1);
    });

    it('drops bad notes and reports every defaulted note field (no silent rewrites)', () => {
        const appStore = JSON.stringify({
            state: {
                globalNotes: [
                    { id: 1, icon: 'note', emoji: null, content: 'no title' },
                    { id: 2, title: 't', icon: 5, emoji: 'x', content: 'bad icon', isSettings: 'yes' },
                    { id: 3, title: 't', icon: 'note', emoji: null, content: 42 },
                    { id: 4, title: 't', icon: 'note', emoji: null },
                    { title: 'no id', icon: 'note', emoji: null, content: 'c' },
                ],
            },
            version: KOBAR_STORAGE_VERSION,
        });
        const ok = expectOk(parseBackup(backupText({ 'kobar-storage': appStore }), OPTIONS));
        const notes = JSON.parse(ok.plan.entries[0].value).state.globalNotes;
        expect(notes).toEqual([
            { id: 1, title: '', icon: 'note', emoji: null, content: 'no title' },
            { id: 2, title: 't', icon: 'note', emoji: 'x', content: 'bad icon' },
            { id: 4, title: 't', icon: 'note', emoji: null, content: '' },
        ]);
        expect(ok.preview.counts.droppedNotes).toBe(2);
        expect([...ok.preview.droppedCoreFields].sort()).toEqual([
            'globalNotes[].content',
            'globalNotes[].icon',
            'globalNotes[].isSettings',
            'globalNotes[].title',
        ]);
    });
});

describe('preview text safety and internal errors', () => {
    it('removes bidi controls and zero-width characters from listed keys and plugin names', () => {
        const ok = expectOk(
            parseBackup(
                backupText(
                    { 'kobar-storage': APP_STORE, 'evil\u202Egnp.exe\u200B': 'x' },
                    { plugins: [{ id: 'spoof\u2066-plugin', name: 'Good\uFEFF \u202ATool\u2069', version: '1.0.0\u200F' }] }
                ),
                OPTIONS
            )
        );
        expect(ok.preview.skipped).toContainEqual({ key: 'evilgnp.exe', reason: 'unknown-owner' });
        expect(ok.preview.missingPlugins).toEqual([{ id: 'spoof-plugin', name: 'Good Tool', version: '1.0.0' }]);
    });

    it('also removes other invisible format characters and shows control characters as U+FFFD', () => {
        expect(displayText('a\u00ADb\u061Cc\u2060d\u2064e')).toBe('abcde');
        expect(displayText('x\u0001y\u007Fz\u0085w')).toBe('x\uFFFDy\uFFFDz\uFFFDw');
        const ok = expectOk(parseBackup(backupText({ 'kobar-storage': APP_STORE, 'bad\u0007\u009Bkey': 'x' }), OPTIONS));
        expect(ok.preview.skipped).toContainEqual({ key: 'bad\uFFFD\uFFFDkey', reason: 'invalid-key' });
    });

    it('cuts long listed keys by code point, never inside a surrogate pair', () => {
        const key = 'a' + '\u{1F600}'.repeat(200);
        const ok = expectOk(parseBackup(backupText({ 'kobar-storage': APP_STORE, [key]: 'x' }), OPTIONS));
        const listed = ok.preview.skipped.find((s) => s.key.startsWith('a'))!.key;
        expect(listed).toBe('a' + '\u{1F600}'.repeat(119) + '...');
        expect(listed).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('parses a large backup quickly (owner lookup does not scale with the plugin count)', () => {
        const storage: Record<string, string> = { 'kobar-storage': APP_STORE };
        for (let i = 0; i < 9_990; i++) storage[`com.vendor${i % 50}.plugin:key-${i}`] = 'x';
        const plugins = Array.from({ length: 1000 }, (_, i) => ({ id: `com.vendor${i}.plugin`, name: 'P', version: '1.0.0' }));
        const removedKeys = Array.from({ length: 50_000 }, (_, i) => ({
            key: `com.vendor${i % 1000}.plugin:secret-${i}`,
            reason: 'secret-name',
        }));
        const installed = Array.from({ length: 500 }, (_, i) => `com.vendor${i}.plugin`);
        const text = backupText(storage, { plugins, redactions: { removedKeys, redactedFields: [] } });
        const started = performance.now();
        const ok = expectOk(parseBackup(text, { installedPluginIds: installed, currentAppVersion: '1.1.4' }));
        const elapsed = performance.now() - started;
        expect(ok.preview.counts.pluginKeys).toBe(9_990);
        expect(ok.plan.keepLocalKeys).toHaveLength(25_000);
        expect(elapsed).toBeLessThan(3000);
    });

    it('stays fast for adversarial key shapes (many separators, many _iso_ markers, repeated records)', () => {
        const storage: Record<string, string> = { 'kobar-storage': APP_STORE };
        for (let i = 0; i < 9_999; i++) storage['aa' + '-a'.repeat(249) + i] = 'x';
        const removedKeys = Array.from({ length: 100_000 }, (_, i) => ({
            key: '_iso_'.repeat(101).slice(0, 505) + i,
            reason: 'secret-name',
        }));
        const text = backupText(storage, { redactions: { removedKeys, redactedFields: [] } });
        const started = performance.now();
        const ok = expectOk(parseBackup(text, { installedPluginIds: ['aa'], currentAppVersion: '1.1.4' }));
        const elapsed = performance.now() - started;
        expect(ok.preview.counts.pluginKeys).toBe(9_999);
        expect(elapsed).toBeLessThan(10_000);
    }, 30_000);

    it('handles identical redaction records once and refuses array `length` paths', () => {
        const redactedFields = [
            ...Array.from({ length: 99_000 }, () => ({ key: 'kobar_plugin_todos', path: ['0', 'token'], reason: 'field' })),
            { key: 'kobar_plugin_todos', path: ['length'], reason: 'field' },
            { key: 'kobar_plugin_todos', path: ['0', 'tags', 'length'], reason: 'field' },
        ];
        const ok = expectOk(
            parseBackup(
                backupText(
                    { 'kobar-storage': APP_STORE, kobar_plugin_todos: '[{"token":"","tags":["a"]}]' },
                    { redactions: { removedKeys: [], redactedFields } }
                ),
                OPTIONS
            )
        );
        expect(ok.plan.keepLocalFields).toEqual([{ key: 'kobar_plugin_todos', path: ['0', 'token'] }]);
        expect(ok.preview.counts.droppedKeepLocalFields).toBe(2);
    });

    it('reports an unexpected failure as internal-error instead of throwing', () => {
        const throwing: Iterable<string> = {
            [Symbol.iterator]() {
                throw new Error('boom');
            },
        };
        expect(
            parseBackup(backupText({ 'kobar-storage': APP_STORE }), { installedPluginIds: throwing, currentAppVersion: '1.1.4' })
        ).toEqual({
            ok: false,
            error: 'internal-error',
        });
    });
});

describe('round trip', () => {
    it('accepts a backup built from a synthetic profile', () => {
        const profile = JSON.parse(fixture('profiles/v21/localStorage.json')) as Record<string, string>;
        const backup = buildBackup({
            localStorage: profile,
            extensionsConfig: { 'fake-plugin': true },
            plugins: [{ id: 'fake-plugin', folder: 'fake-plugin', name: 'Fake', version: '1.0.0', enabled: true, githubRepo: '' }],
            appVersion: '1.1.4',
            now: new Date('2026-10-12T10:00:00.000Z'),
        });
        const ok = expectOk(parseBackup(serializeBackup(backup), { installedPluginIds: ['fake-plugin'], currentAppVersion: '1.1.4' }));
        expect(ok.plan.entries.map((e) => [e.key, e.category])).toEqual([
            ['fake-plugin-data', 'plugin'],
            ['fake-plugin-data_iso_ws-focus', 'isolated'],
            ['kobar-chat-storage', 'core'],
            ['kobar-storage', 'core'],
        ]);
        expect(ok.plan.entries.find((e) => e.key === 'fake-plugin-data')?.value).toBe(profile['fake-plugin-data']);
        expect(ok.plan.extensionsConfig).toEqual({ 'fake-plugin': true });
        expect(ok.preview.counts).toMatchObject({ skippedKeys: 0, missingPlugins: 0, chats: 1, workspaces: 2 });
        expect(ok.preview.createdAt).toBe('2026-10-12T10:00:00.000Z');
        expect(ok.preview.fromNewerApp).toBe(false);
        // The synthetic profile has values the app never writes (design 'glass', view mode 'grid', an object instead of a
        // boolean in currentExtensionsConfig): restore drops them, the app then uses its defaults. Since v24 (T-408) the active
        // workspace record gets the top-level profile values before validation, so its copy of 'glass' is dropped too.
        expect([...ok.preview.droppedCoreFields].sort()).toEqual([
            'currentExtensionsConfig',
            'design',
            'settingsFeatureViewMode',
            'workspaces[].design',
        ]);
        expect(ok.preview.warnings).toEqual([OWN_BACKUPS_ONLY_WARNING, 'core-fields-dropped']);
        const appStore = JSON.parse(ok.plan.entries.find((e) => e.key === 'kobar-storage')!.value);
        expect(appStore.version).toBe(KOBAR_STORAGE_VERSION);
        expect(appStore.state.currentExtensionsConfig).toEqual({});
        expect(appStore.state.workspaces[0].isolatedData.notes).toHaveLength(1);
    });

    it('marks blanked API keys of a redacted backup as keep-local', () => {
        const chat = JSON.stringify({ state: { chats: [], apiKeys: { openai: 'plain-fake-value-1', defaultModel: 'm' } }, version: 1 });
        const backup = buildBackup({
            localStorage: { 'kobar-storage': APP_STORE, 'kobar-chat-storage': chat },
            extensionsConfig: {},
            plugins: [],
            appVersion: '1.1.4',
            now: new Date('2026-10-12T10:00:00.000Z'),
        });
        const ok = expectOk(parseBackup(serializeBackup(backup), OPTIONS));
        expect(ok.plan.keepLocalFields).toEqual([{ key: 'kobar-chat-storage', path: ['state', 'apiKeys', 'openai'] }]);
        expect(JSON.parse(ok.plan.entries.find((e) => e.key === 'kobar-chat-storage')!.value).state.apiKeys.openai).toBe('');
    });
});

describe('versions and purity', () => {
    it('compares app versions', () => {
        expect(compareAppVersions('1.2.0', '1.1.9')).toBe(1);
        expect(compareAppVersions('1.1.4', '1.1.4')).toBe(0);
        expect(compareAppVersions('v1.0.0', '1.1.4')).toBe(-1);
        expect(compareAppVersions('dev', '1.1.4')).toBeNull();
    });

    it('restore modules import no I/O, IPC or storage API', () => {
        for (const file of ['parseBackup.ts', 'coreValues.ts', 'keyPolicy.ts']) {
            const source = readFileSync(new URL(`../src/backup/${file}`, import.meta.url), 'utf8');
            expect(source).not.toMatch(/from ['"](?:node:)?fs|require\(|\bwindow\.|ipcRenderer|\.setItem\(|\.removeItem\(|\.clear\(/);
        }
    });

    it('keeps the hostile fixture free of real secrets', () => {
        expect(HOSTILE).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}/);
    });
});
