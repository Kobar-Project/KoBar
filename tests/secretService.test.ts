// T-411: SecretService (safeStorage-encrypted secrets in kobar-data/secrets/) and its IPC. A fake cipher stands in for
// Electron safeStorage; real fs in a temp dir, a fake ipcMain + the real typed registry. Synthetic values only; never touches the
// real userData and never launches Electron.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { InvokeResult, IpcSecretResult } from '../shared/ipc-contract';
import { type IpcMainLike, createIpcRegistry } from '../electron/main/ipc/registry.cjs';
import { INTERNAL_STORAGE_ENTRIES, SECRETS_DIR_NAME, isInternalStorageEntry } from '../electron/main/services/storage/layout.cjs';
import {
    SECRET_LAST4_MIN_LENGTH,
    SECRET_MAX_COUNT,
    SECRET_MAX_VALUE_BYTES,
    PLUGIN_SECRET_PREFIX,
    type SecretCipher,
    type SecretFs,
    type SecretResult,
    type SecretServiceOptions,
    createSecretService,
    isCoreSecretName,
    isPluginSecretName,
    isValidSecretName,
    secretLast4,
} from '../electron/main/services/secrets/secretService.cjs';
import {
    SECRET_CHANNELS,
    registerSecretsIpc,
    rendererSecretNameError,
    toIpcSecretResult,
} from '../electron/main/services/secrets/secretsIpc.cjs';
import { readMainModule } from './helpers/mainSource';

/** Obviously fake, long enough to show a suffix. */
const SECRET = 'sk-fake-T411-0123456789abcdefWXYZ';
const SECRET_2 = 'fake-second-token-9876543210-QRST';
/** A plugin-namespace name (T-417): the only kind the renderer may use over IPC. */
const PLUGIN_NAME = 'plugin-test-plugin-token';

let tmp: string;
let root: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-t411-'));
    root = path.join(tmp, 'kobar-data');
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
});

type CipherMode = 'ok' | 'identity' | 'throws' | 'mismatch' | 'decrypt-throws';

/** Stand-in for safeStorage: a 'v10' prefix + XOR, so the plaintext never appears in its output (like DPAPI). */
function fakeCipher(initial: { available?: boolean; mode?: CipherMode } = {}) {
    const state = { available: initial.available ?? true, mode: initial.mode ?? ('ok' as CipherMode) };
    const PREFIX = Buffer.from('v10');
    const xor = (bytes: Buffer) => Buffer.from(bytes.map((b) => b ^ 0x5a));
    const cipher: SecretCipher = {
        isEncryptionAvailable: () => state.available,
        encryptString: (plainText) => {
            // The error message carries the plaintext on purpose: the service must never log or return it.
            if (state.mode === 'throws') throw new Error(`cannot encrypt ${plainText}`);
            if (state.mode === 'identity') return Buffer.from(plainText, 'utf8');
            return Buffer.concat([PREFIX, xor(Buffer.from(plainText, 'utf8'))]);
        },
        decryptString: (encrypted) => {
            if (state.mode === 'decrypt-throws') throw new Error('cannot decrypt');
            if (!encrypted.subarray(0, 3).equals(PREFIX)) throw new Error('not ours');
            const text = xor(encrypted.subarray(3)).toString('utf8');
            return state.mode === 'mismatch' ? `${text}!` : text;
        },
    };
    return { state, cipher };
}

function setup(options: Partial<SecretServiceOptions> & { cipherState?: { available?: boolean; mode?: CipherMode } } = {}) {
    const { state, cipher } = fakeCipher(options.cipherState);
    const logged: Array<[string, unknown]> = [];
    const service = createSecretService({
        root,
        cipher,
        sleepSync: () => {},
        log: (event, details) => logged.push([event, details]),
        ...options,
    });
    return { service, state, logged };
}

function blob(name: string): string {
    return path.join(root, SECRETS_DIR_NAME, `${name}.bin`);
}

