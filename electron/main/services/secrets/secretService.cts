// T-411: encrypted secret storage for the main process. Each secret is one file
// `userData/kobar-data/secrets/<name>.bin` holding the bytes of Electron `safeStorage.encryptString` (DPAPI on Windows,
// Keychain on macOS). Pure: no Electron import; the cipher (safeStorage adapter), fs, randomness and the path guard are
// injected, so it is unit-tested with a fake cipher against a temp dir.
//
// Guarantees:
//   - No plaintext fallback: when the cipher reports encryption unavailable, `set` refuses (`encryption-unavailable`) and
//     writes nothing. A cipher whose output contains the plaintext, or that does not decrypt back to it, is refused too.
//   - The renderer-facing results carry `{ exists, last4 }` only; the value is returned by `getSecret` alone, which is for
//     main-process callers (LLM / network services) and has no IPC channel.
//   - Names are an id (`[a-z0-9-]{1,64}`, no Windows device name), never a path fragment; every path is checked lexically and
//     against links/junctions (fsGuards) before it is touched.
//   - Writes are atomic (temp file in secrets/, fsync, rename with the Windows retry policy); a failed write leaves the old
//     secret untouched. Values are capped (SECRET_MAX_VALUE_BYTES) and so is the number of secrets (SECRET_MAX_COUNT).
//   - Values never reach a log or an error message: logs carry the event, the secret name and an error code only.
//   - secrets/ is internal (layout.cts INTERNAL_STORAGE_ENTRIES): excluded from full backups, exports and "delete all" flows.
//
// Namespaces (T-417): plugins share the renderer realm and `window.api` with the host UI, so an IPC call cannot tell who made
// it. Renderer-originated calls (secretsIpc.cts) are therefore limited to the plugin namespace `plugin-<plugin id>-<key>`
// (isPluginSecretName); every other valid name is a core name (isCoreSecretName) that only main-process code paths may write,
// read or delete through this service. The two never collide, and each namespace has its own SECRET_MAX_COUNT, so plugins
// cannot crowd core secrets out. The plugin id inside the prefix is a convention the host cannot verify.
import * as nodeFs from 'fs';
import * as nodePath from 'path';
import { isFsPathInside } from '../../../lib/fsGuards.cjs';
import { type StorageFs, atomicWriteFileSync, blockingSleep, fsErrorCode, removeQuietly } from '../storage/atomicWrite.cjs';
import { SECRETS_DIR_NAME, isStorageTempName, isValidStorageId, resolveStoragePath } from '../storage/layout.cjs';

/** Extension of a secret blob file. */
export const SECRET_FILE_EXTENSION = '.bin';
/** Largest secret accepted (UTF-8 bytes). API keys and tokens are far below this. */
export const SECRET_MAX_VALUE_BYTES = 16 * 1024;
/** Largest blob file read back; anything bigger is treated as unreadable instead of being read into memory. */
export const SECRET_MAX_FILE_BYTES = 64 * 1024;
/**
 * Most secrets kept at the same time per namespace (core / plugin, T-417): a new name beyond this is refused; replacing an
 * existing one is always allowed.
 */
export const SECRET_MAX_COUNT = 64;
/** Prefix of every name the renderer (and so any plugin) may use over IPC: `plugin-<plugin id>-<key>` (T-417). */
export const PLUGIN_SECRET_PREFIX = 'plugin-';
/** Secrets shorter than this never show a suffix (4 characters would reveal too much of them). */
export const SECRET_LAST4_MIN_LENGTH = 12;

/** The part of Electron `safeStorage` the service uses. */
export interface SecretCipher {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Uint8Array;
    decryptString(encrypted: Buffer): string;
}

/** `StorageFs` plus a binary read (the real `fs` satisfies it). */
export type SecretFs = StorageFs & { readFileSync(p: string): Uint8Array };

/** `reserved-name` is only produced by the IPC layer (a renderer call outside the plugin namespace, T-417). */
export type SecretFailure =
    | 'invalid-name'
    | 'reserved-name'
    | 'invalid-value'
    | 'too-large'
    | 'limit-reached'
    | 'encryption-unavailable'
    | 'encryption-failed'
    | 'io';

export interface SecretStatus {
    name: string;
    exists: boolean;
    last4: string | null;
    encryptionAvailable: boolean;
    unreadable: boolean;
}

export interface SecretResult {
    success: boolean;
    reason?: SecretFailure;
    status?: SecretStatus;
}

export interface SecretServiceOptions {
    /** Absolute path of userData/kobar-data (the blobs live in its secrets/ folder). */
    root: string;
    cipher: SecretCipher;
    fs?: SecretFs;
    random?: () => number;
    sleepSync?: (ms: number) => void;
    pid?: number;
    /** Link-aware containment check (default: fsGuards `isFsPathInside`). */
    isInside?: (base: string, target: string) => boolean;
    log?: (event: string, details?: Record<string, string | number | boolean>) => void;
}

/**
 * The main-process API. It accepts both namespaces: core secrets (e.g. the chat API keys T-416 will move here) are written
 * through it by main-side code only; the renderer reaches it solely through secretsIpc.cts, which allows plugin names only.
 */
