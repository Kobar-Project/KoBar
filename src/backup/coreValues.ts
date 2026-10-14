// Validation of the core localStorage values of a `kobar-backup` file (T-212). Pure: no DOM, no Electron, no I/O.
//
// Core values are never restored as they are: each one is parsed with prototype-pollution protection, checked with
// zod, (for `kobar-storage`) run through `migrateKobarStorage`, reduced to the persisted field list and serialized
// again. Anything that cannot be validated is reported, never guessed.

import { z } from 'zod';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../store/migrations';
import { BACKUP_KEY_V29, isOnboardingV29, migratedOnboardingV29 } from '../store/migrations/v29';
import { IMPORT_LIMITS, SETTINGS_KEYS, isSystemTab, settingsSchema, workspaceSchema } from '../store/importExport';
import { FORBIDDEN_KEYS, type CoreValueKind } from './keyPolicy';

type AnyRecord = Record<string, unknown>;

/** `useChatStore` persist version (src/store/useChatStore.ts; a test checks that both stay equal). */
export const CHAT_STORE_VERSION = 1;

export const RESTORE_LIMITS = {
    /** Largest single localStorage value a restore accepts (Chromium caps an origin at ~10 MB in total). */
    maxValueChars: 10_000_000,
    /** Object/array nesting allowed inside a core value. */
    maxCoreDepth: 100,
    maxNotes: IMPORT_LIMITS.maxNotes,
    maxWorkspaces: IMPORT_LIMITS.maxWorkspaces,
    maxChats: 5000,
    maxChatMessages: 20_000,
    maxShortText: 200,
    maxChatText: 1_000_000,
} as const;

export type CoreValueProblem = 'invalid-json' | 'too-deep' | 'invalid-shape' | 'invalid-version' | 'version-newer' | 'migration-failed';

export interface AppStoreStats {
    /** Notes of all data contexts (shared + isolated workspaces), system tabs not counted. */
    notes: number;
    workspaces: number;
    workspaceIds: string[];
    /** Persisted fields that were dropped because they did not pass validation (top-level names). */
    droppedFields: string[];
    /** Notes dropped because they did not pass validation. */
    droppedNotes: number;
}

/**
 * Maps a path inside the ORIGINAL backup value (as recorded by redact.ts) to the same place in the re-serialized value:
 * array positions of dropped elements are removed, so later positions move. Returns null when the place no longer
 * exists (its element or field was dropped).
 */
export type PathMapper = (path: readonly string[]) => string[] | null;

export type CoreValueResult =
    { ok: true; value: string; mapPath: PathMapper; appStore?: AppStoreStats; chats?: number } | { ok: false; problem: CoreValueProblem };

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
export const isPlainObject = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON.parse that drops `__proto__`, `constructor` and `prototype` keys at every depth. Returns undefined on error. */
export function parseJsonSafely(text: string, onForbiddenKey?: () => void): { value: unknown } | undefined {
    try {
        const value: unknown = JSON.parse(text, (key, child: unknown) => {
            if (FORBIDDEN_KEYS.includes(key)) {
                onForbiddenKey?.();
                return undefined;
            }
            return child;
        });
        return { value };
    } catch {
        // Invalid JSON, or nesting too deep for the parser (RangeError).
        return undefined;
    }
}

/** True when objects/arrays in `root` nest deeper than `max` levels. Iterative, so a nesting bomb cannot overflow. */
export function exceedsDepth(root: unknown, max: number): boolean {
    const stack: Array<[unknown, number]> = [[root, 0]];
    while (stack.length > 0) {
        const [value, depth] = stack.pop()!;
        if (value === null || typeof value !== 'object') continue;
        if (depth >= max) return true;
        for (const child of Object.values(value as AnyRecord)) {
            if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
        }
    }
    return false;
}

// ---------------------------------------------------------------- kobar-storage

const shortText = z.string().max(RESTORE_LIMITS.maxShortText);
const safeInt = z.number().int().safe();
const plainObject = z.custom<AnyRecord>(isPlainObject);
const persistEnvelope = z.object({ state: plainObject, version: z.number().int().min(0).safe() });

const noteTitle = z.string().max(IMPORT_LIMITS.maxNoteTitle);
const noteContent = z.string().max(IMPORT_LIMITS.maxNoteContent);

