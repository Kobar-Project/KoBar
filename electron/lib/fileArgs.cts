// Argument guards for IPC handlers that receive file paths or file content from the renderer
// (and therefore from plugins): save-screenshot, parse-file and kobox-drop (SEC-02).
// No Electron imports, so everything here is unit-testable with plain temp folders.
import * as fs from 'fs';
import * as nodePath from 'path';
import { resolveInside } from './paths.cjs';
import { isFsPathInside } from './fsGuards.cjs';
import { KOBOX_FOLDER_LIMITS, measureFolder, type FolderLimits } from './folderLimits.cjs';

export type GuardResult = { ok: true } | { ok: false; reason: string };

// ─── Generic path checks ─────────────────────────────────────────

// Windows reserved device names; reserved with any extension too (e.g. "CON.png", "nul.txt").
const WIN_RESERVED_STEM_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** True on Windows when the last path component is a device name such as CON, NUL or COM1.png. */
export function hasReservedDeviceName(filePath: string, platform: string = process.platform): boolean {
    if (platform !== 'win32') return false;
    const base = nodePath.win32.basename(filePath);
    // Windows ignores trailing dots/spaces and everything after the first dot when matching device names.
    const stem = base
        .replace(/[. ]+$/, '')
        .split('.')[0]
        .trim();
    return WIN_RESERVED_STEM_RE.test(stem);
}

/** True for Win32 device-namespace paths (\\.\ or \\?\), which bypass normal path parsing. */
export function isDeviceNamespacePath(filePath: string): boolean {
    return /^[\\/]{2}[.?][\\/]/.test(filePath);
}

/** True on Windows when a `:` appears after the drive letter (NTFS alternate data stream, e.g. `a.png:evil`). */
export function hasAlternateDataStream(filePath: string, platform: string = process.platform): boolean {
    if (platform !== 'win32') return false;
    const rest = /^[a-zA-Z]:/.test(filePath) ? filePath.slice(2) : filePath;
    return rest.includes(':');
}

/** Basic shape check shared by every handler: absolute string path, no NUL, no device paths, no ADS. */
export function isPlainAbsolutePath(filePath: unknown, platform: string = process.platform): filePath is string {
    return (
        typeof filePath === 'string' &&
        filePath !== '' &&
        !filePath.includes('\0') &&
        // Use the given platform's rules, not the host's (a Linux CI run checks Windows paths too).
        (platform === 'win32' ? nodePath.win32 : nodePath.posix).isAbsolute(filePath) &&
        !isDeviceNamespacePath(filePath) &&
        !hasReservedDeviceName(filePath, platform) &&
        !hasAlternateDataStream(filePath, platform)
    );
}

function realpathOrNull(p: string): string | null {
    try {
        return fs.realpathSync.native(p);
    } catch {
        try {
            return fs.realpathSync(p);
        } catch {
            return null;
        }
    }
}

function lexicallyInside(root: string, target: string): boolean {
    const resolvedRoot = nodePath.resolve(root);
    const rel = nodePath.relative(resolvedRoot, nodePath.resolve(target));
    if (rel === '') return true;
    // A path on another drive yields an absolute "relative" path, which resolveInside rejects.
    return resolveInside(resolvedRoot, rel) !== null;
}

/**
 * Real location of `target`: its realpath, or for a path that does not exist yet the realpath of
 * its parent joined with the name (so a junction parent is still resolved). Null if neither resolves.
 */
function realLocation(target: string): string | null {
    const real = realpathOrNull(target);
    if (real) return real;
    const realParent = realpathOrNull(nodePath.dirname(target));
    return realParent ? nodePath.join(realParent, nodePath.basename(target)) : null;
}

/** Each usable root in its given form plus its resolved form. */
function rootForms(roots: readonly string[]): string[] {
    const out: string[] = [];
    for (const root of roots) {
        if (typeof root !== 'string' || root === '' || !nodePath.isAbsolute(root)) continue;
        out.push(root);
        const realRoot = realpathOrNull(root);
        if (realRoot) out.push(realRoot);
    }
    return out;
}

/**
 * True when `target` is inside (or equal to) any of `roots`. Compared both lexically and after
 * resolving links/junctions/8.3 names on each side, so a link that points into a root is caught.
 */
