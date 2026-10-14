// Which localStorage keys of a `kobar-backup` file a restore may write (T-212). Pure: no DOM, no Electron, no I/O.
//
// localStorage has no notion of key ownership: plugins pick their own key names (there is no naming convention in the
// plugin contract), the app has a few core keys, and the workspace isolation layer (src/utils/localStorageIsolation.ts)
// appends `_iso_<workspaceId>` to every non-system key while an isolated workspace is active. The policy is therefore
// conservative; a key is accepted only when one of these rules says who owns it:
//   1. Core keys (CORE_KEYS) that KoBar itself writes.
//   2. Keys of INSTALLED official plugins listed in OFFICIAL_PLUGIN_KEYS (checked against the plugin sources).
//   3. Id-prefixed keys (`<id>`, `<id>:x`, `<id>.x`, `<id>_x`, `<id>-x`, `<id>/x`). The candidate owners are the
//      installed plugins, the official plugins and the plugins listed in the backup; the LONGEST candidate id that
//      prefixes the key owns it (so `todolist` never claims `todolist-plugin-x`, `com.kobar` never claims
//      `com.kobar.aihub.x`). The key is accepted only when that owner is installed. Keys in the reserved
//      `kobar`/`kobox` namespaces can only be claimed this way by official plugin ids.
//   4. Isolated keys: the isolation shim stores `<base>_iso_<workspaceId>` (base key + `_iso_` + the workspace id,
//      appended once at the end). A key is treated as isolated ONLY when it ends with `_iso_<id>` for a workspace id of
//      the backup's own `kobar-storage` and the base is not empty; then `<base>` must pass rules 1-3 (system keys are
//      never suffixed). Any other key, even one that contains `_iso_` (e.g. `my_iso_settings`), is a shared key and
//      the WHOLE key goes through rules 1-3.
// Everything else (unknown owners, plugins that are not installed, junk keys such as `setItem`, retired secrets) is
// skipped and reported with a reason.

/** Core localStorage keys KoBar itself writes. `system` keys are never isolated (see localStorageIsolation.ts). */
export const CORE_KEYS = {
    'kobar-storage': { system: true, kind: 'app-store' },
    'kobar-chat-storage': { system: false, kind: 'chat-store' },
    kobar_force_theme_color: { system: true, kind: 'theme-color' },
    kobar_language: { system: true, kind: 'short-text' },
    kobar_onboarding_completed: { system: true, kind: 'short-text' },
    'kobar-backup-hint-shown': { system: true, kind: 'short-text' },
} as const;

export type CoreKey = keyof typeof CORE_KEYS;
export type CoreValueKind = (typeof CORE_KEYS)[CoreKey]['kind'];

/** Core keys that are never restored: the licence key is a retired secret (licensing removed in T-124). */
export const RETIRED_CORE_KEYS: readonly string[] = ['kobar_license_key'];

/**
 * Names that can only appear as localStorage keys through a buggy monkeypatch or `localStorage.setItem = ...` style
 * assignments (T-158a). They are never data and never restored.
 */
export const JUNK_KEYS: readonly string[] = ['setItem', 'getItem', 'removeItem', 'clear', 'key', 'length'];

/**
 * Prefix of the verbatim copies of an unreadable `kobar-storage` value that the hydration recovery screen keeps before
 * it lets the user start fresh or restore (T-152): `kobar-storage.unreadable.<timestamp>`. They are a safety net on this
 * machine only and never restored. Exports: a copy that is valid JSON is redacted like any other key; a copy that is not
 * valid JSON is dropped from exports without secrets (redact.ts, reason 'unprocessable') and only kept in exports with
 * secrets.
 */
export const UNREADABLE_STORE_COPY_PREFIX = 'kobar-storage.unreadable.';

export function isUnreadableStoreCopyKey(key: string): boolean {
    return key.startsWith(UNREADABLE_STORE_COPY_PREFIX);
}

/**
 * Host-internal localStorage keys that describe THIS machine's storage state and are never exported or restored (T-405).
 * `kobar-storage.meta` records KoBar's last `kobar-storage` write (src/storage/fileBackedStorage.ts PERSIST_META_KEY, a test
 * keeps them equal); restoring an old copy could make an older file store value win over the restored data.
 */
export const HOST_INTERNAL_KEYS: readonly string[] = ['kobar-storage.meta'];

export function isHostInternalKey(key: string): boolean {
    return HOST_INTERNAL_KEYS.includes(key);
}

/** Property names that must never become object keys anywhere in the restore pipeline. */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * Known localStorage keys of the official plugins (manifest id -> keys). Confirmed against the plugin sources (T-212). Focus Mode, KoPlayer and Pin Window use no localStorage key of their
 * own (they only read `useAppStore`); they can still claim id-prefixed keys (rule 3).
 */
