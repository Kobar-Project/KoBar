import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    FULL_BACKUP_MAX_BYTES,
    backupPluginEntry,
    collectInstalledPlugins,
    fullBackupFileName,
    sanitizeExtensionsConfig,
    validateFullBackupText,
} from '../electron/lib/fullBackup.cjs';
import { readMainModule } from './helpers/mainSource';

// T-211: main-process helpers of the full backup export. Temp dirs and synthetic data only.

function readRepoFile(relativePath: string): string {
    return fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

const validEnvelope = { format: 'kobar-backup', schemaVersion: 1, includesSecrets: false, localStorage: {} };

describe('validateFullBackupText', () => {
    it('accepts a kobar-backup v1 envelope', () => {
        expect(validateFullBackupText(JSON.stringify(validEnvelope))).toEqual({ ok: true });
    });

    it.each([
        [42, 'not-string'],
        [null, 'not-string'],
        ['{oops', 'not-json'],
        ['[]', 'not-a-backup'],
        ['"text"', 'not-a-backup'],
        [JSON.stringify({ ...validEnvelope, format: 'other' }), 'not-a-backup'],
        [JSON.stringify({ ...validEnvelope, schemaVersion: 2 }), 'not-a-backup'],
        [JSON.stringify({ ...validEnvelope, includesSecrets: 'no' }), 'not-a-backup'],
        [JSON.stringify({ ...validEnvelope, localStorage: [] }), 'not-a-backup'],
    ])('rejects %j (%s)', (input, reason) => {
        expect(validateFullBackupText(input)).toEqual({ ok: false, reason });
    });

    it('rejects text over the size limit before parsing it', () => {
        expect(validateFullBackupText('x'.repeat(FULL_BACKUP_MAX_BYTES + 1))).toEqual({ ok: false, reason: 'too-large' });
    });
});

describe('sanitizeExtensionsConfig', () => {
    it('keeps a __proto__ key as an own entry', () => {
        const out = sanitizeExtensionsConfig(JSON.parse('{"__proto__":true,"a":false}'));
        expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
        expect(JSON.stringify(out)).toBe('{"__proto__":true,"a":false}');
    });

    it('keeps only string -> boolean entries', () => {
        expect(sanitizeExtensionsConfig({ a: true, b: false, c: 'yes', d: 1, '': true, 'bad\nkey': true })).toEqual({ a: true, b: false });
    });

    it.each([null, undefined, [], 'x', 3])('returns {} for %j', (input) => {
        expect(sanitizeExtensionsConfig(input)).toEqual({});
    });
});

describe('backupPluginEntry', () => {
    it('uses the manifest id rule of get-installed-extensions and copies only short strings', () => {
        expect(
            backupPluginEntry(
                'todo-folder',
                { id: 'todo', name: 'ToDo', version: '1.2.0', githubRepo: 'Kobar-Project/ToDo', code: 'x' },
                { todo: false }
            )
        ).toEqual({ id: 'todo', folder: 'todo-folder', name: 'ToDo', version: '1.2.0', enabled: false, githubRepo: 'Kobar-Project/ToDo' });
        expect(backupPluginEntry('f', { id: 7, name: 'x'.repeat(300), githubLink: 'a/b' }, {})).toEqual({
            id: 'f',
            folder: 'f',
            name: 'f',
            version: '1.0.0',
            enabled: true,
            githubRepo: 'a/b',
        });
        expect(backupPluginEntry('f', null, {}).id).toBe('f');
    });
});

describe('collectInstalledPlugins', () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-fullbackup-'));
        fs.mkdirSync(path.join(dir, 'alpha'));
        fs.writeFileSync(path.join(dir, 'alpha', 'manifest.json'), JSON.stringify({ id: 'alpha', name: 'Alpha', version: '2.0.0' }));
        fs.mkdirSync(path.join(dir, 'no-manifest'));
        fs.writeFileSync(path.join(dir, 'loose-file.txt'), 'x');
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const readManifest = (p: string): unknown => {
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
            return null;
        }
    };

    it('lists folders with a manifest, never plugin code', () => {
        const plugins = collectInstalledPlugins(dir, { alpha: false }, readManifest);
        expect(plugins).toEqual([{ id: 'alpha', folder: 'alpha', name: 'Alpha', version: '2.0.0', enabled: false, githubRepo: '' }]);
    });

    it('returns [] for a missing folder and survives a throwing reader', () => {
        expect(collectInstalledPlugins(path.join(dir, 'missing'), {}, readManifest)).toEqual([]);
        const throwing = () => {
            throw new Error('boom');
        };
        expect(collectInstalledPlugins(dir, {}, throwing)).toEqual([]);
    });
});

describe('fullBackupFileName', () => {
    it('is a local-time json name', () => {
        expect(fullBackupFileName(new Date(2026, 9, 12, 9, 5))).toBe('kobar-backup-2026-10-12-0905.json');
        expect(fullBackupFileName(new Date('invalid'))).toMatch(/^kobar-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    });
});

describe('wiring (source level)', () => {
    // T-315: the backup handlers moved to electron/main/services/backup.cts (indented inside registerFullBackupIpc).
    const main = readMainModule('services/backup.cts');
    const preload = readRepoFile('electron/preload.cts');

    it('preload exposes both channels as additive window.api methods', () => {
        expect(preload).toContain("    getBackupSources: () => ipcRenderer.invoke('get-backup-sources'),");
        expect(preload).toContain("    saveFullBackup: (text: string) => ipcRenderer.invoke('save-full-backup', text),");
    });

    it('main checks the sender, validates the text and writes only the dialog path outside app data', () => {
        const start = main.indexOf("ipcMain.handle('save-full-backup'");
        expect(start).toBeGreaterThan(0);
        const end = main.indexOf('\n    });', start);
        expect(end).toBeGreaterThan(start);
        const handler = main.slice(start, end);
        expect(handler).toContain('isMainWindowTopFrame(event)');
        expect(handler).toContain('validateFullBackupText(text)');
        expect(handler).toContain('dialog.showSaveDialog(');
        expect(handler).toContain('isProtectedPath(filePath, getProtectedAppRoots())');
        expect(handler.indexOf('validateFullBackupText')).toBeLessThan(handler.indexOf('showSaveDialog'));
        expect(handler.indexOf('isProtectedPath')).toBeLessThan(handler.indexOf('writeFile('));
        // Atomic write (temp file + rename, temp removed on failure) and the remembered folder (T-037 pattern).
        expect(handler).toMatch(/writeFile\(tempPath,[^)]*flag: 'wx'/);
        expect(handler).toContain('fs.promises.rename(tempPath, filePath)');
        expect(handler).toContain('fs.promises.rm(tempPath');
        expect(handler).toContain("dialogDefaultPath(readDialogPathsFile(dialogPathsFile), 'save-full-backup'");
        expect(handler).toContain("recordDialogPick(dialogPathsFile, 'save-full-backup', filePath)");
        expect(main).toMatch(/ipcMain\.handle\('get-backup-sources', \(event\)[^]*?isMainWindowTopFrame\(event\)/);
    });
});