export function isInsideAnyRoot(target: string, roots: readonly string[]): boolean {
    const targets = [target];
    const real = realLocation(target);
    if (real) targets.push(real);
    const forms = rootForms(roots);
    return targets.some((t) => forms.some((r) => lexicallyInside(r, t)));
}

/** True when any of `roots` lies inside (or equals) `target`, i.e. `target` is a parent of a root. */
export function containsAnyRoot(target: string, roots: readonly string[]): boolean {
    const targets = [target];
    const real = realLocation(target);
    if (real) targets.push(real);
    const forms = rootForms(roots);
    return targets.some((t) => forms.some((r) => lexicallyInside(t, r)));
}

/**
 * Inside a protected root and not inside one of the allowed exceptions (e.g. userData minus KoBox).
 * The exception is judged on the real location only when it resolves, so a junction inside KoBox
 * that points elsewhere in userData does not inherit KoBox's exception.
 */
export function isProtectedPath(target: string, protectedRoots: readonly string[], allowedRoots: readonly string[] = []): boolean {
    if (!isInsideAnyRoot(target, protectedRoots)) return false;
    const effective = realLocation(target) ?? target;
    const allowed = rootForms(allowedRoots);
    return !allowed.some((r) => lexicallyInside(r, effective));
}

// ─── save-screenshot ─────────────────────────────────────────────

export type ImageKind = 'png' | 'jpeg' | 'webp';

const IMAGE_EXT_KIND: Record<string, ImageKind> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };

/** Allowed `format` values for save-screenshot (case-insensitive), normalised to lower case. */
export function normalizeImageFormat(format: unknown): 'png' | 'jpg' | 'jpeg' | 'webp' | null {
    if (typeof format !== 'string') return null;
    const f = format.trim().toLowerCase().replace(/^\./, '');
    return f === 'png' || f === 'jpg' || f === 'jpeg' || f === 'webp' ? f : null;
}

/** Image kind implied by the file extension, or null when the extension is not an allowed image type. */
export function imageKindFromPath(filePath: string): ImageKind | null {
    const ext = nodePath.extname(filePath).slice(1).toLowerCase();
    return IMAGE_EXT_KIND[ext] ?? null;
}

/** Detects the image type from the leading magic bytes. */
export function detectImageKind(buf: Uint8Array): ImageKind | null {
    const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buf.length >= 8 && PNG.every((b, i) => buf[i] === b)) return 'png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
    if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    return null;
}

/** Upper bound for the base64 screenshot payload (characters), about 75 MB of image data. */
export const SCREENSHOT_MAX_PAYLOAD_CHARS = 100 * 1024 * 1024;

/**
 * Decodes what the renderer sends as `buffer`: an image data URL (`data:image/...;base64,`) or a
 * bare base64 string, matching the old handler. Returns null for anything else or empty output.
 */
export function decodeImagePayload(payload: unknown): Buffer | null {
    if (typeof payload !== 'string' || payload === '' || payload.length > SCREENSHOT_MAX_PAYLOAD_CHARS) return null;
    let base64 = payload;
    if (payload.startsWith('data:')) {
        const m = /^data:image\/[\w.+-]+;base64,/i.exec(payload);
        if (!m) return null;
        base64 = payload.slice(m[0].length);
    }
    const buf = Buffer.from(base64, 'base64');
    return buf.length > 0 ? buf : null;
}

/** The save target must not exist yet or be a regular file (no directory, link/junction or device). */
export function checkWritableFileTarget(filePath: string): GuardResult {
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(filePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
        return { ok: false, reason: 'target-unreadable' };
    }
    if (stat.isSymbolicLink()) return { ok: false, reason: 'target-is-link' };
    if (!stat.isFile()) return { ok: false, reason: 'target-not-regular-file' };
    return { ok: true };
}

/**
 * Full check for save-screenshot: path shape, image extension, matching magic bytes, regular-file target.
 * The target check is check-then-write (TOCTOU): Windows offers no "do not follow links" open flag, so
 * a link created between this check and the write is not detected. Acceptable for a user-chosen path.
 */
