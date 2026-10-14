import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    MAX_ORIGINS_FILE_BYTES,
    ORIGINS_FILE_NAME,
    type OriginRecord,
    type OriginsOverlay,
    applyOriginsOverlay,
    cleanupStaleTempFiles,
    decideGithubReplace,
    emptyOrigins,
    findOriginKey,
    installedVersionOf,
    legacyOrigin,
    normalizeOriginRecord,
    normalizeRepoRef,
    parseOrigins,
    readOriginsFile,
    repoFromManifest,
    reposEqual,
    snapshotMissingOrigins,
    sourceForRepo,
    updateCheckVersion,
    withOrigin,
    withoutOrigin,
    writeOriginsFileAtomic,
} from '../electron/lib/pluginOrigins.cjs';

const NOW = '2026-01-01T00:00:00.000Z';

function rec(partial: Partial<OriginRecord> = {}): OriginRecord {
    return { repo: 'someone/plugin', source: 'github', installedAt: NOW, version: '1.0.0', ...partial };
}

describe('normalizeOriginRecord / parseOrigins', () => {
    it('keeps valid records', () => {
        expect(normalizeOriginRecord(rec())).toEqual(rec());
        expect(normalizeOriginRecord(rec({ repo: null, source: 'zip' }))).toEqual(rec({ repo: null, source: 'zip' }));
        for (const source of ['registry', 'github', 'zip', 'bundled', 'legacy'] as const) {
            expect(normalizeOriginRecord(rec({ source }))?.source).toBe(source);
        }
    });
    it('drops records with an invalid shape, source, repo or timestamp', () => {
        expect(normalizeOriginRecord(null)).toBeNull();
        expect(normalizeOriginRecord([])).toBeNull();
        expect(normalizeOriginRecord('x')).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), source: 'evil' })).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), repo: 'https://evil.example/x' })).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), repo: 'a/b/c' })).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), repo: undefined })).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), installedAt: 5 })).toBeNull();
        expect(normalizeOriginRecord({ ...rec(), installedAt: 'x'.repeat(65) })).toBeNull();
    });
    it('drops an oversized or non-string version but keeps the record', () => {
        expect(normalizeOriginRecord({ ...rec(), version: 7 })).toEqual({ repo: 'someone/plugin', source: 'github', installedAt: NOW });
        expect(normalizeOriginRecord({ ...rec(), version: '1'.repeat(65) })?.version).toBeUndefined();
    });
    it('drops unknown fields', () => {
        expect(normalizeOriginRecord({ ...rec(), extra: 'x' })).toEqual(rec());
    });
    it('parses a map, skipping reserved and invalid keys', () => {
        const raw = JSON.parse(
            JSON.stringify({ good: rec(), bad: { source: 'nope' }, constructor: rec(), ['k'.repeat(300)]: rec() }).replace(
                '"good"',
                '"__proto__":' + JSON.stringify(rec()) + ',"good"'
            )
        );
        const map = parseOrigins(raw);
        expect(Object.keys(map)).toEqual(['good']);
        expect(Object.getPrototypeOf(map)).toBeNull();
        expect(({} as Record<string, unknown>).repo).toBeUndefined();
    });
    it('returns an empty map for non-objects', () => {
        for (const raw of [null, undefined, 1, 'x', [rec()]]) {
            expect(Object.keys(parseOrigins(raw))).toEqual([]);
        }
    });
});

describe('withOrigin / withoutOrigin', () => {
    it('adds and removes without mutating the input', () => {
        const base = emptyOrigins();
        const added = withOrigin(base, 'plugin-a', rec());
        expect(Object.keys(base)).toEqual([]);
        expect(added['plugin-a']).toEqual(rec());
        const removed = withoutOrigin(added, 'plugin-a');
        expect(Object.keys(removed)).toEqual([]);
        expect(added['plugin-a']).toEqual(rec());
    });
    it('ignores invalid keys and records', () => {
        expect(Object.keys(withOrigin(emptyOrigins(), '__proto__', rec()))).toEqual([]);
        expect(Object.keys(withOrigin(emptyOrigins(), '', rec()))).toEqual([]);
        expect(Object.keys(withOrigin(emptyOrigins(), 'x', { ...rec(), source: 'nope' } as unknown as OriginRecord))).toEqual([]);
    });
});

