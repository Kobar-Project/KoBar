import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_GITHUB_OWNER, OFFICIAL_PLUGIN_IDS, isOfficialGithubOwner, isOfficialPluginId } from '../electron/lib/officialPlugins.cjs';
import { isSafeId } from '../electron/lib/paths.cjs';
import {
    isMacMetadataEntry,
    isSafeEntry,
    parseGithubRepo,
    validateManifestForInstall,
    withoutMacMetadata,
} from '../electron/lib/pluginInstall.cjs';
import { extractZipSafely } from '../electron/lib/zipGuards.cjs';

// Manifest ids of the 13 official plugins (checked against the plugin repos' manifest.json).
const EXPECTED_OFFICIAL_IDS = [
    'com.kobar.aihub',
    'com.kobar.calculator.plugin',
    'com.kobar.clipboardmanager',
    'com.kobar.kobox',
    'focus-mode-plugin',
    'ko-calender-plugin',
    'kobar-colorpicker-plugin',
    'kobar.shortcuts',
    'koplayer-plugin',
    'pin-window-to-top',
    'screenshot-studio-overlay',
    'snippetvault-plugin',
    'todolist-plugin',
];

const OFFICIAL_REPO = { kind: 'github' as const, repo: 'Kobar-Project/KoBox-plugin' };
const OTHER_REPO = { kind: 'github' as const, repo: 'someone/KoBox-plugin' };
const LOCAL = { kind: 'local' as const };

describe('officialPlugins', () => {
    it('lists exactly the 13 official ids, all safe', () => {
        expect([...OFFICIAL_PLUGIN_IDS].sort()).toEqual([...EXPECTED_OFFICIAL_IDS].sort());
        for (const id of OFFICIAL_PLUGIN_IDS) expect(isSafeId(id), id).toBe(true);
    });
    it('is frozen', () => {
        expect(Object.isFrozen(OFFICIAL_PLUGIN_IDS)).toBe(true);
    });
    it('isOfficialPluginId matches exact ids only', () => {
        for (const id of EXPECTED_OFFICIAL_IDS) expect(isOfficialPluginId(id)).toBe(true);
        for (const v of ['eedali-emoji-picker', 'COM.KOBAR.KOBOX', 'com.kobar.kobox ', 'dev-com.kobar.kobox', '', null, undefined, 1]) {
            expect(isOfficialPluginId(v)).toBe(false);
        }
    });
    it('isOfficialGithubOwner is case-insensitive', () => {
        expect(OFFICIAL_GITHUB_OWNER).toBe('Kobar-Project');
        expect(isOfficialGithubOwner('Kobar-Project')).toBe(true);
        expect(isOfficialGithubOwner('kobar-project')).toBe(true);
        expect(isOfficialGithubOwner('Kobar-Project2')).toBe(false);
        expect(isOfficialGithubOwner('eedali')).toBe(false);
        expect(isOfficialGithubOwner(undefined)).toBe(false);
    });
});

describe('parseGithubRepo', () => {
    it('accepts owner/name', () => {
        expect(parseGithubRepo('Kobar-Project/Clipboard-Manager-plugin')).toEqual({
            owner: 'Kobar-Project',
            name: 'Clipboard-Manager-plugin',
        });
        expect(parseGithubRepo('eedali/EmojiPicker-plugin')).not.toBeNull();
        expect(parseGithubRepo('a/b.c_d')).not.toBeNull();
    });
    it.each([
        ['empty', ''],
        ['no slash', 'Kobar-Project'],
        ['three segments', 'Kobar-Project/a/b'],
        ['traversal', 'Kobar-Project/..'],
        ['traversal into other owner', 'Kobar-Project/../evil'],
        ['url', 'https://github.com/Kobar-Project/x'],
        ['leading dash owner', '-x/y'],
        ['space', 'Kobar-Project/a b'],
        ['query', 'Kobar-Project/a?x=1'],
        ['trailing slash', 'Kobar-Project/a/'],
        ['dot name', 'Kobar-Project/.'],
    ])('rejects %s', (_n, repo) => {
        expect(parseGithubRepo(repo)).toBeNull();
    });
    it('rejects non-strings', () => {
        expect(parseGithubRepo(undefined)).toBeNull();
        expect(parseGithubRepo(['a', 'b'])).toBeNull();
    });
});

describe('isSafeEntry', () => {
    it('accepts absent and relative entries', () => {
        for (const e of [undefined, null, '', 'index.js', 'dist/index.js', 'dist\\index.js', './index.js']) {
            expect(isSafeEntry(e), String(e)).toBe(true);
        }
    });
    it.each([
        ['parent', '../index.js'],
        ['nested parent', 'dist/../../x.js'],
        ['windows parent', '..\\..\\x.js'],
        ['posix absolute', '/etc/passwd'],
        ['windows absolute', 'C:\\Windows\\x.js'],
        ['drive relative', 'C:x.js'],
        ['unc', '\\\\host\\share\\x.js'],
        ['folder itself', '.'],
        ['NUL', 'index.js\0'],
    ])('rejects %s', (_n, entry) => {
        expect(isSafeEntry(entry)).toBe(false);
    });
    it('rejects non-string entries', () => {
        expect(isSafeEntry(1)).toBe(false);
        expect(isSafeEntry({})).toBe(false);
    });
});

