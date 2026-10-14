import { describe, expect, it } from 'vitest';
import {
    BACKUP_EXCLUDED,
    BACKUP_FORMAT,
    BACKUP_SCHEMA_VERSION,
    SECRETS_WARNING,
    type BackupSnapshot,
    buildBackup,
    serializeBackup,
} from '../src/backup/buildBackup';
import { validateFullBackupText } from '../electron/lib/fullBackup.cjs';

// T-211: the `kobar-backup` schema (version 1). Synthetic fixtures only.

const FAKE_KEY = 'plain-fake-api-key-123';

function snapshot(overrides: Partial<BackupSnapshot> = {}): BackupSnapshot {
    return {
        localStorage: {
            'kobar-storage': JSON.stringify({ state: { notes: [{ id: 1, content: 'hi' }], language: 'tr' }, version: 23 }),
            'kobar-chat-storage': JSON.stringify({ state: { apiKeys: { openai: FAKE_KEY, defaultModel: 'm' } }, version: 1 }),
            kobar_plugin_todos_iso_ws1: '[{"id":1,"text":"x"}]',
            kobar_language: 'tr',
        },
        extensionsConfig: { todo: true, clipboard: false },
        plugins: [{ id: 'todo', folder: 'todo', name: 'ToDo', version: '1.2.0', enabled: true, githubRepo: 'Kobar-Project/ToDo' }],
        appVersion: '1.1.4',
        now: new Date('2026-10-12T10:00:00.000Z'),
        ...overrides,
    };
}

describe('buildBackup', () => {
    it('produces the schema v1 envelope with all localStorage keys, the plugin config and list', () => {
        const backup = buildBackup(snapshot());
        expect(backup.format).toBe(BACKUP_FORMAT);
        expect(backup.format).toBe('kobar-backup');
        expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
        expect(backup.schemaVersion).toBe(1);
        expect(backup.createdAt).toBe('2026-10-12T10:00:00.000Z');
        expect(backup.app).toEqual({ name: 'KoBar', version: '1.1.4' });
        expect(Object.keys(backup.localStorage).sort()).toEqual([
            'kobar-chat-storage',
            'kobar-storage',
            'kobar_language',
            'kobar_plugin_todos_iso_ws1',
        ]);
        expect(backup.localStorage.kobar_plugin_todos_iso_ws1).toBe('[{"id":1,"text":"x"}]');
        expect(backup.extensionsConfig).toEqual({ todo: true, clipboard: false });
        expect(backup.plugins).toEqual(snapshot().plugins);
        expect(backup.excluded).toEqual([...BACKUP_EXCLUDED]);
        expect(backup.excluded).toContain('KoBox');
    });

    it('excludes secrets by default and records what was removed', () => {
        const backup = buildBackup(snapshot());
        expect(backup.includesSecrets).toBe(false);
        expect(backup.secretsWarning).toBeNull();
        expect(serializeBackup(backup)).not.toContain(FAKE_KEY);
        expect(JSON.parse(backup.localStorage['kobar-chat-storage']).state.apiKeys).toEqual({ openai: '', defaultModel: 'm' });
        expect(backup.redactions.redactedFields).toEqual([
            { key: 'kobar-chat-storage', path: ['state', 'apiKeys', 'openai'], reason: 'field' },
        ]);
    });

    it('includes secrets only when explicitly asked, with a warning flag in the file', () => {
        const backup = buildBackup(snapshot(), { includeSecrets: true });
        expect(backup.includesSecrets).toBe(true);
        expect(backup.secretsWarning).toBe(SECRETS_WARNING);
        expect(backup.localStorage['kobar-chat-storage']).toBe(snapshot().localStorage['kobar-chat-storage']);
        expect(backup.redactions).toEqual({ removedKeys: [], redactedFields: [] });
        // Anything but `true` keeps the default.
        expect(buildBackup(snapshot(), { includeSecrets: 'yes' as unknown as boolean }).includesSecrets).toBe(false);
    });

    it('drops non-string localStorage values and non-boolean config values', () => {
        const backup = buildBackup(
            snapshot({
                localStorage: { a: 'x', b: 1 as unknown as string },
                extensionsConfig: { ok: true, bad: 'yes' as unknown as boolean },
            })
        );
        expect(backup.localStorage).toEqual({ a: 'x' });
        expect(backup.extensionsConfig).toEqual({ ok: true });
    });

    it('serializes to a file the main process accepts', () => {
        const text = serializeBackup(buildBackup(snapshot()));
        expect(validateFullBackupText(text)).toEqual({ ok: true });
        expect(JSON.parse(text).format).toBe('kobar-backup');
    });

    it('uses the current time when given an invalid date', () => {
        const backup = buildBackup(snapshot({ now: new Date('invalid') }));
        expect(Number.isFinite(Date.parse(backup.createdAt))).toBe(true);
    });
});
