// Last-used folder per file dialog kind (T-037). Electron 43+ no longer remembers the last folder of the native file
// dialogs, so main stores it in userData/dialog-paths.json. Pure validation plus two small file helpers (read tolerant,
// write atomic); no Electron access, unit tested in tests/dialogPaths.test.ts.
import * as fs from 'fs';
import * as nodePath from 'path';
import { isPlainAbsolutePath } from './fileArgs.cjs';

export const DIALOG_PATHS_FILE_NAME = 'dialog-paths.json';
/** A handful of short paths; anything larger is not ours and is ignored. */
export const DIALOG_PATHS_FILE_MAX_BYTES = 16 * 1024;
export const DIALOG_PATH_MAX_LENGTH = 1024;

/** Only these dialogs remember their folder. Unknown keys in the file are dropped. */
export const DIALOG_KINDS = ['save-note-text', 'install-zip', 'save-full-backup'] as const;
export type DialogKind = (typeof DIALOG_KINDS)[number];
export type DialogPaths = Partial<Record<DialogKind, string>>;

function isDialogKind(value: string): value is DialogKind {
    return (DIALOG_KINDS as readonly string[]).includes(value);
}

function hasControlChars(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) < 0x20) return true;
    }
    return false;
}

// UNC / network roots (two leading slashes or backslashes): a stat on an offline share can block for SMB timeouts.
const UNC_PREFIX = /^[\\/]{2}/;

/**
 * A remembered folder must be a plain absolute local path (no device/ADS/UNC paths), at most 1024 chars, no control
 * chars. UNC roots are rejected so a tampered file cannot make main stat a network share.
 */
export function isValidDialogDir(value: unknown, platform: string = process.platform): value is string {
    return (
        typeof value === 'string' &&
        value.length <= DIALOG_PATH_MAX_LENGTH &&
        !hasControlChars(value) &&
        !UNC_PREFIX.test(value) &&
        isPlainAbsolutePath(value, platform)
    );
}

/** Keeps only known kinds with a valid folder. Anything that is not a plain object yields `{}`. Never throws. */
export function validateDialogPaths(input: unknown, platform: string = process.platform): DialogPaths {
    const out: DialogPaths = {};
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
    try {
        for (const key of Object.keys(input)) {
            if (!isDialogKind(key)) continue;
            const value = (input as Record<string, unknown>)[key];
            if (isValidDialogDir(value, platform)) out[key] = value;
        }
    } catch {
        return {};
    }
    return out;
}

/** Returns a new map with `dir` remembered for `kind`; an invalid folder leaves the map unchanged. */
export function rememberDialogDir(paths: DialogPaths, kind: DialogKind, dir: unknown, platform: string = process.platform): DialogPaths {
    if (!isDialogKind(kind) || !isValidDialogDir(dir, platform)) return { ...paths };
    return { ...paths, [kind]: dir };
}

/**
 * The `defaultPath` to pass to the dialog: the remembered folder (joined with `fileName` when given) if it still
 * exists as a directory, otherwise `fileName` alone (or undefined). Async so the existence check never blocks the
 * main process. `isDirectory` is injectable for tests. Never rejects.
 */
export async function dialogDefaultPath(
    paths: DialogPaths,
    kind: DialogKind,
    fileName?: string,
    isDirectory: (p: string) => Promise<boolean> = isExistingDirectory
): Promise<string | undefined> {
    const dir = paths[kind];
    let exists = false;
    if (dir && isValidDialogDir(dir)) {
        try {
            exists = await isDirectory(dir);
        } catch {
            exists = false;
        }
    }
    if (dir && exists) return fileName ? nodePath.join(dir, fileName) : dir;
    return fileName || undefined;
}

/**
 * `defaultPath` for the screenshot save dialog (T-042): `fileName` inside the renderer-supplied folder when it is a
 * valid local folder path (same rules as remembered folders, so no UNC/device/ADS paths), otherwise inside
 * `fallbackDir`. Purely lexical (no fs access), never throws.
 */
export function screenshotDialogDefaultPath(
    requestedDir: unknown,
    fallbackDir: string,
    fileName: string,
    platform: string = process.platform
): string {
    const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    return p.join(isValidDialogDir(requestedDir, platform) ? requestedDir : fallbackDir, fileName);
}

async function isExistingDirectory(p: string): Promise<boolean> {
    try {
        return (await fs.promises.stat(p)).isDirectory();
    } catch {
        return false;
    }
}

/** Reads the saved folders. Missing, oversized, corrupt or invalid files yield `{}`. Never throws. */
export function readDialogPathsFile(filePath: string): DialogPaths {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > DIALOG_PATHS_FILE_MAX_BYTES) return {};
        return validateDialogPaths(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return {};
    }
}

/** Validates and writes atomically (temp file in the same folder + rename). Never throws; false on failure. */
export function writeDialogPathsFileAtomic(filePath: string, paths: DialogPaths): boolean {
    const valid = validateDialogPaths(paths);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(valid, null, 2), { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, filePath);
        return true;
    } catch {
        try {
            fs.rmSync(tempPath, { force: true });
        } catch {
            /* ignore */
        }
        return false;
    }
}

/** Remembers the folder of a picked/saved file and persists it. Never throws; false when nothing was written. */
export function recordDialogPick(filePath: string, kind: DialogKind, pickedFile: unknown): boolean {
    try {
        if (typeof pickedFile !== 'string' || !isValidDialogDir(pickedFile)) return false;
        const dir = nodePath.dirname(pickedFile);
        const current = readDialogPathsFile(filePath);
        if (current[kind] === dir) return true;
        const next = rememberDialogDir(current, kind, dir);
        if (next[kind] !== dir) return false;
        return writeDialogPathsFileAtomic(filePath, next);
    } catch {
        return false;
    }
}
