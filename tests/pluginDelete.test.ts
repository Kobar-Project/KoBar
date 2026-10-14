import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canDeletePluginFolder } from '../electron/lib/pluginDelete.cjs';
import { validateManifestForInstall } from '../electron/lib/pluginInstall.cjs';
import { findManifestDir, listPluginDirs, listPluginDirsAsync, resetPluginScanWarnings } from '../electron/lib/pluginScan.cjs';
import { extractZipSafely } from '../electron/lib/zipGuards.cjs';

// Synthetic temp folders only (never the real userData).
let root: string;
let ext: string;
let outside: string;
let linkSupported = true;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-plugindelete-'));
    ext = path.join(root, 'extensions');
    outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(ext, 'good-plugin'), { recursive: true });
    fs.writeFileSync(path.join(ext, 'good-plugin', 'manifest.json'), '{}');
    fs.writeFileSync(path.join(ext, 'a-file'), 'x');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'keep me');
    try {
        fs.symlinkSync(outside, path.join(ext, 'evil-link'), 'junction');
        // Dangling link: the target does not exist.
        fs.symlinkSync(path.join(root, 'missing-target'), path.join(ext, 'broken-link'), 'junction');
    } catch {
        linkSupported = false;
        console.warn('[pluginDelete.test] cannot create junction/symlink here: link tests are skipped.');
    }
});

afterAll(() => {
    // Remove links first so the recursive removal can never reach their targets.
    for (const l of ['evil-link', 'broken-link']) {
        try {
            fs.unlinkSync(path.join(ext, l));
        } catch {
            try {
                fs.rmdirSync(path.join(ext, l));
            } catch {
                /* already gone */
            }
        }
    }
    fs.rmSync(root, { recursive: true, force: true });
});

describe('canDeletePluginFolder', () => {
    it('accepts a real plugin folder', () => {
        expect(canDeletePluginFolder(ext, 'good-plugin')).toEqual({ ok: true, dir: path.join(ext, 'good-plugin') });
    });
    it.each(['..', '.', 'a/b', 'a\\b', '', 'CON', 'con', 'Good-Plugin', 'x', '../outside'])('rejects unsafe id %j', (id) => {
        expect(canDeletePluginFolder(ext, id).ok).toBe(false);
    });
    it.each([undefined, null, 5, {}])('rejects non-string id %j', (id) => {
        expect(canDeletePluginFolder(ext, id).ok).toBe(false);
    });
    it('reports a missing folder', () => {
        expect(canDeletePluginFolder(ext, 'not-installed')).toEqual({ ok: false, reason: 'not-found' });
    });
    it('rejects a file instead of a directory', () => {
        expect(canDeletePluginFolder(ext, 'a-file')).toEqual({ ok: false, reason: 'not-a-directory' });
    });
    it('accepts a legacy (non-safe) entry name only when asked and when it exists', () => {
        fs.mkdirSync(path.join(ext, 'Legacy_Plugin'));
        try {
            expect(canDeletePluginFolder(ext, 'Legacy_Plugin').ok).toBe(false);
            expect(canDeletePluginFolder(ext, 'Legacy_Plugin', { allowLegacyEntry: true }).ok).toBe(true);
            expect(canDeletePluginFolder(ext, 'Other_Name', { allowLegacyEntry: true }).ok).toBe(false);
            expect(canDeletePluginFolder(ext, '../outside', { allowLegacyEntry: true }).ok).toBe(false);
        } finally {
            fs.rmSync(path.join(ext, 'Legacy_Plugin'), { recursive: true, force: true });
        }
    });
    it('refuses a junction that points outside and leaves the target intact', (ctx) => {
        if (!linkSupported) return ctx.skip();
        expect(canDeletePluginFolder(ext, 'evil-link')).toEqual({ ok: false, reason: 'link' });
        expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe('keep me');
    });
    it('refuses a dangling link', (ctx) => {
        if (!linkSupported) return ctx.skip();
        expect(canDeletePluginFolder(ext, 'broken-link').ok).toBe(false);
    });
});