export interface SecretService {
    /** True when safeStorage can encrypt right now (never throws). */
    isEncryptionAvailable(): boolean;
    /** `{ exists, last4 }` of one secret. Never throws, never returns the value. */
    status(name: unknown): SecretResult;
    /** Encrypts and stores a secret, replacing an existing one atomically. Never throws. */
    set(name: unknown, value: unknown): SecretResult;
    /** Removes a secret (missing counts as success). Never throws. */
    delete(name: unknown): SecretResult;
    /** MAIN PROCESS ONLY (no IPC): the decrypted value, or null when missing or unreadable. Never throws. */
    getSecret(name: string): string | null;
}

/** True for a usable secret name: an id that can only ever become one file name inside secrets/. */
export function isValidSecretName(name: unknown): name is string {
    return isValidStorageId(name);
}

/** True for a plugin-namespace name (T-417): a valid name made of `plugin-` and at least one more character. */
export function isPluginSecretName(name: unknown): name is string {
    return isValidSecretName(name) && name.startsWith(PLUGIN_SECRET_PREFIX) && name.length > PLUGIN_SECRET_PREFIX.length;
}

/** True for a core (host) name (T-417): a valid name outside the plugin namespace. Only main-process code may use these. */
export function isCoreSecretName(name: unknown): name is string {
    return isValidSecretName(name) && !name.startsWith(PLUGIN_SECRET_PREFIX);
}

/** The last 4 characters (code points) of a secret, or null when it is too short to show any of it. */
export function secretLast4(value: string): string | null {
    const chars = Array.from(value);
    return chars.length >= SECRET_LAST4_MIN_LENGTH ? chars.slice(-4).join('') : null;
}

/** Values at least this long (UTF-8 bytes) must not appear inside the cipher output. */
const PLAINTEXT_CHECK_MIN_BYTES = 8;

function bytesContain(haystack: Uint8Array, needle: Buffer): boolean {
    return needle.length > 0 && Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).includes(needle);
}

