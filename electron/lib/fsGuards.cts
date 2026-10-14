// File-system guards that complement the lexical `resolveInside` check before deleting or writing.
import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveInside } from './paths.cjs';

/**
 * True when `target` lies lexically inside `base` and no existing path component between them
 * (including `target` itself) is a symbolic link or junction. Components that do not exist yet
 * are fine (the caller may be about to create them). `base` itself may be a link (e.g. a
 * relocated folder); only what is below it is checked.
 *
 * Why lstat per component instead of comparing fs.realpath results: under MSIX file-system
 * virtualization (Microsoft Store build) userData paths can resolve to different physical roots,
 * so a realpath comparison could reject legitimate plugin folders. A link anywhere below `base`
 * is the only way a lexically-inside path can reach outside, and lstat detects it on every OS
 * (Node reports Windows junctions as symbolic links).
 */
export function isFsPathInside(base: string, target: string): boolean {
    const resolvedBase = resolveInside(base);
    if (resolvedBase === null) return false;
    const rel = nodePath.relative(resolvedBase, target);
    if (rel === '') return false;
    const resolvedTarget = resolveInside(resolvedBase, rel);
    if (resolvedTarget === null) return false;

    let current = resolvedBase;
    for (const segment of rel.split(nodePath.sep)) {
        if (segment === '') continue;
        current = nodePath.join(current, segment);
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(current);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
            return false;
        }
        if (stat.isSymbolicLink()) return false;
    }
    return true;
}

/** `fs.existsSync` without blocking (T-318): true when the path can be accessed, false on any error. Never throws. */
export async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}