/** Every file below `dir` (recursive). */
function allFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? allFiles(full) : [full];
    });
}

/** True when any file below the temp dir contains `value` as UTF-8 or UTF-16LE. */
function plaintextOnDisk(value: string): boolean {
    const needles = [Buffer.from(value, 'utf8'), Buffer.from(value, 'utf16le')];
    return allFiles(tmp).some((file) => {
        const bytes = fs.readFileSync(file);
        return needles.some((needle) => bytes.includes(needle));
    });
}

describe('names, last4 and layout', () => {
    it('accepts only ids that can be one file name, never a path fragment', () => {
        for (const ok of ['openai', 'llm-anthropic', 'a', 'x'.repeat(64), 'plugin-ko-chat-token'])
            expect(isValidSecretName(ok), ok).toBe(true);
        for (const bad of [
            '',
            '..',
            '../x',
            'a/b',
            'a\\b',
            'C:\\x',
            'C:',
            '/etc/passwd',
            '\\\\server\\share',
            '.hidden',
            'name.bin',
            'Upper',
            'con',
            'nul',
            'com1',
            'lpt9',
            'x'.repeat(65),
            'a b',
            'a\u0000b',
            '%2e%2e',
            ' openai',
        ]) {
            expect(isValidSecretName(bad), JSON.stringify(bad)).toBe(false);
        }
        for (const notString of [undefined, null, 1, {}, ['openai']]) expect(isValidSecretName(notString)).toBe(false);
    });

    it('last4 shows the last four characters of long secrets only', () => {
        expect(secretLast4(SECRET)).toBe('WXYZ');
        expect(secretLast4('x'.repeat(SECRET_LAST4_MIN_LENGTH - 1))).toBeNull();
        expect(secretLast4(`${'x'.repeat(SECRET_LAST4_MIN_LENGTH - 4)}abcd`)).toBe('abcd');
        // Code points, not UTF-16 units: a surrogate pair is never split.
        expect(secretLast4(`${'x'.repeat(12)}ab\u{1F511}c`)).toBe('ab\u{1F511}c');
    });

    it('T-417: plugin and core namespaces never overlap', () => {
        expect(PLUGIN_SECRET_PREFIX).toBe('plugin-');
        for (const name of ['plugin-a', 'plugin-ko-chat-token', 'plugin--x', `plugin-${'x'.repeat(57)}`]) {
            expect(isPluginSecretName(name), name).toBe(true);
            expect(isCoreSecretName(name), name).toBe(false);
        }
        for (const name of ['openai', 'chat-openai', 'snippet-lock', 'plugins-x', 'pluginx', 'xplugin-a']) {
            expect(isCoreSecretName(name), name).toBe(true);
            expect(isPluginSecretName(name), name).toBe(false);
        }
        // Neither: malformed names and the bare prefix.
        for (const name of ['plugin-', 'Plugin-a', 'plugin-A', `plugin-${'x'.repeat(58)}`, '../plugin-a', 42, null]) {
            expect(isPluginSecretName(name), String(name)).toBe(false);
            expect(isCoreSecretName(name), String(name)).toBe(false);
        }
    });

    it('secrets/ is an internal storage entry (excluded from backups, exports and delete-all)', () => {
        expect(INTERNAL_STORAGE_ENTRIES).toContain(SECRETS_DIR_NAME);
        expect(isInternalStorageEntry('secrets/openai.bin')).toBe(true);
    });
});

