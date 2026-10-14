// Short-lived allow-list of paths the USER chose in this session (SEC-02, T-042). Handlers that read or
// write files on behalf of the renderer (parse-file, save-screenshot, kobox-drop, install-extension-from-path) only accept a path that
// was granted here, exactly (a granted folder does not cover the files beneath it). Grants come from a
// drag-and-drop / <input type=file> File resolved through webUtils.getPathForFile in the preload: a plugin
// cannot fabricate a File with a real path by script.
// Residual risk: Chromium may also expose real-path Files for files pasted from Explorer (clipboardData.files),
// so a paste the user makes into KoBar can grant those paths too. It is still a user action.
// In memory only, never persisted. No Electron or fs imports; clock and platform are injectable for tests.
import * as nodePath from 'path';

/** How long a grant stays valid after the user action. */
export const PATH_GRANT_TTL_MS = 10 * 60 * 1000;
/** Upper bound of live grants; the oldest grant is evicted first. */
export const PATH_GRANT_MAX_ENTRIES = 500;

/** Where a grant came from: a File the user dropped or picked in the renderer. */
export type PathGrantKind = 'user-file';

export interface PathGrantOptions {
    now?: () => number;
    platform?: string;
    ttlMs?: number;
    maxEntries?: number;
}

export interface PathGrants {
    /** Grants exactly `path` (refreshing an existing grant). Returns false for unusable input. */
    grant(path: unknown, kind: PathGrantKind): boolean;
    /** True while exactly `path` holds an unexpired grant. */
    isGranted(path: unknown): boolean;
    /** Number of live grants (expired ones are dropped first). */
    size(): number;
    clear(): void;
}

type Entry = { expiresAt: number; kind: PathGrantKind };

export function createPathGrants(options: PathGrantOptions = {}): PathGrants {
    const now = options.now ?? (() => performance.now()); // monotonic: immune to wall-clock changes
    const platform = options.platform ?? process.platform;
    const ttlMs = options.ttlMs ?? PATH_GRANT_TTL_MS;
    const maxEntries = Math.max(1, options.maxEntries ?? PATH_GRANT_MAX_ENTRIES);
    const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const isWin = platform === 'win32';
    // Fold ASCII only, like resolveInside: NTFS does not treat e.g. the Kelvin sign as equal to 'k'.
    const fold = (s: string) => (isWin ? s.replace(/[A-Z]/g, (c) => c.toLowerCase()) : s);
    // Insertion order of the Map is the age order (a refresh re-inserts), so the first key is the oldest.
    const entries = new Map<string, Entry>();

    const keyOf = (input: unknown): string | null => {
        if (typeof input !== 'string' || input === '' || input.includes('\0') || !p.isAbsolute(input)) return null;
        return fold(p.resolve(input));
    };

    const purge = () => {
        const t = now();
        for (const [key, entry] of entries) {
            if (entry.expiresAt <= t) entries.delete(key);
        }
    };

    return {
        grant(path, kind) {
            const key = keyOf(path);
            if (!key) return false;
            purge();
            entries.delete(key);
            entries.set(key, { expiresAt: now() + ttlMs, kind });
            while (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                if (oldest === undefined) break;
                entries.delete(oldest);
            }
            return true;
        },
        isGranted(path) {
            const key = keyOf(path);
            if (!key) return false;
            purge();
            return entries.has(key);
        },
        size() {
            purge();
            return entries.size;
        },
        clear() {
            entries.clear();
        },
    };
}
