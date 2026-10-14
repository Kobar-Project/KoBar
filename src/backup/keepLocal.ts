// Keep-local secret fields of a full backup restore (T-213, endpoint guard T-159). Pure: no DOM, no Electron, no I/O.
//
// A backup made without secrets has blank secret fields ('' / null). A restore puts the user's CURRENT secret back
// into those places (matched by element `id`, never by position for objects). T-159: a crafted backup could also carry
// an endpoint / base URL next to such a key that points at someone else's server, and the user's local key would then be
// sent to it. So the local key is only carried over when every endpoint-type field on the path from the root to the key
// (see below) holds the same value locally and in the backup. Otherwise the key stays blank, exactly as in the backup.
//
// Default decision (owner unavailable, safest; to be confirmed):
//   - endpoint-type field = a field whose normalized name ends in url/uri/endpoint/host/hostname/server/origin/address/
//     domain/proxy/base/gateway (also plural url/endpoint), OR any string value (either side) that starts with
//     http(s):// or ws(s):// whatever its name.
//   - T-161, record scope: for one record (the value of one localStorage key, i.e. one plugin blob) the endpoint-type
//     fields are collected from the WHOLE record, at any depth, in any branch and inside nested JSON strings, from the
//     written and the local value. If any of them differs, NO local secret of that record is carried over (they stay
//     blank, as in the backup). So `{ provider: { baseUrl }, auth: { apiKey } }` and an endpoint outside a nested JSON
//     string whose key is inside it are guarded too. Array elements with an `id` are paired by id, others by position.
//   - exception `app-store` (`kobar-storage`): its own structure is validated by the app (coreValues.ts) and has no
//     endpoints or secrets; only the plugin blobs below `pluginData` are checked (one blob = one record), so unrelated
//     fields of `state` or of a workspace can never block a plugin's key.
//   - same = equal after trim, URL normalization (scheme/host case, default port) and removal of trailing slashes;
//     null/undefined/'' all mean "no endpoint". Missing on one side only = changed.
//   - an endpoint value that is not a string (number, boolean, object, array) is treated as changed (hostile). So is a
//     record that is too large or too deeply nested to scan completely (fail closed).
//   - no endpoint field on either side: the key is carried over as before.
//   - the chat store `apiKeys` (`kobar-chat-storage`) is exempt: its cloud keys only ever go to fixed provider hosts
//     (electron/main.cts `llm-request`) and its `localUrl` is loopback-only and never receives a key, so a changed
//     `localUrl` cannot redirect a key. Guarding it would only drop keys after a legitimate Ollama port change.
//   - T-161, separate keys: a secret that lives under its OWN localStorage key (kept local because the backup left it
//     out) stays paired with the endpoint key of the same provider (`foo_api_key` with `foo_base_url`). When the plan
//     would write such an endpoint key with a value that differs from the local one, that endpoint key is NOT written
//     (the local endpoint stays, nothing is deleted) and the same warning is shown (see `endpointKeysToKeepLocal`).
// Never logs; the result only counts blocked fields, never names or values.

import { isPlainObject, parseJsonSafely } from './coreValues';
import { baseKeyName, isSecretName, setOwn } from './redact';

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const MAX_DECODE_DEPTH = 8;

/** Normalized (lowercase letters and digits) field-name endings that mark an endpoint / base URL. */
const ENDPOINT_NAME_SUFFIXES = [
    'url',
    'urls',
    'uri',
    'endpoint',
    'endpoints',
    'host',
    'hostname',
    'server',
    'origin',
    'address',
    'domain',
    'proxy',
    'base',
    'gateway',
] as const;

/** A string that is an absolute web URL is an endpoint whatever the field is called. */
const URL_VALUE = /^\s*(?:https?|wss?):\/\//i;
const looksLikeUrl = (value: unknown): boolean => typeof value === 'string' && URL_VALUE.test(value);