describe('SecretService', () => {
    it('round trip: set stores ciphertext, status shows exists + last4, getSecret (main only) decrypts', () => {
        const { service } = setup();
        expect(service.status('openai')).toEqual({
            success: true,
            status: { name: 'openai', exists: false, last4: null, encryptionAvailable: true, unreadable: false },
        });
        const saved = service.set('openai', SECRET);
        expect(saved).toEqual({
            success: true,
            status: { name: 'openai', exists: true, last4: 'WXYZ', encryptionAvailable: true, unreadable: false },
        });
        expect(service.status('openai')).toEqual(saved);
        expect(service.getSecret('openai')).toBe(SECRET);
        expect(fs.existsSync(blob('openai'))).toBe(true);
        expect(plaintextOnDisk(SECRET)).toBe(false);
        // Nothing the renderer receives contains the value.
        expect(JSON.stringify([saved, service.status('openai')])).not.toContain(SECRET);
    });

    it('replacing a secret is atomic and leaves no temp file; delete removes it (missing counts as success)', () => {
        const { service } = setup();
        service.set('openai', SECRET);
        expect(service.set('openai', SECRET_2).status?.last4).toBe('QRST');
        expect(service.getSecret('openai')).toBe(SECRET_2);
        expect(fs.readdirSync(path.join(root, SECRETS_DIR_NAME))).toEqual(['openai.bin']);
        expect(service.delete('openai')).toEqual({
            success: true,
            status: { name: 'openai', exists: false, last4: null, encryptionAvailable: true, unreadable: false },
        });
        expect(fs.existsSync(blob('openai'))).toBe(false);
        expect(service.getSecret('openai')).toBeNull();
        expect(service.delete('openai').success).toBe(true);
    });

    it('encryption unavailable: set refuses with a warning and writes nothing (no plaintext fallback)', () => {
        const { service, state, logged } = setup({ cipherState: { available: false } });
        expect(service.isEncryptionAvailable()).toBe(false);
        expect(service.set('openai', SECRET)).toEqual({ success: false, reason: 'encryption-unavailable' });
        expect(fs.existsSync(root)).toBe(false);
        expect(logged).toContainEqual(['refused', { name: 'openai', reason: 'encryption-unavailable' }]);
        expect(service.status('openai').status).toEqual({
            name: 'openai',
            exists: false,
            last4: null,
            encryptionAvailable: false,
            unreadable: false,
        });

        // A secret saved while encryption worked is reported as existing but unreadable when it stops working.
        state.available = true;
        service.set('openai', SECRET);
        state.available = false;
        expect(service.status('openai').status).toMatchObject({ exists: true, last4: null, encryptionAvailable: false, unreadable: true });
        expect(service.getSecret('openai')).toBeNull();
        expect(plaintextOnDisk(SECRET)).toBe(false);
    });

    it('an isEncryptionAvailable that throws counts as unavailable', () => {
        const { cipher } = fakeCipher();
        const service = createSecretService({
            root,
            cipher: {
                ...cipher,
                isEncryptionAvailable: () => {
                    throw new Error('not ready');
                },
            },
            log: () => {},
        });
        expect(service.set('openai', SECRET)).toEqual({ success: false, reason: 'encryption-unavailable' });
        expect(fs.existsSync(root)).toBe(false);
    });

    it.each<[CipherMode]>([['identity'], ['throws'], ['mismatch']])(
        'a cipher that %s is refused before anything reaches the disk',
        (mode) => {
            const { service, logged } = setup({ cipherState: { mode } });
            expect(service.set('openai', SECRET)).toEqual({ success: false, reason: 'encryption-failed' });
            expect(allFiles(tmp)).toEqual([]);
            expect(JSON.stringify(logged)).not.toContain(SECRET);
        }
    );

    it("short values that match the cipher's fixed 'v10' header are not mistaken for plaintext", () => {
        const { service } = setup();
        expect(service.set('x', 'v1').success).toBe(true);
        expect(service.set('y', 'v').success).toBe(true);
        expect(service.set('z', 'v10').success).toBe(true);
        expect(service.getSecret('x')).toBe('v1');
        expect(service.getSecret('y')).toBe('v');
        expect(service.getSecret('z')).toBe('v10');
        // A true identity cipher (its round trip succeeds) is still refused from 8 bytes on by the containment check.
        const weak = createSecretService({
            root,
            log: () => {},
            cipher: {
                isEncryptionAvailable: () => true,
                encryptString: (plainText) => Buffer.from(plainText, 'utf8'),
                decryptString: (encrypted) => encrypted.toString('utf8'),
            },
        });
        expect(weak.set('openai', 'abcdefgh')).toEqual({ success: false, reason: 'encryption-failed' });
        expect(weak.set('openai', `v10${SECRET}`)).toEqual({ success: false, reason: 'encryption-failed' });
        expect(fs.existsSync(blob('openai'))).toBe(false);
    });

    it('a blob that cannot be decrypted is reported as unreadable, never as missing', () => {
        const { service, state } = setup();
        service.set('openai', SECRET);
        state.mode = 'decrypt-throws';
        expect(service.status('openai').status).toMatchObject({ exists: true, last4: null, unreadable: true, encryptionAvailable: true });
        expect(service.getSecret('openai')).toBeNull();
        state.mode = 'ok';
        fs.writeFileSync(blob('openai'), 'garbage');
        expect(service.status('openai').status).toMatchObject({ exists: true, unreadable: true });
        fs.writeFileSync(blob('openai'), Buffer.alloc(64 * 1024 + 1));
        expect(service.status('openai').status).toMatchObject({ exists: true, unreadable: true });
        expect(service.getSecret('openai')).toBeNull();
    });

    it('traversal and malformed names are rejected and touch nothing', () => {
        const { service } = setup();
        for (const name of ['../escape', '..', 'a/b', 'a\\b', 'C:\\x', '/abs', 'secrets/../../x', 'name.bin', 'con', 42, null]) {
            expect(service.set(name, SECRET), String(name)).toEqual({ success: false, reason: 'invalid-name' });
            expect(service.status(name)).toEqual({ success: false, reason: 'invalid-name' });
            expect(service.delete(name)).toEqual({ success: false, reason: 'invalid-name' });
            expect(service.getSecret(name as string)).toBeNull();
        }
        expect(allFiles(tmp)).toEqual([]);
    });

    it('a junction or link in place of secrets/ is refused (nothing is written outside kobar-data)', (ctx) => {
        const outside = path.join(tmp, 'outside');
        fs.mkdirSync(outside, { recursive: true });
        fs.mkdirSync(root, { recursive: true });
        try {
            fs.symlinkSync(outside, path.join(root, SECRETS_DIR_NAME), 'junction');
        } catch {
            ctx.skip();
        }
        const { service } = setup();
        expect(service.set('openai', SECRET)).toEqual({ success: false, reason: 'io' });
        expect(service.status('openai')).toEqual({ success: false, reason: 'io' });
        expect(service.delete('openai')).toEqual({ success: false, reason: 'io' });
        expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('values: non-string, empty and oversized values are refused', () => {
        const { service } = setup();
        expect(service.set('openai', 123)).toEqual({ success: false, reason: 'invalid-value' });
        expect(service.set('openai', '')).toEqual({ success: false, reason: 'invalid-value' });
        expect(service.set('openai', 'x'.repeat(SECRET_MAX_VALUE_BYTES + 1))).toEqual({ success: false, reason: 'too-large' });
        // The limit is in UTF-8 bytes.
        expect(service.set('openai', '\u00e9'.repeat(SECRET_MAX_VALUE_BYTES / 2 + 1))).toEqual({ success: false, reason: 'too-large' });
        expect(service.set('openai', 'x'.repeat(SECRET_MAX_VALUE_BYTES)).success).toBe(true);
    });

    it(`at most ${SECRET_MAX_COUNT} secrets; replacing an existing one is always allowed`, () => {
        const { service } = setup();
        for (let i = 0; i < SECRET_MAX_COUNT; i++) expect(service.set(`k${i}`, SECRET).success).toBe(true);
        expect(service.set('one-more', SECRET)).toEqual({ success: false, reason: 'limit-reached' });
        expect(service.set('k0', SECRET_2).success).toBe(true);
        service.delete('k1');
        expect(service.set('one-more', SECRET).success).toBe(true);
    });

    it('T-417: the limit is per namespace, so plugin secrets can never crowd out core secrets', () => {
        const { service } = setup();
        for (let i = 0; i < SECRET_MAX_COUNT; i++) expect(service.set(`plugin-p-k${i}`, SECRET).success).toBe(true);
        expect(service.set('plugin-p-one-more', SECRET)).toEqual({ success: false, reason: 'limit-reached' });
        expect(service.set('chat-openai', SECRET).success).toBe(true);
        for (let i = 1; i < SECRET_MAX_COUNT; i++) expect(service.set(`core-k${i}`, SECRET).success).toBe(true);
        expect(service.set('core-one-more', SECRET)).toEqual({ success: false, reason: 'limit-reached' });
        expect(service.set('plugin-p-k0', SECRET_2).success).toBe(true);
    });

    it('T-417: set refuses the bare plugin- prefix (it belongs to no namespace) and writes nothing', () => {
        const { service } = setup();
        expect(service.set('plugin-', SECRET)).toEqual({ success: false, reason: 'invalid-name' });
        expect(allFiles(tmp)).toEqual([]);
    });

    it('a failed rename keeps the old secret and removes the temp file', () => {
        const { service: first } = setup();
        first.set('openai', SECRET);
        const failingFs: SecretFs = {
            ...(fs as unknown as SecretFs),
            renameSync: () => {
                throw Object.assign(new Error('locked'), { code: 'EBUSY' });
            },
        };
        const { service, logged } = setup({ fs: failingFs });
        expect(service.set('openai', SECRET_2)).toEqual({ success: false, reason: 'io' });
        expect(logged).toContainEqual(['write-failed', { name: 'openai', code: 'EBUSY' }]);
        expect(service.getSecret('openai')).toBe(SECRET);
        expect(fs.readdirSync(path.join(root, SECRETS_DIR_NAME))).toEqual(['openai.bin']);
    });

    it('cleans temp files a crashed write left behind (once per session), never other files', () => {
        const dir = path.join(root, SECRETS_DIR_NAME);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'openai.bin.123.1-abcdefgh.tmp'), 'ciphertext');
        fs.writeFileSync(path.join(dir, 'README.txt'), 'keep');
        const { service } = setup();
        service.set('gemini', SECRET);
        expect(fs.readdirSync(dir).sort()).toEqual(['README.txt', 'gemini.bin']);
    });

    it('never logs a secret value (injected log and the default console log)', () => {
        const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
        const { cipher, state } = fakeCipher();
        const service = createSecretService({ root, cipher, sleepSync: () => {} });
        service.set('openai', SECRET);
        service.status('openai');
        service.getSecret('openai');
        state.mode = 'decrypt-throws';
        service.status('openai');
        state.mode = 'throws';
        service.set('openai', SECRET_2);
        state.mode = 'ok';
        state.available = false;
        service.set('openai', SECRET_2);
        service.delete('openai');
        const output = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
        expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
        expect(output).not.toContain(SECRET);
        expect(output).not.toContain(SECRET_2);
        expect(output).not.toContain('WXYZ'); // not even the last 4 characters
    });

    it('requires an absolute root', () => {
        const { cipher } = fakeCipher();
        expect(() => createSecretService({ root: 'relative/kobar-data', cipher })).toThrow();
    });
});