export function validateScreenshotSave(filePath: unknown, image: Uint8Array | null, platform: string = process.platform): GuardResult {
    if (!isPlainAbsolutePath(filePath, platform) || hasAlternateDataStream(filePath, platform))
        return { ok: false, reason: 'invalid-path' };
    const extKind = imageKindFromPath(filePath);
    if (!extKind) return { ok: false, reason: 'invalid-extension' };
    if (!image || image.length === 0) return { ok: false, reason: 'invalid-image-data' };
    if (detectImageKind(image) !== extKind) return { ok: false, reason: 'content-does-not-match-extension' };
    return checkWritableFileTarget(filePath);
}

// ─── parse-file ──────────────────────────────────────────────────

/** Upper bound for files AI Hub may attach (read fully into memory and sent to the renderer). */
export const PARSE_FILE_MAX_BYTES = 50 * 1024 * 1024;

export type ParseKind = 'pdf' | 'image' | 'text';

// Text-like formats AI Hub attaches as plain text (the old handler treated every non-PDF,
// non-image file as UTF-8 text). Secret-bearing names such as .env, .pem or .key are deliberately absent.
const TEXT_EXTENSIONS = new Set(
    `txt text md markdown rst adoc org tex rtf json jsonc json5 csv tsv log xml yaml yml toml ini cfg
    conf properties html htm css scss sass less svg js jsx mjs cjs ts tsx mts cts vue svelte astro py
    ipynb rb php pl lua r jl dart go rs swift kt kts scala groovy gradle java c h cc cpp cxx hpp hh cs
    fs vb m mm zig nim ex exs erl hs clj elm sql graphql gql proto sh bash zsh fish ps1 psm1 bat cmd srt
    vtt diff patch gitignore dockerfile makefile cmake jsonl ndjson mdx csproj vbproj fsproj vcxproj sln props
    targets xaml resx plist tf hcl nix`
        .split(/\s+/)
        .filter(Boolean)
);
// Extension-less well-known file names and config dot-files (compared lower-case, whole name).
const TEXT_NAMES = new Set(
    `readme license licence changelog changes authors contributors copying notice todo gemfile procfile
    jenkinsfile vagrantfile rakefile brewfile podfile dockerfile containerfile makefile gnumakefile justfile
    .editorconfig .gitignore .gitattributes .gitmodules .dockerignore .npmignore .prettierrc .prettierignore
    .eslintrc .eslintignore .babelrc .nvmrc .node-version .python-version .browserslistrc .stylelintrc`
        .split(/\s+/)
        .filter(Boolean)
);
// Names that commonly hold credentials are refused even when their extension would be allowed.
const SECRET_NAME_RE =
    /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\..*)?|\.npmrc|\.yarnrc(\.yml)?|\.netrc|_netrc|\.git-credentials|\.pgpass|\.htpasswd|credentials(\..*)?)$/;
