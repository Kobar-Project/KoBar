import { describe, expect, it } from 'vitest';
import { maskSecrets } from '../electron/lib/storageBackup.cjs';
import { REDACTED_TEXT, baseKeyName, containsSecretValue, isSecretName, redactSecrets } from '../src/backup/redact';

// T-211: secret redaction of the full backup. Synthetic fixtures only (no real keys).

const FAKE_OPENAI = `sk-${'A1b2C3d4'.repeat(4)}`;
const FAKE_GOOGLE = `AIza${'Xy9_'.repeat(9)}`;
const FAKE_GITHUB = `ghp_${'Q'.repeat(30)}`;

function persisted(state: unknown, version = 1): string {
    return JSON.stringify({ state, version });
}

describe('isSecretName', () => {
    it.each([
        'apiKey',
        'api_key',
        'OPENAI_API_KEY',
        'password',
        'userPassword',
        'secret',
        'clientSecret',
        'githubToken',
        'token',
        'auth',
        'authorization',
        'accessKey',
        'privateKey',
        'credentials',
        'kobar_license_key',
        'apiKeys',
        'openaiKey',
        'geminiKey',
        'groqKey',
        'authKey',
        'providerKeys',
        'jwt',
        'sessionCookie',
        'accessTokens',
        'basicAuth',
        'proxyAuth',
        'authHeader',
        'webhookUrl',
        'slackWebhook',
    ])('%s is a secret name', (name) => {
        expect(isSecretName(name)).toBe(true);
    });

    it.each([
        'notes',
        'keyboard',
        'shortcutKey',
        'hotkey',
        'hotkeys',
        'sortKey',
        'primaryKey',
        'storageKey',
        'cacheKey',
        'modifierKeys',
        'i18nKey',
        'translationKey',
        'tokenCount',
        'maxTokens',
        'totalTokens',
        'sessions',
        'author',
        'passed',
        'theme',
        'id',
        '',
    ])('%s is not a secret name', (name) => {
        expect(isSecretName(name)).toBe(false);
    });

    it('ignores the isolated-workspace suffix of a key', () => {
        expect(baseKeyName('myplugin_token_iso_ws-1')).toBe('myplugin_token');
        expect(baseKeyName('kobar-storage')).toBe('kobar-storage');
    });
});

describe('containsSecretValue', () => {
    it('finds the same token shapes as the T-201 masking in electron/lib/storageBackup.cts', () => {
        const shapes = [
            FAKE_OPENAI,
            `sk_live_${'a'.repeat(20)}`,
            FAKE_GITHUB,
            `github_pat_${'b'.repeat(24)}`,
            FAKE_GOOGLE,
            `xoxb-${'1'.repeat(12)}`,
            `hf_${'c'.repeat(24)}`,
            `gsk_${'a'.repeat(40)}`,
            `pplx-${'b'.repeat(40)}`,
            `xai-${'c'.repeat(40)}`,
            `AKIA${'ABCD1234'.repeat(2)}`,
            `Bearer ${'d'.repeat(20)}`,
            `eyJ${'e'.repeat(12)}.${'f'.repeat(12)}.${'g'.repeat(8)}`,
        ];
        for (const shape of shapes) {
            expect(containsSecretValue(`x ${shape} y`), shape).toBe(true);
            const masked = maskSecrets(JSON.stringify({ note: `x ${shape} y` }));
            expect(masked.kind === 'json' && !masked.text.includes(shape), shape).toBe(true);
        }
    });

    it('finds well-known token shapes', () => {
        expect(containsSecretValue(`my key is ${FAKE_OPENAI} ok`)).toBe(true);
        expect(containsSecretValue(FAKE_GOOGLE)).toBe(true);
        expect(containsSecretValue(FAKE_GITHUB)).toBe(true);
        expect(containsSecretValue('just a normal note')).toBe(false);
    });

    it('does not mask ordinary text that only resembles the Groq / Perplexity / xAI / AWS shapes', () => {
        const texts = [
            'the gsk_ prefix is short',
            `gsk_${'a'.repeat(10)}`,
            'pplx-short and xai-short',
            'AKIA',
            'AKIAB is a word',
            `AKIA${'A'.repeat(15)} too short`,
            `AKIA${'A'.repeat(17)}`,
            `ASAKIA${'A'.repeat(16)}`,
            'SAKIAMOTO and MAKIATO are names',
            `akia${'a'.repeat(16)}`,
        ];
        for (const text of texts) {
            expect(containsSecretValue(text), text).toBe(false);
            const masked = maskSecrets(JSON.stringify({ note: text }));
            expect(masked.kind === 'json' && masked.text.includes(text), text).toBe(true);
        }
    });

    it('matches the new shapes without catastrophic backtracking', () => {
        const hostile = [
            `gsk_${'a'.repeat(200_000)}!`,
            `AKIA${'A'.repeat(200_000)}`,
            `pplx-${'-'.repeat(200_000)}`,
            `xai-${'x'.repeat(100_000)}-`,
        ];
        const started = performance.now();
        for (const text of hostile) {
            containsSecretValue(text);
            maskSecrets(JSON.stringify({ note: text }));
        }
        expect(performance.now() - started).toBeLessThan(2000);
    });

    it('does not match inside a longer base64 run (image data URL)', () => {
        const base64 = `iVBORw0KGgo${'abc+/'.repeat(5)}${FAKE_GOOGLE}+${'Zz09'.repeat(5)}`;
        expect(containsSecretValue(`<img src="data:image/png;base64,${base64}">`)).toBe(false);
    });
});