// ---- IPC ----------------------------------------------------------------------------------------------------------

const MAIN_WINDOW = 1;
const OTHER_WINDOW = 2;
type Listener = (event: never, ...args: unknown[]) => unknown;

function setupIpc(cipherState: { available?: boolean; mode?: CipherMode } = {}) {
    const { service, state } = setup({ cipherState });
    const handlers = new Map<string, Listener>();
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => void handlers.set(channel, listener as Listener),
        on: (channel, listener) => void listeners.set(channel, listener as Listener),
    };
    const logs: unknown[][] = [];
    const registry = createIpcRegistry({
        ipcMain,
        senderPolicies: {
            'main-window-top-frame': (event) => (event as unknown as { sender: { id: number } }).sender.id === MAIN_WINDOW,
        },
        logger: { warn: (...data) => void logs.push(data), error: (...data) => void logs.push(data) },
    });
    registerSecretsIpc({ registry, secrets: service });
    const invoke = async (channel: string, sender: number, ...args: unknown[]) =>
        (await handlers.get(channel)!({ sender: { id: sender } } as never, ...args)) as IpcSecretResult;
    return { service, state, handlers, listeners, logs, invoke };
}

describe('secret IPC', () => {
    it('registers exactly secret-status / secret-set / secret-delete: there is no channel that returns a value', () => {
        const { handlers, listeners } = setupIpc();
        expect([...handlers.keys()].sort()).toEqual([...SECRET_CHANNELS].sort());
        expect(listeners.size).toBe(0);
    });

    it('set then status: the renderer only ever gets { exists, last4 }', async () => {
        const { invoke, service } = setupIpc();
        const saved = await invoke('secret-set', MAIN_WINDOW, PLUGIN_NAME, SECRET);
        expect(saved).toEqual({
            success: true,
            status: { name: PLUGIN_NAME, exists: true, last4: 'WXYZ', encryptionAvailable: true, unreadable: false },
        });
        const status = await invoke('secret-status', MAIN_WINDOW, PLUGIN_NAME);
        expect(status).toEqual(saved);
        expect(JSON.stringify([saved, status])).not.toContain(SECRET);
        expect(service.getSecret(PLUGIN_NAME)).toBe(SECRET);
        expect((await invoke('secret-delete', MAIN_WINDOW, PLUGIN_NAME)).status?.exists).toBe(false);
    });

    it('T-417: core names answer reserved-name on every channel; the renderer cannot read, overwrite or delete them', async () => {
        const { invoke, service } = setupIpc();
        expect(service.set('chat-openai', SECRET).success).toBe(true); // main-side code path
        expect(await invoke('secret-status', MAIN_WINDOW, 'chat-openai')).toEqual({ success: false, reason: 'reserved-name' });
        expect(await invoke('secret-set', MAIN_WINDOW, 'chat-openai', SECRET_2)).toEqual({ success: false, reason: 'reserved-name' });
        expect(await invoke('secret-delete', MAIN_WINDOW, 'chat-openai')).toEqual({ success: false, reason: 'reserved-name' });
        expect(service.getSecret('chat-openai')).toBe(SECRET);
        expect(await invoke('secret-set', MAIN_WINDOW, 'new-core-name', SECRET)).toEqual({ success: false, reason: 'reserved-name' });
        expect(service.status('new-core-name').status?.exists).toBe(false);
        // The bare prefix is malformed, not reserved.
        expect(await invoke('secret-set', MAIN_WINDOW, 'plugin-', SECRET)).toEqual({ success: false, reason: 'invalid-name' });
    });

    it('T-417: rendererSecretNameError classifies names', () => {
        expect(rendererSecretNameError('plugin-x-token')).toBeNull();
        expect(rendererSecretNameError('openai')).toBe('reserved-name');
        expect(rendererSecretNameError('plugin-')).toBe('invalid-name');
        expect(rendererSecretNameError('../plugin-x')).toBe('invalid-name');
        expect(rendererSecretNameError(7)).toBe('invalid-name');
    });

    it('encryption unavailable: secret-set answers encryption-unavailable and nothing is stored', async () => {
        const { invoke } = setupIpc({ available: false });
        expect(await invoke('secret-set', MAIN_WINDOW, PLUGIN_NAME, SECRET)).toEqual({ success: false, reason: 'encryption-unavailable' });
        expect((await invoke('secret-status', MAIN_WINDOW, PLUGIN_NAME)).status).toMatchObject({
            exists: false,
            encryptionAvailable: false,
        });
        expect(allFiles(tmp)).toEqual([]);
    });

    it('other windows are denied before the service runs', async () => {
        const { invoke } = setupIpc();
        expect(await invoke('secret-set', OTHER_WINDOW, PLUGIN_NAME, SECRET)).toEqual({ success: false, reason: 'denied' });
        expect(await invoke('secret-status', OTHER_WINDOW, PLUGIN_NAME)).toEqual({ success: false, reason: 'denied' });
        expect(await invoke('secret-delete', OTHER_WINDOW, PLUGIN_NAME)).toEqual({ success: false, reason: 'denied' });
        expect(allFiles(tmp)).toEqual([]);
    });

    it('invalid arguments are refused by the schema and never logged with their values', async () => {
        const { invoke, logs } = setupIpc();
        expect(await invoke('secret-set', MAIN_WINDOW, PLUGIN_NAME, { value: SECRET })).toEqual({
            success: false,
            reason: 'invalid-request',
        });
        expect(await invoke('secret-set', MAIN_WINDOW, 7, SECRET)).toEqual({ success: false, reason: 'invalid-request' });
        expect(await invoke('secret-status', MAIN_WINDOW)).toEqual({ success: false, reason: 'invalid-request' });
        expect(await invoke('secret-set', MAIN_WINDOW, '../x', SECRET)).toEqual({ success: false, reason: 'invalid-name' });
        expect(logs.length).toBeGreaterThan(0);
        expect(JSON.stringify(logs)).not.toContain(SECRET);
        expect(allFiles(tmp)).toEqual([]);
    });

    it('a throwing service answers io instead of rejecting (the registry would log the error object)', async () => {
        const handlers = new Map<string, Listener>();
        const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l as Listener), on: () => undefined };
        const errors: unknown[][] = [];
        const registry = createIpcRegistry({
            ipcMain,
            senderPolicies: { 'main-window-top-frame': () => true },
            logger: { warn: () => {}, error: (...data) => void errors.push(data) },
        });
        const boom = () => {
            throw new Error(`boom ${SECRET}`);
        };
        registerSecretsIpc({
            registry,
            secrets: { isEncryptionAvailable: () => true, status: boom, set: boom, delete: boom, getSecret: () => null },
        });
        const result = await handlers.get('secret-set')!({ sender: { id: 1 } } as never, PLUGIN_NAME, SECRET);
        expect(result).toEqual({ success: false, reason: 'io' });
        expect(errors).toEqual([]);
    });

    it('toIpcSecretResult copies the known fields only', () => {
        const extra = {
            success: true,
            status: { name: 'openai', exists: true, last4: 'WXYZ', encryptionAvailable: true, unreadable: false, value: SECRET },
            value: SECRET,
        } as unknown as SecretResult;
        expect(JSON.stringify(toIpcSecretResult(extra))).not.toContain(SECRET);
    });

    it('the service result type fits the IPC contract', () => {
        expectTypeOf<SecretResult>().toExtend<IpcSecretResult>();
        expectTypeOf<InvokeResult<'secret-set'>>().toEqualTypeOf<IpcSecretResult>();
    });

    it('main wiring: registered in registerCoreIpc, the cipher is safeStorage and basic_text counts as unavailable', () => {
        const bootstrap = readMainModule('bootstrap.cts');
        expect(bootstrap).toMatch(/registerSecretsIpc\(\{ registry: ctx\.registry, secrets: ctx\.secrets \}\)/);
        const context = readMainModule('app/context.cts');
        expect(context).toMatch(/safeStorage\.isEncryptionAvailable\(\)/);
        expect(context).toMatch(/getSelectedStorageBackend\(\) === 'basic_text'/);
        // No main-process module hands a decrypted value to IPC.
        const ipcSource = readMainModule('services/secrets/secretsIpc.cts');
        expect(ipcSource).not.toMatch(/getSecret\(/);
    });
});
