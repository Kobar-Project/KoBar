import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import {
    BACKUP_DIR_NAME,
    BACKUP_KEEP,
    BACKUP_MAX_RAW_BYTES,
    MASKED_VALUE,
    SECRET_KEY_PATTERN,
    type BackupFs,
    backupFileName,
    createBackupIfChanged,
    isAcceptableBackupInput,
    isBackupFileName,
    maskSecrets,
    parseStoredVersion,
    planPrune,
    sortBackupNames,
    unparsableBackupFileName,
} from '../electron/lib/storageBackup.cjs';

// T-201 (PROD-02): masked pre-migration backups of kobar-storage. Synthetic data and temp dirs only.

const at = (iso: string) => new Date(iso);

function wrapper(state: unknown, version: unknown = 21): string {
    return JSON.stringify({ state, version });
}

describe('maskSecrets', () => {
    it('masks secret-named keys recursively in objects and arrays, keeps everything else', () => {
        const raw = wrapper({
            language: 'tr',
            notes: [{ id: 1, title: 'note', content: 'hello' }],
            globalPluginData: {
                'ai-hub': { apiKey: 'plain-key-1', providers: [{ name: 'x', accessToken: 'tok-2', model: 'm' }] },
                mail: { smtpPassword: 'pw-3', password: 'pw-4', user: 'me' },
                other: { clientSecret: 'sec-5', nested: { deep: [{ API_KEY: 'k-6' }] } },
            },
            flags: { hasApiKey: true, licenseKey: null, emptyToken: '' },
        });
        const out = maskSecrets(raw);
        expect(out.kind).toBe('json');
        if (out.kind !== 'json') return;
        for (const secret of ['plain-key-1', 'tok-2', 'pw-3', 'pw-4', 'sec-5', 'k-6']) expect(out.text).not.toContain(secret);
        const parsed = JSON.parse(out.text);
        expect(out.version).toBe(21);
        expect(parsed.version).toBe(21);
        expect(parsed.state.language).toBe('tr');
        expect(parsed.state.notes).toEqual([{ id: 1, title: 'note', content: 'hello' }]);
        expect(parsed.state.globalPluginData['ai-hub'].apiKey).toBe(MASKED_VALUE);
        expect(parsed.state.globalPluginData['ai-hub'].providers[0]).toEqual({ name: 'x', accessToken: MASKED_VALUE, model: 'm' });
        expect(parsed.state.globalPluginData.mail).toEqual({ smtpPassword: MASKED_VALUE, password: MASKED_VALUE, user: 'me' });
        expect(parsed.state.globalPluginData.other.nested.deep[0].API_KEY).toBe(MASKED_VALUE);
        // Booleans / null / empty strings cannot hold a secret and are kept.
        expect(parsed.state.flags).toEqual({ hasApiKey: true, licenseKey: null, emptyToken: '' });
    });

    it('masks a whole object stored under a secret-named key', () => {
        const out = maskSecrets(wrapper({ apiKeys: { openai: 'x1', anthropic: 'x2' } }));
        expect(out.kind === 'json' && JSON.parse(out.text).state.apiKeys).toBe(MASKED_VALUE);
    });

    it('masks secrets inside stringified JSON values (plugin data) and token shapes inside plain strings', () => {
        const pluginBlob = JSON.stringify({ settings: { apiKey: 'nested-secret-7' }, theme: 'dark' });
        const token = 'sk-' + 'A'.repeat(24);
        const out = maskSecrets(wrapper({ globalPluginData: { p: pluginBlob }, notes: [{ content: `my key is ${token} ok` }] }));
        expect(out.kind).toBe('json');
        if (out.kind !== 'json') return;
        expect(out.text).not.toContain('nested-secret-7');
        expect(out.text).not.toContain(token);
        const parsed = JSON.parse(out.text);
        expect(JSON.parse(parsed.state.globalPluginData.p)).toEqual({ settings: { apiKey: MASKED_VALUE }, theme: 'dark' });
        expect(parsed.state.notes[0].content).toBe(`my key is ${MASKED_VALUE} ok`);
    });

    it('keeps unparsable text only when it shows no sign of a secret', () => {
        expect(maskSecrets('{"state": broken')).toEqual({ kind: 'unparsable', text: '{"state": broken' });
        expect(maskSecrets('{"apiKey": "x", broken')).toEqual({ kind: 'skipped', reason: 'unparsable-may-contain-secrets' });
        expect(maskSecrets('{"dbPass": "x", broken')).toEqual({ kind: 'skipped', reason: 'unparsable-may-contain-secrets' });
        expect(maskSecrets('garbage ghp_' + 'b'.repeat(30))).toEqual({ kind: 'skipped', reason: 'unparsable-may-contain-secrets' });
    });

    it('masks pass / jwt / cookie / session / bearer key names and JWT-shaped values', () => {
        const jwt = 'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(10);
        const out = maskSecrets(
            wrapper({
                mail: { pass: 'p1', smtpPass: 'p2', user: 'me' },
                auth0: { jwt: 'j1', idCookie: 'c1', sessionId: 's1', bearer: 'b1' },
                notes: [{ content: `token ${jwt} end` }],
                passive: 'kept',
            })
        );
        expect(out.kind).toBe('json');
        if (out.kind !== 'json') return;
        for (const secret of ['p1', 'p2', 'j1', 'c1', 's1', 'b1', jwt]) expect(out.text).not.toContain(`"${secret}"`);
        expect(out.text).not.toContain(jwt);
        const parsed = JSON.parse(out.text);
        expect(parsed.state.mail).toEqual({ pass: MASKED_VALUE, smtpPass: MASKED_VALUE, user: 'me' });
        expect(parsed.state.auth0).toBe(MASKED_VALUE);
        expect(parsed.state.notes[0].content).toBe(`token ${MASKED_VALUE} end`);
        expect(parsed.state.passive).toBe('kept');

        const nested = maskSecrets(wrapper({ data: { jwt: 'j2', cookie: 'c2', session: 's2', bearer: 'b2' } }));
        expect(nested.kind === 'json' && JSON.parse(nested.text).state.data).toEqual({
            jwt: MASKED_VALUE,
            cookie: MASKED_VALUE,
            session: MASKED_VALUE,
            bearer: MASKED_VALUE,
        });
    });
});