const SECRET_EXT = new Set(['pem', 'key', 'p12', 'pfx', 'kdbx', 'keystore', 'jks', 'ppk', 'asc', 'gpg']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** Extension allow-list for parse-file. Returns how the file is read, or null when not allowed. */
export function classifyParseFile(filePath: string): ParseKind | null {
    const base = nodePath.basename(filePath).toLowerCase();
    const ext = nodePath.extname(base).slice(1);
    if (SECRET_NAME_RE.test(base) || SECRET_EXT.has(ext)) return null;
    // Extension-less well-known names ("README", "Dockerfile") and dot-files like ".gitignore".
    if (TEXT_NAMES.has(base)) return 'text';
    if (ext === 'pdf') return 'pdf';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    return null;
}

function fileTooLargeMessage(maxBytes: number): string {
    return `File is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`;
}

/**
 * Reads a regular file read-only with a size cap. Rejects links/junctions, directories and other
 * non-regular files. Type, size and identity (dev/ino) are re-checked on the opened handle (fstat),
 * so a file swapped between the lstat and the open is refused instead of read.
 * Blocks the calling thread: the main process uses `readRegularFileLimitedAsync` (T-318).
 */
export function readRegularFileLimited(filePath: string, maxBytes: number): Buffer {
    const pre = fs.lstatSync(filePath);
    if (pre.isSymbolicLink()) throw new Error('File is a link');
    if (!pre.isFile()) throw new Error('Not a regular file');
    if (pre.size > maxBytes) throw new Error(fileTooLargeMessage(maxBytes));
    const fd = fs.openSync(filePath, 'r');
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) throw new Error('Not a regular file');
        if (st.dev !== pre.dev || st.ino !== pre.ino) throw new Error('File changed while opening');
        if (st.size > maxBytes) throw new Error(fileTooLargeMessage(maxBytes));
        const out = Buffer.alloc(st.size);
        let offset = 0;
        while (offset < st.size) {
            const n = fs.readSync(fd, out, offset, st.size - offset, offset);
            if (n === 0) break;
            offset += n;
        }
        return offset === st.size ? out : out.subarray(0, offset);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * `readRegularFileLimited` without blocking the main process (T-318): the same checks in the same order (lstat type
 * and size, then type, identity and size again on the opened handle) and the same error messages.
 */
export async function readRegularFileLimitedAsync(filePath: string, maxBytes: number): Promise<Buffer> {
    const pre = await fs.promises.lstat(filePath);
    if (pre.isSymbolicLink()) throw new Error('File is a link');
    if (!pre.isFile()) throw new Error('Not a regular file');
    if (pre.size > maxBytes) throw new Error(fileTooLargeMessage(maxBytes));
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const st = await handle.stat();
        if (!st.isFile()) throw new Error('Not a regular file');
        if (st.dev !== pre.dev || st.ino !== pre.ino) throw new Error('File changed while opening');
        if (st.size > maxBytes) throw new Error(fileTooLargeMessage(maxBytes));
        const out = Buffer.alloc(st.size);
        let offset = 0;
        while (offset < st.size) {
            const { bytesRead } = await handle.read(out, offset, st.size - offset, offset);
            if (bytesRead === 0) break;
            offset += bytesRead;
        }
        return offset === st.size ? out : out.subarray(0, offset);
    } finally {
        await handle.close();
    }
}

// ─── kobox-drop ──────────────────────────────────────────────────

export type KoBoxSourceCheck = { ok: true; kind: 'file' | 'dir' } | { ok: false; reason: string };

/** The dropped source must exist, be a regular file or folder (not a link) and lie outside the protected roots. */
export function validateKoBoxSource(src: unknown, protectedRoots: readonly string[]): KoBoxSourceCheck {
    if (!isPlainAbsolutePath(src)) return { ok: false, reason: 'invalid-path' };
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(src);
    } catch {
        return { ok: false, reason: 'source-missing' };
    }
    if (stat.isSymbolicLink()) return { ok: false, reason: 'source-is-link' };
    if (!stat.isFile() && !stat.isDirectory()) return { ok: false, reason: 'source-not-regular' };
    if (isInsideAnyRoot(src, protectedRoots)) return { ok: false, reason: 'source-inside-app-data' };
    // A parent folder of userData (e.g. AppData\Roaming) would copy the whole app data into KoBox.
    if (containsAnyRoot(src, protectedRoots)) return { ok: false, reason: 'source-contains-app-data' };
    return { ok: true, kind: stat.isDirectory() ? 'dir' : 'file' };
}

const MAX_COLLISION_ATTEMPTS = 1000;

/**
 * Windows-style collision name: n <= 1 returns the name unchanged, otherwise "name (n).ext" for a file and
 * "name (n)" for a folder (a folder's dots are not an extension). Pure; callers still check the result stays inside KoBox.
 */
export function withCollisionSuffix(name: string, n: number, isDir: boolean): string {
    if (n <= 1) return name;
    const ext = isDir ? '' : nodePath.extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    return `${stem} (${n})${ext}`;
}

/** Copies the files and folders inside `from` into the existing folder `to`; never overwrites, skips links and special files. */
async function copyFolderContents(from: string, to: string): Promise<void> {
    for (const name of await fs.promises.readdir(from)) {
        const a = nodePath.join(from, name);
        const b = nodePath.join(to, name);
        const st = await fs.promises.lstat(a);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
            await fs.promises.mkdir(b);
            await copyFolderContents(a, b);
        } else if (st.isFile()) {
            await fs.promises.copyFile(a, b, fs.constants.COPYFILE_EXCL);
        }
    }
}