const tutorialStateSchema = z.object({
    version: shortText,
    status: z.enum(['pending', 'completed', 'snoozed']),
    snoozeUntil: z.number().finite().optional(),
});

/** v29 (T-604): src/store/onboarding.ts `OnboardingState` (unknown keys are refused, like `isOnboardingState`). */
const onboardingSchema = z
    .object({
        status: z.enum(['pending', 'completed', 'skipped']),
        version: safeInt.min(1),
        migrated: z.literal(true).optional(),
    })
    .strict();

/** Old array position -> new position, for the arrays whose elements can be dropped. */
type IndexMap = Map<number, number>;

interface SanitizeContext {
    dropped: string[];
    droppedNotes: number;
    /** `notes`, `globalNotes` and `ws:<old workspace index>` (isolated notes) -> index map. */
    noteMaps: Map<string, IndexMap>;
    workspaceMap: IndexMap;
}

/**
 * One stored note. A note without a valid id, or whose content is not a string (or too large), is dropped (never
 * silently emptied). Missing or invalid title/icon/emoji/flags fall back to defaults and are reported by field.
 */
function sanitizeNote(entry: unknown, prefix: string, ctx: SanitizeContext): AnyRecord | null {
    if (!isPlainObject(entry)) return null;
    const id = safeInt.safeParse(entry.id);
    if (!id.success) return null;
    let content = '';
    if (own(entry, 'content')) {
        const res = noteContent.safeParse(entry.content);
        if (!res.success) return null;
        content = res.data;
    } else {
        ctx.dropped.push(prefix + 'content');
    }
    const field = <T>(name: string, schema: z.ZodType<T>, fallback: T): T => {
        const res = schema.safeParse(entry[name]);
        if (res.success) return res.data;
        ctx.dropped.push(prefix + name);
        return fallback;
    };
    const note: AnyRecord = {
        id: id.data,
        title: field('title', noteTitle, ''),
        icon: field('icon', shortText, 'note'),
        emoji: field('emoji', shortText.nullable(), null),
        content,
    };
    for (const flag of ['isSettings', 'isPlugins'] as const) {
        if (!own(entry, flag) || entry[flag] === undefined) continue;
        if (typeof entry[flag] === 'boolean') note[flag] = entry[flag];
        else ctx.dropped.push(prefix + flag);
    }
    return note;
}

/** Valid notes only (invalid entries are dropped and counted); records the old -> new positions under `mapKey`. */
function sanitizeNotes(raw: unknown, prefix: string, mapKey: string, ctx: SanitizeContext): unknown[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: unknown[] = [];
    const map: IndexMap = new Map();
    raw.forEach((entry, index) => {
        const note = out.length < RESTORE_LIMITS.maxNotes ? sanitizeNote(entry, prefix + '[].', ctx) : null;
        if (note) {
            map.set(index, out.length);
            out.push(note);
        } else {
            ctx.droppedNotes++;
        }
    });
    ctx.noteMaps.set(mapKey, map);
    return out;
}

function sanitizeIsolatedData(raw: unknown, oldIndex: number, ctx: SanitizeContext): AnyRecord | undefined {
    if (!isPlainObject(raw)) return undefined;
    const out: AnyRecord = {};
    const notes = sanitizeNotes(raw.notes, 'workspaces[].isolatedData.notes', 'ws:' + oldIndex, ctx);
    if (notes) out.notes = notes;
    for (const key of ['activeNoteId', 'nextNoteId'] as const) {
        const res = safeInt.safeParse(raw[key]);
        if (own(raw, key) && res.success) out[key] = res.data;
    }
    if (isPlainObject(raw.pluginData)) out.pluginData = raw.pluginData;
    return out;
}

/** Copies the fields of `schema` whose value passes; names of failing fields are added to `dropped`. */
function pickValid(raw: AnyRecord, shape: Record<string, z.ZodType>, dropped: string[], prefix = ''): AnyRecord {
    const out: AnyRecord = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
        if (!own(raw, key)) continue;
        const res = fieldSchema.safeParse(raw[key]);
        if (res.success) out[key] = res.data;
        else dropped.push(prefix + key);
    }
    return out;
}

