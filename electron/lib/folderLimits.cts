// Size / entry limit for folders dropped into KoBox (T-042). The folder is walked BEFORE anything is
// copied, with lstat only: links and junctions are neither followed nor counted (the copy skips them
// too). The walk stops as soon as a limit is exceeded. The fs functions are injectable for tests.
import * as fs from 'fs';
import * as nodePath from 'path';

/** Most files + folders (beneath the dropped folder) one KoBox folder drop may copy. */
export const KOBOX_FOLDER_MAX_ENTRIES = 20_000;
/** Most bytes (sum of regular file sizes) one KoBox folder drop may copy. */
export const KOBOX_FOLDER_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface FolderLimits {
    maxEntries: number;
    maxBytes: number;
}

export const KOBOX_FOLDER_LIMITS: FolderLimits = { maxEntries: KOBOX_FOLDER_MAX_ENTRIES, maxBytes: KOBOX_FOLDER_MAX_BYTES };

type StatLike = { isSymbolicLink(): boolean; isFile(): boolean; isDirectory(): boolean; size: number };

export interface FolderWalkFs {
    lstat(p: string): Promise<StatLike>;
    readdir(p: string): Promise<string[]>;
}

const defaultFs: FolderWalkFs = {
    lstat: (p) => fs.promises.lstat(p),
    readdir: (p) => fs.promises.readdir(p),
};

export type FolderMeasure =
    { ok: true; entries: number; bytes: number } | { ok: false; reason: 'too-large' | 'unreadable'; entries: number; bytes: number };

/**
 * Counts the entries and total file bytes beneath `root` and fails with 'too-large' as soon as either
 * limit is exceeded. Links/junctions and other non-regular entries are skipped, never followed.
 * An unreadable root fails with 'unreadable'; unreadable entries below it are skipped like the copy does.
 */
export async function measureFolder(
    root: string,
    limits: FolderLimits = KOBOX_FOLDER_LIMITS,
    fsImpl: FolderWalkFs = defaultFs
): Promise<FolderMeasure> {
    let entries = 0;
    let bytes = 0;
    let rootStat: StatLike;
    try {
        rootStat = await fsImpl.lstat(root);
    } catch {
        return { ok: false, reason: 'unreadable', entries, bytes };
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { ok: false, reason: 'unreadable', entries, bytes };

    const pending: string[] = [root];
    while (pending.length > 0) {
        const dir = pending.pop() as string;
        let names: string[];
        try {
            names = await fsImpl.readdir(dir);
        } catch {
            if (dir === root) return { ok: false, reason: 'unreadable', entries, bytes };
            continue;
        }
        for (const name of names) {
            const full = nodePath.join(dir, name);
            let st: StatLike;
            try {
                st = await fsImpl.lstat(full);
            } catch {
                continue;
            }
            if (st.isSymbolicLink()) continue;
            if (st.isDirectory()) {
                pending.push(full);
            } else if (st.isFile()) {
                bytes += st.size;
            } else {
                continue;
            }
            entries += 1;
            if (entries > limits.maxEntries || bytes > limits.maxBytes) return { ok: false, reason: 'too-large', entries, bytes };
        }
    }
    return { ok: true, entries, bytes };
}