/**
 * Copies one dropped file or folder into KoBox (the source is left untouched). Validation is
 * synchronous; the copy itself is asynchronous so large drops do not block the main process.
 * The destination is a direct child of KoBox named after the source; if that name is taken it becomes
 * "name (2)", "name (3).ext" and so on (R-03), so nothing existing is ever overwritten, merged into or replaced. Links inside a dropped folder are skipped. If a folder copy fails partway, the
 * folder this call created is removed. The copy's mtime is set to "now" so the 24-hour cleanup
 * counts from the drop, not from the original file's last edit. A file larger than `folderLimits.maxBytes`
 * or a folder over either limit is refused with 'too-large' before anything is copied (T-042).
 */
export async function copyIntoKoBox(
    src: unknown,
    koBoxPath: string,
    protectedRoots: readonly string[],
    folderLimits: FolderLimits = KOBOX_FOLDER_LIMITS
): Promise<GuardResult & { dest?: string }> {
    const check = validateKoBoxSource(src, protectedRoots);
    if (!check.ok) return check;
    const source = src as string;

    const baseName = nodePath.basename(source);
    const koBoxRoot = nodePath.resolve(koBoxPath);
    /** A direct child of KoBox for the n-th candidate name, or null if it would leave KoBox. */
    const candidate = (n: number): string | null => {
        const target = resolveInside(koBoxPath, withCollisionSuffix(baseName, n, check.kind === 'dir'));
        if (!target || nodePath.dirname(target) !== koBoxRoot || !isFsPathInside(koBoxPath, target)) return null;
        return target;
    };
    if (!candidate(1)) return { ok: false, reason: 'invalid-destination' };

    const now = new Date();
    let dest = '';
    if (check.kind === 'file') {
        // A single file shares the folder byte limit (T-042).
        let size: number;
        try {
            size = fs.lstatSync(source).size;
        } catch {
            return { ok: false, reason: 'source-missing' };
        }
        if (size > folderLimits.maxBytes) return { ok: false, reason: 'too-large' };
        // COPYFILE_EXCL fails with EEXIST instead of overwriting (or following a link at the target), so the
        // first free name is claimed atomically even if a concurrent drop picks the same one.
        for (let n = 1; n <= MAX_COLLISION_ATTEMPTS && !dest; n++) {
            const target = candidate(n);
            if (!target) return { ok: false, reason: 'invalid-destination' };
            try {
                await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
                dest = target;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
                    // EEXIST was excluded above, so a half-written target can only be ours: remove it, the source is untouched.
                    await fs.promises.unlink(target).catch(() => undefined);
                    throw err;
                }
            }
        }
        if (!dest) return { ok: false, reason: 'destination-exists' };
    } else {
        // Entry / size limit checked before anything is created or copied (T-042).
        const measure = await measureFolder(source, folderLimits);
        if (!measure.ok) return { ok: false, reason: measure.reason === 'too-large' ? 'too-large' : 'source-unreadable' };
        // Non-recursive mkdir fails with EEXIST if the name is taken (also by a concurrent drop), so the
        // name is claimed atomically and the folder removed on failure below is always the one this call created.
        for (let n = 1; n <= MAX_COLLISION_ATTEMPTS && !dest; n++) {
            const target = candidate(n);
            if (!target) return { ok: false, reason: 'invalid-destination' };
            try {
                await fs.promises.mkdir(target);
                dest = target;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return { ok: false, reason: 'destination-unwritable' };
            }
        }
        if (!dest) return { ok: false, reason: 'destination-exists' };
        // An explicit walker instead of fs.cp: newer Node versions (as bundled in Electron 44) refuse an existing
        // destination root with errorOnExist, and the root was just claimed above. Links and special files are skipped.
        // The source is only read here, never modified, so a failure leaves it intact and removes only the folder claimed above.
        try {
            await copyFolderContents(source, dest);
        } catch (err) {
            await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => undefined);
            throw err;
        }
    }
    await fs.promises.utimes(dest, now, now);
    return { ok: true, dest };
}
