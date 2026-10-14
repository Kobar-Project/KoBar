// T-402: atomic file writes for the file-backed store. A temp file is written with `wx` and
// fsync'd, then renamed over the target. Windows scanners/indexers may briefly hold the target (EPERM/EBUSY/EACCES), so
// the rename is retried with a growing, jittered delay. On final failure the temp file is removed and the target is left
// untouched. Unlike restoreBackup.cts `writeJsonFileAtomic` (sync, no retry), the retry wait can be asynchronous so the
// main process is not blocked. No Electron imports; fs, sleep and randomness are injectable for unit tests.
import * as nodeFs from 'fs';
import * as nodePath from 'path';

/** The subset of `fs` the storage service uses (injectable for tests). */
export interface StorageFs {
    mkdirSync(p: string, options: { recursive: true }): unknown;
    openSync(p: string, flags: string): number;
    writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
    fsyncSync(fd: number): void;
    closeSync(fd: number): void;
    renameSync(from: string, to: string): void;
    copyFileSync(src: string, dest: string, mode: number): void;
    unlinkSync(p: string): void;
    readFileSync(p: string, encoding: 'utf8'): string;
    statSync(p: string): { size: number; isFile(): boolean };
    readdirSync(p: string): string[];
}

export const realStorageFs: StorageFs = nodeFs as unknown as StorageFs;

/** `fs.constants.COPYFILE_EXCL`: a copy never replaces an existing file. */
export const COPYFILE_EXCL = 1;

/** Error codes a rename is retried on (antivirus / indexer holding the file on Windows). */
export const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Total rename attempts (5 tries, 20-200 ms growing back-off). */
export const RENAME_MAX_ATTEMPTS = 5;
export const RENAME_MIN_DELAY_MS = 20;
export const RENAME_MAX_DELAY_MS = 200;

export interface RetryTiming {
    random: () => number;
}

/** Delay after failed attempt `attempt` (1-based): 20, 40, 80, 160 ms plus up to 25% jitter, never above 200 ms. */
export function renameRetryDelayMs(attempt: number, random: () => number): number {
    const base = Math.min(RENAME_MAX_DELAY_MS, RENAME_MIN_DELAY_MS * 2 ** Math.max(0, attempt - 1));
    const jitter = base * 0.25 * Math.min(1, Math.max(0, random()));
    return Math.min(RENAME_MAX_DELAY_MS, Math.round(base + jitter));
}

/** The `code` of a Node fs error, or 'UNKNOWN'. */
export function fsErrorCode(err: unknown): string {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return typeof code === 'string' && code !== '' ? code : 'UNKNOWN';
}

export function isRetryableRenameError(err: unknown): boolean {
    return RENAME_RETRY_CODES.has(fsErrorCode(err));
}

/** Removes a file and ignores every error (best effort cleanup). */
export function removeQuietly(fs: StorageFs, p: string): void {
    try {
        fs.unlinkSync(p);
    } catch {
        /* ignore */
    }
}

/** Best-effort directory fsync so the rename itself is durable. Windows cannot open a directory this way; errors are ignored. */
export function fsyncDirQuietly(fs: StorageFs, dir: string): void {
    let fd: number | null = null;
    try {
        fd = fs.openSync(dir, 'r');
        fs.fsyncSync(fd);
    } catch {
        /* ignore: not supported on this platform/file system */
    } finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch {
                /* ignore */
            }
        }
    }
}

let tempCounter = 0;

/**
 * A temp file name for `baseName` inside `tmpDir`: `<baseName>.<pid>.<counter>-<rand>.tmp`. The process-wide counter keeps
 * two temp files that exist at the same time distinct even when `random` repeats (`wx` would fail with EEXIST).
 */
export function tempFilePath(tmpDir: string, baseName: string, pid: number, random: () => number): string {
    tempCounter = (tempCounter + 1) % Number.MAX_SAFE_INTEGER;
    const rand = Math.floor(Math.min(0.999999, Math.max(0, random())) * 36 ** 8)
        .toString(36)
        .padStart(8, '0');
    return nodePath.join(tmpDir, `${baseName}.${pid}.${tempCounter.toString(36)}-${rand}.tmp`);
}