// T-414: the backup mask is as thorough as the strict (localStorage snapshot) mask. Fake secret-shaped values only.
describe('maskSecrets (T-414: nested key names, double-encoded and deep JSON)', () => {
    const MARK = 'FAKESECRET';
    /** A fake token-shaped property name (no secret-like word in it). */
    const fakeKeyName = (letter: string) => `sk-proj-${letter.repeat(20)}`;
    /** `innermostText` (a JSON text) wrapped `levels` times as `{"wrap": "<previous JSON text>"}`. */
    const wrapDeep = (innermostText: string, levels: number): string => {
        let text = innermostText;
        for (let i = 0; i < levels; i++) text = JSON.stringify({ wrap: text });
        return text;
    };
    const unwrapDeep = (text: string, levels: number): unknown => {
        let value: unknown = JSON.parse(text);
        for (let i = 0; i < levels; i++) value = JSON.parse((value as { wrap: string }).wrap);
        return value;
    };

    it('masks token-shaped key names at every level (plain, nested JSON, double-encoded JSON); collisions stay distinct', () => {
        const usage = { [fakeKeyName('A')]: { n: 1 }, [fakeKeyName('B')]: { n: 2 }, plain: { n: 3 } };
        const out = maskSecrets(
            wrapper({
                usage,
                globalPluginData: { stats: JSON.stringify({ usage }), double: JSON.stringify(JSON.stringify({ usage })) },
            })
        );
        expect(out.kind).toBe('json');
        if (out.kind !== 'json') return;
        expect(out.text).not.toMatch(/AAAAAAAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBBBBBB/);
        const expected = { [MASKED_VALUE]: { n: 1 }, [`${MASKED_VALUE}#2`]: { n: 2 }, plain: { n: 3 } };
        const state = JSON.parse(out.text).state;
        expect(state.usage).toEqual(expected);
        expect(JSON.parse(state.globalPluginData.stats).usage).toEqual(expected);
        expect(JSON.parse(JSON.parse(state.globalPluginData.double)).usage).toEqual(expected);
    });

    it('enters double- and triple-encoded JSON strings', () => {
        const triple = JSON.stringify(JSON.stringify(JSON.stringify({ apiKey: `${MARK}-1`, ok: 1 })));
        const out = maskSecrets(wrapper({ globalPluginData: { p: JSON.stringify({ apiKey: `${MARK}-2`, n: 1 }), q: triple } }));
        expect(out.kind).toBe('json');
        if (out.kind !== 'json') return;
        expect(out.text).not.toContain(MARK);
        const data = JSON.parse(out.text).state.globalPluginData;
        expect(JSON.parse(data.p)).toEqual({ apiKey: MASKED_VALUE, n: 1 });
        expect(JSON.parse(JSON.parse(JSON.parse(data.q)))).toEqual({ apiKey: MASKED_VALUE, ok: 1 });
    });

    it('masks JSON nested deeper than 4 levels per value (secret-like name, token shape, escaped name), keeps the backup', () => {
        // A marker without a secret-like word, so each case is caught by its own rule only.
        const mark = 'FAKEVALUE';
        const innermostTexts = [
            JSON.stringify({ apiKey: `${mark}-1` }),
            JSON.stringify({ note: `pasted sk-${mark}${'x'.repeat(16)}` }),
            // The `a` is a JSON escape: the key name only spells the word once the escape is decoded.
            `{"p\\u0061ssword":"${mark}-3"}`,
            // `pass$` in SECRET_KEY_PATTERN never matches raw JSON text (the name is followed by a quote).
            JSON.stringify({ dbPass: `${mark}-4` }),
            JSON.stringify({ pass: `${mark}-5` }),
        ];
        // Preconditions: only the first case contains a word SECRET_KEY_PATTERN finds in raw text.
        for (const innermost of innermostTexts.slice(1)) expect(SECRET_KEY_PATTERN.test(innermost)).toBe(false);
        expect(innermostTexts[2]).toContain('p\\u0061ssword');
        for (const innermost of innermostTexts) {
            const out = maskSecrets(wrapper({ keep: 'me', deep: wrapDeep(innermost, 6) }));
            expect(out.kind).toBe('json');
            if (out.kind !== 'json') continue;
            expect(out.text).not.toContain(mark);
            const state = JSON.parse(out.text).state;
            expect(state.keep).toBe('me');
            // The levels within the limit are still walked; the value beyond it is masked as a whole.
            expect(unwrapDeep(state.deep, 3)).toEqual({ wrap: MASKED_VALUE });
        }
    });

    it('keeps deep JSON without any sign of a secret verbatim', () => {
        const raw = wrapper({ deep: wrapDeep(JSON.stringify({ a: 1, list: ['x', { title: 'hello' }] }), 6) });
        const out = maskSecrets(raw);
        expect(out).toEqual({ kind: 'json', text: raw, version: 21 });
    });

    it('leaves non-secret functional data byte-identical (stringified plugin data, quoted text, __proto__ keys)', () => {
        const state = {
            language: 'tr',
            theme: 'dark',
            notes: [{ id: 'n1', title: 'Shopping', content: '<p>milk, eggs</p>' }],
            todos: [
                { id: 't1', text: ' "quoted" todo ', done: false },
                { id: 't2', text: '  "exactly quoted"  ' },
            ],
            globalPluginData: {
                weather: JSON.stringify({ city: 'Ankara', units: 'metric', history: [{ t: 1, v: 20.5 }] }),
                double: JSON.stringify(JSON.stringify({ layout: 'grid', count: 3 })),
            },
            flags: { hasApiKey: true, emptyToken: '' },
        };
        const raw = wrapper(state).replace('"flags":{', '"__proto__":{"x":1},"flags":{');
        const out = maskSecrets(raw);
        expect(out).toEqual({ kind: 'json', text: raw, version: 21 });
        if (out.kind !== 'json') return;
        expect(Object.prototype.hasOwnProperty.call(JSON.parse(out.text).state, '__proto__')).toBe(true);
    });

    it('produces the same output as the strict mask whenever the input can be walked', () => {
        const raw = wrapper({
            usage: { [fakeKeyName('C')]: 1 },
            ai: { apiKey: `${MARK}-3`, model: 'm' },
            p: JSON.stringify(JSON.stringify({ token: `${MARK}-4`, ok: true })),
            note: `see sk-${MARK}${'y'.repeat(16)} end`,
        });
        expect(maskSecrets(raw)).toEqual(maskSecrets(raw, { strict: true }));
    });
});

