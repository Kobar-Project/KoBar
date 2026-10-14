import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    DIALOG_PATHS_FILE_MAX_BYTES,
    DIALOG_PATHS_FILE_NAME,
    DIALOG_PATH_MAX_LENGTH,
    dialogDefaultPath,
    isValidDialogDir,
    readDialogPathsFile,
    recordDialogPick,
    rememberDialogDir,
    screenshotDialogDefaultPath,
    validateDialogPaths,
    writeDialogPathsFileAtomic,
} from '../electron/lib/dialogPaths.cjs';

let dir = '';
let n = 0;
const nextFile = () => path.join(dir, `case-${++n}`, DIALOG_PATHS_FILE_NAME);
const ensureParent = (file: string) => fs.mkdirSync(path.dirname(file), { recursive: true });

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-dialogpaths-'));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('isValidDialogDir / validateDialogPaths', () => {
    it('accepts plain absolute paths up to the length limit', () => {
        expect(isValidDialogDir(dir)).toBe(true);
        const long = path.join(dir, 'a'.repeat(Math.max(1, DIALOG_PATH_MAX_LENGTH - dir.length - 1)));
        expect(long.length).toBeLessThanOrEqual(DIALOG_PATH_MAX_LENGTH);
        expect(isValidDialogDir(long)).toBe(true);
        expect(isValidDialogDir(path.join(dir, 'a'.repeat(DIALOG_PATH_MAX_LENGTH)))).toBe(false);
    });

    it('rejects relative paths, non-strings and control characters', () => {
        for (const v of [
            '',
            'relative/dir',
            './x',
            42,
            null,
            undefined,
            {},
            [],
            `${dir}${String.fromCharCode(10)}x`,
            `${dir}${String.fromCharCode(0)}`,
        ]) {
            expect(isValidDialogDir(v)).toBe(false);
        }
    });

    it('rejects Windows device and alternate data stream paths', () => {
        expect(isValidDialogDir(String.raw`\\.\PhysicalDrive0`, 'win32')).toBe(false);
        expect(isValidDialogDir(String.raw`C:\folder:stream`, 'win32')).toBe(false);
    });

    it('rejects UNC / network roots (a stat on an offline share can block main)', () => {
        for (const v of [String.raw`\\server\share`, String.raw`\\server\share\dir`, '//server/share', String.raw`\/server\share`]) {
            expect(isValidDialogDir(v, 'win32')).toBe(false);
        }
        expect(validateDialogPaths({ 'install-zip': String.raw`\\server\share\dir` })).toEqual({});
    });

    it('keeps only known kinds with valid folders', () => {
        expect(validateDialogPaths({ 'save-note-text': dir, 'install-zip': 'relative', other: dir })).toEqual({
            'save-note-text': dir,
        });
        for (const v of [null, undefined, 'x', 1, [dir], true]) expect(validateDialogPaths(v)).toEqual({});
    });
});

describe('rememberDialogDir / dialogDefaultPath', () => {
    it('remembers valid folders without mutating the input', () => {
        const start = {};
        const next = rememberDialogDir(start, 'install-zip', dir);
        expect(next).toEqual({ 'install-zip': dir });
        expect(start).toEqual({});
        expect(rememberDialogDir(next, 'install-zip', 'relative')).toEqual({ 'install-zip': dir });
    });

    it('joins the remembered folder with the file name when it still exists', async () => {
        const paths = { 'save-note-text': dir };
        expect(await dialogDefaultPath(paths, 'save-note-text', 'note.txt')).toBe(path.join(dir, 'note.txt'));
        expect(await dialogDefaultPath({ 'install-zip': dir }, 'install-zip')).toBe(dir);
    });

    it('falls back to the bare file name when nothing usable is remembered', async () => {
        expect(await dialogDefaultPath({}, 'save-note-text', 'note.txt')).toBe('note.txt');
        expect(await dialogDefaultPath({}, 'install-zip')).toBeUndefined();
        const gone = path.join(dir, 'does-not-exist');
        expect(await dialogDefaultPath({ 'save-note-text': gone }, 'save-note-text', 'note.txt')).toBe('note.txt');
        expect(await dialogDefaultPath({ 'save-note-text': dir }, 'save-note-text', 'note.txt', async () => false)).toBe('note.txt');
    });

    it('uses the injected async checker and never rejects when it fails', async () => {
        const seen: string[] = [];
        const check = async (p: string) => {
            seen.push(p);
            return true;
        };
        expect(await dialogDefaultPath({ 'install-zip': dir }, 'install-zip', undefined, check)).toBe(dir);
        expect(seen).toEqual([dir]);
        const failing = async () => {
            throw new Error('boom');
        };
        expect(await dialogDefaultPath({ 'install-zip': dir }, 'install-zip', 'a.zip', failing)).toBe('a.zip');
    });

    it('never checks an invalid (e.g. UNC) folder from a tampered map', async () => {
        let called = false;
        const check = async () => {
            called = true;
            return true;
        };
        const unc = String.raw`\\server\share\dir`;
        expect(await dialogDefaultPath({ 'install-zip': unc } as never, 'install-zip', undefined, check)).toBeUndefined();
        expect(called).toBe(false);
    });
});

