import { describe, expect, it } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { applyKeepLocal, applyKeepLocalFields, endpointGuardFor, endpointKeysToKeepLocal, isEndpointName } from '../src/backup/keepLocal';
import { parseBackup } from '../src/backup/parseBackup';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';

// T-159: a local API key is only carried over when the endpoint fields next to it are unchanged. Synthetic values only.

const LOCAL_KEY = 'local-fake-key-1';
const GOOD = 'https://api.example.test/v1';
const EVIL = 'https://evil.example.invalid/v1';

const provider = (apiKey: string, extra: Record<string, unknown>) =>
    JSON.stringify({ state: { providers: { openai: { apiKey, ...extra } } } });
const keyOf = (value: string): unknown => JSON.parse(value).state.providers.openai.apiKey;
const PATH = [['state', 'providers', 'openai', 'apiKey']];

function run(writtenExtra: Record<string, unknown>, localExtra: Record<string, unknown>, guard = true) {
    return applyKeepLocal(provider('', writtenExtra), provider(LOCAL_KEY, localExtra), PATH, guard);
}

describe('applyKeepLocal: endpoint guard', () => {
    it('keeps the local key when the endpoint is the same', () => {
        const out = run({ baseUrl: GOOD }, { baseUrl: GOOD });
        expect(keyOf(out.value)).toBe(LOCAL_KEY);
        expect(out.blocked).toBe(0);
    });

    it('treats trim, case of scheme/host, default port and trailing slashes as the same endpoint', () => {
        const out = run({ baseUrl: '  HTTPS://API.Example.test:443/v1/// ' }, { baseUrl: GOOD });
        expect(keyOf(out.value)).toBe(LOCAL_KEY);
    });

    it('does not carry the key over when the endpoint changed, and counts it', () => {
        const out = run({ baseUrl: EVIL }, { baseUrl: GOOD });
        expect(keyOf(out.value)).toBe('');
        expect(out.blocked).toBe(1);
        // Nothing of the local value leaks into the written one.
        expect(out.value).not.toContain(LOCAL_KEY);
        expect(out.value).toContain(EVIL);
    });

    it('treats a different path or scheme on the same host as changed', () => {
        expect(run({ baseUrl: 'https://api.example.test/other' }, { baseUrl: GOOD }).blocked).toBe(1);
        expect(run({ baseUrl: 'http://api.example.test/v1' }, { baseUrl: GOOD }).blocked).toBe(1);
    });

    it('treats an endpoint missing in the backup but present locally as changed', () => {
        const out = run({}, { baseUrl: GOOD });
        expect(keyOf(out.value)).toBe('');
        expect(out.blocked).toBe(1);
    });

    it('treats an endpoint present in the backup but missing locally as changed', () => {
        expect(run({ endpoint: EVIL }, {}).blocked).toBe(1);
    });

    it('behaves as before when neither side has an endpoint field', () => {
        const out = run({ model: 'a' }, { model: 'b' });
        expect(keyOf(out.value)).toBe(LOCAL_KEY);
        expect(out.blocked).toBe(0);
    });

    it('keeps the key when both endpoints are empty or null', () => {
        expect(keyOf(run({ baseUrl: '' }, { baseUrl: '' }).value)).toBe(LOCAL_KEY);
        expect(keyOf(run({ baseUrl: null }, {}).value)).toBe(LOCAL_KEY);
        expect(keyOf(run({ baseUrl: '' }, { baseUrl: null }).value)).toBe(LOCAL_KEY);
    });

    it('treats non-string endpoint values as changed (hostile), even when both sides are equal', () => {
        for (const hostile of [42, true, ['x'], { href: EVIL }]) {
            expect(run({ baseUrl: hostile }, { baseUrl: GOOD }).blocked).toBe(1);
            expect(run({ baseUrl: hostile }, { baseUrl: hostile }).blocked).toBe(1);
            expect(run({ baseUrl: GOOD }, { baseUrl: hostile }).blocked).toBe(1);
        }
    });

    it('compares every endpoint-type sibling: one changed is enough', () => {
        expect(run({ baseUrl: GOOD, proxyHost: 'a.test' }, { baseUrl: GOOD, proxyHost: 'a.test' }).blocked).toBe(0);
        expect(run({ baseUrl: GOOD, proxyHost: 'evil.test' }, { baseUrl: GOOD, proxyHost: 'a.test' }).blocked).toBe(1);
    });

    it('guards the whole record (T-161): a changed endpoint of one provider blocks the secrets of the other one too', () => {
        const written = JSON.stringify({
            providers: { a: { apiKey: '', baseUrl: EVIL }, b: { apiKey: '', baseUrl: GOOD } },
        });
        const local = JSON.stringify({
            providers: { a: { apiKey: 'ka', baseUrl: GOOD }, b: { apiKey: 'kb', baseUrl: GOOD } },
        });
        const out = applyKeepLocal(written, local, [
            ['providers', 'a', 'apiKey'],
            ['providers', 'b', 'apiKey'],
        ]);
        const parsed = JSON.parse(out.value);
        expect(parsed.providers.a.apiKey).toBe('');
        expect(parsed.providers.b.apiKey).toBe('');
        expect(out.blocked).toBe(2);
    });

    it('works inside array elements matched by id and inside nested JSON strings', () => {
        const written = JSON.stringify({
            list: [{ id: 'x', token: '', url: EVIL }],
            inner: JSON.stringify({ token: '', host: 'evil.test' }),
        });
        const local = JSON.stringify({
            list: [{ id: 'x', token: 'lt', url: GOOD }],
            inner: JSON.stringify({ token: 'li', host: 'good.test' }),
        });
        const out = applyKeepLocal(written, local, [
            ['list', '0', 'token'],
            ['inner', 'token'],
        ]);
        const parsed = JSON.parse(out.value);
        expect(parsed.list[0].token).toBe('');
        expect(JSON.parse(parsed.inner).token).toBe('');
        expect(out.blocked).toBe(2);

        const same = applyKeepLocal(written.replace(EVIL, GOOD).replace('evil.test', 'good.test'), local, [
            ['list', '0', 'token'],
            ['inner', 'token'],
        ]);
        const keep = JSON.parse(same.value);
        expect(keep.list[0].token).toBe('lt');
        expect(JSON.parse(keep.inner).token).toBe('li');
        expect(same.blocked).toBe(0);
    });

    it('guards a numeric PIN next to an endpoint too', () => {
        const out = applyKeepLocal(
            '{"pin":null,"serverUrl":"https://evil.example.invalid"}',
            '{"pin":1234,"serverUrl":"https://good.example.test"}',
            [['pin']]
        );
        expect(JSON.parse(out.value).pin).toBeNull();
        expect(out.blocked).toBe(1);
    });

    it('can be switched off (chat store) and applyKeepLocalFields honours it', () => {
        const written = provider('', { baseUrl: EVIL });
        const local = provider(LOCAL_KEY, { baseUrl: GOOD });
        expect(keyOf(applyKeepLocalFields(written, local, PATH, false))).toBe(LOCAL_KEY);
        expect(keyOf(applyKeepLocalFields(written, local, PATH))).toBe('');
        expect(keyOf(applyKeepLocalFields(written, local, PATH, endpointGuardFor('kobar-aihub-plugin-storage')))).toBe('');
    });

    it('exempts only the chat store (also isolated), whose keys go to fixed provider hosts', () => {
        expect(endpointGuardFor('kobar-chat-storage')).toBe(false);
        expect(endpointGuardFor('kobar-chat-storage_iso_ws1')).toBe(false);
        expect(endpointGuardFor('kobar-aihub-plugin-storage')).toBe(true);
        expect(endpointGuardFor('kobar-storage')).toBe('app-store');
        expect(endpointGuardFor('kobar-storage_iso_ws1')).toBe('app-store');
        expect(endpointGuardFor('kobar-chat-storage-evil')).toBe(true);
    });

    it('recognizes endpoint-type names', () => {
        for (const name of [
            'baseUrl',
            'base_url',
            'apiURL',
            'endpoint',
            'customEndpoint',
            'ollamaHost',
            'serverAddress',
            'proxy',
            'origin',
            'apiBase',
            'api_base',
            'openAIApiBase',
            'gateway',
            'apiGateway',
        ]) {
            expect(isEndpointName(name), name).toBe(true);
        }
        for (const name of ['apiKey', 'model', 'name', 'temperature', 'id']) expect(isEndpointName(name), name).toBe(false);
    });
});