describe('names and versions', () => {
    it('parses the stored version or reports unknown', () => {
        expect(parseStoredVersion(wrapper({}, 5))).toBe(5);
        expect(parseStoredVersion(wrapper({}, '21'))).toBe('unknown');
        expect(parseStoredVersion(wrapper({}, -1))).toBe('unknown');
        expect(parseStoredVersion(wrapper({}, 1.5))).toBe('unknown');
        expect(parseStoredVersion('[1,2]')).toBe('unknown');
        expect(parseStoredVersion('not json')).toBe('unknown');
    });

    it('builds sanitised, sortable file names', () => {
        const now = at('2026-10-11T12:34:56.789Z');
        expect(backupFileName(21, now)).toBe('kobar-storage.v21.2026-10-11T12-34-56-789Z.json');
        expect(backupFileName('../../evil', now)).toBe('kobar-storage.vunknown.2026-10-11T12-34-56-789Z.json');
        expect(backupFileName(Number.NaN, now)).toBe('kobar-storage.vunknown.2026-10-11T12-34-56-789Z.json');
        expect(unparsableBackupFileName(now)).toBe('kobar-storage.unparsable.2026-10-11T12-34-56-789Z.txt');
        expect(isBackupFileName(backupFileName(21, now))).toBe(true);
        expect(isBackupFileName('kobar-system.json')).toBe(false);
        expect(isBackupFileName('kobar-storage.v21.2026-10-11T12-34-56-789Z.json.tmp')).toBe(false);
        // An invalid date never throws.
        expect(isBackupFileName(backupFileName(1, new Date(Number.NaN)))).toBe(true);
    });

    it('planPrune keeps the newest N of our own files and never lists foreign files', () => {
        const names = Array.from({ length: 7 }, (_, i) => backupFileName(21, at(`2026-01-0${i + 1}T00:00:00.000Z`)));
        const foreign = ['notes.json', 'kobar-storage.json', 'kobar-storage.v21.bad.json'];
        const prune = planPrune([...foreign, ...names]);
        expect(prune).toEqual([names[1], names[0]]);
        expect(planPrune(names, 5)).toHaveLength(2);
        expect(planPrune(names.slice(0, 3))).toEqual([]);
        expect(sortBackupNames(names)[0]).toBe(names[6]);
    });

    it('planPrune pins the newest backup of every older version, capped with oldest-version-first eviction', () => {
        const v20old = backupFileName(20, at('2026-01-01T00:00:00.000Z'));
        const v20 = backupFileName(20, at('2026-01-02T00:00:00.000Z'));
        const v21 = Array.from({ length: 6 }, (_, i) => backupFileName(21, at(`2026-02-0${i + 1}T00:00:00.000Z`)));
        const prune = planPrune([v20old, v20, ...v21]);
        expect(prune).toContain(v20old);
        expect(prune).not.toContain(v20);
        expect(prune).toContain(v21[0]);
        expect(prune).toHaveLength(2);

        // Unknown / unparsable backups are never pinned.
        const unknown = backupFileName('x', at('2025-12-01T00:00:00.000Z'));
        expect(planPrune([unknown, ...v21])).toEqual([v21[0], unknown]);

        // 12 older versions: only the 10 highest stay pinned.
        const older = Array.from({ length: 12 }, (_, i) =>
            backupFileName(i + 1, at(`2025-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`))
        );
        const pruned = planPrune([...older, ...v21]);
        expect(pruned).toEqual(expect.arrayContaining([older[0], older[1], v21[0]]));
        expect(pruned).toHaveLength(3);
        expect(planPrune([...older, ...v21], 5, 0)).toHaveLength(13);
    });

    it('accepts only strings within the size limit', () => {
        expect(isAcceptableBackupInput('{}')).toBe(true);
        expect(isAcceptableBackupInput(42)).toBe(false);
        expect(isAcceptableBackupInput(null)).toBe(false);
        expect(isAcceptableBackupInput('x'.repeat(BACKUP_MAX_RAW_BYTES + 1))).toBe(false);
    });
});

