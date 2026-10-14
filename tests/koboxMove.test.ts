// R2-11 / R2-12: moving files and folders into KoBox, and the Recycle-Bin cleanup. Temp folders only (never the real userData / KoBox).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { moveIntoKoBox } from '../electron/lib/koboxMove.cjs';
import { copyIntoKoBox } from '../electron/lib/fileArgs.cjs';
import { cleanKoBoxItems, readInventory, recordMovedItem } from '../electron/lib/koboxCleanup.cjs';

let root: string;
let userData: string;
let koBox: string;
let outside: string;
let inventory: string;
const roots = () => [userData];

function makeTree(dir: string): void {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.writeFileSync(path.join(dir, 'top.txt'), 'top');
    fs.writeFileSync(path.join(dir, 'a', 'mid.txt'), 'mid');
    fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.bin'), Buffer.from([1, 2, 3, 4]));
}
const errno = (code: string) => Object.assign(new Error(code), { code });
const list = (dir: string) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-kobox-move-'));
    userData = path.join(root, 'userData');
    koBox = path.join(userData, 'KoBox');
    outside = path.join(root, 'outside');
    inventory = path.join(userData, 'kobox-inventory.json');
    fs.mkdirSync(koBox, { recursive: true });
    fs.mkdirSync(outside);
});
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('moveIntoKoBox: same drive (R2-12 folders, R2-11 move)', () => {
    it('moves a folder tree with nested dirs, files and an empty dir; the source is gone', async () => {
        const src = path.join(outside, 'My Folder');
        makeTree(src);
        const before = list(src);
        const res = await moveIntoKoBox(src, koBox, roots());
        expect(res).toEqual({ ok: true, dest: path.join(koBox, 'My Folder'), kind: 'dir', via: 'rename' });
        expect(list(path.join(koBox, 'My Folder'))).toEqual(before);
        expect(fs.existsSync(path.join(koBox, 'My Folder', 'empty'))).toBe(true);
        expect(fs.readFileSync(path.join(koBox, 'My Folder', 'a', 'mid.txt'), 'utf-8')).toBe('mid');
        expect(fs.existsSync(src)).toBe(false);
    });
    it('moves a file and keeps its content', async () => {
        const src = path.join(outside, 'doc.txt');
        fs.writeFileSync(src, 'hello');
        const res = await moveIntoKoBox(src, koBox, roots());
        expect(res).toEqual({ ok: true, dest: path.join(koBox, 'doc.txt'), kind: 'file', via: 'rename' });
        expect(fs.readFileSync(path.join(koBox, 'doc.txt'), 'utf-8')).toBe('hello');
        expect(fs.existsSync(src)).toBe(false);
    });
    it('a name collision gets a suffix, for files and for folders; nothing existing is overwritten or merged', async () => {
        fs.writeFileSync(path.join(koBox, 'doc.txt'), 'old');
        fs.mkdirSync(path.join(koBox, 'dir'));
        fs.writeFileSync(path.join(koBox, 'dir', 'keep.txt'), 'keep');
        const f = path.join(outside, 'doc.txt');
        fs.writeFileSync(f, 'new');
        const d = path.join(outside, 'dir');
        makeTree(d);
        expect((await moveIntoKoBox(f, koBox, roots())).ok).toBe(true);
        const dirRes = await moveIntoKoBox(d, koBox, roots());
        expect(dirRes.ok && dirRes.dest).toBe(path.join(koBox, 'dir (2)'));
        expect(fs.readFileSync(path.join(koBox, 'doc.txt'), 'utf-8')).toBe('old');
        expect(fs.readFileSync(path.join(koBox, 'doc (2).txt'), 'utf-8')).toBe('new');
        expect(list(path.join(koBox, 'dir'))).toEqual(['keep.txt']);
        expect(fs.readFileSync(path.join(koBox, 'dir (2)', 'top.txt'), 'utf-8')).toBe('top');
    });
    it('a file in use: the source is untouched and no placeholder is left in KoBox', async () => {
        const src = path.join(outside, 'busy.txt');
        fs.writeFileSync(src, 'busy');
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: () => Promise.reject(errno('EBUSY')) });
        expect(res).toEqual({ ok: false, reason: 'source-in-use' });
        expect(fs.readFileSync(src, 'utf-8')).toBe('busy');
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('a folder in use: the source is untouched and nothing appears in KoBox', async () => {
        const src = path.join(outside, 'busyDir');
        makeTree(src);
        const before = list(src);
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: () => Promise.reject(errno('EPERM')) });
        expect(res).toEqual({ ok: false, reason: 'source-in-use' });
        expect(list(src)).toEqual(before);
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('refuses sources inside app data and missing sources', async () => {
        fs.writeFileSync(path.join(koBox, 'x.txt'), 'x');
        expect(await moveIntoKoBox(path.join(koBox, 'x.txt'), koBox, roots())).toEqual({ ok: false, reason: 'source-inside-app-data' });
        expect(await moveIntoKoBox(path.join(outside, 'nope'), koBox, roots())).toEqual({ ok: false, reason: 'source-missing' });
        expect(fs.existsSync(path.join(koBox, 'x.txt'))).toBe(true);
    });
});