export function createSecretService(options: SecretServiceOptions): SecretService {
    if (typeof options.root !== 'string' || !nodePath.isAbsolute(options.root))
        throw new Error('SecretService root must be an absolute path');
    const fs = options.fs ?? (nodeFs as unknown as SecretFs);
    const { cipher } = options;
    const random = options.random ?? Math.random;
    const sleepSync = options.sleepSync ?? blockingSleep;
    const pid = options.pid ?? process.pid;
    const isInside = options.isInside ?? isFsPathInside;
    const log =
        options.log ??
        ((event, details) =>
            (event === 'saved' || event === 'deleted' ? console.log : console.warn)('[KoBar] secrets:', event, details ?? {}));
    const root = nodePath.resolve(options.root);
    const dir = nodePath.join(root, SECRETS_DIR_NAME);
    let cleanedTemp = false;

    function encryptionAvailable(): boolean {
        try {
            return cipher.isEncryptionAvailable() === true;
        } catch {
            return false;
        }
    }

    function guard(p: string): string {
        if (!isInside(root, p)) throw Object.assign(new Error('secret path guard'), { code: 'PATH_GUARD' });
        return p;
    }

    /** Absolute blob path of a validated name (lexical + link check). Throws PATH_GUARD. */
    function blobPath(name: string): string {
        const resolved = resolveStoragePath(root, [SECRETS_DIR_NAME, `${name}${SECRET_FILE_EXTENSION}`]);
        if (resolved === null) throw Object.assign(new Error('secret path guard'), { code: 'PATH_GUARD' });
        return guard(resolved);
    }

    function failure(reason: SecretFailure, status?: SecretStatus): SecretResult {
        return status ? { success: false, reason, status } : { success: false, reason };
    }

    type BlobRead = { kind: 'missing' } | { kind: 'ok'; bytes: Buffer } | { kind: 'error'; code: string };

    function readBlob(p: string): BlobRead {
        try {
            const stat = fs.statSync(p);
            if (!stat.isFile() || stat.size > SECRET_MAX_FILE_BYTES) return { kind: 'error', code: 'BAD_FILE' };
            const data = fs.readFileSync(p);
            return { kind: 'ok', bytes: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
        } catch (err) {
            const code = fsErrorCode(err);
            return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'error', code };
        }
    }

    /** Decrypts a blob; null when encryption is unavailable or decryption fails. */
    function decrypt(name: string, bytes: Buffer): string | null {
        if (!encryptionAvailable()) return null;
        try {
            const value = cipher.decryptString(bytes);
            return typeof value === 'string' ? value : null;
        } catch {
            log('decrypt-failed', { name });
            return null;
        }
    }

    function statusOf(name: string, read: BlobRead): SecretStatus {
        const available = encryptionAvailable();
        if (read.kind === 'missing') return { name, exists: false, last4: null, encryptionAvailable: available, unreadable: false };
        const value = read.kind === 'ok' ? decrypt(name, read.bytes) : null;
        return {
            name,
            exists: true,
            last4: value === null ? null : secretLast4(value),
            encryptionAvailable: available,
            unreadable: value === null,
        };
    }

    /** Blob names currently stored (only our own `<valid name>.bin` files count). */
    function storedNames(): string[] {
        let names: string[];
        try {
            names = fs.readdirSync(guard(dir));
        } catch {
            return [];
        }
        return names
            .filter((file) => file.endsWith(SECRET_FILE_EXTENSION))
            .map((file) => file.slice(0, -SECRET_FILE_EXTENSION.length))
            .filter((name) => isValidSecretName(name));
    }

    /** Once per session: removes temp files a crashed write left in secrets/ (they only ever hold ciphertext). */
    function cleanTempOnce(): void {
        if (cleanedTemp) return;
        cleanedTemp = true;
        let names: string[];
        try {
            names = fs.readdirSync(guard(dir));
        } catch {
            return;
        }
        for (const file of names) if (isStorageTempName(file)) removeQuietly(fs, guard(nodePath.join(dir, file)));
    }

    function status(name: unknown): SecretResult {
        if (!isValidSecretName(name)) return failure('invalid-name');
        try {
            const read = readBlob(blobPath(name));
            if (read.kind === 'error') log('read-failed', { name, code: read.code });
            return { success: true, status: statusOf(name, read) };
        } catch (err) {
            log('read-failed', { name, code: fsErrorCode(err) });
            return failure('io');
        }
    }

    function set(name: unknown, value: unknown): SecretResult {
        // A new secret must belong to a namespace (T-417): the bare `plugin-` prefix is neither core nor plugin.
        if (!isPluginSecretName(name) && !isCoreSecretName(name)) return failure('invalid-name');
        if (typeof value !== 'string' || value.length === 0) return failure('invalid-value');
        const plainBytes = Buffer.from(value, 'utf8');
        if (plainBytes.length > SECRET_MAX_VALUE_BYTES) {
            log('rejected', { name, reason: 'too-large' });
            return failure('too-large');
        }
        if (!encryptionAvailable()) {
            // Defined behaviour: refuse and warn; there is no plaintext fallback. Nothing is written.
            log('refused', { name, reason: 'encryption-unavailable' });
            return failure('encryption-unavailable');
        }
        let encrypted: Uint8Array;
        try {
            encrypted = cipher.encryptString(value);
            // A cipher that hands back the plaintext (or something that does not decrypt to it) must never reach the disk. The
            // containment check only runs from PLAINTEXT_CHECK_MIN_BYTES on: shorter values can match the fixed 'v10' header by chance.
            if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) throw new Error('weak');
            if (plainBytes.length >= PLAINTEXT_CHECK_MIN_BYTES && bytesContain(encrypted, plainBytes)) throw new Error('weak');
            const roundTrip = cipher.decryptString(Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength));
            if (roundTrip !== value) throw new Error('mismatch');
        } catch {
            log('refused', { name, reason: 'encryption-failed' });
            return failure('encryption-failed');
        }
        try {
            const target = blobPath(name);
            guard(dir);
            fs.mkdirSync(dir, { recursive: true });
            cleanTempOnce();
            // The limit counts the name's own namespace only (T-417): plugin secrets can never block a core secret.
            const isPlugin = isPluginSecretName(name);
            const stored = storedNames().filter((n) => isPluginSecretName(n) === isPlugin);
            if (!stored.includes(name) && stored.length >= SECRET_MAX_COUNT) {
                log('rejected', { name, reason: 'limit-reached' });
                return failure('limit-reached');
            }
            const written = atomicWriteFileSync(fs, target, dir, encrypted, { random, sleepSync, pid });
            if (!written.ok) {
                log('write-failed', { name, code: written.code });
                return failure('io');
            }
        } catch (err) {
            log('write-failed', { name, code: fsErrorCode(err) });
            return failure('io');
        }
        log('saved', { name });
        return {
            success: true,
            status: { name, exists: true, last4: secretLast4(value), encryptionAvailable: true, unreadable: false },
        };
    }

    function remove(name: unknown): SecretResult {
        if (!isValidSecretName(name)) return failure('invalid-name');
        try {
            fs.unlinkSync(blobPath(name));
            log('deleted', { name });
        } catch (err) {
            const code = fsErrorCode(err);
            if (code !== 'ENOENT') {
                log('delete-failed', { name, code });
                return failure('io');
            }
        }
        return {
            success: true,
            status: { name, exists: false, last4: null, encryptionAvailable: encryptionAvailable(), unreadable: false },
        };
    }

    function getSecret(name: string): string | null {
        if (!isValidSecretName(name)) return null;
        try {
            const read = readBlob(blobPath(name));
            if (read.kind === 'error') log('read-failed', { name, code: read.code });
            return read.kind === 'ok' ? decrypt(name, read.bytes) : null;
        } catch (err) {
            log('read-failed', { name, code: fsErrorCode(err) });
            return null;
        }
    }

    return { isEncryptionAvailable: encryptionAvailable, status, set, delete: remove, getSecret };
}
