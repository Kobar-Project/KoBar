// Pure uninstall protection: decides whether an extensions/<id> folder may be deleted.
import * as fs from 'fs';
import * as nodePath from 'path';
import { isFsPathInside } from './fsGuards.cjs';
import { isSafeId, resolveInside } from './paths.cjs';

export type CanDeleteResult =
    { ok: true; dir: string } | { ok: false; reason: 'invalid-id' | 'outside' | 'not-found' | 'not-a-directory' | 'link' };

export interface CanDeleteOptions {
    /**
     * Also accept an id that is not isSafeId but is the exact name of an existing entry
     * (folders installed before ids were validated).
     */
    allowLegacyEntry?: boolean;
}

/**
 * `ok` only when `id` is a safe id (or, with `allowLegacyEntry`, an existing entry name), the
 * folder is a direct child of `extensionsDir`, exists, and is a real directory (not a
 * symlink/junction, no link on the way). Never deletes anything.
 */
export function canDeletePluginFolder(extensionsDir: string, id: unknown, options: CanDeleteOptions = {}): CanDeleteResult {
    if (typeof id !== 'string' || id === '') return { ok: false, reason: 'invalid-id' };
    if (!isSafeId(id)) {
        let legacy = false;
        if (options.allowLegacyEntry) {
            try {
                legacy = fs.readdirSync(extensionsDir).includes(id);
            } catch {
                legacy = false;
            }
        }
        if (!legacy) return { ok: false, reason: 'invalid-id' };
    }
    const dir = resolveInside(extensionsDir, id);
    if (!dir || nodePath.dirname(dir) !== nodePath.resolve(extensionsDir)) return { ok: false, reason: 'outside' };
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(dir);
    } catch (err) {
        return { ok: false, reason: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'not-a-directory' };
    }
    if (stat.isSymbolicLink() || !isFsPathInside(extensionsDir, dir)) return { ok: false, reason: 'link' };
    if (!stat.isDirectory()) return { ok: false, reason: 'not-a-directory' };
    return { ok: true, dir };
}