// Simulates another drive: renaming INTO KoBox fails with EXDEV, everything else uses the real rename.
const crossDrive = (inUse?: (from: string, to: string) => boolean) => async (from: string, to: string) => {
    if (inUse?.(from, to)) throw errno('EBUSY');
    if (to.startsWith(koBox)) throw errno('EXDEV');
    await fs.promises.rename(from, to);
};

describe('moveIntoKoBox: another drive (EXDEV)', () => {
    it('copies a folder tree, verifies it, then removes the source', async () => {
        const src = path.join(outside, 'Big Folder');
        makeTree(src);
        const before = list(src);
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive() });
        expect(res).toEqual({ ok: true, dest: path.join(koBox, 'Big Folder'), kind: 'dir', via: 'copy' });
        expect(list(path.join(koBox, 'Big Folder'))).toEqual(before);
        expect(fs.readFileSync(path.join(koBox, 'Big Folder', 'a', 'b', 'deep.bin')).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    it('copies a file and removes the source; collisions get a suffix', async () => {
        fs.writeFileSync(path.join(koBox, 'a.txt'), 'old');
        const src = path.join(outside, 'a.txt');
        fs.writeFileSync(src, 'new');
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive() });
        expect(res).toEqual({ ok: true, dest: path.join(koBox, 'a (2).txt'), kind: 'file', via: 'copy' });
        expect(fs.readFileSync(path.join(koBox, 'a (2).txt'), 'utf-8')).toBe('new');
        expect(fs.readFileSync(path.join(koBox, 'a.txt'), 'utf-8')).toBe('old');
        expect(fs.existsSync(src)).toBe(false);
    });
    it('a locked folder is detected before anything is deleted: source intact, the copy in KoBox is rolled back', async () => {
        const src = path.join(outside, 'Locked');
        makeTree(src);
        const before = list(src);
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive((_f, to) => to.includes('.kobar-moving')) });
        expect(res).toEqual({ ok: false, reason: 'source-in-use' });
        expect(list(src)).toEqual(before);
        expect(fs.readFileSync(path.join(src, 'a', 'mid.txt'), 'utf-8')).toBe('mid');
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('a file over the KoBox size limit is refused on the copy path; source intact, nothing left in KoBox', async () => {
        const src = path.join(outside, 'f.txt');
        fs.writeFileSync(src, 'data');
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive(), folderLimits: { maxEntries: 10, maxBytes: 2 } });
        expect(res).toEqual({ ok: false, reason: 'too-large' });
        expect(fs.readFileSync(src, 'utf-8')).toBe('data');
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('a folder over the KoBox limits is refused on the copy path; source intact, nothing left in KoBox', async () => {
        const src = path.join(outside, 'Many');
        makeTree(src);
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive(), folderLimits: { maxEntries: 2, maxBytes: 1e9 } });
        expect(res).toEqual({ ok: false, reason: 'too-large' });
        expect(fs.existsSync(path.join(src, 'a', 'b', 'deep.bin'))).toBe(true);
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('a folder with a link inside is refused on the copy path instead of losing the link', async (ctx) => {
        const src = path.join(outside, 'WithLink');
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(src, 'real.txt'), 'r');
        // The junction points at a folder outside `src` (a link back to `outside` would make a cycle that the temp-folder cleanup cannot resolve).
        const elsewhere = path.join(root, 'elsewhere');
        fs.mkdirSync(elsewhere);
        try {
            fs.symlinkSync(elsewhere, path.join(src, 'lnk'), 'junction');
        } catch {
            ctx.skip();
        }
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive() });
        expect(res).toEqual({ ok: false, reason: 'unsupported-entries' });
        expect(fs.existsSync(path.join(src, 'real.txt'))).toBe(true);
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
});