describe('dialog-paths.json file helpers', () => {
    it('yields {} for a missing, corrupt, oversized or non-object file', () => {
        const file = nextFile();
        expect(readDialogPathsFile(file)).toEqual({});
        ensureParent(file);
        fs.writeFileSync(file, '{not json');
        expect(readDialogPathsFile(file)).toEqual({});
        fs.writeFileSync(file, '[1,2]');
        expect(readDialogPathsFile(file)).toEqual({});
        fs.writeFileSync(file, JSON.stringify({ 'install-zip': dir, pad: 'x'.repeat(DIALOG_PATHS_FILE_MAX_BYTES) }));
        expect(readDialogPathsFile(file)).toEqual({});
        // A directory where the file should be is ignored too.
        const asDir = nextFile();
        fs.mkdirSync(asDir, { recursive: true });
        expect(readDialogPathsFile(asDir)).toEqual({});
    });

    it('writes atomically and reads back only valid entries', () => {
        const file = nextFile();
        ensureParent(file);
        expect(writeDialogPathsFileAtomic(file, { 'save-note-text': dir, 'install-zip': 'relative' } as never)).toBe(true);
        expect(readDialogPathsFile(file)).toEqual({ 'save-note-text': dir });
        expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('returns false (never throws) when the folder does not exist', () => {
        expect(writeDialogPathsFileAtomic(path.join(dir, 'missing', 'x', DIALOG_PATHS_FILE_NAME), {})).toBe(false);
    });

    it('recordDialogPick stores the folder of the picked file per kind', () => {
        const file = nextFile();
        ensureParent(file);
        const picked = path.join(dir, 'sub', 'plugin.zip');
        expect(recordDialogPick(file, 'install-zip', picked)).toBe(true);
        expect(recordDialogPick(file, 'save-note-text', path.join(dir, 'note.txt'))).toBe(true);
        expect(readDialogPathsFile(file)).toEqual({ 'install-zip': path.join(dir, 'sub'), 'save-note-text': dir });
        // Unchanged folder: no rewrite needed, still true.
        expect(recordDialogPick(file, 'install-zip', path.join(dir, 'sub', 'other.zip'))).toBe(true);
    });

    it('recordDialogPick ignores invalid picks and keeps the previous value', () => {
        const file = nextFile();
        ensureParent(file);
        recordDialogPick(file, 'install-zip', path.join(dir, 'a.zip'));
        for (const v of ['relative.zip', '', null, 5, String.raw`\\server\share\a.zip`])
            expect(recordDialogPick(file, 'install-zip', v)).toBe(false);
        expect(readDialogPathsFile(file)).toEqual({ 'install-zip': dir });
    });
});

describe('screenshotDialogDefaultPath (T-042)', () => {
    const desk = String.raw`C:\Users\me\Desktop`;
    it.runIf(process.platform === 'win32')('uses a valid local folder from the renderer', () => {
        expect(screenshotDialogDefaultPath(String.raw`D:\Shots`, desk, 'a.png', 'win32')).toBe(String.raw`D:\Shots\a.png`);
    });
    it('falls back to the desktop for missing, relative, UNC, device or ADS folders, never throwing', () => {
        for (const bad of [
            undefined,
            null,
            42,
            '',
            'relative',
            String.raw`\\server\share`,
            '//server/share',
            String.raw`\\?\C:\x`,
            String.raw`C:\x:ads`,
            String.raw`C:\NUL`,
        ]) {
            expect(screenshotDialogDefaultPath(bad, desk, 'a.png', 'win32')).toBe(String.raw`C:\Users\me\Desktop\a.png`);
        }
    });
});
