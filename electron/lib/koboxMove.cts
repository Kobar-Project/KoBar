// R2-11 / R2-12: moves one dropped file or folder INTO KoBox (it leaves its original place). No Electron imports, so it is
// unit-tested with plain temp folders; the rename function is injectable so tests can simulate EXDEV and "file in use".
//
// Semantics (fail-safe, the source is never deleted before the destination is verified):
//   1. Same drive: one fs.rename. It is atomic, keeps the original timestamps and fails as a whole when something inside is in
//      use, so nothing is ever half moved. No size limit applies (nothing is read or written).
//   2. Another drive (EXDEV): the item is copied by an explicit walker (not fs.cp), the copy is verified (same names, types and
//      sizes), only then is the source removed. A folder is first renamed aside next to its original place: that rename fails
//      while anything inside is open, so a locked tree is detected BEFORE a single file is deleted; on failure the copy in
//      KoBox is removed again and the source stays intact. Links or special files inside a folder cannot be copied, so such a
//      folder is refused on this path instead of silently losing them. The KoBox size / entry limits apply on this path only.
//   3. In use (EBUSY / EPERM / EACCES / ETXTBSY): reason 'source-in-use', the source is untouched, nothing is left in KoBox.
//   4. Name collisions: the first free "name", "name (2)", ... is claimed (a file by an exclusive create, a folder by checking
//      the name right before the rename); an existing KoBox entry is never overwritten or merged into.
import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveInside } from './paths.cjs';
import { isFsPathInside } from './fsGuards.cjs';
import { KOBOX_FOLDER_LIMITS, measureFolder, type FolderLimits } from './folderLimits.cjs';
import { validateKoBoxSource, withCollisionSuffix } from './fileArgs.cjs';

export type MoveIntoKoBoxResult =
    | {
          ok: true;
          dest: string;
          kind: 'file' | 'dir';
          /** How the item got there: a rename, or copy + verify + remove (another drive). */
          via: 'rename' | 'copy';
          /** True when the item is safely in KoBox but a leftover of the original could not be removed (original location). */
          leftover?: boolean;
      }
    | { ok: false; reason: string };

export interface MoveIntoKoBoxOptions {
    folderLimits?: FolderLimits;
    /** Defaults to fs.promises.rename; tests inject EXDEV / EBUSY here. */
    rename?: (from: string, to: string) => Promise<void>;
}

const MAX_COLLISION_ATTEMPTS = 1000;
const IN_USE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ETXTBSY']);

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

async function exists(p: string): Promise<boolean> {
    try {
        await fs.promises.lstat(p);
        return true;
    } catch {
        return false;
    }
}

const rmQuiet = (p: string) => fs.promises.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);

type Listing = Map<string, { dir: boolean; size: number }>;

/** Relative path -> type/size for a whole tree; throws 'unsupported-entries' on a link or special file. */
async function listTree(root: string): Promise<Listing> {
    const out: Listing = new Map();
    const walk = async (dir: string, rel: string): Promise<void> => {
        for (const name of await fs.promises.readdir(dir)) {
            const full = nodePath.join(dir, name);
            const r = rel ? `${rel}/${name}` : name;
            const st = await fs.promises.lstat(full);
            if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw new Error('unsupported-entries');
            out.set(r, { dir: st.isDirectory(), size: st.isFile() ? st.size : 0 });
            if (st.isDirectory()) await walk(full, r);
        }
    };
    await walk(root, '');
    return out;
}

async function copyTree(from: string, to: string): Promise<void> {
    for (const name of await fs.promises.readdir(from)) {
        const a = nodePath.join(from, name);
        const b = nodePath.join(to, name);
        const st = await fs.promises.lstat(a);
        if (st.isDirectory()) {
            await fs.promises.mkdir(b);
            await copyTree(a, b);
        } else if (st.isFile()) {
            await fs.promises.copyFile(a, b, fs.constants.COPYFILE_EXCL);
        } else {
            throw new Error('unsupported-entries');
        }
    }
}

async function sameTree(a: string, b: string): Promise<boolean> {
    const [x, y] = await Promise.all([listTree(a), listTree(b)]);
    if (x.size !== y.size) return false;
    for (const [rel, info] of x) {
        const other = y.get(rel);
        if (!other || other.dir !== info.dir || other.size !== info.size) return false;
    }
    return true;
}