/**
 * Writes `data` (a string as UTF-8, or raw bytes; T-411 writes encrypted blobs) to a NEW file `tempPath` (`wx`: fails if
 * it exists) and fsyncs it before closing. On any failure the partial temp file is removed and the error is rethrown.
 */
export function writeTempFile(fs: StorageFs, tempPath: string, data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    let fd: number | null = null;
    try {
        fd = fs.openSync(tempPath, 'wx');
        let offset = 0;
        while (offset < bytes.length) {
            const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
            if (!(written > 0)) throw Object.assign(new Error('short write'), { code: 'EIO' });
            offset += written;
        }
        fs.fsyncSync(fd);
        const closing = fd;
        fd = null;
        fs.closeSync(closing);
    } catch (err) {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch {
                /* ignore */
            }
        }
        removeQuietly(fs, tempPath);
        throw err;
    }
}

export type RenameOutcome = { ok: true; attempts: number } | { ok: false; code: string; attempts: number; aborted?: boolean };

/**
 * `rename(from, to)` with the Windows retry policy, waiting asynchronously between attempts. `shouldContinue` is asked
 * after every wait; returning false stops with `aborted: true` (a newer write already landed). Never throws and never
 * removes `from`: the caller decides what to do with the temp file.
 */
export async function renameWithRetry(
    fs: StorageFs,
    from: string,
    to: string,
    options: RetryTiming & { sleep: (ms: number) => Promise<void>; shouldContinue?: () => boolean }
): Promise<RenameOutcome> {
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(from, to);
            return { ok: true, attempts: attempt };
        } catch (err) {
            if (!isRetryableRenameError(err) || attempt >= RENAME_MAX_ATTEMPTS)
                return { ok: false, code: fsErrorCode(err), attempts: attempt };
        }
        await options.sleep(renameRetryDelayMs(attempt, options.random));
        if (options.shouldContinue && !options.shouldContinue()) return { ok: false, code: 'ABORTED', attempts: attempt, aborted: true };
    }
}

/** Same as `renameWithRetry` but blocks between attempts (used by the synchronous write path only). */
export function renameWithRetrySync(
    fs: StorageFs,
    from: string,
    to: string,
    options: RetryTiming & { sleepSync: (ms: number) => void }
): RenameOutcome {
    for (let attempt = 1; ; attempt++) {
        try {
            fs.renameSync(from, to);
            return { ok: true, attempts: attempt };
        } catch (err) {
            if (!isRetryableRenameError(err) || attempt >= RENAME_MAX_ATTEMPTS)
                return { ok: false, code: fsErrorCode(err), attempts: attempt };
        }
        options.sleepSync(renameRetryDelayMs(attempt, options.random));
    }
}

/** Blocks the current thread for `ms` (default synchronous sleep). */
export function blockingSleep(ms: number): void {
    if (ms <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function timerSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AtomicWriteOutcome = { ok: true } | { ok: false; code: string };

/**
 * Synchronous atomic write: temp file in `tmpDir` (same volume as the target), fsync, rename with retry, directory fsync.
 * On failure the temp file is removed and the target is untouched. Never throws.
 */
export function atomicWriteFileSync(
    fs: StorageFs,
    target: string,
    tmpDir: string,
    data: string | Uint8Array,
    options: RetryTiming & { sleepSync: (ms: number) => void; pid: number }
): AtomicWriteOutcome {
    const tempPath = tempFilePath(tmpDir, nodePath.basename(target), options.pid, options.random);
    try {
        writeTempFile(fs, tempPath, data);
    } catch (err) {
        return { ok: false, code: fsErrorCode(err) };
    }
    const renamed = renameWithRetrySync(fs, tempPath, target, options);
    if (!renamed.ok) {
        removeQuietly(fs, tempPath);
        return { ok: false, code: renamed.code };
    }
    fsyncDirQuietly(fs, nodePath.dirname(target));
    return { ok: true };
}