/** Keys whose secrets are never sent to a stored endpoint (see the module comment). */
const ENDPOINT_EXEMPT_BASE_KEYS: readonly string[] = ['kobar-chat-storage'];

/** `false`: no guard; `true`: every object level; `'app-store'`: only the plugin blobs below `pluginData`. */
export type EndpointGuard = boolean | 'app-store';

/** The endpoint guard that applies to the value stored under localStorage `key` (isolated suffix ignored). */
export function endpointGuardFor(key: string): EndpointGuard {
    const base = baseKeyName(key);
    if (ENDPOINT_EXEMPT_BASE_KEYS.includes(base)) return false;
    return base === 'kobar-storage' ? 'app-store' : true;
}

export function isEndpointName(name: string): boolean {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return ENDPOINT_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Comparable form of an endpoint value; null when it is not a string (hostile value). */
function endpointForm(value: unknown): string | null {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed === '') return '';
    try {
        return new URL(trimmed).href.replace(/\/+$/, '');
    } catch {
        return trimmed.replace(/\/+$/, '');
    }
}

interface Decoded {
    value: unknown;
    encode: (value: unknown) => string;
}

/** JSON nested in a string (object/array, or a JSON-encoded string), as redact.ts enters it. Null when it is not. */
function decode(text: string): Decoded | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) return null;
    const parsed = parseJsonSafely(trimmed);
    if (!parsed) return null;
    const value = parsed.value;
    if (trimmed.startsWith('"') ? typeof value !== 'string' : value === null || typeof value !== 'object') return null;
    return { value, encode: (next) => JSON.stringify(next) };
}

