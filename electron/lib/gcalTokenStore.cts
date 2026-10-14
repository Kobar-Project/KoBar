// R2-15: persistence of the Google Calendar sign-in, owned by the main process.
//   userData/google-calendar.json        { version: 1, refreshToken: <base64 of the safeStorage ciphertext>, savedAt }
//   userData/google-calendar-flag.json   { version: 1, enabled }   (the user's feature switch; no secret)
// The refresh token is only ever written encrypted. When encryption is unavailable the connection is refused (no plaintext fallback).
// Disconnecting deletes the token file. Neither file is part of any backup or export (they are not under kobar-data/, are not
// listed by the backup sources and never reach localStorage). Pure: the cipher and the file operations are injected.
// Nothing is logged here.
export interface GcalCipher {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

export interface GcalFileOps {
    readFile(filePath: string): Promise<string>;
    /** Writes atomically (temp file + rename) or at least completely. */
    writeFile(filePath: string, text: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
}

export const GCAL_TOKEN_FILE_NAME = 'google-calendar.json';
export const GCAL_FLAG_FILE_NAME = 'google-calendar-flag.json';
export const GCAL_FILE_VERSION = 1;

export type SaveTokenResult = { ok: true } | { ok: false; reason: 'encryption-unavailable' | 'io' };

export interface GcalTokenStore {
    /** True when the OS can encrypt (a connection is refused otherwise). */
    encryptionAvailable(): boolean;
    /** The persisted feature switch; false when the file is missing or invalid (default OFF). */
    readEnabled(): Promise<boolean>;
    writeEnabled(enabled: boolean): Promise<boolean>;
    /** True when a token file with a well-formed token entry exists (the token is not decrypted). */
    hasToken(): Promise<boolean>;
    /** Encrypts and stores; refuses (writes nothing) when the OS cannot encrypt. */
    saveRefreshToken(refreshToken: string, savedAt: number): Promise<SaveTokenResult>;
    /** The decrypted refresh token, or null (missing, corrupt, other OS user, encryption unavailable). */
    readRefreshToken(): Promise<string | null>;
    /** Deletes the token file (a missing file is fine). Returns false only when the delete failed. */
    clearToken(): Promise<boolean>;
}

export interface GcalTokenStoreDeps {
    /** Absolute path of google-calendar.json. */
    tokenFile: string;
    /** Absolute path of google-calendar-flag.json. */
    flagFile: string;
    cipher: GcalCipher;
    fs: GcalFileOps;
}

function parseObject(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export function createGcalTokenStore({ tokenFile, flagFile, cipher, fs }: GcalTokenStoreDeps): GcalTokenStore {
    async function readTokenEntry(): Promise<string | null> {
        let text: string;
        try {
            text = await fs.readFile(tokenFile);
        } catch {
            return null;
        }
        const data = parseObject(text);
        if (!data || data.version !== GCAL_FILE_VERSION) return null;
        return typeof data.refreshToken === 'string' && data.refreshToken !== '' ? data.refreshToken : null;
    }

    return {
        encryptionAvailable() {
            try {
                return cipher.isEncryptionAvailable();
            } catch {
                return false;
            }
        },
        async readEnabled() {
            try {
                const data = parseObject(await fs.readFile(flagFile));
                return data?.version === GCAL_FILE_VERSION && data.enabled === true;
            } catch {
                return false;
            }
        },
        async writeEnabled(enabled) {
            try {
                await fs.writeFile(flagFile, JSON.stringify({ version: GCAL_FILE_VERSION, enabled }));
                return true;
            } catch {
                return false;
            }
        },
        async hasToken() {
            return (await readTokenEntry()) !== null;
        },
        async saveRefreshToken(refreshToken, savedAt) {
            if (!cipher.isEncryptionAvailable()) return { ok: false, reason: 'encryption-unavailable' };
            try {
                const encrypted = cipher.encryptString(refreshToken).toString('base64');
                await fs.writeFile(tokenFile, JSON.stringify({ version: GCAL_FILE_VERSION, refreshToken: encrypted, savedAt }));
                return { ok: true };
            } catch {
                return { ok: false, reason: 'io' };
            }
        },
        async readRefreshToken() {
            const entry = await readTokenEntry();
            if (entry === null || !cipher.isEncryptionAvailable()) return null;
            try {
                const plain = cipher.decryptString(Buffer.from(entry, 'base64'));
                return plain === '' ? null : plain;
            } catch {
                return null;
            }
        },
        async clearToken() {
            try {
                await fs.unlink(tokenFile);
                return true;
            } catch (error) {
                return (error as { code?: unknown } | null)?.code === 'ENOENT';
            }
        },
    };
}