function sanitizeWorkspaces(raw: unknown, ctx: SanitizeContext): AnyRecord[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const { dropped } = ctx;
    const seen = new Set<string>();
    const out: AnyRecord[] = [];
    for (let index = 0; index < raw.length; index++) {
        const entry: unknown = raw[index];
        const id = isPlainObject(entry) ? shortText.min(1).safeParse(entry.id) : undefined;
        if (!isPlainObject(entry) || !id?.success || seen.has(id.data) || out.length >= RESTORE_LIMITS.maxWorkspaces) {
            dropped.push('workspaces[]');
            continue;
        }
        ctx.workspaceMap.set(index, out.length);
        seen.add(id.data);
        // Same fallbacks as a settings import for the two fields the app cannot do without.
        const ws: AnyRecord = { name: id.data, isIsolated: false, ...pickValid(entry, workspaceSchema.shape, dropped, 'workspaces[].') };
        ws.id = id.data;
        const iso = sanitizeIsolatedData(entry.isolatedData, index, ctx);
        if (iso) ws.isolatedData = iso;
        else if (own(entry, 'isolatedData') && entry.isolatedData !== undefined) dropped.push('workspaces[].isolatedData');
        out.push(ws);
    }
    return out;
}

/** Persisted top-level fields other than settings, notes and workspaces (see `partialize` in useAppStore.ts). */
// `defaultExtensionsConfig` (v25, T-409) is deliberately not restored: a restore must never enable a plugin (T-213); same result as 1.2.x.
const OTHER_PERSISTED_FIELDS: Record<string, z.ZodType> = {
    activeNoteId: safeInt,
    nextNoteId: safeInt,
    globalPluginData: plainObject,
    activeWorkspaceId: shortText.nullable(),
    notePanelWidth: z.number().finite().min(0).max(100_000),
    notePanelHeight: z.number().finite().min(0).max(100_000),
    // v31 (R-11): note list column width.
    noteListWidth: z.number().finite().min(160).max(420),
    // v32 (R-15): per-plugin panel offsets (pluginId -> { x?, y? } px).
    pluginPanelOffsets: z.record(
        z.string().max(RESTORE_LIMITS.maxShortText),
        z.object({ x: z.number().finite().min(-100000).max(100000).optional(), y: z.number().finite().min(-100000).max(100000).optional() })
    ),
    tutorialState: tutorialStateSchema,
    // v29 (T-604): restored with the rest of the state (an older backup gets the migration's `completed` record).
    onboarding: onboardingSchema,
    legacyBackup: plainObject,
    toggleWidth: workspaceSchema.shape.toggleWidth,
    featureSpacing: workspaceSchema.shape.featureSpacing,
    isPopupSmartPositioning: workspaceSchema.shape.isPopupSmartPositioning,
};

/** The boolean entries of a `Record<string, boolean>` (other entries are dropped and reported). */
function booleanEntries(raw: unknown): { value: Record<string, boolean>; dropped: boolean } | undefined {
    if (!isPlainObject(raw)) return undefined;
    const value: Record<string, boolean> = {};
    let dropped = false;
    for (const [key, enabled] of Object.entries(raw)) {
        if (typeof enabled === 'boolean' && key.length <= RESTORE_LIMITS.maxShortText) {
            Object.defineProperty(value, key, { value: enabled, enumerable: true, writable: true, configurable: true });
        } else {
            dropped = true;
        }
    }
    return { value, dropped };
}

/** Top-level keys the v26 / v27 migrations add to every older state (derived values, not user data). */
const MIGRATION_ADDED_KEYS = new Set(['scheme', 'accent', 'material', 'density']);

/** `onboardingV29`, `onboardingV29#2`, ... (src/store/migrations/v29.ts). */
const V29_BACKUP_SLOT = new RegExp(`^${BACKUP_KEY_V29}(#[0-9]+)?$`);

/** A `legacyBackup` that holds nothing but v29 slots (a copy of the input's own `tutorialState`, not extra data). */
const onlyV29Backup = (value: unknown) => isPlainObject(value) && Object.keys(value).every((key) => V29_BACKUP_SLOT.test(key));

const SETTINGS_FIELDS: Record<string, z.ZodType> = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, settingsSchema.shape[key]]));

