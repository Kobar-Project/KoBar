import * as nodePath from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAppPaths } from '../electron/main/lib/appPaths.cjs';
import { type LlmContentPart, type LlmMessage, buildRequest, parseChunk, pickApiKey } from '../electron/main/lib/llmRequest.cjs';
import { resolvePhysicalPath } from '../electron/main/lib/physicalPath.cjs';
import { buildInstalledPlugin, manifestDisplayName, readManifestSafe } from '../electron/main/lib/pluginManifest.cjs';
import { readMainCts, readMainModule, readMainSources } from './helpers/mainSource';

// T-305: pure helpers moved out of electron/main.cts into electron/main/lib/*.cts. No Electron, no network, no real filesystem.

describe('createAppPaths', () => {
    const base = nodePath.join('X:', 'app', 'dist-electron');
    const paths = createAppPaths(base);

    it('resolves every path from the injected bundle directory with the same relative joins as before', () => {
        expect(paths).toEqual({
            iconPng: nodePath.join(base, '../build/icon.png'),
            iconIco256: nodePath.join(base, '../build/icon-256x256.ico'),
            preload: nodePath.join(base, 'preload.cjs'),
            pipPreload: nodePath.join(base, 'pip-preload.cjs'),
            settingsPreload: nodePath.join(base, 'settings-preload.cjs'),
            indexHtml: nodePath.join(base, '../dist/index.html'),
            pipHtml: nodePath.join(base, '../dist/pip.html'),
            settingsHtml: nodePath.join(base, '../dist/settings.html'),
            smtcWorker: nodePath.join(base, 'smtc-worker.cjs'),
            melodyDir: nodePath.join(base, '../Assets/Melody'),
            pluginsPlayground: nodePath.join(base, '../pluginsPlayground'),
        });
    });

    it('puts the bundle files next to the bundle and the assets one level up', () => {
        expect(nodePath.dirname(paths.preload)).toBe(base);
        expect(nodePath.dirname(paths.pipPreload)).toBe(base);
        expect(nodePath.dirname(paths.settingsPreload)).toBe(base);
        expect(nodePath.dirname(paths.smtcWorker)).toBe(base);
        expect(nodePath.basename(nodePath.dirname(paths.indexHtml))).toBe('dist');
        expect(nodePath.dirname(nodePath.dirname(paths.indexHtml))).toBe(nodePath.dirname(base));
    });

    it('main.cts passes its own __dirname and no longer uses __dirname anywhere else', () => {
        const main = readMainCts();
        expect(main).toMatch(/createAppPaths\(__dirname\)/);
        expect(main.match(/__dirname/g)).toHaveLength(2); // the call plus the explanatory comment
        const code = readMainModule('lib/appPaths.cts')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        expect(code).not.toMatch(/__dirname/);
    });
});

describe('resolvePhysicalPath', () => {
    const win = nodePath.win32;
    const storeEnv = {
        windowsStore: true,
        isWin: true,
        path: win,
        execPath: 'C:\\Program Files\\WindowsApps\\KoBar.App_2.0.1.0_x64__abcde12345fgh\\app\\KoBar.exe',
        env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\u' },
    };
    const family = 'KoBar.App_abcde12345fgh';

    it('returns the path unchanged outside the Store build', () => {
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar', { ...storeEnv, windowsStore: false })).toBe(
            'C:\\Users\\u\\AppData\\Roaming\\KoBar'
        );
        expect(resolvePhysicalPath('/home/u/.config/KoBar', { ...storeEnv, isWin: false })).toBe('/home/u/.config/KoBar');
        expect(resolvePhysicalPath('', storeEnv)).toBe('');
    });

    it('maps Roaming userData to the package LocalCache', () => {
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar\\KoBox', storeEnv)).toBe(
            win.join('C:\\Users\\u\\AppData\\Local', 'Packages', family, 'LocalCache', 'Roaming', 'KoBar', 'KoBox')
        );
    });

    it('maps Local userData to the package LocalState, but never a path already under Packages', () => {
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Local\\KoBar', storeEnv)).toBe(
            win.join('C:\\Users\\u\\AppData\\Local', 'Packages', family, 'LocalState', 'KoBar')
        );
        const inPackages = 'C:\\Users\\u\\AppData\\Local\\Packages\\Other_1234567890abc\\LocalState';
        expect(resolvePhysicalPath(inPackages, storeEnv)).toBe(inPackages);
    });

    it('falls back to USERPROFILE when APPDATA is missing, and leaves unrelated paths alone', () => {
        const env = { ...storeEnv, env: { LOCALAPPDATA: storeEnv.env.LOCALAPPDATA, USERPROFILE: 'C:\\Users\\u' } };
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar', env)).toBe(
            win.join('C:\\Users\\u\\AppData\\Local', 'Packages', family, 'LocalCache', 'Roaming', 'KoBar')
        );
        expect(resolvePhysicalPath('D:\\Other\\KoBar', storeEnv)).toBe('D:\\Other\\KoBar');
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar', { ...storeEnv, env: {} })).toBe(
            'C:\\Users\\u\\AppData\\Roaming\\KoBar'
        );
    });

    it('returns the input when the exe is not in a WindowsApps package folder name', () => {
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar', { ...storeEnv, execPath: 'C:\\Tools\\KoBar.exe' })).toBe(
            'C:\\Users\\u\\AppData\\Roaming\\KoBar'
        );
    });

    it('logs and returns the input when resolving throws', () => {
        const logError = vi.fn();
        const broken = {
            ...storeEnv,
            path: {
                ...win,
                relative: () => {
                    throw new Error('boom');
                },
            },
            logError,
        };
        expect(resolvePhysicalPath('C:\\Users\\u\\AppData\\Roaming\\KoBar', broken)).toBe('C:\\Users\\u\\AppData\\Roaming\\KoBar');
        expect(logError).toHaveBeenCalledOnce();
    });
});