describe('applyKeepLocal: every object level on the path is guarded (fail closed)', () => {
    const blockedOf = (written: unknown, local: unknown, path: string[], guard: boolean | 'app-store' = true) =>
        applyKeepLocal(JSON.stringify(written), JSON.stringify(local), [path], guard);

    it('guards an array of key strings next to a base URL', () => {
        const evil = blockedOf({ baseUrl: EVIL, apiKeys: [''] }, { baseUrl: GOOD, apiKeys: [LOCAL_KEY] }, ['apiKeys', '0']);
        expect(JSON.parse(evil.value).apiKeys).toEqual(['']);
        expect(evil.blocked).toBe(1);
        const same = blockedOf({ baseUrl: GOOD, apiKeys: [''] }, { baseUrl: GOOD, apiKeys: [LOCAL_KEY] }, ['apiKeys', '0']);
        expect(JSON.parse(same.value).apiKeys).toEqual([LOCAL_KEY]);
        expect(same.blocked).toBe(0);
    });

    it('guards a secret-named container next to a base URL', () => {
        const path = ['credentials', 'openai'];
        const evil = blockedOf({ baseUrl: EVIL, credentials: { openai: '' } }, { baseUrl: GOOD, credentials: { openai: LOCAL_KEY } }, path);
        expect(JSON.parse(evil.value).credentials.openai).toBe('');
        expect(evil.blocked).toBe(1);
        const same = blockedOf({ baseUrl: GOOD, credentials: { openai: '' } }, { baseUrl: GOOD, credentials: { openai: LOCAL_KEY } }, path);
        expect(JSON.parse(same.value).credentials.openai).toBe(LOCAL_KEY);
    });

    it('guards an endpoint at any ancestor level, also inside a persist wrapper and array elements', () => {
        const wrap = (baseUrl: string, key: string) => ({ state: { baseUrl, list: [{ id: 1, keys: { a: key } }] }, version: 1 });
        const path = ['state', 'list', '0', 'keys', 'a'];
        expect(blockedOf(wrap(EVIL, ''), wrap(GOOD, LOCAL_KEY), path).blocked).toBe(1);
        expect(JSON.parse(blockedOf(wrap(GOOD, ''), wrap(GOOD, LOCAL_KEY), path).value).state.list[0].keys.a).toBe(LOCAL_KEY);
    });

    it('treats any absolute URL value as an endpoint, whatever the field is called', () => {
        for (const url of ['https://evil.example.invalid', ' HTTP://evil.example.invalid', 'wss://evil.example.invalid/x']) {
            expect(run({ link: url, region: 'x' }, { link: GOOD }).blocked, url).toBe(1);
        }
        expect(run({ link: GOOD }, { link: GOOD }).blocked).toBe(0);
        // A URL only the local object has counts too (missing in the backup).
        expect(run({}, { link: GOOD }).blocked).toBe(1);
        expect(run({ apiBase: EVIL }, { apiBase: GOOD }).blocked).toBe(1);
    });

    it('app-store mode checks only the plugin blobs: unrelated state fields never block a plugin key', () => {
        const store = (stateUrl: string, wsUrl: string, pluginUrl: string, key: string) => ({
            state: {
                wallpaperUrl: stateUrl,
                workspaces: [{ id: 'w', homepage: wsUrl, isolatedData: { pluginData: { p: { baseUrl: pluginUrl, apiKey: key } } } }],
            },
            version: 1,
        });
        const path = ['state', 'workspaces', '0', 'isolatedData', 'pluginData', 'p', 'apiKey'];
        const keep = blockedOf(
            store('https://a.test', 'https://b.test', GOOD, ''),
            store('https://c.test', 'https://d.test', GOOD, LOCAL_KEY),
            path,
            'app-store'
        );
        expect(JSON.parse(keep.value).state.workspaces[0].isolatedData.pluginData.p.apiKey).toBe(LOCAL_KEY);
        expect(keep.blocked).toBe(0);
        const block = blockedOf(
            store('https://a.test', 'https://b.test', EVIL, ''),
            store('https://a.test', 'https://b.test', GOOD, LOCAL_KEY),
            path,
            'app-store'
        );
        expect(block.blocked).toBe(1);
    });
});