/** Identity of an array element: its `id` when it is an object with a string/number id. */
function elementId(value: unknown): string | number | undefined {
    if (!isPlainObject(value) || !own(value, 'id')) return undefined;
    const id = value.id;
    return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

/** Upper bounds of a record scan; a bigger or deeper record counts as changed (fail closed). */
const MAX_SCAN_NODES = 200_000;
const MAX_SCAN_DEPTH = 200;

/** Endpoint-type fields of a record: location -> comparable form (null = hostile value, always "changed"). */
interface EndpointScan {
    fields: Map<string, string | null>;
    nodes: number;
    incomplete: boolean;
}

function scanEndpoints(
    value: unknown,
    location: string,
    endpointNamed: boolean,
    scan: EndpointScan,
    depth: number,
    decodeDepth: number
): void {
    if (scan.incomplete) return;
    if (++scan.nodes > MAX_SCAN_NODES || depth > MAX_SCAN_DEPTH) {
        scan.incomplete = true;
        return;
    }
    const record = (form: string | null) => {
        // Two fields at one location (duplicate ids in an array) cannot be paired reliably.
        scan.fields.set(location, scan.fields.has(location) ? null : form);
    };
    if (typeof value === 'string') {
        if (endpointNamed || looksLikeUrl(value)) {
            record(endpointForm(value));
            return;
        }
        const inner = decode(value);
        if (!inner) return;
        if (decodeDepth >= MAX_DECODE_DEPTH) scan.incomplete = true;
        else scanEndpoints(inner.value, `${location}~json`, false, scan, depth + 1, decodeDepth + 1);
        return;
    }
    if (endpointNamed) {
        // null / undefined mean "no endpoint"; any other non-string value is hostile.
        record(endpointForm(value));
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((element, index) => {
            const id = elementId(element);
            const step = id !== undefined ? `#${JSON.stringify(id)}` : `[${index}]`;
            scanEndpoints(element, `${location}${step}`, false, scan, depth + 1, decodeDepth);
        });
    } else if (isPlainObject(value)) {
        for (const name of Object.keys(value)) {
            scanEndpoints(value[name], `${location}.${JSON.stringify(name)}`, isEndpointName(name), scan, depth + 1, decodeDepth);
        }
    }
}

/**
 * True when any endpoint-type field anywhere in the written record differs from the local record (or when either side
 * cannot be scanned completely). See the module comment (record scope).
 */
function recordEndpointsChanged(written: unknown, local: unknown): boolean {
    const w: EndpointScan = { fields: new Map(), nodes: 0, incomplete: false };
    const l: EndpointScan = { fields: new Map(), nodes: 0, incomplete: false };
    scanEndpoints(written, '', false, w, 0, 0);
    scanEndpoints(local, '', false, l, 0, 0);
    if (w.incomplete || l.incomplete) return true;
    for (const location of new Set([...w.fields.keys(), ...l.fields.keys()])) {
        const wf = w.fields.has(location) ? w.fields.get(location) : '';
        const lf = l.fields.has(location) ? l.fields.get(location) : '';
        if (wf === null || lf === null || wf !== lf) return true;
    }
    return false;
}

interface Tally {
    /** Blank secret fields that had a usable local value but were not filled because of a changed endpoint. */
    blocked: number;
    /** App-store plugin records (by location) whose endpoints were already compared, decided once from the unmodified value. */
    records: Map<string, boolean>;
}

/**
 * Returns `written` with the local value placed at `path` (or `written` itself when nothing changes). Only a blank
 * leaf ('' or null, as left by the redaction) is replaced, and only by a local string or finite number. `changed` says
 * that an endpoint differs somewhere in the record the leaf belongs to (see the module comment); `scope` tracks the
 * walk through the plugin blobs of the app store (guard 'app-store' only).
 */
function transplant(
    written: unknown,
    local: unknown,
    path: readonly string[],
    tally: Tally,
    guard: EndpointGuard,
    changed: boolean,
    scope: 'none' | 'pluginData' | 'record',
    trail: string,
    depth = 0
): unknown {
    if (path.length === 0) {
        const blank = written === '' || written === null;
        const usable = typeof local === 'string' || (typeof local === 'number' && Number.isFinite(local));
        if (!blank || !usable) return written;
        if (changed) {
            tally.blocked++;
            return written;
        }
        return local;
    }
    if (typeof written === 'string') {
        if (depth >= MAX_DECODE_DEPTH || typeof local !== 'string') return written;
        const w = decode(written);
        const l = decode(local);
        if (!w || !l) return written;
        const next = transplant(w.value, l.value, path, tally, guard, changed, scope, `${trail}~`, depth + 1);
        return next === w.value ? written : w.encode(next);
    }
    const [step, ...rest] = path;
    if (Array.isArray(written)) {
        if (!/^\d{1,9}$/.test(step) || Number(step) >= written.length || !Array.isArray(local)) return written;
        const index = Number(step);
        const element: unknown = written[index];
        let match: unknown;
        const id = elementId(element);
        if (id !== undefined) match = local.find((candidate) => elementId(candidate) === id);
        else if (!isPlainObject(element)) match = local[index];
        // An object without an id has no reliable local counterpart: the blank stays (never another item's secret).
        else return written;
        const next = transplant(element, match, rest, tally, guard, changed, scope, `${trail}[${step}]`, depth);
        if (next === element) return written;
        const copy = written.slice();
        copy[index] = next;
        return copy;
    }
    if (isPlainObject(written)) {
        if (!own(written, step)) return written;
        const localChild = isPlainObject(local) && own(local, step) ? local[step] : undefined;
        let childChanged = changed;
        let childScope = scope;
        if (guard === 'app-store') {
            if (scope === 'pluginData') {
                // `pluginData.<plugin id>` is one record: an endpoint change anywhere in it blocks all of its secrets.
                const recordKey = `${trail}.${JSON.stringify(step)}`;
                let known = tally.records.get(recordKey);
                if (known === undefined) {
                    known = recordEndpointsChanged(written[step], localChild);
                    tally.records.set(recordKey, known);
                }
                childChanged = known;
                childScope = 'record';
            } else if (scope === 'none' && step === 'pluginData') {
                childScope = 'pluginData';
            }
        }
        const next = transplant(
            written[step],
            localChild,
            rest,
            tally,
            guard,
            childChanged,
            childScope,
            `${trail}.${JSON.stringify(step)}`,
            depth
        );
        if (next === written[step]) return written;
        const copy: Record<string, unknown> = {};
        for (const name of Object.keys(written)) setOwn(copy, name, written[name]);
        setOwn(copy, step, next);
        return copy;
    }
    return written;
}

export interface KeepLocalOutcome {
    /** The value to write. */
    value: string;
    /** Secret fields that were NOT carried over because an endpoint in their record differs (or is not a plain string). */
    blocked: number;
}

/**
 * The value to write for one key: `written` with the user's current secrets at `paths`, except where the endpoint
 * guard blocks it. `guard` false turns the guard off (see endpointGuardFor). Never throws.
 */
export function applyKeepLocal(
    written: string,
    local: string | null,
    paths: readonly (readonly string[])[],
    guard: EndpointGuard = true
): KeepLocalOutcome {
    const tally: Tally = { blocked: 0, records: new Map() };
    if (local === null || paths.length === 0) return { value: written, blocked: 0 };
    try {
        // Both values are decoded once (core values can be megabytes), then every path is applied to the trees.
        const w = decode(written);
        const l = decode(local);
        if (!w || !l) return { value: written, blocked: 0 };
        let value: unknown = w.value;
        // One record = this key's value: its endpoint-type fields are compared once, before any secret is placed.
        const changed = guard === true && recordEndpointsChanged(w.value, l.value);
        for (const path of paths) if (path.length > 0) value = transplant(value, l.value, path, tally, guard, changed, 'none', '', 1);
        return { value: value === w.value ? written : w.encode(value), blocked: tally.blocked };
    } catch {
        return { value: written, blocked: 0 };
    }
}

/** `applyKeepLocal(...).value` (the guard is on unless `guard` is false). */
export function applyKeepLocalFields(
    written: string,
    local: string | null,
    paths: readonly (readonly string[])[],
    guard: EndpointGuard = true
): string {
    return applyKeepLocal(written, local, paths, guard).value;
}

// ---------------------------------------------------------------- secrets under their own key (T-161)

/** Words of a key name: camelCase is split first, then the name is lowercased and cut at every non-alphanumeric run. */
function nameWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word !== '');
}