export const OFFICIAL_PLUGIN_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'com.kobar.aihub': ['kobar-aihub-plugin-storage'],
    'com.kobar.calculator.plugin': ['kobar_calc_plugin_mode', 'kobar_calc_scientific', 'kobar_exchange_rates'],
    'com.kobar.clipboardmanager': ['kobar-plugin-clipboard-settings'],
    'com.kobar.kobox': ['kobox-plugin-settings'],
    'focus-mode-plugin': [],
    'ko-calender-plugin': ['kobar_plugin_events', 'kobar_plugin_calendar_color'],
    'kobar-colorpicker-plugin': ['kobar-plugin-colorpicker-color', 'kobar-plugin-colorpicker-palettes'],
    'kobar.shortcuts': ['kobar-plugin-shortcuts-data', 'kobar-plugin-shortcuts-settings'],
    'koplayer-plugin': [],
    'pin-window-to-top': [],
    'screenshot-studio-overlay': ['kobar_screenshot_save_path'],
    'snippetvault-plugin': ['kobar-plugin-snippetvault-data', 'kobar-plugin-snippetvault-compact'],
    'todolist-plugin': ['kobar_plugin_todos'],
});

/** Official plugin ids (must match OFFICIAL_PLUGIN_IDS in electron/lib/officialPlugins.cts; a test checks this). */
export const OFFICIAL_PLUGIN_ID_LIST: readonly string[] = Object.freeze(Object.keys(OFFICIAL_PLUGIN_KEYS));

const KNOWN_KEY_OWNER = new Map<string, string>();
for (const id of OFFICIAL_PLUGIN_ID_LIST) for (const key of OFFICIAL_PLUGIN_KEYS[id]) KNOWN_KEY_OWNER.set(key, id);

const OFFICIAL_IDS = new Set(OFFICIAL_PLUGIN_ID_LIST);

/**
 * Key names starting with one of these (case-insensitive; e.g. `kobar-`, `kobar_`, `kobox-`) belong to KoBar or its
 * official plugins. Owner decision (T-212): the prefixes are reserved for the host and the official plugins, so a
 * third-party plugin whose id starts with them can never claim such keys on restore (documented for plugin authors in
 * for-agents/kobar-plugin-developer/SKILL.md).
 */
const RESERVED_NAMESPACES = ['kobar', 'kobox'] as const;

/** Characters that may follow a plugin id in an id-prefixed key (rule 3). */
const PREFIX_SEPARATORS = [':', '.', '_', '-', '/'] as const;

/** Manifest id format (same as SAFE_ID_RE in electron/lib/paths.cts). Other ids never claim keys by prefix. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MAX_PLUGIN_ID_LENGTH = 64;

/** Workspace ids are at most 200 characters (validated in coreValues.ts), so longer suffixes are never tried. */
const MAX_WORKSPACE_ID_LENGTH = 200;

export const ISO_MARKER = '_iso_';

export const MAX_KEY_LENGTH = 512;

export type SkipReason =
    | 'forbidden-key'
    | 'junk-key'
    | 'invalid-key'
    | 'retired-key'
    | 'recovery-copy'
    | 'host-internal'
    | 'value-too-large'
    | 'invalid-core-value'
    | 'invalid-isolated-key'
    | 'plugin-not-installed'
    | 'unknown-owner';

export type KeyClass =
    | { accepted: true; category: 'core'; coreKey: CoreKey }
    | { accepted: true; category: 'plugin'; pluginId: string }
    | { accepted: false; reason: SkipReason; pluginId?: string };

/** Control characters (C0, DEL, C1) and lone surrogates make a key unusable. */
function hasBadChars(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            i++;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}

export function isCoreKey(key: string): key is CoreKey {
    return Object.prototype.hasOwnProperty.call(CORE_KEYS, key);
}

function isReservedName(key: string): boolean {
    const lower = key.toLowerCase();
    return RESERVED_NAMESPACES.some((ns) => lower.startsWith(ns));
}

/** Owner candidates (rule 3), built once per restore: installed, official and backup-listed ids in manifest id format. */
interface OwnerCandidates {
    installed: ReadonlySet<string>;
    ids: ReadonlySet<string>;
}

function ownerCandidates(installed: ReadonlySet<string>, backupPluginIds: ReadonlySet<string>): OwnerCandidates {
    const ids = new Set<string>();
    for (const id of [...installed, ...OFFICIAL_PLUGIN_ID_LIST, ...backupPluginIds]) if (PLUGIN_ID_RE.test(id)) ids.add(id);
    return { installed, ids };
}

/**
 * Longest candidate id that is `key` itself or a prefix of `key` followed by a separator. Only the prefixes that end
 * right before a separator are looked up, so the cost depends on the key, not on the number of plugins.
 */