describe('createBackupIfChanged (temp dirs)', () => {
    let root: string;
    let dir: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-backup-test-'));
        dir = path.join(root, BACKUP_DIR_NAME);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('creates the directory and a masked backup named after the old version', () => {
        const raw = wrapper({ notes: [{ id: 1 }], ai: { apiKey: 'secret-value' } }, 20);
        const result = createBackupIfChanged({ backupsDir: dir, raw, now: at('2026-10-11T10:00:00.000Z') });
        expect(result.created).toBe(true);
        expect(path.basename(result.path!)).toBe('kobar-storage.v20.2026-10-11T10-00-00-000Z.json');
        const content = fs.readFileSync(result.path!, 'utf8');
        expect(content).not.toContain('secret-value');
        expect(JSON.parse(content).state.notes).toEqual([{ id: 1 }]);
        // Only the backup itself: no temp file left behind.
        expect(fs.readdirSync(dir)).toEqual([path.basename(result.path!)]);
    });

    it('skips when the masked content equals the newest backup, writes again when it changed', () => {
        const raw = wrapper({ n: 1 });
        expect(createBackupIfChanged({ backupsDir: dir, raw, now: at('2026-10-11T10:00:00.000Z') }).created).toBe(true);
        const again = createBackupIfChanged({ backupsDir: dir, raw, now: at('2026-10-11T11:00:00.000Z') });
        expect(again).toMatchObject({ created: false, reason: 'unchanged' });
        expect(fs.readdirSync(dir)).toHaveLength(1);
        expect(createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: 2 }), now: at('2026-10-11T12:00:00.000Z') }).created).toBe(true);
        expect(fs.readdirSync(dir)).toHaveLength(2);
    });

    it('keeps reading a backup written by the pre-T-414 mask; writes a fresh masked one next to it (T-414)', () => {
        // Pre-T-414 backups kept token-shaped nested key names; the file format and name are unchanged.
        const tokenName = `sk-proj-${'D'.repeat(20)}`;
        const oldName = 'kobar-storage.v21.2026-10-11T09-00-00-000Z.json';
        const oldText = wrapper({ notes: [{ id: 1 }], usage: { [tokenName]: 1 }, ai: { apiKey: MASKED_VALUE } });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, oldName), oldText);
        expect(isBackupFileName(oldName)).toBe(true);
        expect(parseStoredVersion(fs.readFileSync(path.join(dir, oldName), 'utf8'))).toBe(21);

        const raw = wrapper({ notes: [{ id: 1 }], usage: { [tokenName]: 1 }, ai: { apiKey: 'fake-key' } });
        const result = createBackupIfChanged({ backupsDir: dir, raw, now: at('2026-10-11T10:00:00.000Z') });
        expect(result.created).toBe(true);
        expect(sortBackupNames(fs.readdirSync(dir))).toEqual([path.basename(result.path!), oldName]);
        expect(fs.readFileSync(path.join(dir, oldName), 'utf8')).toBe(oldText);
        const fresh = JSON.parse(fs.readFileSync(result.path!, 'utf8'));
        expect(fresh.state).toEqual({ notes: [{ id: 1 }], usage: { [MASKED_VALUE]: 1 }, ai: { apiKey: MASKED_VALUE } });
        // The next launch with the same data finds the new backup unchanged.
        expect(createBackupIfChanged({ backupsDir: dir, raw, now: at('2026-10-11T11:00:00.000Z') })).toMatchObject({
            created: false,
            reason: 'unchanged',
        });
    });

    it('prunes to the newest 5 and never touches foreign files', () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'keep-me.json'), 'foreign');
        for (let i = 0; i < 8; i++) {
            const result = createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: i }), now: at(`2026-10-11T10:0${i}:00.000Z`) });
            expect(result.created).toBe(true);
        }
        const names = fs.readdirSync(dir);
        expect(names).toContain('keep-me.json');
        const backups = sortBackupNames(names);
        expect(backups).toHaveLength(BACKUP_KEEP);
        expect(backups[0]).toBe('kobar-storage.v21.2026-10-11T10-07-00-000Z.json');
        expect(backups[4]).toBe('kobar-storage.v21.2026-10-11T10-03-00-000Z.json');
    });

    it('keeps the pre-migration v20 backup after 6 later v21 backups', () => {
        expect(
            createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: 'old' }, 20), now: at('2026-10-11T09:00:00.000Z') }).created
        ).toBe(true);
        for (let i = 0; i < 6; i++) {
            createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: i }), now: at(`2026-10-11T10:0${i}:00.000Z`) });
        }
        const backups = sortBackupNames(fs.readdirSync(dir));
        expect(backups).toContain('kobar-storage.v20.2026-10-11T09-00-00-000Z.json');
        expect(backups).toHaveLength(BACKUP_KEEP + 1);
    });

    it('removes leftover temp files of an interrupted write, leaves other dot-files alone', () => {
        fs.mkdirSync(dir, { recursive: true });
        const leftover = '.kobar-storage.v21.2026-10-11T09-00-00-000Z.json.1234.abcd.tmp';
        fs.writeFileSync(path.join(dir, leftover), 'partial');
        fs.writeFileSync(path.join(dir, '.other.tmp'), 'foreign');
        expect(createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: 1 }), now: at('2026-10-11T10:00:00.000Z') }).created).toBe(true);
        const names = fs.readdirSync(dir);
        expect(names).not.toContain(leftover);
        expect(names).toContain('.other.tmp');
    });

    it('stores unparsable raw text as .txt when it has no secrets, skips it otherwise', () => {
        const ok = createBackupIfChanged({ backupsDir: dir, raw: '{"state": broken', now: at('2026-10-11T10:00:00.000Z') });
        expect(ok.created).toBe(true);
        expect(path.basename(ok.path!)).toBe('kobar-storage.unparsable.2026-10-11T10-00-00-000Z.txt');
        expect(fs.readFileSync(ok.path!, 'utf8')).toBe('{"state": broken');
        const risky = createBackupIfChanged({ backupsDir: dir, raw: '{"token": "abc", broken', now: at('2026-10-11T11:00:00.000Z') });
        expect(risky).toEqual({ created: false, reason: 'unparsable-may-contain-secrets' });
        expect(fs.readdirSync(dir)).toHaveLength(1);
    });

    it('gives same-millisecond backups distinct names', () => {
        const now = at('2026-10-11T10:00:00.000Z');
        const a = createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: 1 }), now });
        const b = createBackupIfChanged({ backupsDir: dir, raw: wrapper({ n: 2 }), now });
        expect(a.created && b.created).toBe(true);
        expect(a.path).not.toBe(b.path);
        expect(isBackupFileName(path.basename(b.path!))).toBe(true);
        expect(sortBackupNames(fs.readdirSync(dir))[0]).toBe(path.basename(b.path!));
    });

    it('rejects invalid input and reports fs failures without throwing', () => {
        expect(createBackupIfChanged({ backupsDir: dir, raw: 123 })).toEqual({ created: false, reason: 'invalid-input' });
        const failingFs: BackupFs = {
            mkdirSync: () => undefined,
            readdirSync: () => [],
            readFileSync: () => '',
            writeFileSync: () => {
                throw new Error('disk full');
            },
            renameSync: () => undefined,
            unlinkSync: () => {
                throw new Error('nope');
            },
        };
        expect(() => createBackupIfChanged({ backupsDir: dir, raw: wrapper({}), fs: failingFs })).not.toThrow();
        expect(createBackupIfChanged({ backupsDir: dir, raw: wrapper({}), fs: failingFs })).toEqual({ created: false, reason: 'error' });
        const throwingMkdir: BackupFs = {
            ...failingFs,
            mkdirSync: () => {
                throw new Error('EACCES');
            },
        };
        expect(createBackupIfChanged({ backupsDir: dir, raw: wrapper({}), fs: throwingMkdir })).toEqual({
            created: false,
            reason: 'error',
        });
    });
});