/** Words that start the secret part of a key name (`foo_api_key_v2`: everything from `api` on). */
const SECRET_WORDS = new Set([
    'apikey',
    'apikeys',
    'key',
    'keys',
    'token',
    'tokens',
    'secret',
    'secrets',
    'password',
    'passwd',
    'passphrase',
    'credential',
    'credentials',
    'auth',
    'bearer',
    'jwt',
    'cookie',
    'webhook',
    'pwd',
    'pass',
    'pat',
    'authorization',
]);
/** `api` / `access` / `private` / `license` followed by `key(s)`. */
const KEY_PREFIX_WORDS = new Set(['api', 'access', 'private', 'license']);

/** Endpoint words at the end of a key name (`foo_base_url`: `base` and `url`). */
const ENDPOINT_WORDS = new Set([
    'url',
    'urls',
    'uri',
    'uris',
    'endpoint',
    'endpoints',
    'host',
    'hosts',
    'hostname',
    'hostnames',
    'server',
    'servers',
    'origin',
    'address',
    'domain',
    'proxy',
    'base',
    'gateway',
]);

/**
 * Provider prefix of a secret key name: the words in front of the first secret word (`foo_api_key_v2`, `fooToken`,
 * `foo_credentials_json` give `foo`). Fail closed: without a recognizable secret word the first word is the prefix.
 * Only the part before `_iso_<workspace>` counts.
 */
