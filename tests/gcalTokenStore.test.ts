// R2-15: the Google Calendar token store with a fake safeStorage and an in-memory file system. Proves the refresh token is never
// written in plaintext, that connecting is refused without encryption, and that the files are not part of any backup.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GCAL_FLAG_FILE_NAME, GCAL_TOKEN_FILE_NAME, createGcalTokenStore } from '../electron/lib/gcalTokenStore.cjs';

function setup(available = true) {
    const files = new Map<string, string>();
    const cipher = {
        isEncryptionAvailable: () => available,
        // "encryption" that is visibly not plaintext
        encryptString: (plain: string) => Buffer.from(plain.split('').reverse().join('') + '#enc', 'utf8'),
        decryptString: (buf: Buffer) => buf.toString('utf8').replace(/#enc$/, '').split('').reverse().join(''),
    };
    const store = createGcalTokenStore({
        tokenFile: '/ud/google-calendar.json',
        flagFile: '/ud/google-calendar-flag.json',
        cipher,
        fs: {
            readFile: async (p) => {
                const text = files.get(p);
                if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
                return text;
            },
            writeFile: async (p, text) => void files.set(p, text),
            unlink: async (p) => {
                if (!files.delete(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            },
        },
    });
    return { files, store };
}

describe('gcal token store', () => {
    it('writes the refresh token encrypted, never in plaintext, and reads it back', async () => {
        const { files, store } = setup();
        expect(await store.saveRefreshToken('1//secret-refresh-token', 123)).toEqual({ ok: true });
        const text = files.get('/ud/google-calendar.json') ?? '';
        expect(text).not.toContain('secret-refresh-token');
        expect(JSON.parse(text)).toMatchObject({ version: 1, savedAt: 123 });
        expect(await store.hasToken()).toBe(true);
        expect(await store.readRefreshToken()).toBe('1//secret-refresh-token');
    });

    it('refuses to connect when encryption is unavailable and writes nothing', async () => {
        const { files, store } = setup(false);
        expect(store.encryptionAvailable()).toBe(false);
        expect(await store.saveRefreshToken('1//secret', 1)).toEqual({ ok: false, reason: 'encryption-unavailable' });
        expect(files.size).toBe(0);
        expect(await store.readRefreshToken()).toBeNull();
    });

    it('treats a corrupt file as no token and a missing flag as disabled', async () => {
        const { files, store } = setup();
        expect(await store.readEnabled()).toBe(false);
        files.set('/ud/google-calendar.json', '{broken');
        expect(await store.hasToken()).toBe(false);
        expect(await store.readRefreshToken()).toBeNull();
    });

    it('keeps the enabled flag in its own file, so disconnecting does not lose it', async () => {
        const { files, store } = setup();
        await store.writeEnabled(true);
        await store.saveRefreshToken('r', 1);
        expect(await store.clearToken()).toBe(true);
        expect(files.has('/ud/google-calendar.json')).toBe(false);
        expect(await store.readEnabled()).toBe(true);
        expect(await store.clearToken()).toBe(true); // already gone is fine
    });
});

describe('backup exclusion', () => {
    const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

    it('no backup, restore or export source names the Google Calendar files', () => {
        expect(GCAL_TOKEN_FILE_NAME).toBe('google-calendar.json');
        expect(GCAL_FLAG_FILE_NAME).toBe('google-calendar-flag.json');
        const sources = [
            'electron/lib/fullBackup.cts',
            'electron/lib/storageBackup.cts',
            'electron/lib/restoreBackup.cts',
            'electron/main/services/backup.cts',
            'src/backup/buildBackup.ts',
            'src/backup/exportBackup.ts',
            'src/backup/coreValues.ts',
            'src/backup/keyPolicy.ts',
        ];
        for (const file of sources) {
            const text = read(file);
            expect(text, file).not.toMatch(/google-calendar|gcal/i);
        }
    });

    it('the full backup only carries the plugin enabled-flags and plugin metadata (no userData file list)', () => {
        const text = read('electron/lib/fullBackup.cts');
        expect(text).toMatch(
            /interface BackupSources\s*\{\s*extensionsConfig: Record<string, boolean>;\s*plugins: BackupPluginEntry\[\];\s*\}/
        );
    });

    it('the token file is only ever written by the token store, into userData', () => {
        const service = read('electron/main/services/gcal.cts');
        expect(service).toContain("app.getPath('userData')");
        expect(service).not.toMatch(/kobar-data|KoBox|backups/);
    });
});