describe('redactSecrets', () => {
    it('blanks the AI keys of the chat store but keeps its non-secret fields', () => {
        const chat = persisted({
            chats: [{ id: 'c1', title: 'Hello', messages: [] }],
            apiKeys: {
                openai: FAKE_OPENAI,
                gemini: 'gemini-plain-key-value',
                anthropic: 'anthropic-plain-key-value',
                localUrl: 'http://localhost:11434',
                systemMessage: 'Be brief.',
                customInstructions: 'None',
                defaultModel: 'anthropic:claude-sonnet-4-6',
            },
        });
        const result = redactSecrets({ 'kobar-chat-storage': chat });
        const out = JSON.parse(result.entries['kobar-chat-storage']);
        expect(out.state.apiKeys).toEqual({
            openai: '',
            gemini: '',
            anthropic: '',
            localUrl: 'http://localhost:11434',
            systemMessage: 'Be brief.',
            customInstructions: 'None',
            defaultModel: 'anthropic:claude-sonnet-4-6',
        });
        expect(out.state.chats).toEqual([{ id: 'c1', title: 'Hello', messages: [] }]);
        expect(out.version).toBe(1);
        expect(result.redactedFields.map((f) => f.path.join('.')).sort()).toEqual([
            'state.apiKeys.anthropic',
            'state.apiKeys.gemini',
            'state.apiKeys.openai',
        ]);
        expect(result.redactedFields.every((f) => f.key === 'kobar-chat-storage' && f.reason === 'field')).toBe(true);
        expect(result.entries['kobar-chat-storage']).not.toContain(FAKE_OPENAI);
    });

    it('redacts secret-named fields in plugin data, including isolated keys and nested JSON strings', () => {
        const inner = JSON.stringify({ settings: { apiKey: 'plain-secret-1', model: 'gpt' }, items: [1, 2] });
        const entries = {
            'kobar-aihub-plugin-storage_iso_ws-2': persisted({ providers: { openai: { apiKey: 'plain-secret-2', baseUrl: 'https://x' } } }),
            myplugin_data: JSON.stringify({ blob: inner, password: 'hunter2', showPassword: true, token: '' }),
        };
        const result = redactSecrets(entries);
        const aihub = JSON.parse(result.entries['kobar-aihub-plugin-storage_iso_ws-2']);
        expect(aihub.state.providers.openai).toEqual({ apiKey: '', baseUrl: 'https://x' });
        const data = JSON.parse(result.entries.myplugin_data);
        expect(data.password).toBe('');
        expect(data.showPassword).toBe(true);
        expect(data.token).toBe('');
        expect(JSON.parse(data.blob)).toEqual({ settings: { apiKey: '', model: 'gpt' }, items: [1, 2] });
        const serialized = JSON.stringify(result.entries);
        for (const secret of ['plain-secret-1', 'plain-secret-2', 'hunter2']) expect(serialized).not.toContain(secret);
        expect(result.redactedFields).toContainEqual({ key: 'myplugin_data', path: ['blob', 'settings', 'apiKey'], reason: 'field' });
    });

    it('drops keys whose name is a secret name (also with an isolation suffix)', () => {
        const result = redactSecrets({
            kobar_license_key: 'LIC-123',
            'myplugin_api_key_iso_ws-1': 'plain',
            'kobar-storage': persisted({ notes: [] }, 23),
        });
        expect(Object.keys(result.entries)).toEqual(['kobar-storage']);
        expect(result.removedKeys).toEqual([
            { key: 'kobar_license_key', reason: 'secret-name' },
            { key: 'myplugin_api_key_iso_ws-1', reason: 'secret-name' },
        ]);
    });

    it('replaces token shapes inside free text (e.g. a key pasted into a note)', () => {
        const store = persisted({ notes: [{ id: 1, content: `<p>key: ${FAKE_OPENAI}</p>` }] }, 23);
        const result = redactSecrets({ 'kobar-storage': store, plain: `token ${FAKE_GITHUB} here` });
        const notes = JSON.parse(result.entries['kobar-storage']).state.notes;
        expect(notes[0].content).toBe(`<p>key: ${REDACTED_TEXT}</p>`);
        expect(result.entries.plain).toBe(`token ${REDACTED_TEXT} here`);
        expect(result.redactedFields).toContainEqual({ key: 'kobar-storage', path: ['state', 'notes', '0', 'content'], reason: 'pattern' });
    });

    it('keeps values without secrets byte-identical (no re-serialization)', () => {
        const pretty = '{\n  "state": { "theme": "midnight", "hotkey": "Ctrl+K" },\n  "version": 23\n}';
        const result = redactSecrets({ 'kobar-storage': pretty, kobar_language: 'tr', broken: '{not json' });
        expect(result.entries).toEqual({ 'kobar-storage': pretty, kobar_language: 'tr', broken: '{not json' });
        expect(result.removedKeys).toEqual([]);
        expect(result.redactedFields).toEqual([]);
    });

    it('replaces numbers under secret names with null; keeps booleans, null and numbers under other names', () => {
        const result = redactSecrets({
            x: JSON.stringify({ maxTokens: 100, tokenCount: 7, apiKey: null, secretMode: false, password: 1234 }),
        });
        expect(JSON.parse(result.entries.x)).toEqual({ maxTokens: 100, tokenCount: 7, apiKey: null, secretMode: false, password: null });
        expect(result.redactedFields).toEqual([{ key: 'x', path: ['password'], reason: 'field' }]);
    });

    it('decodes a JSON-encoded string of JSON and redacts inside it', () => {
        const raw = JSON.stringify(JSON.stringify({ apiKey: 'plain', note: 'n' }));
        expect(raw.startsWith('"')).toBe(true);
        const result = redactSecrets({ k: raw, plainQuoted: '"just text"' });
        expect(JSON.parse(JSON.parse(result.entries.k))).toEqual({ apiKey: '', note: 'n' });
        expect(result.entries.plainQuoted).toBe('"just text"');
        expect(JSON.stringify(result)).not.toContain('plain"');
    });

    it('drops a value that is nested too deeply to check, instead of leaking it', () => {
        let deep: unknown = { apiKey: 'plain-deep-secret' };
        for (let i = 0; i < 400; i++) deep = { child: deep };
        const result = redactSecrets({ deep: JSON.stringify(deep), ok: 'fine' });
        expect(result.entries).toEqual({ ok: 'fine' });
        expect(result.removedKeys).toEqual([{ key: 'deep', reason: 'unprocessable' }]);
    });

    it('blanks provider-named key fields such as openaiKey / authKey', () => {
        const result = redactSecrets({
            p: JSON.stringify({ openaiKey: 'plain-1', geminiKey: 'plain-2', authKey: 'plain-3', jwt: 'plain-4', hotkey: 'Ctrl+K' }),
        });
        expect(JSON.parse(result.entries.p)).toEqual({ openaiKey: '', geminiKey: '', authKey: '', jwt: '', hotkey: 'Ctrl+K' });
    });

    it('drops a key whose JSON is nested deeper than it walks (5 levels of JSON strings)', () => {
        let value: unknown = { apiKey: 'plain-nested-secret' };
        for (let i = 0; i < 5; i++) value = { inner: JSON.stringify(value) };
        const result = redactSecrets({ nested: JSON.stringify(value), ok: 'fine' });
        expect(result.entries).toEqual({ ok: 'fine' });
        expect(result.removedKeys).toEqual([{ key: 'nested', reason: 'unprocessable' }]);
    });

    it('keeps a __proto__ key as data through re-serialization', () => {
        const raw = '{"__proto__":{"note":"x"},"password":"plain-p"}';
        const out = JSON.parse(redactSecrets({ k: raw }).entries.k);
        expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
        expect(out.__proto__).toEqual({ note: 'x' });
        expect(out.password).toBe('');
        const top = redactSecrets({ ['__proto__']: 'v' } as Record<string, string>);
        expect(Object.prototype.hasOwnProperty.call(top.entries, '__proto__')).toBe(true);
    });

    it('drops entries whose property name is a token and never records the token', () => {
        const result = redactSecrets({ k: JSON.stringify({ [FAKE_OPENAI]: 'value', keep: 1 }), [`cache:${FAKE_GITHUB}`]: 'x' });
        expect(JSON.parse(result.entries.k)).toEqual({ keep: 1 });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(FAKE_OPENAI);
        expect(serialized).not.toContain(FAKE_GITHUB);
        expect(result.redactedFields).toContainEqual({ key: 'k', path: [REDACTED_TEXT], reason: 'field' });
        expect(result.removedKeys).toContainEqual({ key: `cache:${REDACTED_TEXT}`, reason: 'secret-name' });
    });

    it('does not modify its input', () => {
        const input = { k: JSON.stringify({ apiKey: 'plain-x' }) };
        const copy = { ...input };
        redactSecrets(input);
        expect(input).toEqual(copy);
    });
});
