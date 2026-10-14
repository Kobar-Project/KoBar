import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isFsPathInside, pathExists } from '../electron/lib/fsGuards.cjs';

// Synthetic temp folders only (never the real userData).
let root: string;
let base: string;
let outside: string;
let linkSupported = true;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-fsguards-'));
    base = path.join(root, 'extensions');
    outside = path.join(root, 'outside');
    fs.mkdirSync(path.join(base, 'plugin-a', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(base, 'plugin-a', 'manifest.json'), '{}');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    try {
        // 'junction' needs no admin rights on Windows; it is ignored (plain symlink) elsewhere.
        fs.symlinkSync(outside, path.join(base, 'evil-link'), 'junction');
        fs.symlinkSync(outside, path.join(base, 'plugin-a', 'linked-dir'), 'junction');
    } catch {
        linkSupported = false;
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('isFsPathInside', () => {
    it('accepts real children, existing or not', () => {
        expect(isFsPathInside(base, path.join(base, 'plugin-a'))).toBe(true);
        expect(isFsPathInside(base, path.join(base, 'plugin-a', 'manifest.json'))).toBe(true);
        expect(isFsPathInside(base, path.join(base, 'new-plugin'))).toBe(true);
        expect(isFsPathInside(base, path.join(base, 'new-plugin', 'index.js'))).toBe(true);
    });
    it('rejects the base itself and lexical escapes', () => {
        expect(isFsPathInside(base, base)).toBe(false);
        expect(isFsPathInside(base, path.join(base, '..', 'outside'))).toBe(false);
        expect(isFsPathInside(base, outside)).toBe(false);
    });
    it('rejects a link / junction as the final component', (ctx) => {
        // Link creation failed on this machine: report as skipped, not passed.
        if (!linkSupported) ctx.skip();
        expect(isFsPathInside(base, path.join(base, 'evil-link'))).toBe(false);
    });
    it('rejects a path that goes through a link / junction', (ctx) => {
        // Link creation failed on this machine: report as skipped, not passed.
        if (!linkSupported) ctx.skip();
        expect(isFsPathInside(base, path.join(base, 'evil-link', 'secret.txt'))).toBe(false);
        expect(isFsPathInside(base, path.join(base, 'plugin-a', 'linked-dir', 'secret.txt'))).toBe(false);
    });
    it('allows the base itself to be reached through a link', (ctx) => {
        // Link creation failed on this machine: report as skipped, not passed.
        if (!linkSupported) ctx.skip();
        const linkedBase = path.join(base, 'plugin-a', 'linked-dir');
        expect(isFsPathInside(linkedBase, path.join(linkedBase, 'secret.txt'))).toBe(true);
    });
});

describe('pathExists (T-318)', () => {
    it('matches fs.existsSync for files, folders, missing paths and empty input, and never rejects', async () => {
        const cases = [
            path.join(base, 'plugin-a'),
            path.join(base, 'plugin-a', 'manifest.json'),
            path.join(base, 'missing'),
            path.join(base, 'plugin-a', 'manifest.json', 'below-a-file'),
            '',
        ];
        for (const p of cases) expect(await pathExists(p), p).toBe(fs.existsSync(p));
        expect(await pathExists(path.join(base, 'plugin-a'))).toBe(true);
        expect(await pathExists(path.join(base, 'missing'))).toBe(false);
    });
});
