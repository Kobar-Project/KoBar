// T-412: full backup v2. The backup covers the file store (userData/kobar-data) through the persist storage's
// `kobar-storage` value, never the store's internal entries, keeps the schema v1 envelope, and still reads backups written
// by 1.2.0 (tests/fixtures/backup/app-1.2.0-schema-v1.json, synthetic, generated once with the 1.2.0 builder and frozen).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFullBackupText } from '../electron/lib/fullBackup.cjs';
import { INTERNAL_STORAGE_ENTRIES, STORAGE_KEYS } from '../electron/main/services/storage/layout.cjs';
import {
    BACKUP_EXCLUDED,
    BACKUP_SCHEMA_VERSION,
    FILE_STORE_EXCLUDED_ENTRIES,
    FILE_STORE_KEYS_IN_BACKUP,
    buildBackup,
    serializeBackup,
} from '../src/backup/buildBackup';
import { withAppStoreValue } from '../src/backup/exportBackup';
import { HOST_INTERNAL_KEYS, isCoreKey, isHostInternalKey } from '../src/backup/keyPolicy';
import { parseBackup } from '../src/backup/parseBackup';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';

const OLD_FIXTURE = fileURLToPath(new URL('./fixtures/backup/app-1.2.0-schema-v1.json', import.meta.url));
const oldText = readFileSync(OLD_FIXTURE, 'utf8');
const old = JSON.parse(oldText) as { localStorage: Record<string, string> } & Record<string, unknown>;
const OPTIONS = { installedPluginIds: ['fake-plugin', 'todolist-plugin'], currentAppVersion: '1.3.0' };

type Blob = { state: Record<string, unknown>; version: number };

describe('file store coverage', () => {
    it('carries every file store key and names every internal entry of the store', () => {
        expect([...FILE_STORE_KEYS_IN_BACKUP]).toEqual([...STORAGE_KEYS]);
        expect([...FILE_STORE_EXCLUDED_ENTRIES].sort()).toEqual([...INTERNAL_STORAGE_ENTRIES].sort());
        for (const key of FILE_STORE_KEYS_IN_BACKUP) {
            expect(isCoreKey(key)).toBe(true);
            expect(isHostInternalKey(key)).toBe(false);
        }
        expect(BACKUP_EXCLUDED).toEqual(
            expect.arrayContaining(['KoBox', 'plugin-code', 'automatic-backups', 'file-store-internals', 'encrypted-secrets'])
        );
    });

    it('takes kobar-storage from the persist storage (file store) and never exports host-internal keys', () => {
        const fileValue = JSON.stringify({ state: { notes: [{ id: 1, content: 'from the file' }] }, version: KOBAR_STORAGE_VERSION });
        const snapshot = withAppStoreValue(
            { 'kobar-storage': JSON.stringify({ state: { notes: [] }, version: KOBAR_STORAGE_VERSION }), [HOST_INTERNAL_KEYS[0]]: 'x' },
            fileValue
        );
        const backup = buildBackup({ localStorage: snapshot, extensionsConfig: {}, plugins: [], appVersion: '1.3.0', now: new Date(0) });
        expect(backup.localStorage['kobar-storage']).toBe(fileValue);
        for (const key of HOST_INTERNAL_KEYS) expect(backup.localStorage).not.toHaveProperty(key);
        // No file store value (fallback start from localStorage): localStorage stays as it is.
        expect(withAppStoreValue({ 'kobar-storage': 'local' }, null)).toEqual({ 'kobar-storage': 'local' });
    });
});

describe('backward compatible envelope', () => {
    it('keeps schema version 1 and every field of the 1.2.0 envelope, so 1.2.x still accepts a 1.3.0 backup file', () => {
        const backup = buildBackup({
            localStorage: { kobar_language: 'tr' },
            extensionsConfig: {},
            plugins: [],
            appVersion: '1.3.0',
            now: new Date(0),
        });
        expect(BACKUP_SCHEMA_VERSION).toBe(1);
        expect(backup.schemaVersion).toBe(old.schemaVersion);
        expect(backup.format).toBe(old.format);
        expect(Object.keys(backup).sort()).toEqual(Object.keys(old).sort());
        expect(validateFullBackupText(serializeBackup(backup))).toEqual({ ok: true });
    });
});

describe('reading a 1.2.0 backup (old format)', () => {
    it('is a valid backup for main and has the frozen 1.2.0 shape (kobar-storage v23, no host-internal key)', () => {
        expect(validateFullBackupText(oldText)).toEqual({ ok: true });
        expect(old.app).toEqual({ name: 'KoBar', version: '1.2.0' });
        expect(old.excluded).toEqual(['KoBox', 'plugin-code', 'automatic-backups']);
        expect((JSON.parse(old.localStorage['kobar-storage']) as Blob).version).toBe(23);
        for (const key of HOST_INTERNAL_KEYS) expect(old.localStorage).not.toHaveProperty(key);
    });

    it('parses into a plan that migrates kobar-storage to the current version and keeps notes, workspaces and plugin data', () => {
        const result = parseBackup(oldText, OPTIONS);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { plan, preview } = result;
        const byKey = new Map(plan.entries.map((e) => [e.key, e]));
        expect([...byKey.keys()].sort()).toEqual([
            'fake-plugin-data',
            'fake-plugin-data_iso_ws-iso',
            'kobar-chat-storage',
            'kobar-storage',
            'kobar_language',
            'kobar_plugin_todos',
        ]);
        expect(byKey.get('fake-plugin-data_iso_ws-iso')).toMatchObject({
            category: 'isolated',
            workspaceId: 'ws-iso',
            pluginId: 'fake-plugin',
        });
        expect(byKey.get('kobar_plugin_todos')).toMatchObject({ category: 'plugin', pluginId: 'todolist-plugin' });

        const source = JSON.parse(old.localStorage['kobar-storage']) as Blob;
        const restored = JSON.parse(byKey.get('kobar-storage')!.value) as Blob;
        const migrated = migrateKobarStorage(structuredClone(source.state), source.version) as Record<string, unknown>;
        expect(restored.version).toBe(KOBAR_STORAGE_VERSION);
        expect(restored.state.notes).toStrictEqual(migrated.notes);
        expect(restored.state.globalNotes).toStrictEqual(migrated.globalNotes);
        expect((restored.state.workspaces as { id: string }[]).map((w) => w.id)).toEqual(['ws-iso', 'ws-shared', 'ws-legacy']);
        expect(preview.appVersion).toBe('1.2.0');
        expect(preview.fromNewerApp).toBe(false);
        expect(preview.counts.droppedNotes).toBe(0);
        // The blanked chat API key is kept from this machine on restore, never written as an empty value.
        expect(plan.keepLocalFields).toEqual([{ key: 'kobar-chat-storage', path: ['state', 'apiKeys', 'openai'] }]);
        expect(plan.extensionsConfig).toEqual({ 'fake-plugin': true, 'todolist-plugin': false });
    });

    it('skips a host-internal key injected into an old backup', () => {
        const tampered = JSON.stringify({ ...old, localStorage: { ...old.localStorage, [HOST_INTERNAL_KEYS[0]]: 'local|0|0' } });
        const result = parseBackup(tampered, OPTIONS);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.plan.entries.map((e) => e.key)).not.toContain(HOST_INTERNAL_KEYS[0]);
        expect(result.preview.skipped).toContainEqual({ key: HOST_INTERNAL_KEYS[0], reason: 'host-internal' });
    });
});
