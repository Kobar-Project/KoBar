// Directory scanning helpers for plugin folders (no Electron). Every entry is handled on its own,
// so one broken entry (dangling link, access error) never hides the others.
import * as fs from 'fs';
import * as nodePath from 'path';

export interface ListPluginDirsOptions {
    /**
     * Accept links/junctions that point to a directory. Only for the dev playground, where
     * developers link their working copies. userData/extensions never allows links.
     */
    allowLinks?: boolean;
    /** Called at most once per distinct `${baseDir}|${name}` for entries that are skipped. */
    warn?: (message: string) => void;
}

const warned = new Set<string>();

function warnOnce(key: string, message: string, warn?: (m: string) => void): void {
    if (warned.has(key)) return;
    warned.add(key);
    (warn ?? console.warn)(message);
}

/** Test helper: forget which skipped entries were already reported. */
export function resetPluginScanWarnings(): void {
    warned.clear();
}

/**
 * Names of the real plugin folders directly inside `baseDir`. Uses lstat (never follows links):
 * links/junctions are skipped (untrusted) unless `allowLinks`; files and unreadable entries are
 * skipped. Skipped links and failing entries are reported once. A missing/unreadable `baseDir`
 * yields an empty list.
 */
export function listPluginDirs(baseDir: string, options: ListPluginDirsOptions = {}): string[] {
    let names: string[];
    try {
        names = fs.readdirSync(baseDir);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            warnOnce(`${baseDir}|`, `[Extensions] Cannot list ${baseDir}: ${(err as Error).message}`, options.warn);
        }
        return [];
    }
    const result: string[] = [];
    for (const name of names) {
        const key = `${baseDir}|${name}`;
        try {
            const full = nodePath.join(baseDir, name);
            const lst = fs.lstatSync(full);
            if (lst.isSymbolicLink()) {
                if (!options.allowLinks) {
                    warnOnce(key, `[Extensions] Skipping "${name}": links are not allowed in ${baseDir}.`, options.warn);
                    continue;
                }
                if (!fs.statSync(full).isDirectory()) continue;
            } else if (!lst.isDirectory()) {
                continue;
            }
            result.push(name);
        } catch (err) {
            warnOnce(key, `[Extensions] Skipping "${name}" in ${baseDir}: ${(err as Error).message}`, options.warn);
        }
    }
    return result;
}

/** `listPluginDirs` without blocking the main process (T-318): same entries, same order, same skip rules and warnings. */
export async function listPluginDirsAsync(baseDir: string, options: ListPluginDirsOptions = {}): Promise<string[]> {
    let names: string[];
    try {
        names = await fs.promises.readdir(baseDir);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            warnOnce(`${baseDir}|`, `[Extensions] Cannot list ${baseDir}: ${(err as Error).message}`, options.warn);
        }
        return [];
    }
    const result: string[] = [];
    for (const name of names) {
        const key = `${baseDir}|${name}`;
        try {
            const full = nodePath.join(baseDir, name);
            const lst = await fs.promises.lstat(full);
            if (lst.isSymbolicLink()) {
                if (!options.allowLinks) {
                    warnOnce(key, `[Extensions] Skipping "${name}": links are not allowed in ${baseDir}.`, options.warn);
                    continue;
                }
                if (!(await fs.promises.stat(full)).isDirectory()) continue;
            } else if (!lst.isDirectory()) {
                continue;
            }
            result.push(name);
        } catch (err) {
            warnOnce(key, `[Extensions] Skipping "${name}" in ${baseDir}: ${(err as Error).message}`, options.warn);
        }
    }
    return result;
}

/**
 * Finds the folder holding manifest.json in an extracted package: the root itself, else the first
 * top-level subfolder that has one. Returns null when there is none.
 */
export function findManifestDir(extractedDir: string): { dir: string; manifestPath: string } | null {
    const rootManifest = nodePath.join(extractedDir, 'manifest.json');
    if (fs.existsSync(rootManifest)) return { dir: extractedDir, manifestPath: rootManifest };
    for (const name of fs.readdirSync(extractedDir)) {
        const sub = nodePath.join(extractedDir, name);
        if (!fs.lstatSync(sub).isDirectory()) continue;
        const manifestPath = nodePath.join(sub, 'manifest.json');
        if (fs.existsSync(manifestPath)) return { dir: sub, manifestPath };
    }
    return null;
}