describe('applyKeepLocal: record scope (T-161)', () => {
    const apply = (written: unknown, local: unknown, path: string[], guard: boolean | 'app-store' = true) =>
        applyKeepLocal(JSON.stringify(written), JSON.stringify(local), [path], guard);

    it('(b) guards an endpoint in a different branch than the key', () => {
        const shape = (baseUrl: string, apiKey: string) => ({ provider: { baseUrl }, auth: { apiKey } });
        const evil = apply(shape(EVIL, ''), shape(GOOD, LOCAL_KEY), ['auth', 'apiKey']);
        expect(JSON.parse(evil.value).auth.apiKey).toBe('');
        expect(evil.blocked).toBe(1);
        expect(evil.value).not.toContain(LOCAL_KEY);
        const same = apply(shape(GOOD, ''), shape(GOOD, LOCAL_KEY), ['auth', 'apiKey']);
        expect(JSON.parse(same.value).auth.apiKey).toBe(LOCAL_KEY);
        expect(same.blocked).toBe(0);
        // The endpoint only exists in the backup / only locally: changed as well.
        expect(
            apply({ provider: { baseUrl: EVIL }, auth: { apiKey: '' } }, { auth: { apiKey: LOCAL_KEY } }, ['auth', 'apiKey']).blocked
        ).toBe(1);
        expect(
            apply({ auth: { apiKey: '' } }, { provider: { baseUrl: GOOD }, auth: { apiKey: LOCAL_KEY } }, ['auth', 'apiKey']).blocked
        ).toBe(1);
    });

    it('(b) guards an endpoint inside an array element of another branch, paired by id', () => {
        const shape = (url: string, key: string) => ({ servers: [{ id: 's', url }], keys: { main: key } });
        expect(apply(shape(EVIL, ''), shape(GOOD, LOCAL_KEY), ['keys', 'main']).blocked).toBe(1);
        expect(JSON.parse(apply(shape(GOOD, ''), shape(GOOD, LOCAL_KEY), ['keys', 'main']).value).keys.main).toBe(LOCAL_KEY);
        // Reordered elements with ids are the same endpoints.
        const two = (order: string[]) => ({ servers: order.map((id) => ({ id, url: `https://${id}.example.test` })), keys: { main: '' } });
        const localTwo = { ...two(['a', 'b']), keys: { main: LOCAL_KEY } };
        expect(JSON.parse(apply(two(['b', 'a']), localTwo, ['keys', 'main']).value).keys.main).toBe(LOCAL_KEY);
    });

    it('(c) guards an endpoint outside a nested JSON string while the key is inside it', () => {
        const shape = (baseUrl: string, key: string) => ({ baseUrl, inner: JSON.stringify({ apiKey: key }) });
        const evil = apply(shape(EVIL, ''), shape(GOOD, LOCAL_KEY), ['inner', 'apiKey']);
        expect(JSON.parse(JSON.parse(evil.value).inner).apiKey).toBe('');
        expect(evil.blocked).toBe(1);
        const same = apply(shape(GOOD, ''), shape(GOOD, LOCAL_KEY), ['inner', 'apiKey']);
        expect(JSON.parse(JSON.parse(same.value).inner).apiKey).toBe(LOCAL_KEY);
    });

    it('(c) also guards an endpoint inside a nested JSON string when the key is outside it', () => {
        const shape = (url: string, key: string) => ({ apiKey: key, inner: JSON.stringify({ net: { url } }) });
        expect(apply(shape(EVIL, ''), shape(GOOD, LOCAL_KEY), ['apiKey']).blocked).toBe(1);
        expect(JSON.parse(apply(shape(GOOD, ''), shape(GOOD, LOCAL_KEY), ['apiKey']).value).apiKey).toBe(LOCAL_KEY);
    });

    it('treats a record that is too deep to scan as changed (fail closed)', () => {
        let deep: unknown = { baseUrl: GOOD };
        for (let i = 0; i < 300; i++) deep = { n: deep };
        const shape = (key: string) => ({ deep, apiKey: key });
        expect(apply(shape(''), shape(LOCAL_KEY), ['apiKey']).blocked).toBe(1);
    });

    it('app-store: one plugin blob is one record, a different blob or unrelated state never blocks it', () => {
        const store = (blobs: Record<string, unknown>) => ({
            state: { workspaces: [{ id: 'w', isolatedData: { pluginData: blobs } }] },
            version: 1,
        });
        const path = (id: string) => ['state', 'workspaces', '0', 'isolatedData', 'pluginData', id, 'auth', 'apiKey'];
        const blob = (baseUrl: string, key: string) => ({ provider: { baseUrl }, auth: { apiKey: key } });
        const written = store({ p: blob(GOOD, ''), q: blob(EVIL, '') });
        const local = store({ p: blob(GOOD, 'kp'), q: blob(GOOD, 'kq') });
        const p = apply(written, local, path('p'), 'app-store');
        expect(JSON.parse(p.value).state.workspaces[0].isolatedData.pluginData.p.auth.apiKey).toBe('kp');
        expect(p.blocked).toBe(0);
        const q = apply(written, local, path('q'), 'app-store');
        expect(JSON.parse(q.value).state.workspaces[0].isolatedData.pluginData.q.auth.apiKey).toBe('');
        expect(q.blocked).toBe(1);
    });

    it('app-store: the decision of a record is made once, before any of its secrets is placed', () => {
        const store = (blob: unknown) => ({ state: { workspaces: [{ id: 'w', isolatedData: { pluginData: { p: blob } } }] }, version: 1 });
        const base = '/state/workspaces/0/isolatedData/pluginData/p';
        const paths = [
            ['state', 'workspaces', '0', 'isolatedData', 'pluginData', 'p', 'auth', 'apiKey'],
            ['state', 'workspaces', '0', 'isolatedData', 'pluginData', 'p', 'other', 'token'],
        ];
        const written = store({ provider: { baseUrl: EVIL }, auth: { apiKey: '' }, other: { token: '' } });
        const local = store({ provider: { baseUrl: GOOD }, auth: { apiKey: 'ka' }, other: { token: 'kt' } });
        const out = applyKeepLocal(JSON.stringify(written), JSON.stringify(local), paths, 'app-store');
        expect(out.blocked, base).toBe(2);
        expect(out.value).not.toContain('ka');
        expect(out.value).not.toContain('kt');
    });

    it('keeps the chat-store exemption', () => {
        const shape = (localUrl: string, key: string) => ({ state: { apiKeys: { openai: key, localUrl } } });
        const out = apply(shape('http://localhost:1', ''), shape('http://localhost:2', LOCAL_KEY), ['state', 'apiKeys', 'openai'], false);
        expect(JSON.parse(out.value).state.apiKeys.openai).toBe(LOCAL_KEY);
    });
});