describe('readManifestSafe', () => {
    const fsWith = (content: string | Error) => ({
        readFileSync: (() => {
            if (content instanceof Error) throw content;
            return content;
        }) as unknown as typeof import('node:fs').readFileSync,
    });

    it('returns the parsed object', () => {
        expect(readManifestSafe('m.json', fsWith('{"id":"a","name":"A"}'))).toEqual({ id: 'a', name: 'A' });
    });

    it('returns null for a missing file, invalid JSON, arrays and non-objects', () => {
        expect(readManifestSafe('m.json', fsWith(new Error('ENOENT')))).toBeNull();
        expect(readManifestSafe('m.json', fsWith('{oops'))).toBeNull();
        expect(readManifestSafe('m.json', fsWith('[1,2]'))).toBeNull();
        expect(readManifestSafe('m.json', fsWith('"text"'))).toBeNull();
        expect(readManifestSafe('m.json', fsWith('null'))).toBeNull();
        expect(readManifestSafe('m.json', fsWith('42'))).toBeNull();
    });

    it('reads through the real fs by default (missing file -> null)', () => {
        expect(readManifestSafe(nodePath.join(__dirname, 'does-not-exist', 'manifest.json'))).toBeNull();
    });
});

describe('manifestDisplayName', () => {
    it('uses a non-empty string name, else the folder name', () => {
        expect(manifestDisplayName({ name: 'Nice' }, 'folder')).toBe('Nice');
        expect(manifestDisplayName({ name: '' }, 'folder')).toBe('folder');
        expect(manifestDisplayName({ name: 5 }, 'folder')).toBe('folder');
        expect(manifestDisplayName({}, 'folder')).toBe('folder');
    });
});

describe('buildInstalledPlugin', () => {
    it('normalises a sparse manifest with defaults', () => {
        expect(buildInstalledPlugin({}, 'dir', false, {}, '')).toEqual({
            id: 'dir',
            name: 'dir',
            version: '1.0.0',
            description: '',
            icon: 'extension',
            image: '',
            isBeta: false,
            isPlayground: false,
            storeImage: [],
            categories: [],
            versionNote: '',
            githubRepo: '',
            enabled: true,
            code: '',
        });
    });

    it('keeps manifest fields, caps storeImage at 3 and honours the enabled config by id', () => {
        const manifest = {
            id: 'p1',
            name: 'P',
            version: '2.3.4',
            description: 'd',
            icon: 'i',
            image: 'img',
            isBeta: true,
            storeImage: ['a', 'b', 'c', 'd'],
            categories: ['x'],
            versionNote: 'n',
            githubLink: 'o/r',
        };
        const info = buildInstalledPlugin(manifest, 'dir', false, { p1: false }, 'code()');
        expect(info).toMatchObject({
            id: 'p1',
            name: 'P',
            version: '2.3.4',
            isBeta: true,
            storeImage: ['a', 'b', 'c'],
            githubRepo: 'o/r',
            enabled: false,
            code: 'code()',
        });
        expect(buildInstalledPlugin({ ...manifest, githubRepo: 'o/main' }, 'dir', false, {}, '').githubRepo).toBe('o/main');
        expect(buildInstalledPlugin({ ...manifest, isBeta: 'yes' }, 'dir', false, {}, '').isBeta).toBe(false);
    });

    it('marks playground plugins as beta, prefixes the name and the id, and reads the config by the prefixed id', () => {
        const info = buildInstalledPlugin({ id: 'p1', name: 'P', isBeta: false }, 'dir', true, { 'dev-p1': false }, '');
        expect(info).toMatchObject({ id: 'dev-p1', name: '[DEV] P', isBeta: true, isPlayground: true, enabled: false });
    });
});

