// Secret redaction for the full backup (T-211, owner decision S2: secrets are excluded by default).
//
// Works on a localStorage snapshot (key -> raw string). Pure: no DOM, no Electron, no I/O.
//   - A top-level key whose NAME looks like a secret (e.g. `myplugin_api_key`, `kobar_license_key`) is dropped.
//   - Values that are JSON (most stores and many plugins persist stringified JSON, sometimes nested inside another
//     JSON string) are parsed and walked:
//       * a string field whose name looks like a secret (`apiKey`, `password`, `githubToken`, ...) becomes '';
//       * inside a secret-named object (e.g. the chat store's `apiKeys: { openai, gemini, anthropic, localUrl, ... }`)
//         every non-empty string field becomes '' unless its name is clearly not a secret (`...Url`, `...Model`, ...);
//       * well-known API key / token shapes found inside any text (e.g. a key pasted into a note) are replaced.
//   - A value is only re-serialized when something in it was redacted, so untouched values stay byte-identical.
//   - When a value cannot be processed safely (pathological nesting), the whole key is dropped: never leak.
//   - A recovery copy of an unreadable app store (`kobar-storage.unreadable.*`, T-152) that is not valid JSON cannot be
//     walked field by field (a broken `"apiKey":"..."` would slip through), so it is dropped like an unprocessable key.
//     It is only exported when the user opted into secrets (redaction is skipped then).
// Every redaction is recorded (key + path) so a later restore (T-212/T-213) can keep the user's current value.

import { isUnreadableStoreCopyKey } from './keyPolicy';

/** Replacement for a secret token shape found inside free text. Secret-named fields become '' instead. */
export const REDACTED_TEXT = '[redacted-secret]';

/** Nested JSON strings are parsed and redacted up to this depth; JSON nested deeper drops the key. */
const MAX_NESTED_JSON_DEPTH = 4;
/** Object/array nesting deeper than this is treated as unprocessable (the key is dropped). */
const MAX_OBJECT_DEPTH = 200;

/** Normalized names (lowercase, letters and digits only) that contain one of these are secret names. */
const SECRET_NAME_PARTS = [
    'apikey',
    'secret',
    'password',
    'passwd',
    'passphrase',
    'privatekey',
    'accesskey',
    'licensekey',
    'credential',
    'bearer',
    'jwt',
    'cookie',
    'authheader',
    'webhook',
] as const;

/** Count-like prefixes: `maxTokens`, `totalTokens`, ... are numbers about tokens, not tokens. */
const TOKEN_COUNT_NAME = /^(?:max|min|num|total|used|input|output|prompt|completion|context|remaining|reserved)tokens$/;

/** Names ending in `key`/`keys` are secret names (openaiKey, authKey, ...) except these well-known non-secret ones. */
const NON_SECRET_KEY_NAMES = new Set([
    'hotkey',
    'shortcutkey',
    'sortkey',
    'primarykey',
    'storagekey',
    'cachekey',
    'modifierkey',
    'i18nkey',
    'translationkey',
]);

/** Normalized names that are secret names on their own. */
const SECRET_NAME_EXACT = new Set(['token', 'auth', 'authorization', 'pwd', 'pass', 'pat']);

/** Inside a secret-named object, string fields whose normalized name ends with one of these are kept. */
const NON_SECRET_NAME_SUFFIXES = [
    'url',
    'model',
    'endpoint',
    'host',
    'message',
    'instructions',
    'prompt',
    'provider',
    'name',
    'label',
    'id',
    'type',
    'mode',
    'region',
    'version',
] as const;

/**
 * Well-known API key / token shapes. Kept in sync by hand with SECRET_VALUE_SOURCE in electron/lib/storageBackup.cts
 * (T-201 pre-migration backups; main-process code cannot import from src/). This copy adds the base64 boundaries;
 * tests/backup.redact.test.ts checks that both copies find the same token shapes. The look-behind/look-ahead keep the match from starting or ending inside a
 * longer base64 run (e.g. an image data URL in a note), so binary-looking data is not corrupted.
 */
