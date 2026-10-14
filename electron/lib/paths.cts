// Pure path-safety helpers (no Electron / no I/O). Used to validate ids that become folder names
// and to make sure a joined path never escapes its base directory.
import * as nodePath from 'path';

const SAFE_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// Windows reserved device names (with or without an extension) are unusable as folder names.
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

/**
 * True for lowercase ids of 2-64 chars safe to use as a single folder name.
 * Rejects `..`, a trailing dot and Windows reserved device names.
 */
export function isSafeId(id: unknown): id is string {
    return typeof id === 'string' && SAFE_ID_RE.test(id) && !id.includes('..') && !id.endsWith('.') && !WIN_RESERVED_RE.test(id);
}

/**
 * Resolves `child` segments against the absolute `base` and returns the absolute result, or null
 * when the result is outside `base` (base itself counts as inside).
 *
 * NOTE: the check is purely lexical. It does NOT resolve symlinks, junctions or 8.3 short names,
 * so callers that delete or write (T-106 / T-117) must additionally verify with fs.realpath /
 * fs.lstat before touching the file system.
 */
export function resolveInside(base: string, ...child: string[]): string | null {
    return resolveInsideWith(nodePath, base, child);
}

/** Same as `resolveInside` but takes a path module, so tests can exercise win32 semantics on any OS. */
export function resolveInsideWith(p: typeof nodePath.posix, base: string, child: string[]): string | null {
    if (typeof base !== 'string' || base === '' || base.includes('\0')) return null;
    if (!p.isAbsolute(base)) return null;
    for (const seg of child) {
        if (typeof seg !== 'string' || seg.includes('\0')) return null;
    }

    const isWin = p.sep === '\\';
    const resolvedBase = p.resolve(base);

    // Reject segments that are absolute or carry a drive/UNC/root prefix: path.resolve would
    // silently discard everything before them.
    for (const seg of child) {
        if (p.isAbsolute(seg)) return null;
        if (isWin && (/^[a-zA-Z]:/.test(seg) || /^[\\/]/.test(seg))) return null;
    }

    const target = p.resolve(resolvedBase, ...child);
    // Fold ASCII only: toLowerCase() would also fold Unicode (e.g. Kelvin sign U+212A -> 'k'),
    // which NTFS does not treat as equal and would let a path appear inside the base.
    const fold = (s: string) => (isWin ? s.replace(/[A-Z]/g, (c) => c.toLowerCase()) : s);
    const b = fold(resolvedBase);
    const t = fold(target);
    if (t === b) return target;
    return t.startsWith(b.endsWith(p.sep) ? b : b + p.sep) ? target : null;
}