describe('pickApiKey', () => {
    const keys = { openai: 'o', gemini: 'g', anthropic: 'a', localUrl: 'http://localhost:1234' };
    it('picks the key of the provider', () => {
        expect(pickApiKey('openai', keys)).toBe('o');
        expect(pickApiKey('gemini', keys)).toBe('g');
        expect(pickApiKey('anthropic', keys)).toBe('a');
    });
    it('returns an empty string for local, unknown providers and missing key objects', () => {
        expect(pickApiKey('local', keys)).toBe('');
        expect(pickApiKey('other', keys)).toBe('');
        expect(pickApiKey('openai', null)).toBe('');
        // A cloud provider whose key is absent from the key object yields undefined at runtime (the handler treats it as missing).
        expect(pickApiKey('openai', {})).toBeUndefined();
    });
});

describe('buildRequest', () => {
    const messages: LlmMessage[] = [{ role: 'user', content: 'hi' }];
    const image: LlmContentPart = { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } };
    const vision: LlmMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'look' }, image] }];

    function ok(input: Parameters<typeof buildRequest>[0]) {
        const r = buildRequest(input);
        if (!r.ok) throw new Error('expected ok');
        return r;
    }

    it('openai: bearer key, system prompt first, default model', () => {
        const r = ok({ provider: 'openai', model: '', messages, apiKeys: {}, apiKey: 'sk', systemPrompt: 'be brief' });
        expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(r.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk' });
        expect(r.body).toEqual({ model: 'gpt-4o', messages: [{ role: 'system', content: 'be brief' }, ...messages], stream: true });
        expect(messages).toHaveLength(1); // the input array is never mutated
    });

    it('openai: keeps the given model and sends no system message without a prompt', () => {
        const r = ok({ provider: 'openai', model: 'gpt-x', messages, apiKeys: {}, apiKey: 'sk' });
        expect(r.body).toEqual({ model: 'gpt-x', messages, stream: true });
    });

    it('gemini: openai-compatible endpoint, strips the gemini: prefix and -latest', () => {
        const r = ok({ provider: 'gemini', model: 'gemini:pro-latest', messages, apiKeys: {}, apiKey: 'gk', systemPrompt: 's' });
        expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
        expect(r.headers.Authorization).toBe('Bearer gk');
        expect(r.body.model).toBe('pro');
        expect(r.body.messages[0]).toEqual({ role: 'system', content: 's' });
        expect(ok({ provider: 'gemini', model: 'gemini:-latest', messages, apiKeys: {}, apiKey: 'gk' }).body.model).toBe(
            'gemini-3.1-flash'
        );
    });

    it('anthropic: x-api-key headers, system as a field, images translated to the base64 schema', () => {
        const r = ok({ provider: 'anthropic', model: '', messages: vision, apiKeys: {}, apiKey: 'ak', systemPrompt: 'sys' });
        expect(r.url).toBe('https://api.anthropic.com/v1/messages');
        expect(r.headers).toEqual({ 'Content-Type': 'application/json', 'x-api-key': 'ak', 'anthropic-version': '2023-06-01' });
        expect(r.body).toEqual({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'look' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
                    ],
                },
            ],
            stream: true,
            system: 'sys',
        });
    });

    it('anthropic: leaves an image that is not a base64 data URL and plain-text messages unchanged', () => {
        const odd: LlmContentPart = { type: 'image_url', image_url: { url: 'https://x/y.png' } };
        const r = ok({
            provider: 'anthropic',
            model: 'm',
            messages: [{ role: 'user', content: [odd] }, ...messages],
            apiKeys: {},
            apiKey: 'ak',
        });
        expect(r.body.messages).toEqual([{ role: 'user', content: [odd] }, ...messages]);
        expect('system' in r.body).toBe(false);
    });

    it('local: refuses a non-loopback URL', () => {
        expect(
            buildRequest({ provider: 'local', model: 'local:m', messages, apiKeys: { localUrl: 'http://evil.example.com' }, apiKey: '' })
        ).toEqual({
            ok: false,
            error: 'The local model URL must point to this computer (localhost, 127.0.0.1 or [::1]).',
        });
    });

    it('local: Ollama native API on the default endpoint, with images split out of the content', () => {
        const r = ok({
            provider: 'local',
            model: 'local:llava',
            messages: vision,
            apiKeys: {},
            apiKey: '',
            systemPrompt: 'ignored for vision',
        });
        expect(r.url).toBe('http://localhost:11434/api/chat');
        expect(r.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(r.body).toEqual({ model: 'llava', messages: [{ role: 'user', content: 'look', images: ['QUJD'] }], stream: true });
    });

    it('local: Ollama detection by port or by the word ollama, and URL suffixes are trimmed', () => {
        expect(
            ok({ provider: 'local', model: 'local:', messages, apiKeys: { localUrl: 'http://127.0.0.1:11434/v1/' }, apiKey: '' }).url
        ).toBe('http://127.0.0.1:11434/api/chat');
        expect(
            ok({ provider: 'local', model: 'local:', messages, apiKeys: { localUrl: 'http://localhost:9999/api' }, apiKey: '' }).url
        ).toBe('http://localhost:9999/v1/chat/completions');
        expect(
            ok({ provider: 'local', model: 'local:', messages, apiKeys: { localUrl: 'http://localhost:9999/ollama' }, apiKey: '' }).url
        ).toBe('http://localhost:9999/ollama/api/chat');
    });

    it('local: LM Studio (OpenAI compatible) with a system prompt and sampling options', () => {
        const r = ok({
            provider: 'local',
            model: 'local:',
            messages,
            apiKeys: { localUrl: 'http://localhost:1234/v1' },
            apiKey: '',
            systemPrompt: 'sys',
        });
        expect(r.url).toBe('http://localhost:1234/v1/chat/completions');
        expect(r.body).toEqual({
            model: 'local-model',
            messages: [{ role: 'system', content: 'sys' }, ...messages],
            stream: true,
            max_tokens: 2048,
            temperature: 0.7,
        });
    });

    it('an unknown provider yields an empty url (the caller then fails the fetch like before)', () => {
        expect(ok({ provider: 'nope', model: 'x', messages, apiKeys: {}, apiKey: '' })).toEqual({
            ok: true,
            url: '',
            headers: {},
            body: {},
        });
    });

    it('throws on a missing model string for providers that parse it, like the inline code did', () => {
        expect(() =>
            buildRequest({ provider: 'local', model: undefined as unknown as string, messages, apiKeys: {}, apiKey: '' })
        ).toThrow();
    });
});

