// Guards for extracting untrusted plugin ZIP archives: entry/size limits, rejection of absolute
// paths, traversal and symlink entries, and a confined extractor that counts real bytes.
import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveInside } from './paths.cjs';
import { isFsPathInside } from './fsGuards.cjs';

export interface ZipLimits {
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
}

// Official plugin zips are a few MB and a few hundred files; these leave generous headroom.
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
    maxEntries: 2000,
    maxEntryBytes: 50 * 1024 * 1024,
    maxTotalBytes: 150 * 1024 * 1024,
};

export interface ZipEntryInfo {
    entryName: string;
    /** Uncompressed size from the header (may lie; real bytes are re-checked while extracting). */
    size: number;
    isDirectory: boolean;
    /** ZIP external file attributes (unix mode in the high 16 bits). */
    attr?: number;
}

export type ZipCheck = { ok: true } | { ok: false; reason: string };

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

const fail = (reason: string): ZipCheck => ({ ok: false, reason });

/** Returns a reason when the entry name is unsafe, otherwise null. */
export function unsafeEntryName(name: unknown): string | null {
    if (typeof name !== 'string' || name === '') return 'empty entry name';
    if (name.includes('\0')) return 'entry name contains NUL';
    if (name.startsWith('/') || name.startsWith('\\')) return 'absolute entry path';
    if (/^[a-zA-Z]:/.test(name)) return 'drive-letter entry path';
    // Treat both separators as separators so "..\\x" tricks are caught on every OS.
    const parts = name.split(/[\\/]+/);
    if (parts.includes('..')) return 'path traversal entry';
    for (const part of parts) {
        if (part === '' || part === '.') continue;
        // Windows-unsafe parts: stream/drive/wildcard characters, trailing dot or space, device names.
        if (/[:<>|"?*]/.test(part)) return 'Windows-unsafe character in entry name';
        if (/[. ]$/.test(part)) return 'trailing dot or space in entry name';
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part)) return 'reserved device name in entry';
    }
    return null;
}

/** Validates the entry list against the limits and rejects unsafe or link entries. */
export function validateZipEntries(entries: readonly ZipEntryInfo[], limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipCheck {
    if (entries.length > limits.maxEntries) return fail(`ZIP has too many entries (limit ${limits.maxEntries}).`);
    let total = 0;
    for (const e of entries) {
        const bad = unsafeEntryName(e.entryName);
        if (bad) return fail(`Unsafe ZIP entry (${bad}).`);
        const mode = typeof e.attr === 'number' ? (e.attr >>> 16) & S_IFMT : 0;
        if (mode === S_IFLNK) return fail('ZIP contains a symbolic link entry.');
        if (mode !== 0 && mode !== S_IFREG && mode !== S_IFDIR) return fail('ZIP contains a special file entry.');
        if (e.isDirectory) continue;
        if (!Number.isFinite(e.size) || e.size < 0) return fail('ZIP entry has an invalid size.');
        if (e.size > limits.maxEntryBytes) return fail(`ZIP entry is too large (limit ${limits.maxEntryBytes} bytes).`);
        total += e.size;
        if (total > limits.maxTotalBytes) return fail(`ZIP is too large when extracted (limit ${limits.maxTotalBytes} bytes).`);
    }
    return { ok: true };
}

/** Minimal slice of the adm-zip API used here (keeps the library swappable, see T-118). */
export interface ZipLike {
    getEntries(): Array<{
        entryName: string;
        isDirectory: boolean;
        attr?: number;
        header: { size: number };
        getData(): Buffer;
    }>;
}

/**
 * Extracts `zip` into the existing/creatable `destDir` after validating it. Every output path goes
 * through resolveInside + a link check, and actual decompressed bytes are counted against the limits.
 * Throws an Error with a human-readable reason on any violation; the caller cleans up `destDir`.
 */
export function extractZipSafely(zip: ZipLike, destDir: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): void {
    const entries = zip.getEntries();
    const check = validateZipEntries(
        entries.map((e) => ({ entryName: e.entryName, size: e.header.size, isDirectory: e.isDirectory, attr: e.attr })),
        limits
    );
    if (!check.ok) throw new Error(check.reason);

    fs.mkdirSync(destDir, { recursive: true });
    let total = 0;
    for (const entry of entries) {
        const target = resolveInside(destDir, entry.entryName);
        // A directory entry such as './' resolves to the extraction folder itself: nothing to do.
        if (entry.isDirectory && target === nodePath.resolve(destDir)) continue;
        if (!target || target === nodePath.resolve(destDir) || !isFsPathInside(destDir, target)) {
            throw new Error('ZIP entry resolves outside the extraction folder.');
        }
        if (entry.isDirectory) {
            fs.mkdirSync(target, { recursive: true });
            continue;
        }
        const data = entry.getData();
        total += data.length;
        if (data.length > limits.maxEntryBytes) throw new Error(`ZIP entry is too large (limit ${limits.maxEntryBytes} bytes).`);
        if (total > limits.maxTotalBytes) throw new Error(`ZIP is too large when extracted (limit ${limits.maxTotalBytes} bytes).`);
        fs.mkdirSync(nodePath.dirname(target), { recursive: true });
        // Re-check after creating parents: a parent must not have become a link.
        if (!isFsPathInside(destDir, target)) throw new Error('ZIP entry resolves outside the extraction folder.');
        fs.writeFileSync(target, data);
    }
}
