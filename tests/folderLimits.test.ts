import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KOBOX_FOLDER_MAX_BYTES, KOBOX_FOLDER_MAX_ENTRIES, measureFolder } from '../electron/lib/folderLimits.cjs';
import { copyIntoKoBox } from '../electron/lib/fileArgs.cjs';

// Synthetic temp folders only.
let root: string;
let tree: string;
let linked: string;
let koBox: string;
let linkSupported = true;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-folderlimits-'));
    tree = path.join(root, 'tree');
    linked = path.join(root, 'linked');
    koBox = path.join(root, 'KoBox');
    fs.mkdirSync(path.join(tree, 'sub', 'deep'), { recursive: true });
    fs.mkdirSync(koBox);
    fs.writeFileSync(path.join(tree, 'a.txt'), '12345');
    fs.writeFileSync(path.join(tree, 'sub', 'b.txt'), '123');
    fs.writeFileSync(path.join(tree, 'sub', 'deep', 'c.txt'), '12');
    const outside = path.join(root, 'big-outside');
    fs.mkdirSync(outside);
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(outside, `f${i}.txt`), 'x'.repeat(100));
    try {
        // 'junction' needs no admin rights on Windows; it is a plain symlink elsewhere.
        fs.mkdirSync(linked);
        fs.writeFileSync(path.join(linked, 'only.txt'), '1234');
        fs.symlinkSync(outside, path.join(linked, 'link'), 'junction');
    } catch {
        linkSupported = false;
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('measureFolder (T-042)', () => {
    it('counts files and folders beneath the root and sums file sizes', async () => {
        expect(await measureFolder(tree, { maxEntries: 100, maxBytes: 1000 })).toEqual({ ok: true, entries: 5, bytes: 10 });
    });

    it('does not follow or count links / junctions', async (ctx) => {
        if (!linkSupported) ctx.skip();
        // The junction target holds 20 files of 100 bytes; none of it may be counted.
        const res = await measureFolder(linked, { maxEntries: 100, maxBytes: 1000 });
        expect(res).toEqual({ ok: true, entries: 1, bytes: 4 });
    });

    it('fails with too-large on the entry limit', async () => {
        expect(await measureFolder(tree, { maxEntries: 4, maxBytes: 1000 })).toMatchObject({ ok: false, reason: 'too-large' });
    });

    it('fails with too-large on the byte limit', async () => {
        expect(await measureFolder(tree, { maxEntries: 100, maxBytes: 9 })).toMatchObject({ ok: false, reason: 'too-large' });
    });

    it('stops walking as soon as a limit is exceeded', async () => {
        let lstats = 0;
        const fakeFs = {
            lstat: async (p: string) => {
                lstats++;
                const isDir = p === '/r';
                return { isSymbolicLink: () => false, isFile: () => !isDir, isDirectory: () => isDir, size: 1 };
            },
            readdir: async () => Array.from({ length: 1000 }, (_, i) => `f${i}`),
        };
        const res = await measureFolder('/r', { maxEntries: 10, maxBytes: 1e9 }, fakeFs);
        expect(res).toMatchObject({ ok: false, reason: 'too-large', entries: 11 });
        expect(lstats).toBe(12); // root + 11 entries, not 1000
    });

    it('treats a missing root or a non-folder as unreadable', async () => {
        expect(await measureFolder(path.join(root, 'nope'))).toMatchObject({ ok: false, reason: 'unreadable' });
        expect(await measureFolder(path.join(tree, 'a.txt'))).toMatchObject({ ok: false, reason: 'unreadable' });
    });

    it('uses the documented KoBox limits', () => {
        expect(KOBOX_FOLDER_MAX_ENTRIES).toBe(20_000);
        expect(KOBOX_FOLDER_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    });
});

describe('copyIntoKoBox folder limit (T-042)', () => {
    it('refuses an oversized folder before creating anything in KoBox', async () => {
        const res = await copyIntoKoBox(tree, koBox, [], { maxEntries: 2, maxBytes: 1e9 });
        expect(res).toEqual({ ok: false, reason: 'too-large' });
        expect(fs.existsSync(path.join(koBox, 'tree'))).toBe(false);
    });

    it('refuses a single file over the byte limit before copying', async () => {
        const res = await copyIntoKoBox(path.join(tree, 'a.txt'), koBox, [], { maxEntries: 100, maxBytes: 4 });
        expect(res).toEqual({ ok: false, reason: 'too-large' });
        expect(fs.existsSync(path.join(koBox, 'a.txt'))).toBe(false);
        expect((await copyIntoKoBox(path.join(tree, 'a.txt'), koBox, [], { maxEntries: 100, maxBytes: 5 })).ok).toBe(true);
    });

    it('copies a folder within the limits', async () => {
        const res = await copyIntoKoBox(tree, koBox, [], { maxEntries: 100, maxBytes: 1000 });
        expect(res.ok).toBe(true);
        expect(fs.readFileSync(path.join(koBox, 'tree', 'sub', 'deep', 'c.txt'), 'utf8')).toBe('12');
    });
});