function longestOwner(key: string, candidates: OwnerCandidates): string | undefined {
    const reserved = isReservedName(key);
    const accepts = (id: string) => candidates.ids.has(id) && (!reserved || OFFICIAL_IDS.has(id));
    if (accepts(key)) return key;
    // Manifest ids are at most 64 characters (PLUGIN_ID_RE), so longer prefixes are never looked up.
    for (let i = Math.min(key.length - 1, MAX_PLUGIN_ID_LENGTH); i > 0; i--) {
        if (!(PREFIX_SEPARATORS as readonly string[]).includes(key.charAt(i))) continue;
        const prefix = key.slice(0, i);
        if (accepts(prefix)) return prefix;
    }
    return undefined;
}

/** Owner of a plugin key that is neither core nor isolated (rules 2 and 3). */
function classifyPluginKey(key: string, candidates: OwnerCandidates): KeyClass {
    const known = KNOWN_KEY_OWNER.get(key);
    const owner = known ?? longestOwner(key, candidates);
    if (owner === undefined) return { accepted: false, reason: 'unknown-owner' };
    return candidates.installed.has(owner)
        ? { accepted: true, category: 'plugin', pluginId: owner }
        : { accepted: false, reason: 'plugin-not-installed', pluginId: owner };
}

/** Rules 1-3 for a shared key or the base of an isolated key. */
function classifyBaseKey(key: string, candidates: OwnerCandidates): KeyClass {
    if (isCoreKey(key)) return { accepted: true, category: 'core', coreKey: key };
    if (RETIRED_CORE_KEYS.includes(key)) return { accepted: false, reason: 'retired-key' };
    if (isUnreadableStoreCopyKey(key)) return { accepted: false, reason: 'recovery-copy' };
    if (isHostInternalKey(key)) return { accepted: false, reason: 'host-internal' };
    return classifyPluginKey(key, candidates);
}

/** Validity checks shared by full keys and base keys. Returns a skip reason or null. */
function keyNameProblem(key: string): SkipReason | null {
    if (FORBIDDEN_KEYS.includes(key)) return 'forbidden-key';
    if (JUNK_KEYS.includes(key)) return 'junk-key';
    if (key.length === 0 || key.length > MAX_KEY_LENGTH || hasBadChars(key)) return 'invalid-key';
    return null;
}

export type IsolatedKeyClass = KeyClass & { workspaceId?: string; baseKey?: string };

export interface KeyClassifierInput {
    /** Plugins installed right now on this machine. */
    installedPluginIds: ReadonlySet<string>;
    /** Workspaces of the backup's (validated) `kobar-storage`. */
    workspaceIds: ReadonlySet<string>;
    /** Plugin ids listed in the backup: they only help to find the right owner, they never make a key acceptable. */
    backupPluginIds?: ReadonlySet<string>;
}

/** `<base>_iso_<workspace id>` split, for a known workspace id and a non-empty base (rightmost match wins). */
function splitIsolatedKey(key: string, workspaceIds: ReadonlySet<string>): { baseKey: string; workspaceId: string } | null {
    let index = key.lastIndexOf(ISO_MARKER);
    while (index > 0 && key.length - (index + ISO_MARKER.length) <= MAX_WORKSPACE_ID_LENGTH) {
        const workspaceId = key.slice(index + ISO_MARKER.length);
        if (workspaceId !== '' && workspaceIds.has(workspaceId)) return { baseKey: key.slice(0, index), workspaceId };
        index = key.lastIndexOf(ISO_MARKER, index - 1);
    }
    return null;
}

/** Builds the classifier once per restore (owner candidates are prepared here, not per key). */
export function createKeyClassifier(input: KeyClassifierInput): (key: string) => IsolatedKeyClass {
    const candidates = ownerCandidates(input.installedPluginIds, input.backupPluginIds ?? new Set());
    const { workspaceIds } = input;
    return (key) => {
        const problem = keyNameProblem(key);
        if (problem !== null) return { accepted: false, reason: problem };
        const iso = splitIsolatedKey(key, workspaceIds);
        if (iso === null) return classifyBaseKey(key, candidates);
        const { baseKey, workspaceId } = iso;
        const baseProblem = keyNameProblem(baseKey);
        if (baseProblem !== null) return { accepted: false, reason: baseProblem, baseKey };
        // System keys are never suffixed by the isolation layer: such a key was not written by KoBar.
        if (isCoreKey(baseKey) && CORE_KEYS[baseKey].system) return { accepted: false, reason: 'invalid-isolated-key', baseKey };
        const base = classifyBaseKey(baseKey, candidates);
        if (!base.accepted) return { ...base, baseKey };
        return { ...base, workspaceId, baseKey };
    };
}

/** One-off classification (tests, single keys). For many keys use `createKeyClassifier`. */
export function classifyBackupKey(
    key: string,
    installedPluginIds: ReadonlySet<string>,
    workspaceIds: ReadonlySet<string>,
    backupPluginIds: ReadonlySet<string> = new Set()
): IsolatedKeyClass {
    return createKeyClassifier({ installedPluginIds, workspaceIds, backupPluginIds })(key);
}