describe('origins file', () => {
    let dir: string;
    let file: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-origins-'));
        file = path.join(dir, ORIGINS_FILE_NAME);
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads a missing file as empty', () => {
        expect(Object.keys(readOriginsFile(path.join(dir, 'missing.json')))).toEqual([]);
    });
    it('reads a corrupt file as empty (never throws)', () => {
        const corrupt = path.join(dir, 'corrupt.json');
        fs.writeFileSync(corrupt, '{ not json');
        expect(Object.keys(readOriginsFile(corrupt))).toEqual([]);
    });
    it('reads an oversized file as empty', () => {
        const big = path.join(dir, 'big.json');
        fs.writeFileSync(big, Buffer.alloc(MAX_ORIGINS_FILE_BYTES + 1, 0x20));
        expect(Object.keys(readOriginsFile(big))).toEqual([]);
    });
    it('reads a directory as empty', () => {
        expect(Object.keys(readOriginsFile(dir))).toEqual([]);
    });
    it('writes atomically and round-trips, leaving no temp files', () => {
        const map = withOrigin(withOrigin(emptyOrigins(), 'b-plugin', rec()), 'a-plugin', rec({ repo: null, source: 'zip' }));
        writeOriginsFileAtomic(file, map);
        expect(readOriginsFile(file)).toEqual(map);
        // Overwrite an existing file.
        writeOriginsFileAtomic(file, withoutOrigin(map, 'b-plugin'));
        expect(Object.keys(readOriginsFile(file))).toEqual(['a-plugin']);
        expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    });
    it('throws and cleans up when the target cannot be written', () => {
        const target = path.join(dir, 'missing-folder', ORIGINS_FILE_NAME);
        expect(() => writeOriginsFileAtomic(target, emptyOrigins())).toThrow();
        expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    });
});

describe('repo helpers', () => {
    it('compares repos case-insensitively and strictly', () => {
        expect(reposEqual('Owner/Repo', 'owner/repo')).toBe(true);
        expect(reposEqual('owner/repo', 'owner/repo2')).toBe(false);
        expect(reposEqual('owner/repo', 'other/repo')).toBe(false);
        expect(reposEqual(null, null)).toBe(false);
        expect(reposEqual('owner/repo', 'https://github.com/owner/repo')).toBe(false);
    });
    it('normalizes owner/name and github.com URLs only', () => {
        expect(normalizeRepoRef('owner/repo')).toBe('owner/repo');
        expect(normalizeRepoRef('https://github.com/owner/repo')).toBe('owner/repo');
        expect(normalizeRepoRef('https://github.com/owner/repo.git')).toBe('owner/repo');
        expect(normalizeRepoRef('https://github.com/owner/repo/')).toBe('owner/repo');
        expect(normalizeRepoRef('https://github.com/owner/repo/tree/main')).toBeNull();
        expect(normalizeRepoRef('http://github.com/owner/repo')).toBeNull();
        expect(normalizeRepoRef('https://evil.example/owner/repo')).toBeNull();
        expect(normalizeRepoRef('https://github.com.evil.example/owner/repo')).toBeNull();
        expect(normalizeRepoRef('owner/../repo')).toBeNull();
        expect(normalizeRepoRef(42)).toBeNull();
    });
    it('reads githubRepo first, then githubLink', () => {
        expect(repoFromManifest({ githubRepo: 'a/b', githubLink: 'c/d' })).toBe('a/b');
        expect(repoFromManifest({ githubRepo: 'not a repo', githubLink: 'https://github.com/c/d' })).toBe('c/d');
        expect(repoFromManifest({})).toBeNull();
        expect(repoFromManifest(null)).toBeNull();
        expect(repoFromManifest('a/b')).toBeNull();
    });
    it('maps the official organisation to the registry source', () => {
        expect(sourceForRepo('Kobar-Project/todolist')).toBe('registry');
        expect(sourceForRepo('someone/todolist')).toBe('github');
    });
});

describe('legacyOrigin', () => {
    it('uses the manifest repo for third-party plugins, marked legacy', () => {
        expect(legacyOrigin('my-plugin', { id: 'my-plugin', githubRepo: 'someone/my-plugin', version: '1.2.0' }, NOW)).toEqual({
            repo: 'someone/my-plugin',
            source: 'legacy',
            installedAt: NOW,
            version: '1.2.0',
        });
        expect(legacyOrigin('my-plugin', { id: 'my-plugin' }, NOW).repo).toBeNull();
        expect(legacyOrigin('my-plugin', null, NOW)).toEqual({ repo: null, source: 'legacy', installedAt: NOW });
    });
    it('gives official ids with a Kobar-Project manifest repo the registry origin (not legacy)', () => {
        expect(
            legacyOrigin('todolist-plugin', { id: 'todolist-plugin', githubRepo: 'Kobar-Project/todolist-plugin', version: '1.0.0' }, NOW)
        ).toEqual({ repo: 'Kobar-Project/todolist-plugin', source: 'registry', installedAt: NOW, version: '1.0.0' });
        expect(
            legacyOrigin('com.kobar.kobox', { id: 'com.kobar.kobox', githubLink: 'https://github.com/kobar-project/kobox' }, NOW)
        ).toEqual({
            repo: 'kobar-project/kobox',
            source: 'registry',
            installedAt: NOW,
        });
    });
    it('only accepts an official repo for official ids', () => {
        expect(legacyOrigin('todolist-plugin', { id: 'todolist-plugin', githubRepo: 'evil/x' }, NOW).source).toBe('legacy');
        expect(legacyOrigin('todolist-plugin', { id: 'todolist-plugin' }, NOW)).toEqual({ repo: null, source: 'legacy', installedAt: NOW });
        // A manifest of an official plugin pointing elsewhere is not trusted.
        expect(legacyOrigin('todolist-plugin', { id: 'todolist-plugin', githubRepo: 'evil/todolist-plugin' }, NOW).repo).toBeNull();
        // Official id in the manifest under another folder name counts as official too.
        expect(legacyOrigin('folder', { id: 'com.kobar.kobox', githubRepo: 'evil/kobox' }, NOW).repo).toBeNull();
    });
});