const SECRET_VALUE_SOURCE =
    '(?<![A-Za-z0-9+/=_-])(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}' +
    '|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{20,}' +
    '|gsk_[A-Za-z0-9]{20,}|pplx-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' +
    '|Bearer\\s+[A-Za-z0-9._~+/=-]{16,}|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+)(?![A-Za-z0-9+/_-])';

export interface RedactedField {
    /** localStorage key the field was found in. */
    key: string;
    /** Path inside the value; JSON strings nested in the value are entered transparently. */
    path: string[];
    /** `field`: secret-named field set to ''. `pattern`: token shape(s) in text replaced by REDACTED_TEXT. */
    reason: 'field' | 'pattern';
}

export interface RemovedKey {
    key: string;
    reason: 'secret-name' | 'unprocessable';
}

export interface RedactionResult {
    entries: Record<string, string>;
    removedKeys: RemovedKey[];
    redactedFields: RedactedField[];
}

function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when a field or key name looks like it holds a secret (API key, token, password, ...). */
export function isSecretName(name: string): boolean {
    const normalized = normalizeName(name);
    if (normalized === '') return false;
    if (SECRET_NAME_EXACT.has(normalized)) return true;
    if (normalized.endsWith('token') || (normalized.endsWith('tokens') && !TOKEN_COUNT_NAME.test(normalized))) return true;
    if (normalized.endsWith('auth')) return true;
    const singular = normalized.endsWith('keys') ? normalized.slice(0, -1) : normalized;
    if (singular.endsWith('key') && !NON_SECRET_KEY_NAMES.has(singular)) return true;
    return SECRET_NAME_PARTS.some((part) => normalized.includes(part));
}

function isNonSecretName(name: string): boolean {
    const normalized = normalizeName(name);
    return NON_SECRET_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Plugin keys of an isolated workspace end in `_iso_<workspaceId>`; the suffix is ignored for name checks. */
export function baseKeyName(key: string): string {
    const index = key.indexOf('_iso_');
    return index > 0 ? key.slice(0, index) : key;
}

/** True when `text` contains a well-known API key / token shape. */
export function containsSecretValue(text: string): boolean {
    return new RegExp(SECRET_VALUE_SOURCE).test(text);
}

/** `text` with every token shape replaced by REDACTED_TEXT (used for names that are recorded in the result). */
function maskSecretValues(text: string): string {
    return text.replace(new RegExp(SECRET_VALUE_SOURCE, 'g'), REDACTED_TEXT);
}

/** Assigns an own enumerable property, also for names like `__proto__` (plain assignment would set the prototype). */
export function setOwn<T>(target: Record<string, T>, name: string, value: T): void {
    Object.defineProperty(target, name, { value, enumerable: true, writable: true, configurable: true });
}

/** Thrown for values nested too deeply to walk safely; the key is then dropped. */
class UnprocessableError extends Error {}

interface WalkContext {
    key: string;
    fields: RedactedField[];
}

function redactText(text: string, path: string[], ctx: WalkContext, jsonDepth: number): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        let parsed: unknown;
        let isJson = false;
        try {
            parsed = JSON.parse(trimmed);
            isJson = parsed !== null && typeof parsed === 'object';
        } catch {
            isJson = false;
        }
        // JSON nested deeper than we walk could hide a secret-named field: drop the whole key instead.
        if (isJson && jsonDepth >= MAX_NESTED_JSON_DEPTH) throw new UnprocessableError('nested JSON too deep');
        if (isJson) {
            const before = ctx.fields.length;
            const next = redactNode(parsed, path, ctx, jsonDepth + 1, 0, false);
            return ctx.fields.length === before ? text : JSON.stringify(next);
        }
    }
    if (trimmed.startsWith('"')) {
        // A JSON-encoded string (e.g. stringified JSON stringified once more): decode and check what it contains.
        let inner: unknown;
        try {
            inner = JSON.parse(trimmed);
        } catch {
            inner = undefined;
        }
        if (typeof inner === 'string') {
            if (jsonDepth >= MAX_NESTED_JSON_DEPTH) throw new UnprocessableError('nested JSON string too deep');
            const before = ctx.fields.length;
            const next = redactText(inner, path, ctx, jsonDepth + 1);
            return ctx.fields.length === before ? text : JSON.stringify(next);
        }
    }
    const pattern = new RegExp(SECRET_VALUE_SOURCE, 'g');
    if (!pattern.test(text)) return text;
    ctx.fields.push({ key: ctx.key, path, reason: 'pattern' });
    return maskSecretValues(text);
}