/** The persisted field list (`partialize`), validated field by field. Unknown fields are dropped silently. */
function sanitizeAppState(raw: AnyRecord): { state: AnyRecord; ctx: SanitizeContext } {
    const ctx: SanitizeContext = { dropped: [], droppedNotes: 0, noteMaps: new Map(), workspaceMap: new Map() };
    const { dropped } = ctx;
    const state: AnyRecord = {
        ...pickValid(raw, SETTINGS_FIELDS, dropped),
        ...pickValid(raw, OTHER_PERSISTED_FIELDS, dropped),
    };
    if (own(raw, 'currentExtensionsConfig')) {
        const config = booleanEntries(raw.currentExtensionsConfig);
        if (config) state.currentExtensionsConfig = config.value;
        if (!config || config.dropped) dropped.push('currentExtensionsConfig');
    }
    for (const key of ['notes', 'globalNotes'] as const) {
        if (!own(raw, key)) continue;
        const notes = sanitizeNotes(raw[key], key, key, ctx);
        if (notes) state[key] = notes;
        else dropped.push(key);
    }
    if (own(raw, 'workspaces')) {
        const workspaces = sanitizeWorkspaces(raw.workspaces, ctx);
        if (workspaces) state.workspaces = workspaces;
        else dropped.push('workspaces');
    }
    return { state, ctx };
}

const ARRAY_INDEX = /^(?:0|[1-9]\d{0,8})$/;

/** Maps an array position through `map`; null when the element was dropped. */
function mapIndex(segment: string | undefined, map: IndexMap | undefined): string | null {
    if (segment === undefined || !ARRAY_INDEX.test(segment) || !map) return null;
    const next = map.get(Number(segment));
    return next === undefined ? null : String(next);
}

/**
 * True when `path` is a non-empty path without prototype names that leads, through own properties, to a LEAF of
 * `root` (string, number, boolean or null: what redact.ts blanks). JSON strings on the way are entered like redact.ts
 * does. Paths to the whole value or to an object/array (e.g. `[]`, `['state']`, `['state', 'notes']`) are refused.
 */
export function leafPathExists(root: unknown, path: readonly string[]): boolean {
    if (path.length === 0 || path.some((segment) => FORBIDDEN_KEYS.includes(segment))) return false;
    let current: unknown = root;
    for (const segment of path) {
        // Nested JSON strings (also JSON encoded twice) are entered transparently.
        for (let i = 0; i < 4 && typeof current === 'string'; i++) current = parseJsonSafely(current)?.value;
        if (current === null || typeof current !== 'object' || !own(current, segment)) return false;
        // Arrays: only element positions (never `length`).
        if (Array.isArray(current) && !ARRAY_INDEX.test(segment)) return false;
        current = (current as AnyRecord)[segment];
    }
    return current === null || typeof current !== 'object';
}

/** Path mapper for a value that is written unchanged (plugin keys): the path must lead to a leaf of the raw value. */
export function rawValuePathMapper(raw: string): PathMapper {
    let parsed: { value: unknown } | undefined | null = null;
    return (path) => {
        if (path.length === 0 || path.some((segment) => FORBIDDEN_KEYS.includes(segment))) return null;
        // Parsed once per key, on first use.
        if (parsed === null) parsed = parseJsonSafely(raw);
        if (parsed === undefined) return null;
        return leafPathExists(parsed.value, path) ? [...path] : null;
    };
}

/** Path mapper for the re-serialized `kobar-storage` (see PathMapper). */
function appStorePathMapper(serialized: AnyRecord, ctx: SanitizeContext): PathMapper {
    return (path) => {
        const out = [...path];
        if (path[0] === 'state' && (path[1] === 'notes' || path[1] === 'globalNotes') && path.length > 2) {
            const next = mapIndex(path[2], ctx.noteMaps.get(path[1]));
            if (next === null) return null;
            out[2] = next;
        }
        if (path[0] === 'state' && path[1] === 'workspaces' && path.length > 2) {
            const next = mapIndex(path[2], ctx.workspaceMap);
            if (next === null) return null;
            out[2] = next;
            if (path[3] === 'isolatedData' && path[4] === 'notes' && path.length > 5) {
                const note = mapIndex(path[5], ctx.noteMaps.get('ws:' + path[2]));
                if (note === null) return null;
                out[5] = note;
            }
        }
        return leafPathExists(serialized, out) ? out : null;
    };
}

function countUserNotes(notes: unknown): number {
    return Array.isArray(notes) ? notes.filter((n) => !isSystemTab(n)).length : 0;
}