describe('installedVersionOf', () => {
    it('prefers the recorded version when valid', () => {
        expect(installedVersionOf(rec({ version: '2.0.0' }), { version: '9.9.9' })).toBe('2.0.0');
        expect(installedVersionOf(rec({ version: 'bad' }), { version: '1.5.0' })).toBe('1.5.0');
        expect(installedVersionOf(undefined, { version: '1.5.0' })).toBe('1.5.0');
        expect(installedVersionOf(undefined, {})).toBeNull();
        expect(installedVersionOf(undefined, null)).toBeNull();
    });
});

describe('decideGithubReplace', () => {
    const base = { origin: rec(), sourceRepo: 'someone/plugin', installedVersion: '1.0.0', newVersion: '1.1.0' };

    it('allows a strictly newer release from the recorded repo', () => {
        expect(decideGithubReplace(base)).toEqual({ ok: true });
        expect(decideGithubReplace({ ...base, sourceRepo: 'SomeOne/Plugin' })).toEqual({ ok: true });
    });
    it('refuses a release from another repo', () => {
        const d = decideGithubReplace({ ...base, sourceRepo: 'evil/plugin' });
        expect(d.ok).toBe(false);
        expect(!d.ok && d.reason).toContain('someone/plugin');
    });
    it('refuses when the recorded origin has no repo', () => {
        expect(decideGithubReplace({ ...base, origin: rec({ repo: null, source: 'zip' }) }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, origin: rec({ repo: null, source: 'legacy' }) }).ok).toBe(false);
    });
    it('refuses downgrades and same-version replaces', () => {
        expect(decideGithubReplace({ ...base, newVersion: '1.0.0' }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, newVersion: '0.9.0' }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, newVersion: '1.0.0-rc.1' }).ok).toBe(false);
    });
    it('refuses invalid versions on either side', () => {
        expect(decideGithubReplace({ ...base, newVersion: null }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, newVersion: 'latest' }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, installedVersion: null }).ok).toBe(false);
        expect(decideGithubReplace({ ...base, installedVersion: 'dev' }).ok).toBe(false);
    });
    it('accepts a legacy origin that matches the manifest snapshot', () => {
        expect(decideGithubReplace({ ...base, origin: rec({ source: 'legacy' }) })).toEqual({ ok: true });
    });
});

describe('updateCheckVersion (same rule as decideGithubReplace)', () => {
    it('returns a valid installed version', () => {
        expect(updateCheckVersion(rec({ version: '1.2.0' }), {})).toBe('1.2.0');
        expect(updateCheckVersion(undefined, { version: '1.0.0' })).toBe('1.0.0');
    });
    it('returns null for a missing or invalid version, which the install path refuses too', () => {
        for (const [record, manifest] of [
            [undefined, {}],
            [undefined, { version: 'dev' }],
            [rec({ version: 'bad' }), { version: 'also-bad' }],
            [undefined, null],
        ] as const) {
            expect(updateCheckVersion(record, manifest)).toBeNull();
            const installedVersion = installedVersionOf(record, manifest);
            expect(decideGithubReplace({ origin: rec(), sourceRepo: 'someone/plugin', installedVersion, newVersion: '99.0.0' }).ok).toBe(
                false
            );
        }
    });
});

