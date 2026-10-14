import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    PARSE_FILE_MAX_BYTES,
    classifyParseFile,
    copyIntoKoBox,
    withCollisionSuffix,
    SCREENSHOT_MAX_PAYLOAD_CHARS,
    containsAnyRoot,
    decodeImagePayload,
    detectImageKind,
    hasAlternateDataStream,
    hasReservedDeviceName,
    isInsideAnyRoot,
    isPlainAbsolutePath,
    isProtectedPath,
    normalizeImageFormat,
    readRegularFileLimited,
    readRegularFileLimitedAsync,
    validateKoBoxSource,
    validateScreenshotSave,
} from '../electron/lib/fileArgs.cjs';

// Synthetic temp folders only (never the real userData).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const EXE = Buffer.from('MZ\x90\x00 this is not an image');

let root: string;
let userData: string;
let koBox: string;
let outside: string;
let linkSupported = true;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-fileargs-'));
    userData = path.join(root, 'userData');
    koBox = path.join(userData, 'KoBox');
    outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(userData, 'extensions', 'plugin-a'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'extensions', 'plugin-a', 'index.js'), 'x');
    fs.mkdirSync(koBox, { recursive: true });
    fs.mkdirSync(path.join(outside, 'folder', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'doc.txt'), 'hello');
    fs.writeFileSync(path.join(outside, 'folder', 'a.txt'), 'a');
    fs.writeFileSync(path.join(outside, 'folder', 'sub', 'b.txt'), 'b');
    try {
        // 'junction' needs no admin rights on Windows; it is ignored (plain symlink) elsewhere.
        fs.symlinkSync(userData, path.join(outside, 'link-to-userdata'), 'junction');
        fs.symlinkSync(path.join(outside, 'folder'), path.join(outside, 'folder-link'), 'junction');
    } catch {
        linkSupported = false;
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('path shape', () => {
    it.runIf(process.platform === 'win32')('rejects device names, device namespace and relative paths', () => {
        expect(hasReservedDeviceName('C:\\x\\CON.png', 'win32')).toBe(true);
        expect(hasReservedDeviceName('/x/nul', 'win32')).toBe(true);
        expect(hasReservedDeviceName('/x/com1.txt', 'win32')).toBe(true);
        expect(hasReservedDeviceName('/x/console.png', 'win32')).toBe(false);
        // Device names are a Windows-only concept.
        expect(hasReservedDeviceName('/x/con.png', 'linux')).toBe(false);
        expect(hasAlternateDataStream('C:\\x\\a.png:evil', 'win32')).toBe(true);
        expect(hasAlternateDataStream('C:\\x\\a.png::$DATA', 'win32')).toBe(true);
        expect(hasAlternateDataStream('C:\\x\\a.png', 'win32')).toBe(false);
        expect(hasAlternateDataStream('/x/a:b.png', 'linux')).toBe(false);
        expect(isPlainAbsolutePath('\\\\.\\PhysicalDrive0')).toBe(false);
        expect(isPlainAbsolutePath('\\\\?\\C:\\x.png')).toBe(false);
        expect(isPlainAbsolutePath('relative/x.png')).toBe(false);
        expect(isPlainAbsolutePath(path.join(root, 'a\0b.png'))).toBe(false);
        expect(isPlainAbsolutePath(42)).toBe(false);
        expect(isPlainAbsolutePath(path.join(root, 'ok.png'))).toBe(true);
        expect(isPlainAbsolutePath('C:\\x\\doc.txt:secret', 'win32')).toBe(false);
        expect(isPlainAbsolutePath('C:\\x\\doc.txt', 'win32')).toBe(true);
    });
    it('detects paths inside protected roots, with KoBox as an exception', () => {
        expect(isInsideAnyRoot(path.join(userData, 'extensions', 'plugin-a', 'index.js'), [userData])).toBe(true);
        expect(isInsideAnyRoot(userData, [userData])).toBe(true);
        expect(isInsideAnyRoot(path.join(outside, 'doc.txt'), [userData])).toBe(false);
        expect(isInsideAnyRoot(path.join(userData, '..', 'outside', 'doc.txt'), [userData])).toBe(false);
        expect(isProtectedPath(path.join(koBox, 'f.txt'), [userData], [koBox])).toBe(false);
        expect(isProtectedPath(path.join(userData, 'Local Storage', 'x.log'), [userData], [koBox])).toBe(true);
    });
    it('detects a link that points into a protected root', (ctx) => {
        if (!linkSupported) ctx.skip();
        expect(isInsideAnyRoot(path.join(outside, 'link-to-userdata', 'extensions'), [userData])).toBe(true);
    });
    it('applies the KoBox exception to the real location only', (ctx) => {
        if (!linkSupported) ctx.skip();
        const sneaky = path.join(koBox, 'sneaky-link');
        fs.symlinkSync(path.join(userData, 'extensions'), sneaky, 'junction');
        try {
            expect(isProtectedPath(path.join(sneaky, 'plugin-a', 'index.js'), [userData], [koBox])).toBe(true);
            expect(isProtectedPath(path.join(sneaky, 'new.png'), [userData], [koBox])).toBe(true);
        } finally {
            // rmdir removes only the junction. A recursive rm follows a junction on Node >= 24.21 (Electron 44) and would delete the target's contents.
            fs.rmdirSync(sneaky);
        }
    });
    it('detects a not-yet-existing target whose parent is a junction into a protected root', (ctx) => {
        if (!linkSupported) ctx.skip();
        expect(isInsideAnyRoot(path.join(outside, 'link-to-userdata', 'new-file.png'), [userData])).toBe(true);
        expect(isInsideAnyRoot(path.join(outside, 'not-there', 'new-file.png'), [userData])).toBe(false);
    });
});

describe('save-screenshot guards', () => {
    it('normalises the format allow-list', () => {
        expect(normalizeImageFormat('PNG')).toBe('png');
        expect(normalizeImageFormat('.jpg')).toBe('jpg');
        expect(normalizeImageFormat('webp')).toBe('webp');
        expect(normalizeImageFormat('exe')).toBeNull();
        expect(normalizeImageFormat(undefined)).toBeNull();
    });
    it('decodes data URLs and bare base64', () => {
        expect(decodeImagePayload(`data:image/png;base64,${PNG.toString('base64')}`)?.equals(PNG)).toBe(true);
        expect(decodeImagePayload(JPEG.toString('base64'))?.equals(JPEG)).toBe(true);
        expect(decodeImagePayload('data:text/html;base64,PGh0bWw+')).toBeNull();
        expect(decodeImagePayload('')).toBeNull();
        expect(decodeImagePayload(null)).toBeNull();
        expect(decodeImagePayload('A'.repeat(SCREENSHOT_MAX_PAYLOAD_CHARS + 1))).toBeNull();
    });
    it('detects image magic bytes', () => {
        expect(detectImageKind(PNG)).toBe('png');
        expect(detectImageKind(JPEG)).toBe('jpeg');
        expect(detectImageKind(WEBP)).toBe('webp');
        expect(detectImageKind(EXE)).toBeNull();
    });
    it('accepts matching content and extension, case-insensitive', () => {
        expect(validateScreenshotSave(path.join(outside, 'a.png'), PNG).ok).toBe(true);
        expect(validateScreenshotSave(path.join(outside, 'a.JPG'), JPEG).ok).toBe(true);
        expect(validateScreenshotSave(path.join(outside, 'a.jpeg'), JPEG).ok).toBe(true);
        expect(validateScreenshotSave(path.join(outside, 'a.webp'), WEBP).ok).toBe(true);
    });
    it('rejects wrong extensions and mismatched or non-image content', () => {
        expect(validateScreenshotSave(path.join(outside, 'a.exe'), PNG)).toEqual({ ok: false, reason: 'invalid-extension' });
        expect(validateScreenshotSave(path.join(outside, 'a.png.lnk'), PNG).ok).toBe(false);
        expect(validateScreenshotSave(path.join(outside, 'a.jpg'), PNG)).toEqual({ ok: false, reason: 'content-does-not-match-extension' });
        expect(validateScreenshotSave(path.join(outside, 'a.png'), EXE).ok).toBe(false);
        expect(validateScreenshotSave(path.join(outside, 'a.png'), null).ok).toBe(false);
        expect(validateScreenshotSave(path.join(outside, 'CON.png'), PNG, 'win32').ok).toBe(false);
        expect(validateScreenshotSave('a.png', PNG).ok).toBe(false);
        expect(validateScreenshotSave('C:\\x\\a.png:hidden.png', PNG, 'win32')).toEqual({ ok: false, reason: 'invalid-path' });
    });
    it('rejects a directory or link as the target, allows overwriting a regular file', (ctx) => {
        fs.mkdirSync(path.join(outside, 'dir.png'), { recursive: true });
        expect(validateScreenshotSave(path.join(outside, 'dir.png'), PNG)).toEqual({ ok: false, reason: 'target-not-regular-file' });
        fs.writeFileSync(path.join(outside, 'existing.png'), PNG);
        expect(validateScreenshotSave(path.join(outside, 'existing.png'), PNG).ok).toBe(true);
        if (!linkSupported) ctx.skip();
        fs.symlinkSync(path.join(outside, 'folder'), path.join(outside, 'jlink.png'), 'junction');
        expect(validateScreenshotSave(path.join(outside, 'jlink.png'), PNG)).toEqual({ ok: false, reason: 'target-is-link' });
    });
});

describe('parse-file guards', () => {
    it('allow-lists formats AI Hub attaches', () => {
        expect(classifyParseFile('C:\\a\\Report.PDF')).toBe('pdf');
        expect(classifyParseFile('/a/photo.jpeg')).toBe('image');
        expect(classifyParseFile('/a/notes.md')).toBe('text');
        expect(classifyParseFile('/a/main.ts')).toBe('text');
        expect(classifyParseFile('/a/Dockerfile')).toBe('text');
        expect(classifyParseFile('/a/.gitignore')).toBe('text');
        expect(classifyParseFile('/a/README')).toBe('text');
        expect(classifyParseFile('/a/LICENSE')).toBe('text');
        expect(classifyParseFile('/a/Jenkinsfile')).toBe('text');
        expect(classifyParseFile('/a/.editorconfig')).toBe('text');
        expect(classifyParseFile('/a/data.jsonl')).toBe('text');
        expect(classifyParseFile('/a/App.csproj')).toBe('text');
        expect(classifyParseFile('/a/main.tf')).toBe('text');
        expect(classifyParseFile('/a/.env')).toBeNull();
        expect(classifyParseFile('/a/.env.local')).toBeNull();
        expect(classifyParseFile('/a/.env.txt')).toBeNull();
        expect(classifyParseFile('/a/id_rsa')).toBeNull();
        expect(classifyParseFile('/a/id_ed25519.txt')).toBeNull();
        expect(classifyParseFile('/a/.npmrc')).toBeNull();
        expect(classifyParseFile('/a/.netrc')).toBeNull();
        expect(classifyParseFile('/a/.git-credentials')).toBeNull();
        expect(classifyParseFile('/a/key.pem')).toBeNull();
        expect(classifyParseFile('/a/server.key')).toBeNull();
        expect(classifyParseFile('/a/random-extensionless')).toBeNull();
        expect(classifyParseFile('/a/Login Data')).toBeNull();
        expect(classifyParseFile('/a/000003.ldb')).toBeNull();
        expect(classifyParseFile('/a/app.exe')).toBeNull();
    });
    it('reads a regular file and rejects directories, links and oversize files', (ctx) => {
        expect(readRegularFileLimited(path.join(outside, 'doc.txt'), PARSE_FILE_MAX_BYTES).toString()).toBe('hello');
        expect(() => readRegularFileLimited(path.join(outside, 'folder'), PARSE_FILE_MAX_BYTES)).toThrow();
        expect(() => readRegularFileLimited(path.join(outside, 'doc.txt'), 3)).toThrow(/larger/);
        expect(() => readRegularFileLimited(path.join(outside, 'missing.txt'), PARSE_FILE_MAX_BYTES)).toThrow();
        if (!linkSupported) ctx.skip();
        expect(() => readRegularFileLimited(path.join(outside, 'folder-link'), PARSE_FILE_MAX_BYTES)).toThrow(/link/);
    });
});

describe('readRegularFileLimitedAsync (T-318)', () => {
    // The same outcome as the synchronous reader: the same bytes, or a rejection with the same message.
    async function sameAsSync(filePath: string, maxBytes: number): Promise<void> {
        let syncResult: Buffer | null = null;
        let syncError: string | null = null;
        try {
            syncResult = readRegularFileLimited(filePath, maxBytes);
        } catch (e) {
            syncError = (e as Error).message;
        }
        if (syncError !== null) {
            await expect(readRegularFileLimitedAsync(filePath, maxBytes)).rejects.toThrow(syncError);
        } else {
            expect((await readRegularFileLimitedAsync(filePath, maxBytes)).equals(syncResult as Buffer)).toBe(true);
        }
    }

    it('reads a regular file, also an empty one and one exactly at the limit', async () => {
        expect((await readRegularFileLimitedAsync(path.join(outside, 'doc.txt'), PARSE_FILE_MAX_BYTES)).toString()).toBe('hello');
        expect((await readRegularFileLimitedAsync(path.join(outside, 'doc.txt'), 5)).toString()).toBe('hello');
        fs.writeFileSync(path.join(outside, 'empty.txt'), '');
        expect((await readRegularFileLimitedAsync(path.join(outside, 'empty.txt'), PARSE_FILE_MAX_BYTES)).length).toBe(0);
    });

    it('reads a multi-megabyte file completely', async () => {
        const big = Buffer.alloc(3 * 1024 * 1024 + 17);
        for (let i = 0; i < big.length; i++) big[i] = i % 251;
        const file = path.join(outside, 'big.txt');
        fs.writeFileSync(file, big);
        try {
            expect((await readRegularFileLimitedAsync(file, PARSE_FILE_MAX_BYTES)).equals(big)).toBe(true);
            await expect(readRegularFileLimitedAsync(file, 3 * 1024 * 1024)).rejects.toThrow('File is larger than 3 MB');
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it('rejects directories, oversize and missing files with the messages of the synchronous reader', async () => {
        await expect(readRegularFileLimitedAsync(path.join(outside, 'folder'), PARSE_FILE_MAX_BYTES)).rejects.toThrow('Not a regular file');
        await expect(readRegularFileLimitedAsync(path.join(outside, 'doc.txt'), 3)).rejects.toThrow(/larger/);
        await expect(readRegularFileLimitedAsync(path.join(outside, 'missing.txt'), PARSE_FILE_MAX_BYTES)).rejects.toThrow(/ENOENT/);
        await sameAsSync(path.join(outside, 'doc.txt'), PARSE_FILE_MAX_BYTES);
        await sameAsSync(path.join(outside, 'folder'), PARSE_FILE_MAX_BYTES);
        await sameAsSync(path.join(outside, 'doc.txt'), 3);
        await sameAsSync(path.join(outside, 'missing.txt'), PARSE_FILE_MAX_BYTES);
    });

    it('rejects a link or junction without reading through it', async (ctx) => {
        if (!linkSupported) ctx.skip();
        await expect(readRegularFileLimitedAsync(path.join(outside, 'folder-link'), PARSE_FILE_MAX_BYTES)).rejects.toThrow(
            'File is a link'
        );
        await sameAsSync(path.join(outside, 'folder-link'), PARSE_FILE_MAX_BYTES);
    });
});

describe('kobox-drop guards', () => {
    const roots = () => [userData, path.join(userData, 'extensions')];

    it('rejects missing sources and sources inside userData / extensions', () => {
        expect(validateKoBoxSource(path.join(outside, 'nope.txt'), roots())).toEqual({ ok: false, reason: 'source-missing' });
        expect(validateKoBoxSource(path.join(userData, 'extensions', 'plugin-a', 'index.js'), roots())).toEqual({
            ok: false,
            reason: 'source-inside-app-data',
        });
        expect(validateKoBoxSource(path.join(userData, 'extensions'), roots()).ok).toBe(false);
        expect(validateKoBoxSource('relative.txt', roots()).ok).toBe(false);
        expect(validateKoBoxSource(['x'], roots()).ok).toBe(false);
    });
    it('rejects a source folder that contains userData', () => {
        expect(containsAnyRoot(root, roots())).toBe(true);
        expect(containsAnyRoot(outside, roots())).toBe(false);
        expect(validateKoBoxSource(root, roots())).toEqual({ ok: false, reason: 'source-contains-app-data' });
    });
    it('rejects a source reached through a link into userData', (ctx) => {
        if (!linkSupported) ctx.skip();
        expect(validateKoBoxSource(path.join(outside, 'link-to-userdata', 'extensions', 'plugin-a', 'index.js'), roots()).ok).toBe(false);
        expect(validateKoBoxSource(path.join(outside, 'folder-link'), roots())).toEqual({ ok: false, reason: 'source-is-link' });
    });
    it('copies a file and leaves the source in place, with a fresh mtime', async () => {
        const src = path.join(outside, 'doc.txt');
        const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        fs.utimesSync(src, old, old);
        const res = await copyIntoKoBox(src, koBox, roots());
        expect(res.ok).toBe(true);
        expect(fs.readFileSync(src, 'utf-8')).toBe('hello');
        expect(fs.readFileSync(path.join(koBox, 'doc.txt'), 'utf-8')).toBe('hello');
        expect(Date.now() - fs.statSync(path.join(koBox, 'doc.txt')).mtimeMs).toBeLessThan(60 * 60 * 1000);
        // Dropping the same file again keeps the first copy and adds "doc (2).txt" (R-03).
        fs.writeFileSync(path.join(koBox, 'doc.txt'), 'edited');
        const again = await copyIntoKoBox(src, koBox, roots());
        expect(again).toEqual({ ok: true, dest: path.join(koBox, 'doc (2).txt') });
        expect(fs.readFileSync(path.join(koBox, 'doc.txt'), 'utf-8')).toBe('edited');
        expect(fs.readFileSync(path.join(koBox, 'doc (2).txt'), 'utf-8')).toBe('hello');
    });
    it('copies a folder recursively, never merges into an existing one (renames instead)', async () => {
        const src = path.join(outside, 'folder');
        expect((await copyIntoKoBox(src, koBox, roots())).ok).toBe(true);
        expect(fs.readFileSync(path.join(koBox, 'folder', 'sub', 'b.txt'), 'utf-8')).toBe('b');
        expect(fs.existsSync(path.join(src, 'a.txt'))).toBe(true);
        expect(await copyIntoKoBox(src, koBox, roots())).toEqual({ ok: true, dest: path.join(koBox, 'folder (2)') });
        expect(fs.readFileSync(path.join(koBox, 'folder (2)', 'sub', 'b.txt'), 'utf-8')).toBe('b');
        expect(await copyIntoKoBox(src, koBox, roots())).toEqual({ ok: true, dest: path.join(koBox, 'folder (3)') });
    });
    it('two simultaneous drops of the same folder get distinct names and neither fails', async () => {
        const src = path.join(outside, 'folder');
        const [a, b] = await Promise.all([copyIntoKoBox(src, koBox, roots()), copyIntoKoBox(src, koBox, roots())]);
        expect(a.ok && b.ok).toBe(true);
        expect(new Set([a.dest, b.dest]).size).toBe(2);
    });
    it('a folder name with a dot gets the suffix at the end, a file before its extension', async () => {
        const dir = path.join(outside, 'v1.2');
        fs.mkdirSync(dir);
        fs.mkdirSync(path.join(koBox, 'v1.2'));
        expect((await copyIntoKoBox(dir, koBox, roots())).dest).toBe(path.join(koBox, 'v1.2 (2)'));
    });
    it('skips links / junctions inside a dropped folder', async (ctx) => {
        if (!linkSupported) ctx.skip();
        const src = path.join(outside, 'with-link');
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, 'real.txt'), 'r');
        fs.symlinkSync(userData, path.join(src, 'inner-link'), 'junction');
        expect((await copyIntoKoBox(src, koBox, roots())).ok).toBe(true);
        expect(fs.readFileSync(path.join(koBox, 'with-link', 'real.txt'), 'utf-8')).toBe('r');
        expect(fs.existsSync(path.join(koBox, 'with-link', 'inner-link'))).toBe(false);
    });
    it('refuses to copy a KoBox file onto itself (KoBox is inside userData)', async () => {
        expect(await copyIntoKoBox(path.join(koBox, 'doc.txt'), koBox, roots())).toEqual({ ok: false, reason: 'source-inside-app-data' });
    });
});

describe('withCollisionSuffix (R-03)', () => {
    it('keeps the first name unchanged', () => {
        expect(withCollisionSuffix('New folder', 1, true)).toBe('New folder');
        expect(withCollisionSuffix('a.txt', 1, false)).toBe('a.txt');
    });
    it('numbers like Windows', () => {
        expect(withCollisionSuffix('New folder', 2, true)).toBe('New folder (2)');
        expect(withCollisionSuffix('file.txt', 3, false)).toBe('file (3).txt');
        expect(withCollisionSuffix('a.tar.gz', 2, false)).toBe('a.tar (2).gz');
        expect(withCollisionSuffix('.gitignore', 2, false)).toBe('.gitignore (2)');
        expect(withCollisionSuffix('v1.2', 2, true)).toBe('v1.2 (2)');
    });
});