function secretPrefix(key: string): string {
    const words = nameWords(baseKeyName(key));
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const next = words[i + 1];
        if (SECRET_WORDS.has(word) || (KEY_PREFIX_WORDS.has(word) && (next === 'key' || next === 'keys'))) {
            return words.slice(0, i).join('_');
        }
    }
    return words.slice(0, 1).join('_');
}

/**
 * Provider prefix of an endpoint key name: the words in front of the trailing endpoint words (`foo_base_url` gives
 * `foo`). Without such a tail (compound names such as `host_names`, or a key that only holds a URL) the whole name is
 * the prefix, which still matches the secret keys of the same provider.
 */
function endpointPrefix(key: string): string {
    const words = nameWords(baseKeyName(key));
    let end = words.length;
    while (end > 0 && ENDPOINT_WORDS.has(words[end - 1])) end--;
    return (end === words.length ? words : words.slice(0, end)).join('_');
}

/** Same provider: equal prefixes, or one is the other plus more words (`foo` and `foo_openai`). Empty prefixes only match each other. */
function relatedPrefixes(a: string, b: string): boolean {
    if (a === b) return true;
    if (a === '' || b === '') return false;
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return long.startsWith(short) && long.charAt(short.length) === '_';
}

export interface EndpointKeyCandidate {
    key: string;
    value: string;
}

/**
 * Keys of the plan that must NOT be written because they would change the endpoint of a provider whose secret is kept
 * from the local data under its own key (`keepLocalKeys` that hold a non-empty local value, e.g. `foo_api_key` with a
 * written `foo_base_url`; without a local secret there is nothing to protect). The local
 * endpoint then stays and nothing is deleted; the restore reports `secrets-endpoint-changed`. An endpoint key is only
 * kept when its written value differs from the local one (same normalization as the record scan; absent locally and
 * non-empty in the backup counts as different). Fail closed: an unreadable local value counts as different. Never throws,
 * never exposes a name or a value.
 */
export function endpointKeysToKeepLocal(
    entries: readonly EndpointKeyCandidate[],
    keepLocalKeys: readonly string[],
    readLocal: (key: string) => string | null
): Set<string> {
    const result = new Set<string>();
    try {
        const secretPrefixes: string[] = [];
        for (const key of keepLocalKeys) {
            if (!isSecretName(baseKeyName(key))) continue;
            // Without a local secret there is nothing to protect (e.g. a restore on a fresh install).
            try {
                const secret = readLocal(key);
                if (secret === null || secret.trim() === '') continue;
            } catch {
                /* unreadable: assume there is a secret */
            }
            secretPrefixes.push(secretPrefix(key));
        }
        if (secretPrefixes.length === 0) return result;
        for (const entry of entries) {
            const prefix = endpointPrefix(entry.key);
            if (!secretPrefixes.some((secret) => relatedPrefixes(secret, prefix))) continue;
            let local: string | null;
            try {
                local = readLocal(entry.key);
            } catch {
                // Unreadable: a key that is named like an endpoint (or holds a URL) is held back.
                if (isEndpointName(baseKeyName(entry.key)) || looksLikeUrl(entry.value)) result.add(entry.key);
                continue;
            }
            // An endpoint key: named like one, or holding a URL on either side (the name rules above are unchanged).
            if (!isEndpointName(baseKeyName(entry.key)) && !looksLikeUrl(entry.value) && !looksLikeUrl(local)) continue;
            if (endpointForm(entry.value) !== endpointForm(local)) result.add(entry.key);
        }
    } catch {
        /* best effort: what was decided so far stays decided */
    }
    return result;
}

/** Reads a key without the workspace isolation patch (the real localStorage is read through the prototype). */
export function readRawItem(storage: Pick<Storage, 'getItem'>, key: string): string | null {
    try {
        const isReal = typeof Storage !== 'undefined' && storage instanceof Storage;
        return isReal ? Storage.prototype.getItem.call(storage, key) : storage.getItem(key);
    } catch {
        return null;
    }
}