export async function moveIntoKoBox(
    src: unknown,
    koBoxPath: string,
    protectedRoots: readonly string[],
    options: MoveIntoKoBoxOptions = {}
): Promise<MoveIntoKoBoxResult> {
    const limits = options.folderLimits ?? KOBOX_FOLDER_LIMITS;
    const rename = options.rename ?? ((from: string, to: string) => fs.promises.rename(from, to));
    const check = validateKoBoxSource(src, protectedRoots);
    if (!check.ok) return check;
    const source = src as string;
    const kind = check.kind;
    const isDir = kind === 'dir';

    const koBoxRoot = nodePath.resolve(koBoxPath);
    const baseName = nodePath.basename(source);
    const candidate = (n: number): string | null => {
        const target = resolveInside(koBoxPath, withCollisionSuffix(baseName, n, isDir));
        if (!target || nodePath.dirname(target) !== koBoxRoot || !isFsPathInside(koBoxPath, target)) return null;
        return target;
    };
    if (!candidate(1)) return { ok: false, reason: 'invalid-destination' };
    await fs.promises.mkdir(koBoxRoot, { recursive: true });

    const failFromRenameError = async (err: unknown): Promise<MoveIntoKoBoxResult> => {
        if (!(await exists(source))) return { ok: false, reason: 'source-missing' };
        if (IN_USE_CODES.has(codeOf(err) ?? '')) return { ok: false, reason: 'source-in-use' };
        return { ok: false, reason: 'move-failed' };
    };

    // ── Claim a name and rename ──
    let claimed = '';
    let exdev = false;
    for (let n = 1; n <= MAX_COLLISION_ATTEMPTS && !claimed; n++) {
        const target = candidate(n);
        if (!target) return { ok: false, reason: 'invalid-destination' };
        if (!isDir) {
            // Exclusive create claims the name (rename would silently replace an existing file on Windows).
            try {
                await (await fs.promises.open(target, 'wx')).close();
            } catch (err) {
                if (codeOf(err) === 'EEXIST') continue;
                return { ok: false, reason: 'destination-unwritable' };
            }
            try {
                await rename(source, target);
                return { ok: true, dest: target, kind, via: 'rename' };
            } catch (err) {
                if (codeOf(err) === 'EXDEV') {
                    claimed = target;
                    exdev = true;
                    break;
                }
                await fs.promises.unlink(target).catch(() => undefined);
                return failFromRenameError(err);
            }
        }
        if (await exists(target)) continue;
        try {
            await rename(source, target);
            return { ok: true, dest: target, kind, via: 'rename' };
        } catch (err) {
            const code = codeOf(err);
            if (code === 'EXDEV') {
                try {
                    await fs.promises.mkdir(target);
                } catch {
                    continue;
                }
                claimed = target;
                exdev = true;
                break;
            }
            // A directory rename onto a name that appeared meanwhile fails with EEXIST / ENOTEMPTY / EPERM: try the next name.
            if (await exists(target)) continue;
            return failFromRenameError(err);
        }
    }
    if (!claimed) return { ok: false, reason: exdev ? 'move-failed' : 'destination-exists' };

    // ── Another drive: copy, verify, then remove the source ──
    const undo = () => rmQuiet(claimed);
    try {
        if (!isDir) {
            const before = await fs.promises.lstat(source);
            if (before.size > limits.maxBytes) {
                await undo();
                return { ok: false, reason: 'too-large' };
            }
            await fs.promises.copyFile(source, claimed);
            const after = await fs.promises.lstat(claimed);
            if (after.size !== before.size) {
                await undo();
                return { ok: false, reason: 'verify-failed' };
            }
            try {
                await fs.promises.unlink(source);
            } catch (err) {
                await undo();
                return failFromRenameError(err);
            }
            return { ok: true, dest: claimed, kind, via: 'copy' };
        }

        const measure = await measureFolder(source, limits);
        if (!measure.ok) {
            await undo();
            return { ok: false, reason: measure.reason === 'too-large' ? 'too-large' : 'source-unreadable' };
        }
        await copyTree(source, claimed);
        if (!(await sameTree(source, claimed))) {
            await undo();
            return { ok: false, reason: 'verify-failed' };
        }
        // Detect a locked tree before deleting anything: renaming a folder aside fails while something inside is open.
        const aside = nodePath.join(nodePath.dirname(source), `${nodePath.basename(source)}.kobar-moving-${process.pid}-${Date.now()}`);
        try {
            await rename(source, aside);
        } catch (err) {
            await undo();
            return failFromRenameError(err);
        }
        try {
            await fs.promises.rm(aside, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
        } catch {
            // The verified copy is in KoBox; what could not be removed stays in the original place under a ".kobar-moving" name.
            return { ok: true, dest: claimed, kind, via: 'copy', leftover: true };
        }
        return { ok: true, dest: claimed, kind, via: 'copy' };
    } catch (err) {
        await undo();
        if ((err as Error)?.message === 'unsupported-entries') return { ok: false, reason: 'unsupported-entries' };
        if (IN_USE_CODES.has(codeOf(err) ?? '')) return { ok: false, reason: 'source-in-use' };
        if (codeOf(err) === 'ENOENT') return { ok: false, reason: 'source-missing' };
        return { ok: false, reason: 'move-failed' };
    }
}
