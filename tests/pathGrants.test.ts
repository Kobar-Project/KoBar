import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATH_GRANT_MAX_ENTRIES, PATH_GRANT_TTL_MS, createPathGrants } from '../electron/lib/pathGrants.cjs';
import { readMainModule, readMainSources } from './helpers/mainSource';

function clock(start = 1000) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('pathGrants (T-042)', () => {
    it('grants an exact path and refuses others', () => {
        const g = createPathGrants({ platform: 'win32' });
        expect(g.grant('C:\\Users\\me\\doc.txt', 'user-file')).toBe(true);
        expect(g.isGranted('C:\\Users\\me\\doc.txt')).toBe(true);
        expect(g.isGranted('C:\\Windows\\win.ini')).toBe(false);
        expect(g.isGranted('C:\\Users\\me')).toBe(false);
    });

    it('rejects unusable input', () => {
        const g = createPathGrants({ platform: 'win32' });
        for (const bad of [undefined, null, 42, '', 'relative\\doc.txt', 'C:\\a\0b']) {
            expect(g.grant(bad, 'user-file')).toBe(false);
            expect(g.isGranted(bad)).toBe(false);
        }
        expect(g.size()).toBe(0);
    });

    it('normalizes paths and compares case-insensitively on Windows only', () => {
        const win = createPathGrants({ platform: 'win32' });
        win.grant('C:\\Users\\Me\\Docs\\..\\File.TXT', 'user-file');
        expect(win.isGranted('c:/users/me/file.txt')).toBe(true);
        // ASCII-only folding: the Kelvin sign is not the letter k.
        win.grant('C:\\k.txt', 'user-file');
        expect(win.isGranted('C:\\\u212A.txt')).toBe(false);

        const posix = createPathGrants({ platform: 'linux' });
        posix.grant('/home/me/File.txt', 'user-file');
        expect(posix.isGranted('/home/me/./File.txt')).toBe(true);
        expect(posix.isGranted('/home/me/file.txt')).toBe(false);
    });

    it('expires grants after the TTL', () => {
        const c = clock();
        const g = createPathGrants({ platform: 'win32', now: c.now });
        g.grant('C:\\a.txt', 'user-file');
        c.advance(PATH_GRANT_TTL_MS - 1);
        expect(g.isGranted('C:\\a.txt')).toBe(true);
        c.advance(1);
        expect(g.isGranted('C:\\a.txt')).toBe(false);
        expect(g.size()).toBe(0);
    });

    it('a re-grant refreshes the expiry', () => {
        const c = clock();
        const g = createPathGrants({ platform: 'win32', now: c.now, ttlMs: 100 });
        g.grant('C:\\a.txt', 'user-file');
        c.advance(80);
        g.grant('C:\\A.TXT', 'user-file');
        c.advance(80);
        expect(g.isGranted('C:\\a.txt')).toBe(true);
        expect(g.size()).toBe(1);
    });

    it('evicts the oldest grant beyond the entry cap', () => {
        const g = createPathGrants({ platform: 'win32', maxEntries: 3 });
        g.grant('C:\\1.txt', 'user-file');
        g.grant('C:\\2.txt', 'user-file');
        g.grant('C:\\3.txt', 'user-file');
        g.grant('C:\\1.txt', 'user-file'); // refreshed: now the newest
        g.grant('C:\\4.txt', 'user-file');
        expect(g.size()).toBe(3);
        expect(g.isGranted('C:\\2.txt')).toBe(false);
        expect(g.isGranted('C:\\1.txt')).toBe(true);
        expect(g.isGranted('C:\\4.txt')).toBe(true);
        expect(PATH_GRANT_MAX_ENTRIES).toBe(500);
    });

    it('clear() drops every grant', () => {
        const g = createPathGrants({ platform: 'win32' });
        g.grant('C:\\a.txt', 'user-file');
        g.clear();
        expect(g.isGranted('C:\\a.txt')).toBe(false);
    });

    it('a folder grant covers only the folder itself, never files beneath it', () => {
        const g = createPathGrants({ platform: 'win32' });
        g.grant('C:\\Users\\me\\Proj', 'user-file');
        expect(g.isGranted('C:\\Users\\me\\proj')).toBe(true);
        expect(g.isGranted('C:\\Users\\me\\Proj\\a.ts')).toBe(false);
        expect(g.isGranted('C:\\Users\\me\\Proj\\..\\secret.txt')).toBe(false);
    });
});