describe('parseChunk', () => {
    it('reads openai-style deltas (also for gemini and local)', () => {
        const payload = { choices: [{ delta: { content: 'Hel' } }] };
        for (const provider of ['openai', 'gemini', 'local']) expect(parseChunk(provider, payload)).toBe('Hel');
        expect(parseChunk('openai', { choices: [{ delta: {} }] })).toBe('');
        expect(parseChunk('openai', { choices: [] })).toBe('');
        expect(parseChunk('openai', {})).toBe('');
    });

    it('reads anthropic content_block_delta events only', () => {
        expect(parseChunk('anthropic', { type: 'content_block_delta', delta: { text: 'lo' } })).toBe('lo');
        expect(parseChunk('anthropic', { type: 'content_block_delta', delta: {} })).toBe('');
        expect(parseChunk('anthropic', { type: 'message_start' })).toBe('');
        expect(parseChunk('anthropic', { choices: [{ delta: { content: 'x' } }] })).toBe('');
    });

    it('throws when a content_block_delta has no delta (the caller ignores the chunk)', () => {
        expect(() => parseChunk('anthropic', { type: 'content_block_delta' })).toThrow();
    });
});

describe('main.cts wiring (T-305)', () => {
    const main = readMainCts();

    it('imports the extracted modules and no longer defines the moved functions', () => {
        // T-315: appPaths is still wired by main.cts; physicalPath and pluginManifest are used by the modules main.cts calls.
        expect(main).toContain('./main/lib/appPaths.cjs');
        for (const module of ['appPaths', 'physicalPath', 'pluginManifest']) expect(readMainSources()).toContain(`lib/${module}.cjs`);
        // T-313: the llm-request handler (the only user of llmRequest) moved to services/llm.cts; main.cts registers it.
        // T-315: main.cts calls bootstrap.cts, which imports and registers it.
        expect(readMainModule('bootstrap.cts')).toContain('./services/llm.cjs');
        expect(readMainModule('services/llm.cts')).toContain('../lib/llmRequest.cjs');
        expect(main).not.toMatch(/function resolvePhysicalPath\(/);
        expect(main).not.toMatch(/function readManifestSafe\(/);
    });

    it('the llm-request handler still validates the key before building and fetches only what buildRequest returned', () => {
        // T-313: the handler lives in electron/main/services/llm.cts and runs to the end of registerLlmIpc.
        const llm = readMainModule('services/llm.cts');
        const start = llm.indexOf("'llm-request'");
        const end = llm.indexOf('\n}\n', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const handler = llm.slice(start, end);
        const iKey = handler.indexOf('pickApiKey(');
        const iMissing = handler.indexOf('API key not found');
        const iBuild = handler.indexOf('buildRequest(');
        const iFetch = handler.indexOf('await fetch(url');
        expect(iKey).toBeGreaterThan(-1);
        expect(iMissing).toBeGreaterThan(iKey);
        expect(iBuild).toBeGreaterThan(iMissing);
        expect(iFetch).toBeGreaterThan(iBuild);
    });
});