describe('findOriginKey', () => {
    const map = withOrigin(emptyOrigins(), 'MyPlugin', rec());
    it('finds exact keys', () => {
        expect(findOriginKey(map, 'MyPlugin', false)).toBe('MyPlugin');
        expect(findOriginKey(map, 'MyPlugin', true)).toBe('MyPlugin');
    });
    it('matches case-insensitively only when asked (Windows)', () => {
        expect(findOriginKey(map, 'myplugin', false)).toBeNull();
        expect(findOriginKey(map, 'myplugin', true)).toBe('MyPlugin');
        expect(findOriginKey(map, 'other', true)).toBeNull();
        expect(findOriginKey(map, '', true)).toBeNull();
        expect(findOriginKey(map, '__proto__', true)).toBeNull();
    });
});

describe('snapshotMissingOrigins', () => {
    it('adds legacy snapshots only for folders without a record', () => {
        const start = withOrigin(emptyOrigins(), 'tracked', rec({ repo: 'someone/tracked' }));
        const result = snapshotMissingOrigins(
            start,
            [
                { name: 'tracked', manifest: { githubRepo: 'evil/tracked' } },
                { name: 'old-plugin', manifest: { id: 'old-plugin', githubRepo: 'someone/old', version: '1.0.0' } },
                { name: 'todolist-plugin', manifest: { id: 'todolist-plugin', githubRepo: 'Kobar-Project/todolist-plugin' } },
                { name: '__proto__', manifest: {} },
            ],
            NOW,
            false
        );
        expect(result.added).toEqual(['old-plugin', 'todolist-plugin']);
        expect(result.origins.tracked.repo).toBe('someone/tracked');
        expect(result.origins['old-plugin']).toEqual({ repo: 'someone/old', source: 'legacy', installedAt: NOW, version: '1.0.0' });
        expect(result.origins['todolist-plugin'].source).toBe('registry');
        expect(Object.keys(start)).toEqual(['tracked']);
    });
    it('does not re-snapshot a differently-cased folder on Windows', () => {
        const start = withOrigin(emptyOrigins(), 'MyPlugin', rec({ repo: 'someone/real' }));
        const insensitive = snapshotMissingOrigins(start, [{ name: 'myplugin', manifest: { githubRepo: 'evil/x' } }], NOW, true);
        expect(insensitive.added).toEqual([]);
        const sensitive = snapshotMissingOrigins(start, [{ name: 'myplugin', manifest: { githubRepo: 'evil/x' } }], NOW, false);
        expect(sensitive.added).toEqual(['myplugin']);
    });
});

describe('applyOriginsOverlay (session changes survive failed writes)', () => {
    it('keeps a snapshot from this session even when the file does not have it', () => {
        const snapshot = rec({ repo: 'someone/original', source: 'legacy' });
        const overlay: OriginsOverlay = new Map([['plugin', snapshot]]);
        // The file write failed: the file is still empty.
        const current = applyOriginsOverlay(emptyOrigins(), overlay);
        expect(current.plugin).toEqual(snapshot);
        // A later snapshot pass finds the record and does not read the (edited) manifest again.
        const again = snapshotMissingOrigins(current, [{ name: 'plugin', manifest: { githubRepo: 'evil/redirect' } }], NOW, false);
        expect(again.added).toEqual([]);
        expect(again.origins.plugin.repo).toBe('someone/original');
    });
    it('session records win over the file and null removes', () => {
        const file = withOrigin(withOrigin(emptyOrigins(), 'a', rec({ repo: 'old/a' })), 'b', rec());
        const overlay: OriginsOverlay = new Map<string, OriginRecord | null>([
            ['a', rec({ repo: 'new/a' })],
            ['b', null],
        ]);
        const result = applyOriginsOverlay(file, overlay);
        expect(result.a.repo).toBe('new/a');
        expect(Object.keys(result)).toEqual(['a']);
        expect(file.a.repo).toBe('old/a');
    });
});

describe('cleanupStaleTempFiles', () => {
    it('removes only temp files of the origins file and never throws', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-origins-tmp-'));
        try {
            const file = path.join(dir, ORIGINS_FILE_NAME);
            fs.writeFileSync(file, '{}');
            fs.writeFileSync(`${file}.123.456.abc.tmp`, 'partial');
            fs.writeFileSync(`${file}.789.tmp`, 'partial');
            fs.writeFileSync(path.join(dir, 'other.json.1.tmp'), 'keep');
            fs.writeFileSync(path.join(dir, 'extensions-config.json'), 'keep');
            fs.mkdirSync(`${file}.dir.tmp`);
            expect(cleanupStaleTempFiles(file)).toBe(2);
            expect(fs.readdirSync(dir).sort()).toEqual(
                [ORIGINS_FILE_NAME, `${ORIGINS_FILE_NAME}.dir.tmp`, 'extensions-config.json', 'other.json.1.tmp'].sort()
            );
            expect(cleanupStaleTempFiles(path.join(dir, 'missing-folder', ORIGINS_FILE_NAME))).toBe(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