function appStoreStats(state: AnyRecord, droppedFields: string[], droppedNotes: number): AppStoreStats {
    const workspaces = Array.isArray(state.workspaces) ? (state.workspaces as AnyRecord[]) : [];
    let notes = countUserNotes(own(state, 'globalNotes') ? state.globalNotes : state.notes);
    for (const ws of workspaces) {
        if (ws.isIsolated === true && isPlainObject(ws.isolatedData)) notes += countUserNotes(ws.isolatedData.notes);
    }
    return { notes, workspaces: workspaces.length, workspaceIds: workspaces.map((w) => String(w.id)), droppedFields, droppedNotes };
}

/**
 * `kobar-storage` (Zustand persist `{ state, version }`): safe parse -> zod envelope -> `migrateKobarStorage` (older
 * versions only; a newer version is refused) -> persisted fields validated with zod -> serialized at the current
 * version.
 */
export function validateAppStoreValue(raw: string, onForbiddenKey?: () => void, forcedThemeColor?: unknown): CoreValueResult {
    const parsed = parseJsonSafely(raw, onForbiddenKey);
    if (!parsed) return { ok: false, problem: 'invalid-json' };
    if (exceedsDepth(parsed.value, RESTORE_LIMITS.maxCoreDepth)) return { ok: false, problem: 'too-deep' };
    if (!isPlainObject(parsed.value)) return { ok: false, problem: 'invalid-shape' };
    if (!own(parsed.value, 'version') || typeof parsed.value.version !== 'number') return { ok: false, problem: 'invalid-version' };
    const envelope = persistEnvelope.safeParse(parsed.value);
    if (!envelope.success) return { ok: false, problem: isPlainObject(parsed.value.state) ? 'invalid-version' : 'invalid-shape' };
    const { state, version } = envelope.data;
    if (version > KOBAR_STORAGE_VERSION) return { ok: false, problem: 'version-newer' };
    const inputKeys = new Set(Object.keys(state));
    let migrated: unknown;
    try {
        // T-601: the backup's own `kobar_force_theme_color` (when valid) feeds v26 like this machine's key on startup.
        const forced = typeof forcedThemeColor === 'string' && HEX_COLOR.test(forcedThemeColor) ? forcedThemeColor : null;
        migrated = version < KOBAR_STORAGE_VERSION ? migrateKobarStorage(state, version, { forcedThemeColor: forced }) : state;
    } catch {
        return { ok: false, problem: 'migration-failed' };
    }
    if (!isPlainObject(migrated)) return { ok: false, problem: 'migration-failed' };
    const { state: cleanState, ctx } = sanitizeAppState(migrated);
    // T-601: the appearance keys the v26 block adds to every older state do not make a value without any data valid.
    // T-604: the same for a `legacyBackup` the v29 block created only for its backup slot; `onboarding` never counts as
    // data (it is set below for every restored value).
    const addedByMigration = (key: string) =>
        !inputKeys.has(key) && (MIGRATION_ADDED_KEYS.has(key) || (key === 'legacyBackup' && onlyV29Backup(cleanState.legacyBackup)));
    const isData = (key: string) => key !== 'onboarding' && !addedByMigration(key);
    if (Object.keys(cleanState).filter(isData).length === 0) return { ok: false, problem: 'invalid-shape' };
    // T-604: a restored state always belongs to an existing user. A missing or invalid `onboarding` (an invalid one is
    // still reported as dropped) becomes the record v29 writes, so a restore never shows the first-run flow again.
    if (!isOnboardingV29(cleanState.onboarding)) cleanState.onboarding = migratedOnboardingV29();
    const serialized = { state: cleanState, version: KOBAR_STORAGE_VERSION };
    return {
        ok: true,
        value: JSON.stringify(serialized),
        mapPath: appStorePathMapper(serialized, ctx),
        appStore: appStoreStats(cleanState, [...new Set(ctx.dropped)], ctx.droppedNotes),
    };
}

// ---------------------------------------------------------------- kobar-chat-storage

const chatText = z.string().max(RESTORE_LIMITS.maxChatText);
const chatMessageSchema = z.object({
    id: shortText,
    role: z.enum(['system', 'user', 'assistant']),
    content: chatText,
    attachments: z.array(chatText).max(IMPORT_LIMITS.maxListItems).optional(),
});
const chatSchema = z.object({
    id: shortText,
    title: z.string().max(IMPORT_LIMITS.maxNoteTitle),
    messages: z.array(chatMessageSchema).max(RESTORE_LIMITS.maxChatMessages),
    model: shortText,
    updatedAt: z.number().finite(),
});
const chatApiKeysSchema = z.object({
    openai: chatText.optional(),
    gemini: chatText.optional(),
    anthropic: chatText.optional(),
    localUrl: chatText.optional(),
    systemMessage: chatText.optional(),
    customInstructions: chatText.optional(),
    defaultModel: chatText.optional(),
});
const avatarSchema = z.string().max(RESTORE_LIMITS.maxValueChars).nullable();