describe('listPluginDirs', () => {
    it('returns real folders only and keeps going past broken entries', (ctx) => {
        if (!linkSupported) return ctx.skip();
        resetPluginScanWarnings();
        const warnings: string[] = [];
        const names = listPluginDirs(ext, { warn: (m) => warnings.push(m) });
        expect(names).toEqual(['good-plugin']);
        expect(warnings.length).toBe(2);
        listPluginDirs(ext, { warn: (m) => warnings.push(m) });
        expect(warnings.length).toBe(2); // once per name
    });
    it('allowLinks accepts a link to a directory but still skips a dangling one', (ctx) => {
        if (!linkSupported) return ctx.skip();
        resetPluginScanWarnings();
        const names = listPluginDirs(ext, { allowLinks: true, warn: () => {} }).sort();
        expect(names).toEqual(['evil-link', 'good-plugin']);
    });
    it('returns [] for a missing base folder', () => {
        expect(listPluginDirs(path.join(root, 'nope'))).toEqual([]);
    });
});

describe('listPluginDirsAsync (T-318)', () => {
    it('returns exactly what listPluginDirs returns, in the same order, with the same warnings', async (ctx) => {
        if (!linkSupported) return ctx.skip();
        resetPluginScanWarnings();
        const syncWarnings: string[] = [];
        const syncNames = listPluginDirs(ext, { warn: (m) => syncWarnings.push(m) });
        resetPluginScanWarnings();
        const asyncWarnings: string[] = [];
        const asyncNames = await listPluginDirsAsync(ext, { warn: (m) => asyncWarnings.push(m) });
        expect(asyncNames).toEqual(syncNames);
        expect(asyncNames).toEqual(['good-plugin']);
        expect(asyncWarnings.sort()).toEqual(syncWarnings.sort());
        // Shares the once-per-name memory with the synchronous scan.
        await listPluginDirsAsync(ext, { warn: (m) => asyncWarnings.push(m) });
        expect(asyncWarnings.length).toBe(2);
    });
    it('allowLinks accepts a link to a directory but still skips a dangling one', async (ctx) => {
        if (!linkSupported) return ctx.skip();
        resetPluginScanWarnings();
        const names = (await listPluginDirsAsync(ext, { allowLinks: true, warn: () => {} })).sort();
        expect(names).toEqual(['evil-link', 'good-plugin']);
    });
    it('resolves [] for a missing base folder or a file instead of a folder', async () => {
        resetPluginScanWarnings();
        expect(await listPluginDirsAsync(path.join(root, 'nope'))).toEqual([]);
        expect(await listPluginDirsAsync(path.join(ext, 'a-file'), { warn: () => {} })).toEqual([]);
    });
});

describe('ZIP with an unsafe manifest id', () => {
    const cases: Array<[string, unknown]> = [
        ['traversal', '../evil'],
        ['reserved name', 'CON'],
        ['uppercase', 'Evil-Plugin'],
        ['empty', ''],
        ['separator', 'a/b'],
    ];
    it.each(cases)('rejects %s id (extract, find manifest, validate)', (_label, id) => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-badzip-'));
        try {
            const zip = new AdmZip();
            zip.addFile('manifest.json', Buffer.from(JSON.stringify({ id, name: 'Evil', version: '1.0.0' })));
            zip.addFile('index.js', Buffer.from('//'));
            const zipPath = path.join(work, 'evil.zip');
            zip.writeZip(zipPath);

            const temp = path.join(work, 'temp_ext');
            extractZipSafely(new AdmZip(zipPath), temp);
            const found = findManifestDir(temp);
            expect(found).not.toBeNull();
            const manifest = JSON.parse(fs.readFileSync(found!.manifestPath, 'utf8'));
            const result = validateManifestForInstall(manifest, { kind: 'local' });
            expect(result.ok).toBe(false);
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });
    it('finds the manifest inside a single top-level folder', () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-badzip-'));
        try {
            const zip = new AdmZip();
            zip.addFile('pkg/manifest.json', Buffer.from(JSON.stringify({ id: 'ok-plugin', name: 'Ok' })));
            const zipPath = path.join(work, 'ok.zip');
            zip.writeZip(zipPath);
            const temp = path.join(work, 'temp_ext');
            extractZipSafely(new AdmZip(zipPath), temp);
            expect(findManifestDir(temp)?.dir).toBe(path.join(temp, 'pkg'));
            expect(findManifestDir(work)).toBeNull();
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });
});