describe('endpointKeysToKeepLocal: a secret under its own key stays paired with its endpoint key (T-161a)', () => {
    // Every secret key used below has a local value (a key without one has nothing to protect).
    const SECRETS = [
        'foo_api_key',
        'foo-token',
        'foo.secret',
        'fooApiKey',
        'fooToken',
        'foo_api_key_iso_ws1',
        'foo_openai_api_key',
        'foo_api_key_v2',
        'foo_secret_value',
        'foo_apikey_encrypted',
        'foo_credentials_json',
        'foo_bearer',
    ];
    const local = (values: Record<string, string>) => (key: string) => values[key] ?? (SECRETS.includes(key) ? LOCAL_KEY : null);

    it('keeps the local endpoint when the written one differs, or is new', () => {
        const keys = ['foo_api_key'];
        const entries = [{ key: 'foo_base_url', value: EVIL }];
        expect([...endpointKeysToKeepLocal(entries, keys, local({ foo_base_url: GOOD }))]).toEqual(['foo_base_url']);
        expect([...endpointKeysToKeepLocal(entries, keys, local({}))]).toEqual(['foo_base_url']);
    });

    it('lets the endpoint be written when it is the same (after normalization) or both are empty', () => {
        const keys = ['foo_api_key'];
        expect(
            endpointKeysToKeepLocal([{ key: 'foo_base_url', value: ' HTTPS://API.Example.test/v1/ ' }], keys, local({ foo_base_url: GOOD }))
                .size
        ).toBe(0);
        expect(endpointKeysToKeepLocal([{ key: 'foo_base_url', value: '' }], keys, local({})).size).toBe(0);
    });

    it('recognizes the endpoint suffixes, secret tails, camelCase and isolated keys', () => {
        const run = (secret: string, endpoint: string) =>
            endpointKeysToKeepLocal([{ key: endpoint, value: EVIL }], [secret], local({ [endpoint]: GOOD })).size === 1;
        for (const suffix of ['url', 'uri', 'endpoint', 'host', 'server', 'base', 'gateway', 'base_url', 'api_base']) {
            expect(run('foo_api_key', `foo_${suffix}`), suffix).toBe(true);
        }
        expect(run('foo-token', 'foo-endpoint')).toBe(true);
        expect(run('foo.secret', 'foo.server')).toBe(true);
        expect(run('fooApiKey', 'fooBaseUrl')).toBe(true);
        expect(run('foo_api_key_iso_ws1', 'foo_base_url_iso_ws1')).toBe(true);
        // A provider-specific endpoint of the same plugin counts, the endpoint of another provider does not.
        expect(run('foo_api_key', 'foo_openai_base_url')).toBe(true);
        expect(run('foo_openai_api_key', 'foo_ollama_base_url')).toBe(false);
        expect(run('foo_api_key', 'foobar_base_url')).toBe(false);
    });

    it('pairs camelCase names (T-161 review)', () => {
        const run = (secret: string, endpoint: string) =>
            endpointKeysToKeepLocal([{ key: endpoint, value: EVIL }], [secret], local({ [endpoint]: GOOD })).size === 1;
        expect(run('fooApiKey', 'fooApiUrl')).toBe(true);
        expect(run('fooApiKey', 'fooApiBase')).toBe(true);
        expect(run('fooApiKey', 'fooApiEndpoint')).toBe(true);
        expect(run('fooToken', 'fooServerUrl')).toBe(true);
        expect(run('fooToken', 'barServerUrl')).toBe(false);
    });

    it('fails closed for secret names without a plain secret tail', () => {
        const run = (secret: string, endpoint = 'foo_base_url') =>
            endpointKeysToKeepLocal([{ key: endpoint, value: EVIL }], [secret], local({ [endpoint]: GOOD })).size === 1;
        for (const secret of ['foo_api_key_v2', 'foo_secret_value', 'foo_apikey_encrypted', 'foo_credentials_json']) {
            expect(run(secret), secret).toBe(true);
        }
        // No secret word at all (a name that is only secret by other rules): the first word is the prefix.
        expect(endpointKeysToKeepLocal([{ key: 'foo_base_url', value: EVIL }], ['foo_zzz'], local({ foo_base_url: GOOD })).size).toBe(0);
        expect(run('foo_bearer')).toBe(true);
    });

    it('treats compound endpoint names and URL-holding keys as endpoints', () => {
        const keys = ['foo_api_key'];
        // Separators inside a compound word, and a name whose tail is not an endpoint word.
        expect(
            endpointKeysToKeepLocal([{ key: 'foo_host_name', value: 'evil.test' }], keys, local({ foo_host_name: 'good.test' })).size
        ).toBe(1);
        expect(endpointKeysToKeepLocal([{ key: 'foo_Host-Name', value: 'evil.test' }], keys, local({})).size).toBe(1);
        // A URL value makes any sibling an endpoint key, written or local.
        expect(endpointKeysToKeepLocal([{ key: 'foo_link', value: EVIL }], keys, local({ foo_link: GOOD })).size).toBe(1);
        expect(endpointKeysToKeepLocal([{ key: 'foo_link', value: 'x' }], keys, local({ foo_link: GOOD })).size).toBe(1);
        expect(endpointKeysToKeepLocal([{ key: 'foo_link', value: 'x' }], keys, local({ foo_link: 'y' })).size).toBe(0);
        expect(endpointKeysToKeepLocal([{ key: 'foo_link', value: GOOD }], keys, local({ foo_link: GOOD })).size).toBe(0);
    });

    it('ignores keys that are no secret key or no endpoint key, and never lists the secret key itself', () => {
        const entries = [
            { key: 'foo_theme', value: 'dark' },
            { key: 'foo_base_url', value: EVIL },
        ];
        expect(endpointKeysToKeepLocal(entries, ['foo_layout'], local({ foo_base_url: GOOD })).size).toBe(0);
        expect(endpointKeysToKeepLocal(entries, [], local({ foo_base_url: GOOD })).size).toBe(0);
        expect([...endpointKeysToKeepLocal(entries, ['foo_api_key'], local({ foo_base_url: GOOD }))]).toEqual(['foo_base_url']);
    });

    it('has nothing to protect without a local secret (fresh install)', () => {
        const none = (key: string) => (key === 'foo_base_url' ? GOOD : null);
        expect(endpointKeysToKeepLocal([{ key: 'foo_base_url', value: EVIL }], ['foo_api_key'], none).size).toBe(0);
        expect(endpointKeysToKeepLocal([{ key: 'foo_base_url', value: EVIL }], ['foo_api_key'], () => '  ').size).toBe(0);
    });

    it('fails closed when the local value cannot be read', () => {
        const unreadable = () => {
            throw new Error('boom');
        };
        expect(endpointKeysToKeepLocal([{ key: 'foo_base_url', value: GOOD }], ['foo_api_key'], unreadable).size).toBe(1);
    });
});