describe('wiring (source checks)', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    const preload = read('../electron/preload.cts');
    // T-315: the handler moved to electron/main/services/backup.cts (indented inside registerStorageBackupIpc).
    const main = readMainModule('services/backup.cts');

    it('preload sends the raw kobar-storage synchronously inside try/catch before the API is exposed', () => {
        const send = preload.indexOf("ipcRenderer.sendSync('backup-kobar-storage', rawPersisted)");
        const expose = preload.indexOf("contextBridge.exposeInMainWorld('api', {");
        const firstSubscribe = preload.indexOf("subscribe('flush-persist'");
        expect(send).toBeGreaterThan(0);
        expect(send).toBeLessThan(expose);
        expect(send).toBeLessThan(firstSubscribe);
        const block = preload.slice(preload.lastIndexOf('try {', send), preload.indexOf('} catch', send));
        expect(block).toMatch(/getItem\('kobar-storage'\)/);
        // Not a window.api member (the T-211 full backup methods in window.api use other channels).
        expect(preload.slice(expose)).not.toMatch(/backup-kobar-storage/i);
    });

    it('main checks the sender frame and the size, uses createBackupIfChanged and always sets returnValue', () => {
        const start = main.indexOf("ipcMain.on('backup-kobar-storage'");
        expect(start).toBeGreaterThan(0);
        const end = main.indexOf('\n    });', start);
        expect(end).toBeGreaterThan(start);
        const handler = main.slice(start, end);
        expect(handler).toMatch(/event\.sender === appState\.mainWindow\.webContents/);
        expect(handler).toMatch(/event\.senderFrame === appState\.mainWindow\.webContents\.mainFrame/);
        expect(handler).toMatch(/isAcceptableBackupInput\(raw\)/);
        expect(handler).toMatch(/createBackupIfChanged\(\{\s*backupsDir: path\.join\(app\.getPath\('userData'\), BACKUP_DIR_NAME\)/);
        expect(handler).toMatch(/finally \{\s*event\.returnValue = /);
        // The backup path is never handed to the renderer.
        expect(handler).not.toMatch(/returnValue = [^\n]*path/);
    });
});