// User files: a failed copy must NEVER cost the original. Every case makes the copy fail half way and checks the source is untouched.
describe('a failed copy never loses the original', () => {
    /** Makes the second copyFile call fail (the first file is already copied by then). */
    const failSecondCopy = () => {
        const real = fs.promises.copyFile.bind(fs.promises);
        let calls = 0;
        vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to, mode) => {
            calls += 1;
            if (calls === 2) throw errno('EIO');
            return real(from, to, mode);
        });
    };
    it('moveIntoKoBox (another drive), folder: source intact, nothing left in KoBox', async () => {
        const src = path.join(outside, 'Precious');
        makeTree(src);
        const before = list(src);
        failSecondCopy();
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive() });
        expect(res.ok).toBe(false);
        expect(list(src)).toEqual(before);
        expect(fs.readFileSync(path.join(src, 'a', 'b', 'deep.bin')).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('moveIntoKoBox (another drive), file: source intact, no partial file in KoBox', async () => {
        const src = path.join(outside, 'keep.txt');
        fs.writeFileSync(src, 'precious');
        vi.spyOn(fs.promises, 'copyFile').mockRejectedValue(errno('EIO'));
        const res = await moveIntoKoBox(src, koBox, roots(), { rename: crossDrive() });
        expect(res.ok).toBe(false);
        expect(fs.readFileSync(src, 'utf-8')).toBe('precious');
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
    it('copyIntoKoBox, folder: source intact, the half-made copy is removed', async () => {
        const src = path.join(outside, 'Precious');
        makeTree(src);
        const before = list(src);
        failSecondCopy();
        await expect(copyIntoKoBox(src, koBox, roots())).rejects.toThrow();
        expect(list(src)).toEqual(before);
        expect(fs.readdirSync(koBox)).toEqual([]);
    });
});

describe('cleanKoBoxItems (Recycle Bin, inventory)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    let bin: string;
    // The "Recycle Bin": moves the item into a temp folder, never deletes it.
    const trash = async (p: string) => {
        await fs.promises.rename(p, path.join(bin, path.basename(p)));
    };
    beforeEach(() => {
        bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
    });
    const setAge = (p: string, ageMs: number) => {
        const t = new Date(Date.now() - ageMs);
        fs.utimesSync(p, t, t);
    };

    it('24h: counts from the move time (an old file just moved stays), legacy items by mtime, folders included', async () => {
        const moved = path.join(outside, 'moved-old.txt');
        fs.writeFileSync(moved, 'm');
        setAge(moved, 30 * DAY); // old mtime, but it was moved just now
        const res = await moveIntoKoBox(moved, koBox, roots());
        recordMovedItem(inventory, koBox, (res as { dest: string }).dest, 'file');

        fs.writeFileSync(path.join(koBox, 'legacy-old.txt'), 'l');
        setAge(path.join(koBox, 'legacy-old.txt'), 2 * DAY);
        fs.writeFileSync(path.join(koBox, 'legacy-new.txt'), 'n');
        fs.mkdirSync(path.join(koBox, 'legacyDir', 'sub'), { recursive: true });
        setAge(path.join(koBox, 'legacyDir'), 3 * DAY);

        const out = await cleanKoBoxItems({ koBoxPath: koBox, inventoryFile: inventory, mode: '24h', trash });
        expect(out.trashed.sort()).toEqual(['legacy-old.txt', 'legacyDir']);
        expect(fs.readdirSync(koBox).sort()).toEqual(['legacy-new.txt', 'moved-old.txt']);
        expect(fs.readdirSync(bin).sort()).toEqual(['legacy-old.txt', 'legacyDir']);
    });
    it('24h: a moved item older than 24 hours in the inventory goes to the bin and leaves the inventory', async () => {
        fs.writeFileSync(path.join(koBox, 'm.txt'), 'm');
        recordMovedItem(inventory, koBox, path.join(koBox, 'm.txt'), 'file', Date.now() - 2 * DAY);
        expect(Object.keys(readInventory(inventory).items)).toEqual(['m.txt']);
        const out = await cleanKoBoxItems({ koBoxPath: koBox, inventoryFile: inventory, mode: '24h', trash });
        expect(out.trashed).toEqual(['m.txt']);
        expect(readInventory(inventory).items).toEqual({});
    });
    it('quit: everything in KoBox goes to the bin', async () => {
        fs.writeFileSync(path.join(koBox, 'a.txt'), 'a');
        fs.mkdirSync(path.join(koBox, 'd'));
        const out = await cleanKoBoxItems({ koBoxPath: koBox, inventoryFile: inventory, mode: 'quit', trash });
        expect(out.trashed.sort()).toEqual(['a.txt', 'd']);
        expect(fs.readdirSync(koBox)).toEqual([]);
        expect(fs.readdirSync(bin).sort()).toEqual(['a.txt', 'd']);
    });
    it('an item the bin cannot take stays in place (never a permanent delete) and the rest is still handled', async () => {
        fs.writeFileSync(path.join(koBox, 'a.txt'), 'a');
        fs.writeFileSync(path.join(koBox, 'b.txt'), 'b');
        const failFirst = async (p: string) => {
            if (path.basename(p) === 'a.txt') throw new Error('bin unavailable');
            await trash(p);
        };
        const out = await cleanKoBoxItems({ koBoxPath: koBox, inventoryFile: inventory, mode: 'quit', trash: failFirst });
        expect(out).toEqual({ trashed: ['b.txt'], failed: ['a.txt'] });
        expect(fs.readFileSync(path.join(koBox, 'a.txt'), 'utf-8')).toBe('a');
    });
    it('a broken, foreign-version or missing inventory is read as empty (back-compat)', () => {
        expect(readInventory(inventory).items).toEqual({});
        fs.writeFileSync(inventory, '{not json');
        expect(readInventory(inventory).items).toEqual({});
        fs.writeFileSync(inventory, JSON.stringify({ version: 99, items: { x: { movedAt: 1, ino: 1, kind: 'file' } } }));
        expect(readInventory(inventory).items).toEqual({});
    });
    it('a record whose inode no longer matches (name reused) is ignored in favour of the mtime', async () => {
        fs.writeFileSync(path.join(koBox, 'r.txt'), 'r');
        recordMovedItem(inventory, koBox, path.join(koBox, 'r.txt'), 'file', Date.now() - 5 * DAY);
        const inv = readInventory(inventory);
        inv.items['r.txt'].ino += 12345;
        fs.writeFileSync(inventory, JSON.stringify(inv));
        const out = await cleanKoBoxItems({ koBoxPath: koBox, inventoryFile: inventory, mode: '24h', trash });
        expect(out.trashed).toEqual([]); // fresh mtime wins over the stale record
    });
});