/**
 * Legacy core chat store (`kobar-chat-storage`): only the current persist version is accepted (the store has no
 * `migrate`), persisted fields are validated with zod, invalid chats are dropped.
 */
export function validateChatStoreValue(raw: string, onForbiddenKey?: () => void): CoreValueResult {
    const parsed = parseJsonSafely(raw, onForbiddenKey);
    if (!parsed) return { ok: false, problem: 'invalid-json' };
    if (exceedsDepth(parsed.value, RESTORE_LIMITS.maxCoreDepth)) return { ok: false, problem: 'too-deep' };
    const envelope = persistEnvelope.safeParse(parsed.value);
    if (!envelope.success) return { ok: false, problem: 'invalid-shape' };
    const { state, version } = envelope.data;
    if (version > CHAT_STORE_VERSION) return { ok: false, problem: 'version-newer' };
    if (version !== CHAT_STORE_VERSION) return { ok: false, problem: 'invalid-version' };
    const out: AnyRecord = {};
    const chatMap: IndexMap = new Map();
    if (Array.isArray(state.chats)) {
        const chats: unknown[] = [];
        state.chats.forEach((chat, index) => {
            if (chats.length >= RESTORE_LIMITS.maxChats) return;
            const res = chatSchema.safeParse(chat);
            if (!res.success) return;
            chatMap.set(index, chats.length);
            chats.push(res.data);
        });
        out.chats = chats;
    }
    const activeChatId = shortText.nullable().safeParse(state.activeChatId);
    if (own(state, 'activeChatId') && activeChatId.success) out.activeChatId = activeChatId.data;
    const apiKeys = chatApiKeysSchema.safeParse(state.apiKeys);
    if (own(state, 'apiKeys') && apiKeys.success) out.apiKeys = apiKeys.data;
    for (const key of ['aiAvatar', 'userAvatar'] as const) {
        const res = avatarSchema.safeParse(state[key]);
        if (own(state, key) && res.success) out[key] = res.data;
    }
    if (Object.keys(out).length === 0) return { ok: false, problem: 'invalid-shape' };
    const chats = Array.isArray(out.chats) ? out.chats.length : 0;
    const serialized = { state: out, version: CHAT_STORE_VERSION };
    const mapPath: PathMapper = (path) => {
        const mapped = [...path];
        if (path[0] === 'state' && path[1] === 'chats' && path.length > 2) {
            const next = mapIndex(path[2], chatMap);
            if (next === null) return null;
            mapped[2] = next;
        }
        return leafPathExists(serialized, mapped) ? mapped : null;
    };
    return { ok: true, value: JSON.stringify(serialized), mapPath, chats };
}

// ---------------------------------------------------------------- small core keys

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PRINTABLE = /^[ -~]*$/;

/** Small core keys hold plain text: there is no field inside them to keep (and the whole value is never a target). */
const plainValuePath: PathMapper = () => null;

/** Validates one core value by kind; app/chat stores are re-serialized, the small keys are kept as they are. */
/** `forcedThemeColor`: the backup's raw `kobar_force_theme_color` value, used for 'app-store' only (v26, T-601). */
export function validateCoreValue(
    kind: CoreValueKind,
    raw: string,
    onForbiddenKey?: () => void,
    forcedThemeColor?: unknown
): CoreValueResult {
    switch (kind) {
        case 'app-store':
            return validateAppStoreValue(raw, onForbiddenKey, forcedThemeColor);
        case 'chat-store':
            return validateChatStoreValue(raw, onForbiddenKey);
        case 'theme-color':
            return HEX_COLOR.test(raw) ? { ok: true, value: raw, mapPath: plainValuePath } : { ok: false, problem: 'invalid-shape' };
        case 'short-text':
            return raw.length <= RESTORE_LIMITS.maxShortText && PRINTABLE.test(raw)
                ? { ok: true, value: raw, mapPath: plainValuePath }
                : { ok: false, problem: 'invalid-shape' };
    }
}