describe('validateManifestForInstall', () => {
    const base = { name: 'Test', version: '1.0.0' };

    it('accepts a third-party plugin from a local ZIP and from any GitHub repo', () => {
        const m = { ...base, id: 'eedali-emoji-picker' };
        expect(validateManifestForInstall(m, LOCAL)).toEqual({ ok: true, id: 'eedali-emoji-picker' });
        expect(validateManifestForInstall(m, OTHER_REPO)).toEqual({ ok: true, id: 'eedali-emoji-picker' });
    });

    it('accepts every official id from the official GitHub owner (any case)', () => {
        for (const id of EXPECTED_OFFICIAL_IDS) {
            expect(validateManifestForInstall({ ...base, id }, OFFICIAL_REPO)).toEqual({ ok: true, id });
            expect(validateManifestForInstall({ ...base, id }, { kind: 'github', repo: 'kobar-project/x' }).ok).toBe(true);
        }
    });

    it('rejects an official id from a local ZIP or a foreign GitHub repo', () => {
        for (const id of EXPECTED_OFFICIAL_IDS) {
            const local = validateManifestForInstall({ ...base, id }, LOCAL);
            expect(local.ok).toBe(false);
            if (!local.ok) expect(local.reason).toContain('official');
            expect(validateManifestForInstall({ ...base, id }, OTHER_REPO).ok).toBe(false);
        }
    });

    it('rejects an official id from a malformed repo that only looks official', () => {
        for (const repo of ['Kobar-Project/../evil/x', 'Kobar-Project', 'https://github.com/Kobar-Project/x', 'Kobar-Project2/x']) {
            expect(validateManifestForInstall({ ...base, id: 'com.kobar.kobox' }, { kind: 'github', repo }).ok).toBe(false);
        }
    });

    it('allows an official id from a local ZIP only with allowOfficialFromLocal (dev runs)', () => {
        const m = { ...base, id: 'com.kobar.kobox' };
        expect(validateManifestForInstall(m, LOCAL, { allowOfficialFromLocal: true }).ok).toBe(true);
        // The dev flag never helps a foreign GitHub repo.
        expect(validateManifestForInstall(m, OTHER_REPO, { allowOfficialFromLocal: true }).ok).toBe(false);
    });

    it.each([
        ['traversal', '../../Desktop'],
        ['nested traversal', 'a/../../b'],
        ['absolute windows', 'C:\\Users\\me'],
        ['absolute posix', '/home/me'],
        ['dotdot', '..'],
        ['uppercase', 'MyPlugin'],
        ['space', 'my plugin'],
        ['reserved', 'con'],
        ['too long', 'a'.repeat(65)],
        ['number', 42],
    ])('rejects an unsafe id (%s)', (_n, id) => {
        const r = validateManifestForInstall({ ...base, id }, LOCAL);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain('invalid "id"');
    });

    it('rejects missing id or name with the existing message', () => {
        for (const m of [{ name: 'x' }, { id: 'abc' }, { id: '', name: 'x' }]) {
            const r = validateManifestForInstall(m, LOCAL);
            expect(r).toEqual({ ok: false, reason: 'manifest.json is missing required fields "id" or "name".' });
        }
    });

    it('rejects non-object manifests', () => {
        for (const m of [null, undefined, 'x', 1, ['id']]) {
            expect(validateManifestForInstall(m, LOCAL)).toEqual({ ok: false, reason: 'Invalid manifest.json file.' });
        }
    });

    it('rejects an entry that leaves the plugin folder', () => {
        const r = validateManifestForInstall({ ...base, id: 'my-plugin', entry: '../other/index.js' }, LOCAL);
        expect(r.ok).toBe(false);
        expect(validateManifestForInstall({ ...base, id: 'my-plugin', entry: 'dist/index.js' }, LOCAL).ok).toBe(true);
    });
});

// MAC-020: macOS "Compress" adds Finder metadata to ZIPs; it must never be installed.
describe('isMacMetadataEntry', () => {
    it.each([
        '__MACOSX/',
        '__MACOSX/plugin/._index.js',
        'plugin/._index.js',
        '._manifest.json',
        'plugin/.DS_Store',
        '.DS_Store',
        'plugin\\.DS_Store',
    ])('true for %s', (name) => {
        expect(isMacMetadataEntry(name)).toBe(true);
    });
    it.each([
        'plugin/index.js',
        'manifest.json',
        'plugin/.hidden',
        'plugin/_x.js',
        'plugin/x._y',
        '__MACOSX_not/x.js',
        'plugin/.DS_Store_backup',
    ])('false for %s', (name) => {
        expect(isMacMetadataEntry(name)).toBe(false);
    });
});

function fakeZip(names: string[]) {
    return {
        getEntries: () =>
            names.map((entryName) => ({
                entryName,
                isDirectory: entryName.endsWith('/'),
                header: { size: 1 },
                getData: () => Buffer.from('x'),
            })),
    };
}

describe('withoutMacMetadata', () => {
    it('keeps only the real entries, in the same order', () => {
        const zip = fakeZip(['__MACOSX/', '__MACOSX/plugin/._index.js', 'plugin/', 'plugin/index.js', 'plugin/.DS_Store', 'manifest.json']);
        expect(
            withoutMacMetadata(zip)
                .getEntries()
                .map((e) => e.entryName)
        ).toEqual(['plugin/', 'plugin/index.js', 'manifest.json']);
    });
    it('extracts without the macOS metadata files', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-mac020-'));
        try {
            const zip = fakeZip([
                '__MACOSX/',
                '__MACOSX/._index.js',
                'plugin/._index.js',
                'plugin/.DS_Store',
                'plugin/index.js',
                'manifest.json',
            ]);
            extractZipSafely(withoutMacMetadata(zip), tmpDir);
            expect(fs.existsSync(path.join(tmpDir, '__MACOSX'))).toBe(false);
            expect(fs.existsSync(path.join(tmpDir, 'plugin', '._index.js'))).toBe(false);
            expect(fs.existsSync(path.join(tmpDir, 'plugin', '.DS_Store'))).toBe(false);
            expect(fs.existsSync(path.join(tmpDir, 'plugin', 'index.js'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, 'manifest.json'))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
