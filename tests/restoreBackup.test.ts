import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import {
    PRE_DELETE_KEEP,
    PRE_RESTORE_KEEP,
    createRestoreGate,
    isPreDeleteBackupName,
    isPreRestoreBackupName,
    planPreRestorePrune,
    preRestoreBackupFileName,
    restrictExtensionsConfig,
    writeJsonFileAtomic,
    writePreRestoreBackup,
    type RestoreFs,
} from '../electron/lib/restoreBackup.cjs';

// T-213: main-process side of the restore. Temp directories and synthetic data only, never a real profile.

const valid = JSON.stringify({ format: 'kobar-backup', schemaVersion: 1, includesSecrets: false, localStorage: { a: '1' } });
let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-restore-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('writePreRestoreBackup', () => {
    it('writes a valid backup atomically and keeps only the newest pre-restore backups', () => {
        fs.writeFileSync(path.join(dir, 'kobar-storage.v23.2026-01-01T00-00-00-000Z.json'), '{}');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'foreign');
        for (let i = 0; i < PRE_RESTORE_KEEP + 2; i++) {
            const result = writePreRestoreBackup({ backupsDir: dir, text: valid, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
            expect(result.created).toBe(true);
            expect(fs.readFileSync(result.path!, 'utf8')).toBe(valid);
        }
        const names = fs.readdirSync(dir);
        expect(names.filter(isPreRestoreBackupName)).toHaveLength(PRE_RESTORE_KEEP);
        expect(names).toContain('kobar-storage.v23.2026-01-01T00-00-00-000Z.json');
        expect(names).toContain('notes.txt');
        expect(names.some((name) => name.endsWith('.tmp'))).toBe(false);
    });

    it('never overwrites an existing backup with the same timestamp', () => {
        const now = new Date(Date.UTC(2026, 0, 1));
        const first = writePreRestoreBackup({ backupsDir: dir, text: valid, now });
        const second = writePreRestoreBackup({ backupsDir: dir, text: valid, now });
        expect(first.path).not.toBe(second.path);
        expect(isPreRestoreBackupName(path.basename(second.path!))).toBe(true);
    });

    it.each([[42], ['{oops'], [JSON.stringify({ format: 'other' })]])('rejects invalid input %j without writing', (text) => {
        expect(writePreRestoreBackup({ backupsDir: dir, text }).created).toBe(false);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('leaves no file behind when the rename fails', () => {
        const failing: RestoreFs = {
            ...(fs as unknown as RestoreFs),
            renameSync: () => {
                throw new Error('disk');
            },
        };
        expect(writePreRestoreBackup({ backupsDir: dir, text: valid, fs: failing })).toEqual({ created: false, reason: 'write-failed' });
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('rejects an envelope that includes secrets (or lacks the flag)', () => {
        const withSecrets = JSON.stringify({ ...JSON.parse(valid), includesSecrets: true });
        expect(writePreRestoreBackup({ backupsDir: dir, text: withSecrets })).toEqual({ created: false, reason: 'includes-secrets' });
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('treats a same-millisecond `-n` name as newer when pruning', () => {
        const base = preRestoreBackupFileName(new Date(Date.UTC(2026, 0, 1)));
        const dup1 = base.replace(/\.json$/, '-1.json');
        const dup2 = base.replace(/\.json$/, '-2.json');
        const older = preRestoreBackupFileName(new Date(Date.UTC(2025, 11, 31)));
        expect(planPreRestorePrune([dup2, base, older, dup1], 2)).toEqual([base, older]);
    });

    it('pre-delete backups (T-214) use their own names and never prune pre-restore backups', () => {
        const restore = writePreRestoreBackup({ backupsDir: dir, text: valid, now: new Date(Date.UTC(2026, 0, 1)) });
        for (let i = 0; i < PRE_DELETE_KEEP + 2; i++) {
            const result = writePreRestoreBackup({
                backupsDir: dir,
                text: valid,
                kind: 'pre-delete',
                now: new Date(Date.UTC(2026, 0, 2, 0, 0, i)),
            });
            expect(result.created).toBe(true);
            expect(isPreDeleteBackupName(path.basename(result.path!))).toBe(true);
        }
        const names = fs.readdirSync(dir);
        expect(PRE_DELETE_KEEP).toBe(10);
        expect(names.filter(isPreDeleteBackupName)).toHaveLength(PRE_DELETE_KEEP);
        expect(names.filter(isPreRestoreBackupName)).toHaveLength(1);
        expect(names).toContain(path.basename(restore.path!));
        const withSecrets = JSON.stringify({ ...JSON.parse(valid), includesSecrets: true });
        expect(writePreRestoreBackup({ backupsDir: dir, text: withSecrets, kind: 'pre-delete' }).created).toBe(false);
    });

    it('prunes only its own names', () => {
        const own = [0, 1, 2, 3].map((s) => preRestoreBackupFileName(new Date(Date.UTC(2026, 0, 1, 0, 0, s))));
        expect(planPreRestorePrune([...own, 'kobar-storage.v1.x.json', 'other.json'], 3)).toEqual([own[0]]);
    });
});

describe('restrictExtensionsConfig', () => {
    const installed = ['a', 'b', 'c'];

    it('may disable installed plugins but never enables one and never adds unknown ids', () => {
        const current = { a: true, b: false, gone: true };
        const { config, changed } = restrictExtensionsConfig(current, { a: false, b: true, c: false, x: false, y: true }, installed);
        expect(changed).toBe(true);
        expect(config).toEqual({ a: false, b: false, gone: true, c: false });
    });

    it('reports no change when nothing would be disabled', () => {
        expect(restrictExtensionsConfig({ a: true, b: false }, { a: true, b: false }, installed)).toEqual({
            config: { a: true, b: false },
            changed: false,
        });
        expect(restrictExtensionsConfig({ a: true }, 'junk', installed).changed).toBe(false);
    });

    it('ignores prototype keys', () => {
        const incoming = JSON.parse('{"__proto__": false, "a": false}');
        const { config } = restrictExtensionsConfig({}, incoming, [...installed, '__proto__']);
        expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
        expect(config.a).toBe(false);
    });
});

describe('writeJsonFileAtomic', () => {
    it('replaces the file, and keeps the old content when the write fails', () => {
        const file = path.join(dir, 'extensions-config.json');
        fs.writeFileSync(file, '{"a":true}');
        writeJsonFileAtomic(file, { a: false });
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: false });

        const failing: RestoreFs = {
            ...(fs as unknown as RestoreFs),
            renameSync: () => {
                throw new Error('disk');
            },
        };
        expect(() => writeJsonFileAtomic(file, { a: true }, failing)).toThrow('disk');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: false });
        expect(fs.readdirSync(dir)).toEqual(['extensions-config.json']);
    });
});

describe('createRestoreGate', () => {
    it('opens once after a backup and expires', () => {
        let now = 0;
        const gate = createRestoreGate(1000, () => now);
        expect(gate.consume()).toBe(false);
        gate.markBackup();
        expect(gate.consume()).toBe(true);
        expect(gate.consume()).toBe(false);
        gate.markBackup();
        now = 1001;
        expect(gate.consume()).toBe(false);
    });
});

describe('backup.cts wiring', () => {
    // T-315: the handlers moved to electron/main/services/backup.cts (indented inside registerFullBackupIpc).
    const main = readMainModule('services/backup.cts');
    const handler = (channel: string) => {
        const start = main.indexOf(`ipcMain.handle('${channel}'`);
        expect(start).toBeGreaterThan(-1);
        const end = main.indexOf('\n    });', start);
        expect(end).toBeGreaterThan(start);
        return main.slice(start, end);
    };

    it('accepts both channels only from the main window top frame', () => {
        expect(handler('create-pre-restore-backup')).toContain('isMainWindowTopFrame(event)');
        expect(handler('apply-restore-and-relaunch')).toContain('isMainWindowTopFrame(event)');
    });

    it('pre-delete backup (T-214): main window only, own file names, never opens the restore gate', () => {
        const body = handler('create-pre-delete-backup');
        expect(body).toContain('isMainWindowTopFrame(event)');
        expect(body).toContain("kind: 'pre-delete'");
        expect(body).not.toContain('restoreGate');
    });

    it('requires the pre-restore backup, writes the config by the restore rule, then relaunches', () => {
        const apply = handler('apply-restore-and-relaunch');
        const order = ['restoreGate.consume()', 'restrictExtensionsConfig(', 'writeJsonFileAtomic(', 'app.relaunch()', 'app.quit()'];
        const positions = order.map((needle) => apply.indexOf(needle));
        expect(positions.every((p) => p > -1)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(apply).not.toMatch(/installExtension|toggleExtension|saveExtensionsConfig/);
    });
});