function redactNode(value: unknown, path: string[], ctx: WalkContext, jsonDepth: number, depth: number, inSecret: boolean): unknown {
    if (depth > MAX_OBJECT_DEPTH) throw new UnprocessableError('too deep');
    if (typeof value === 'string') {
        if (inSecret && value !== '') {
            ctx.fields.push({ key: ctx.key, path, reason: 'field' });
            return '';
        }
        return redactText(value, path, ctx, jsonDepth);
    }
    if (typeof value === 'number' && inSecret) {
        // A numeric PIN/password under a secret name: removed (null) like a string secret.
        ctx.fields.push({ key: ctx.key, path, reason: 'field' });
        return null;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => redactNode(item, [...path, String(index)], ctx, jsonDepth, depth + 1, inSecret));
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
            if (containsSecretValue(name)) {
                // A token used as a property name: drop the entry; the recorded path never contains the token.
                ctx.fields.push({ key: ctx.key, path: [...path, maskSecretValues(name)], reason: 'field' });
                continue;
            }
            const childPath = [...path, name];
            const childIsSecret = isSecretName(name) || (inSecret && !isNonSecretName(name));
            if (typeof child === 'string') {
                if (childIsSecret && child !== '') {
                    ctx.fields.push({ key: ctx.key, path: childPath, reason: 'field' });
                    setOwn(out, name, '');
                } else {
                    setOwn(out, name, redactText(child, childPath, ctx, jsonDepth));
                }
            } else {
                // Objects below a secret name are walked in secret mode; numbers there become null; booleans and null stay.
                setOwn(out, name, redactNode(child, childPath, ctx, jsonDepth, depth + 1, childIsSecret));
            }
        }
        return out;
    }
    return value;
}

function parsesAsJson(text: string): boolean {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns a copy of `entries` without secrets (see the module comment). Never throws and never returns a value that
 * could not be checked: such keys are listed in `removedKeys`.
 */
export function redactSecrets(entries: Readonly<Record<string, string>>): RedactionResult {
    const out: Record<string, string> = {};
    const removedKeys: RemovedKey[] = [];
    const redactedFields: RedactedField[] = [];
    for (const key of Object.keys(entries)) {
        const raw = entries[key];
        if (typeof raw !== 'string') continue;
        if (containsSecretValue(key)) {
            // A token inside the key name itself: drop the key and never record the token.
            removedKeys.push({ key: maskSecretValues(key), reason: 'secret-name' });
            continue;
        }
        if (isSecretName(baseKeyName(key))) {
            removedKeys.push({ key, reason: 'secret-name' });
            continue;
        }
        if (isUnreadableStoreCopyKey(key) && !parsesAsJson(raw)) {
            removedKeys.push({ key, reason: 'unprocessable' });
            continue;
        }
        const fields: RedactedField[] = [];
        try {
            setOwn(out, key, redactText(raw, [], { key, fields }, 0));
            redactedFields.push(...fields);
        } catch {
            // Too deep (UnprocessableError) or any other failure: drop the key rather than risk a leak.
            removedKeys.push({ key, reason: 'unprocessable' });
        }
    }
    return { entries: out, removedKeys, redactedFields };
}