describe('parseBackup: preview reports blocked secrets only when the local values are readable', () => {
    function backupWith(aihub: string): string {
        return serializeBackup(
            buildBackup({
                localStorage: { 'kobar-storage': APP_STORE, 'kobar-aihub-plugin-storage': aihub },
                extensionsConfig: {},
                plugins: [],
                appVersion: '1.1.4',
                now: new Date(0),
            })
        );
    }
    const APP_STORE = JSON.stringify({
        state: { notes: [], globalNotes: [], workspaces: [], language: 'en' },
        version: KOBAR_STORAGE_VERSION,
    });
    const options = { installedPluginIds: ['com.kobar.aihub'], currentAppVersion: '1.1.4' };

    it('adds secrets-endpoint-changed and counts the field when the endpoint differs', () => {
        const text = backupWith(provider('backup-fake-key', { baseUrl: EVIL }));
        const local = { 'kobar-aihub-plugin-storage': provider(LOCAL_KEY, { baseUrl: GOOD }) };
        const res = parseBackup(text, { ...options, readLocal: (key) => local[key as keyof typeof local] ?? null });
        if (!res.ok) throw new Error(res.error);
        expect(res.preview.warnings).toContain('secrets-endpoint-changed');
        expect(res.preview.warnings).toContain('secrets-kept-local');
        expect(res.preview.counts.keepLocalBlocked).toBe(1);
        // The plan itself is unchanged by the local values; the preview never carries a key or a URL.
        expect(res.plan.keepLocalFields).toEqual([{ key: 'kobar-aihub-plugin-storage', path: ['state', 'providers', 'openai', 'apiKey'] }]);
        const shown = JSON.stringify(res.preview);
        expect(shown).not.toContain(LOCAL_KEY);
        expect(shown).not.toContain('evil.example');
    });

    it('adds no endpoint warning when the endpoint is the same, when local is missing or without readLocal', () => {
        const text = backupWith(provider('backup-fake-key', { baseUrl: GOOD }));
        const local = provider(LOCAL_KEY, { baseUrl: GOOD });
        const same = parseBackup(text, { ...options, readLocal: () => local });
        if (!same.ok) throw new Error(same.error);
        expect(same.preview.warnings).not.toContain('secrets-endpoint-changed');
        expect(same.preview.counts.keepLocalBlocked).toBe(0);

        const evil = backupWith(provider('backup-fake-key', { baseUrl: EVIL }));
        for (const readLocal of [undefined, () => null, () => 'not json']) {
            const res = parseBackup(evil, { ...options, readLocal });
            if (!res.ok) throw new Error(res.error);
            expect(res.preview.warnings).not.toContain('secrets-endpoint-changed');
            expect(res.preview.counts.keepLocalBlocked).toBe(0);
        }
    });

    it('fails closed like the restore when the local value cannot be read', () => {
        const evil = backupWith(provider('backup-fake-key', { baseUrl: EVIL }));
        const res = parseBackup(evil, {
            ...options,
            readLocal: () => {
                throw new Error('boom');
            },
        });
        if (!res.ok) throw new Error(res.error);
        expect(res.preview.warnings).toContain('secrets-endpoint-changed');
        expect(res.preview.counts.keepLocalBlocked).toBe(1);
    });

    it.each([
        ['an array of keys', { baseUrl: EVIL, apiKeys: ['x'] }, { baseUrl: GOOD, apiKeys: [LOCAL_KEY] }, { baseUrl: GOOD, apiKeys: ['x'] }],
        [
            'a secret-named container',
            { baseUrl: EVIL, credentials: { openai: 'x' } },
            { baseUrl: GOOD, credentials: { openai: LOCAL_KEY } },
            { baseUrl: GOOD, credentials: { openai: 'x' } },
        ],
    ])('warns for %s next to a changed base URL and not for the same one', (_name, evil, local, same) => {
        const asText = (value: unknown) => JSON.stringify({ state: value, version: 1 });
        const preview = (backupValue: unknown) => {
            const res = parseBackup(backupWith(asText(backupValue)), { ...options, readLocal: () => asText(local) });
            if (!res.ok) throw new Error(res.error);
            return res.preview;
        };
        expect(preview(evil).warnings).toContain('secrets-endpoint-changed');
        expect(preview(evil).counts.keepLocalBlocked).toBe(1);
        expect(preview(same).warnings).not.toContain('secrets-endpoint-changed');
        expect(preview(same).counts.keepLocalFields).toBe(1);
    });

    describe('T-161: record scope and secrets under their own key', () => {
        const preview = (backupValue: unknown, local: unknown) => {
            const res = parseBackup(backupWith(JSON.stringify({ state: backupValue, version: 1 })), {
                ...options,
                readLocal: () => JSON.stringify({ state: local, version: 1 }),
            });
            if (!res.ok) throw new Error(res.error);
            return res.preview;
        };

        it('(b) warns for an endpoint in another branch than the key, not for the same one', () => {
            const shape = (baseUrl: string, apiKey: string) => ({ provider: { baseUrl }, auth: { apiKey } });
            const evil = preview(shape(EVIL, 'x'), shape(GOOD, LOCAL_KEY));
            expect(evil.warnings).toContain('secrets-endpoint-changed');
            expect(evil.counts.keepLocalBlocked).toBe(1);
            expect(preview(shape(GOOD, 'x'), shape(GOOD, LOCAL_KEY)).warnings).not.toContain('secrets-endpoint-changed');
        });

        it('(c) warns for an endpoint outside a nested JSON string whose key is inside it', () => {
            const shape = (baseUrl: string, apiKey: string) => ({ baseUrl, inner: JSON.stringify({ apiKey }) });
            expect(preview(shape(EVIL, 'x'), shape(GOOD, LOCAL_KEY)).counts.keepLocalBlocked).toBe(1);
            expect(preview(shape(GOOD, 'x'), shape(GOOD, LOCAL_KEY)).counts.keepLocalBlocked).toBe(0);
        });

        describe('(a) a secret key kept local next to a written endpoint key', () => {
            const SECRET = 'todolist-plugin_api_key';
            const ENDPOINT = 'todolist-plugin_base_url';
            const backupText = (endpoint: string) =>
                serializeBackup(
                    buildBackup({
                        localStorage: { 'kobar-storage': APP_STORE, [SECRET]: 'backup-fake-key', [ENDPOINT]: endpoint },
                        extensionsConfig: {},
                        plugins: [],
                        appVersion: '1.1.4',
                        now: new Date(0),
                    })
                );
            const parse = (endpoint: string, local: Record<string, string>) => {
                const res = parseBackup(backupText(endpoint), {
                    installedPluginIds: ['todolist-plugin'],
                    currentAppVersion: '1.1.4',
                    readLocal: (key) => local[key] ?? null,
                });
                if (!res.ok) throw new Error(res.error);
                return res;
            };

            it('warns and counts the endpoint key when its value differs from the local one', () => {
                const res = parse(EVIL, { [SECRET]: LOCAL_KEY, [ENDPOINT]: GOOD });
                expect(res.plan.keepLocalKeys).toEqual([SECRET]);
                expect(res.plan.entries.some((e) => e.key === ENDPOINT)).toBe(true);
                expect(res.preview.warnings).toContain('secrets-endpoint-changed');
                expect(res.preview.counts.keepLocalBlocked).toBe(1);
                const shown = JSON.stringify(res.preview);
                expect(shown).not.toContain(LOCAL_KEY);
                expect(shown).not.toContain('evil.example');
            });

            it('does not warn when the endpoint is the same or the local values are not readable', () => {
                expect(parse(GOOD, { [SECRET]: LOCAL_KEY, [ENDPOINT]: GOOD }).preview.warnings).not.toContain('secrets-endpoint-changed');
                const res = parseBackup(backupText(EVIL), { installedPluginIds: ['todolist-plugin'], currentAppVersion: '1.1.4' });
                if (!res.ok) throw new Error(res.error);
                expect(res.preview.warnings).not.toContain('secrets-endpoint-changed');
            });
        });
    });

    it('does not warn for the chat store, whose keys only go to fixed provider hosts', () => {
        const chat = (key: string, localUrl: string) =>
            JSON.stringify({ state: { chats: [], apiKeys: { openai: key, localUrl } }, version: 1 });
        const text = serializeBackup(
            buildBackup({
                localStorage: { 'kobar-storage': APP_STORE, 'kobar-chat-storage': chat('backup-fake-key', 'http://localhost:1234') },
                extensionsConfig: {},
                plugins: [],
                appVersion: '1.1.4',
                now: new Date(0),
            })
        );
        const res = parseBackup(text, { ...options, readLocal: () => chat(LOCAL_KEY, 'http://localhost:11434') });
        if (!res.ok) throw new Error(res.error);
        expect(res.preview.counts.keepLocalFields).toBe(1);
        expect(res.preview.counts.keepLocalBlocked).toBe(0);
        expect(res.preview.warnings).not.toContain('secrets-endpoint-changed');
    });
});