describe('user-selected path wiring (T-042)', () => {
    // T-315: the 'not-user-selected' reason and the grant store are built in electron/main/app/context.cts (createMainContext).
    const main = readMainModule('app/context.cts');
    const preload = readFileSync(resolve(__dirname, '../electron/preload.cts'), 'utf8');

    // T-310: the save-screenshot handler moved to electron/main/services/screenshot.cts (indented inside registerScreenshotIpc).
    const screenshot = readMainModule('services/screenshot.cts');
    // T-312: grant-path and kobox-drop moved to services/kobox.cts, parse-file to services/files.cts (indented inside their register functions).
    const kobox = readMainModule('services/kobox.cts');
    const files = readMainModule('services/files.cts');

    function handler(channel: string, source: string = main): string {
        // T-303: file channels are registered through the typed registry (registry.on/handle).
        const found = new RegExp(`^([ \\t]*)(?:ipcMain|registry)\\.(on|handle)\\(\\s*'${channel}'`, 'm').exec(source);
        expect(found, channel).not.toBeNull();
        const start = found!.index + found![1].length;
        const after = source.slice(start + 1);
        // The next registration at the same indentation ends the handler.
        const next = after.search(new RegExp(`^${found![1]}(?:ipcMain|registry)\\.`, 'm'));
        return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
    }

    it('preload getFilePath reports a non-empty path to main on the internal grant-path channel', () => {
        const start = preload.indexOf('getFilePath:');
        const src = preload.slice(start, preload.indexOf('// Auto-launch', start));
        expect(src).toMatch(/webUtils\.getPathForFile\(file\)/);
        expect(src).toMatch(/ipcRenderer\.send\('grant-path', filePath\)/);
        expect(src).toMatch(/return filePath;/);
    });

    it('grant-path only accepts the main window top frame and validated paths', () => {
        const src = handler('grant-path', kobox);
        expect(src).toMatch(/event\.sender !== appState\.mainWindow\.webContents/);
        expect(src).toMatch(/event\.senderFrame !== appState\.mainWindow\.webContents\.mainFrame/);
        expect(src).toMatch(/isPlainAbsolutePath\(filePath\)/);
        expect(src).toMatch(/pathGrants\.grant\(filePath, 'user-file'\)/);
    });

    it('only grant-path adds grants (no dialog results in the shared allow-list)', () => {
        expect([...readMainSources().matchAll(/pathGrants\.grant\(/g)]).toHaveLength(1);
    });

    it('parse-file requires an exact grant after the T-109 checks and keeps its error shape', () => {
        const src = handler('parse-file', files);
        const t109 = src.indexOf('isProtectedPath(');
        const grant = src.indexOf('pathGrants.isGranted(filePath)');
        expect(t109).toBeGreaterThan(0);
        expect(grant).toBeGreaterThan(t109);
        expect(src).toMatch(/return \{ type: 'error', content: `Error: \$\{NOT_USER_SELECTED\}`, error: NOT_USER_SELECTED \}/);
        // The refusal is never silent: a rate-limited, localized notice goes out before the structured error.
        expect(src.indexOf('notifyBlockedFileAccess(')).toBeGreaterThan(grant);
        expect(src.indexOf('notifyBlockedFileAccess(')).toBeLessThan(src.indexOf("type: 'error', content: `Error: ${NOT_USER_SELECTED}`"));
        // T-318: the file is read asynchronously, only after the shape, type, T-109 and grant checks.
        const readAt = src.indexOf('await readRegularFileLimitedAsync(filePath, PARSE_FILE_MAX_BYTES)');
        expect(readAt).toBeGreaterThan(grant);
        expect(src).not.toMatch(/readRegularFileLimited\(|readFileSync|readSync/);
    });

    it('install-extension-from-path requires an exact grant before any fs access or confirmation (T-150)', () => {
        // T-314: the handler moved to services/extensions/install.cts (indented inside registerExtensionInstallIpc).
        const src = handler('install-extension-from-path', readMainModule('services/extensions/install.cts'));
        const grant = src.indexOf('pathGrants.isGranted(filePath)');
        expect(grant).toBeGreaterThan(0);
        expect(grant).toBeLessThan(src.indexOf('fs.existsSync('));
        expect(grant).toBeLessThan(src.indexOf('confirmPluginAction('));
        expect(grant).toBeLessThan(src.indexOf('installExtensionFromZipPath('));
        expect(src).toMatch(/notifyBlockedFileAccess\('install-extension-from-path'\)/);
        expect(src).toMatch(/return \{ success: false, reason: NOT_USER_SELECTED \}/);
    });

    it('any renderer caller of installExtensionFromPath resolves its path with getFilePath first (grant registration)', () => {
        // T-615: the old PluginStore (its only caller) is gone; this guards a future caller in the renderer.
        const dir = resolve(__dirname, '../src');
        const walk = (d: string): string[] =>
            readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(d, e.name)) : [resolve(d, e.name)]));
        for (const file of walk(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('global.d.ts'))) {
            const text = readFileSync(file, 'utf8');
            if (!text.includes('installExtensionFromPath(')) continue;
            expect(text.indexOf('getFilePath'), file).toBeGreaterThanOrEqual(0);
            expect(text.indexOf('getFilePath'), file).toBeLessThan(text.indexOf('installExtensionFromPath('));
        }
    });

    it('a refused save-screenshot is announced the same way (notice before the structured reason)', () => {
        const src = handler('save-screenshot', screenshot);
        expect(src.indexOf("notifyBlockedFileAccess('save-screenshot')")).toBeGreaterThan(src.indexOf('pathGrants.isGranted(savePath)'));
        expect(src.indexOf("notifyBlockedFileAccess('save-screenshot')")).toBeLessThan(src.indexOf('reason: NOT_USER_SELECTED'));
    });

    it('save-screenshot checks a supplied destinationPath before any fs validation; its own dialog result needs no grant', () => {
        const src = handler('save-screenshot', screenshot);
        const grant = src.indexOf('pathGrants.isGranted(savePath)');
        expect(grant).toBeGreaterThan(0);
        expect(grant).toBeLessThan(src.indexOf('showSaveDialog('));
        expect(grant).toBeLessThan(src.indexOf('validateScreenshotSave('));
        expect(src.indexOf('validateScreenshotSave(')).toBeLessThan(src.indexOf('writeFile('));
        expect(src.indexOf('isProtectedPath(')).toBeLessThan(src.indexOf('writeFile('));
        expect(src).toMatch(/return \{ success: false, reason: NOT_USER_SELECTED \}/);
    });

    it('kobox-drop moves only exactly granted items and reports failed moves (R2-11)', () => {
        const src = handler('kobox-drop', kobox);
        expect(src).toMatch(/pathGrants\.isGranted\(src\)/);
        expect(src.indexOf('pathGrants.isGranted(')).toBeLessThan(src.indexOf('moveIntoKoBox('));
        expect(src).not.toMatch(/copyIntoKoBox\(/);
        expect(src).toMatch(/notifyKoBoxCopyFailed\(result\.reason\)/);
        expect(src).toMatch(/\.catch\([\s\S]*notifyKoBoxCopyFailed\(\)/);
    });

    it('kobox-clean sends items to the Recycle Bin (never a permanent delete) and the quit pass can be awaited (R2-11)', () => {
        const clean = kobox.slice(kobox.indexOf('function cleanKoBox('), kobox.indexOf("registry.on('grant-path'"));
        expect(clean).toMatch(/if \(mode !== '24h' && mode !== 'quit'\) return;\s*if \(!fs\.existsSync\(koBoxPath\)\) return;/);
        expect(clean).toContain('shell.trashItem(p)');
        expect(clean).not.toMatch(/rmSync|promises\.rm\(|unlink/);
        expect(kobox).toContain('export function waitForKoBoxCleanup(');
        expect(readMainModule('app/lifecycle.cts')).toContain('waitForKoBoxCleanup()');
    });

    it('notices use fixed text and their own rate limiters', () => {
        expect(main).toMatch(/const NOT_USER_SELECTED = 'not-user-selected';/);
        // T-307: the notice helpers and their limiters live in electron/main/services/notifications.cts.
        const notices = readMainModule('services/notifications.cts');
        expect(notices).toMatch(/showRateLimitedNotice\(blockedFileNoticeLimiter, 'blockedFileAccess'\)/);
        expect(notices).toMatch(/showRateLimitedNotice\(koBoxFailNoticeLimiter, koBoxCopyFailedKey\(reason\)\)/);
        const start = notices.indexOf('function koBoxCopyFailedKey(');
        const fn = notices.slice(start, notices.indexOf('\n}\n', start));
        expect(fn).toMatch(/reason === 'destination-exists'\) return 'koBoxItemExists';/);
        expect(fn).toMatch(/reason === 'too-large'\) return 'koBoxTooLarge';/);
        expect(fn).toMatch(/return 'koBoxCopyFailed';/);
        // Fixed string keys only (texts live in lib/mainStrings): a notice never interpolates a path.
        expect(fn).not.toMatch(/`|\+ /);
    });

    it('save-screenshot validates the renderer-supplied defaultPath folder', () => {
        expect(handler('save-screenshot', screenshot)).toMatch(
            /defaultPath: screenshotDialogDefaultPath\(\s*data\.defaultPath,\s*app\.getPath\('desktop'\)/
        );
    });
});
