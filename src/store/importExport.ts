import { z } from 'zod';
import type { AppState, Note, WorkspaceConfig } from './useAppStore';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from './migrations';
import { dropUnapprovedEnables } from '../backup/pluginFlagRules';
import { accentFromLegacy, isAccent, isMaterial, materialFromLegacy } from './appearance';
import { BACKUP_KEY_V26 } from './migrations/v26';
import { densityFromSidebarWidth, isDensity } from './density';
import { BACKUP_KEY_V27 } from './migrations/v27';
import { BACKUP_KEY_V28 } from './migrations/v28';
import { BACKUP_KEY_V29 } from './migrations/v29';

/** `appearanceV26`, `appearanceV26#2`, ... (src/store/migrations/v26.ts). */
const V26_BACKUP_SLOT = new RegExp(`^${BACKUP_KEY_V26}(#[0-9]+)?$`);
/** `densityV27`, `densityV27#2`, ... (src/store/migrations/v27.ts). */
const V27_BACKUP_SLOT = new RegExp(`^${BACKUP_KEY_V27}(#[0-9]+)?$`);
/** `fakeNotesV28`, `fakeNotesV28#2`, ... (src/store/migrations/v28.ts). */
const V28_BACKUP_SLOT = new RegExp(`^${BACKUP_KEY_V28}(#[0-9]+)?$`);
/** `onboardingV29`, `onboardingV29#2`, ... (src/store/migrations/v29.ts). */
const V29_BACKUP_SLOT = new RegExp(`^${BACKUP_KEY_V29}(#[0-9]+)?$`);

type AnyRecord = Record<string, unknown>;

/**
 * Top-level settings an export carries and an import may set (whitelist). Nothing else is ever imported.
 * Device-level state is deliberately not listed: `tutorialState` and `onboarding` (v29, T-604; the first-run state of
 * this installation must not be reset or skipped by a file from another one).
 */
export const SETTINGS_KEYS = [
    'scheme',
    'accent',
    'material',
    'density',
    'theme',
    'customThemeColor',
    'language',
    'showTooltips',
    'sidebarWidth',
    'iconScale',
    'launchAtStartup',
    'enableEyeAnimation',
    'isPinInjectorEnabled',
    'isKoBoxEnabled',
    'koBoxCleanupMode',
    'featureOrder',
    'design',
    'glassOpacity',
    'settingsFeatureViewMode',
    'orientation',
    'edgePosition',
] as const satisfies readonly (keyof AppState)[];

type SettingsKey = (typeof SETTINGS_KEYS)[number];

export type ExportedWorkspace = Omit<WorkspaceConfig, 'isolatedData'>;

export type SettingsExport = Pick<AppState, SettingsKey> & {
    /** kobar-storage persist version the file was written with (missing in files written before T-209). */
    version: number;
    workspaces: ExportedWorkspace[];
    legacyBackup?: Record<string, unknown>;
};

/** What a settings import may write into the store. */
export type SettingsImportPatch = Partial<Pick<AppState, SettingsKey | 'workspaces' | 'legacyBackup'>>;

export interface DataExport {
    notes: Note[];
}

export type ImportedNote = Omit<Note, 'id'>;

export const IMPORT_LIMITS = {
    maxFileChars: 50_000_000,
    maxShortString: 200,
    maxListItems: 500,
    maxWorkspaces: 200,
    maxNotes: 2000,
    maxNoteTitle: 500,
    maxNoteContent: 10_000_000,
    /** legacyBackup / old isolatedData.pluginData, measured as JSON text. */
    maxBlobChars: 5_000_000,
} as const;

/** Files written before T-209 have no `version`; that format was produced by v21 and later. */
export const MISSING_EXPORT_VERSION = 21;

export class ImportError extends Error {}

export const isSystemTab = (note: unknown): boolean => {
    const n = note as { isSettings?: boolean; isPlugins?: boolean; title?: string } | null;
    return !!n && (!!n.isSettings || !!n.isPlugins || n.title === 'Welcome to KoBar!');
};

/**
 * Settings export. Workspaces are included for their layout/config only:
 * `isolatedData` (isolated notes, plugin data such as API keys) is never exported.
 */
export function buildSettingsExport(source: object): SettingsExport {
    const state = source as AnyRecord;
    const out: AnyRecord = { version: KOBAR_STORAGE_VERSION };
    for (const key of SETTINGS_KEYS) out[key] = state[key];
    out.workspaces = Array.isArray(state.workspaces)
        ? (state.workspaces as WorkspaceConfig[]).map((w) => {
              const copy: Partial<WorkspaceConfig> = { ...w };
              delete copy.isolatedData;
              return copy;
          })
        : state.workspaces;
    out.legacyBackup = state.legacyBackup;
    return out as SettingsExport;
}

/** Data export: only the notes of the current data context (system tabs excluded). */
export function buildDataExport(source: object): DataExport {
    const state = source as AnyRecord;
    const notes = Array.isArray(state.notes) ? (state.notes as Note[]) : [];
    return { notes: notes.filter((n) => !isSystemTab(n)) };
}

// ---------------------------------------------------------------- schemas

const shortString = z.string().max(IMPORT_LIMITS.maxShortString);
const bool = z.boolean();
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const theme = z.enum(['ember', 'ocean', 'sakura', 'emerald', 'midnight', 'amethyst', 'crimson', 'nord', 'coffee', 'lavender', 'custom']);
const featureOrder = z.array(shortString).max(IMPORT_LIMITS.maxListItems);
const edgePosition = z.enum(['left', 'right', 'top', 'bottom']);
const orientation = z.enum(['vertical', 'horizontal']);
const design = z.enum(['style1', 'style2']);
// v26 (T-601): appearance model (src/store/appearance.ts).
const scheme = z.enum(['system', 'dark', 'light']);
const accent = z.enum(['amber', 'orange', 'red', 'pink', 'violet', 'blue', 'green', 'graphite', 'custom']);
const material = z.enum(['solid', 'translucent']);
// v27 (T-602): density (src/store/density.ts).
const density = z.enum(['compact', 'normal', 'comfortable']);
const koBoxCleanupMode = z.enum(['24h', 'quit']);
const viewMode = z.enum(['list', 'cards']);
const plainObject = z.custom<AnyRecord>((v) => typeof v === 'object' && v !== null && !Array.isArray(v));
/** Opaque JSON blob (plugin data, legacy backup) with a size cap. */
const blob = plainObject.refine((v) => JSON.stringify(v).length <= IMPORT_LIMITS.maxBlobChars);

export const settingsSchema = z.object({
    scheme,
    accent,
    material,
    density,
    theme,
    customThemeColor: hexColor,
    language: z.enum(['de', 'ar', 'zh', 'fr', 'hi', 'en', 'es', 'ja', 'ru', 'tr']),
    showTooltips: bool,
    sidebarWidth: num(10, 1000),
    iconScale: num(0.1, 5),
    launchAtStartup: bool,
    enableEyeAnimation: bool,
    isPinInjectorEnabled: bool,
    isKoBoxEnabled: bool,
    koBoxCleanupMode,
    featureOrder,
    design,
    glassOpacity: num(0, 100),
    settingsFeatureViewMode: viewMode,
    orientation,
    edgePosition,
} satisfies Record<SettingsKey, z.ZodType>);

/**
 * Compile-time binding of `settingsSchema` to the store types (T-156): the schema output of every imported setting
 * must equal the `AppState` field type in BOTH directions. A value added to (or removed from) a store union such as
 * `ThemeName` or `LanguageCode` without the schema following makes `tsc` fail instead of silently dropping it on import.
 */
type SchemaMatchesStore = {
    [K in SettingsKey]: [z.output<(typeof settingsSchema.shape)[K]>] extends [AppState[K]]
        ? [AppState[K]] extends [z.output<(typeof settingsSchema.shape)[K]>]
            ? true
            : false
        : false;
};
type RequireTrue<T extends true> = T;
export type SettingsSchemaMatchesStore = RequireTrue<false extends SchemaMatchesStore[SettingsKey] ? false : true>;

/** Workspace config fields an import may set (`id`, `isolatedData` are handled separately). */
export const workspaceSchema = z.object({
    name: shortString.min(1),
    isIsolated: bool,
    enabledExtensions: z.record(shortString, bool).refine((v) => Object.keys(v).length <= IMPORT_LIMITS.maxListItems),
    isPinInjectorEnabled: bool,
    isKoBoxEnabled: bool,
    koBoxCleanupMode,
    toggleWidth: num(0, 1000),
    sidebarWidth: num(10, 1000),
    iconScale: num(0.1, 5),
    featureSpacing: num(0, 1000),
    showTooltips: bool,
    theme,
    customThemeColor: hexColor,
    design,
    glassOpacity: num(0, 100),
    accent,
    material,
    density,
    featureOrder,
    edgePosition,
    isPopupSmartPositioning: bool,
    enableEyeAnimation: bool,
    orientation,
});

const noteSchema = z.object({
    title: z.string().max(IMPORT_LIMITS.maxNoteTitle).catch(''),
    icon: shortString.catch('note'),
    emoji: shortString.nullable().catch(null),
    // Missing content is an empty note; wrong type or oversized drops the note (never silently emptied).
    content: z.string().max(IMPORT_LIMITS.maxNoteContent).default(''),
});

const isolatedDataSchema = z.object({
    notes: z
        .array(noteSchema.extend({ id: z.number().int().safe(), isSettings: bool.optional(), isPlugins: bool.optional() }))
        .max(IMPORT_LIMITS.maxNotes)
        .optional(),
    activeNoteId: z.number().int().safe().optional(),
    nextNoteId: z.number().int().safe().optional(),
    pluginData: blob.optional(),
});

// ---------------------------------------------------------------- pipeline

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (obj: AnyRecord, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** Size check + JSON.parse that drops prototype-pollution keys at every depth. Root must be an object. */
export function parseImportJson(text: string): AnyRecord {
    if (typeof text !== 'string' || text.length > IMPORT_LIMITS.maxFileChars) throw new ImportError('file too large');
    let parsed: unknown;
    try {
        parsed = JSON.parse(text, (key, value: unknown) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
    } catch {
        throw new ImportError('invalid JSON');
    }
    if (!isPlainObject(parsed)) throw new ImportError('root is not an object');
    return parsed;
}

/** Copies only the fields of `shape` whose value passes its schema; everything else is ignored. */
function pickValid(raw: AnyRecord, schema: z.ZodObject): AnyRecord {
    const out: AnyRecord = {};
    for (const [key, fieldSchema] of Object.entries(schema.shape)) {
        if (!own(raw, key)) continue;
        const res = (fieldSchema as z.ZodType).safeParse(raw[key]);
        if (res.success) out[key] = res.data;
    }
    return out;
}

/** Valid workspace entries only: string id, first occurrence of an id wins, config fields validated one by one. */
function sanitizeWorkspaces(raw: unknown): AnyRecord[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<string>();
    const out: AnyRecord[] = [];
    for (const entry of raw.slice(0, IMPORT_LIMITS.maxWorkspaces)) {
        if (!isPlainObject(entry)) continue;
        const id = shortString.min(1).safeParse(entry.id);
        if (!id.success || seen.has(id.data)) continue;
        seen.add(id.data);
        const ws: AnyRecord = { ...pickValid(entry, workspaceSchema), id: id.data };
        const iso = isolatedDataSchema.safeParse(entry.isolatedData);
        if (own(entry, 'isolatedData') && iso.success) ws.isolatedData = iso.data;
        out.push(ws);
    }
    return out;
}

/** Whitelisted, schema-valid subset of a settings file (loose shape, suitable for `migrateKobarStorage`). */
function sanitizeSettings(raw: AnyRecord): AnyRecord {
    const out = pickValid(raw, settingsSchema);
    const workspaces = sanitizeWorkspaces(raw.workspaces);
    if (workspaces) out.workspaces = workspaces;
    const backup = blob.safeParse(raw.legacyBackup);
    if (own(raw, 'legacyBackup') && backup.success) out.legacyBackup = backup.data;
    return out;
}

function exportVersion(raw: AnyRecord): number {
    if (!own(raw, 'version') || raw.version === undefined) return MISSING_EXPORT_VERSION;
    const v = z.number().int().min(0).safeParse(raw.version);
    if (!v.success) throw new ImportError('invalid version');
    // A file from a newer app is not migrated (no known blocks); the schema still applies.
    return Math.min(v.data, KOBAR_STORAGE_VERSION);
}

/**
 * Workspaces merged by id. Local workspaces missing from the file are kept. A known id takes the imported config
 * fields but keeps its local `isolatedData` and `isIsolated` (the data context never changes through an import).
 * Unknown ids are appended, missing config fields are filled from the current live settings; an old file's
 * `isolatedData` notes are kept only for them (T-208 behaviour), but never its `pluginData` (T-156): a crafted settings
 * file must not create a workspace pre-filled with plugin settings. Restoring plugin data is the job of the full
 * backup path (`src/backup/*`), which does not use this function.
 *
 * T-418 (same rule as a backup restore, T-415): an imported `enabledExtensions` record may not enable a plugin that is
 * not approved here (`approved`, see src/backup/pluginFlagRules.ts), because switching to the workspace lays the record
 * over the current set (T-409). Such a `true` entry is not carried over: a known workspace keeps its own local entry for
 * that plugin (if any), an unknown one gets no entry (the current value stays when it becomes active). Nothing is
 * forced to `false`.
 */
export function mergeWorkspacesById(
    imported: AnyRecord[],
    local: WorkspaceConfig[],
    defaults: Partial<WorkspaceConfig>,
    approved: ReadonlySet<string> = new Set()
): WorkspaceConfig[] {
    const byId = new Map(imported.map((w) => [w.id as string, w]));
    /** Copy of `incoming.enabledExtensions` without unapproved enables; `localFlags` entries fill the dropped ids. */
    const restrictFlags = (incoming: AnyRecord, localFlags: unknown): AnyRecord => {
        if (!isPlainObject(incoming.enabledExtensions)) return incoming;
        const before = incoming.enabledExtensions;
        const flags: AnyRecord = { ...before };
        if (dropUnapprovedEnables(flags, approved) === 0) return incoming;
        if (isPlainObject(localFlags)) {
            for (const id of Object.keys(before)) {
                if (!own(flags, id) && own(localFlags, id) && typeof localFlags[id] === 'boolean') flags[id] = localFlags[id];
            }
        }
        return { ...incoming, enabledExtensions: flags };
    };
    const merged = local.map((w) => {
        const incoming = byId.get(w.id);
        if (!incoming) return w;
        byId.delete(w.id);
        const fields: AnyRecord = restrictFlags({ ...incoming }, w.enabledExtensions);
        delete fields.isolatedData;
        delete fields.isIsolated;
        return { ...w, ...fields, id: w.id } as WorkspaceConfig;
    });
    for (const incoming of byId.values()) {
        const w = restrictFlags(incoming, undefined);
        const fresh: AnyRecord = { ...defaults, isIsolated: false, name: w.id, ...w };
        if (isPlainObject(fresh.isolatedData)) {
            const iso: AnyRecord = { ...fresh.isolatedData };
            delete iso.pluginData;
            fresh.isolatedData = iso;
        }
        merged.push(fresh as unknown as WorkspaceConfig);
    }
    return merged;
}

/** `legacyBackup` merged per key with local winning; `conflicts` is merged one level deeper (local entry wins). */
export function mergeLegacyBackup(imported: AnyRecord, local: AnyRecord): AnyRecord {
    const merged: AnyRecord = { ...imported, ...local };
    if (isPlainObject(imported.conflicts) && isPlainObject(local.conflicts)) {
        merged.conflicts = { ...imported.conflicts, ...local.conflicts };
    }
    return merged;
}

const WORKSPACE_DEFAULT_KEYS = Object.keys(workspaceSchema.shape).filter(
    (k) => k !== 'name' && k !== 'isIsolated' && k !== 'enabledExtensions'
);

/**
 * Settings import pipeline: parse -> whitelist + zod -> `migrateKobarStorage` -> whitelist + zod again -> merge with
 * the local state. Returns the patch for `useAppStore.setState`. Never touches notes, plugin data, secrets,
 * `activeWorkspaceId`, local `isolatedData` or a local `legacyBackup` value (local wins per key). Throws ImportError.
 *
 * `approvedPlugins`: plugins installed here and not disabled in extensions-config.json (approvedPluginIds of
 * src/backup/pluginFlagRules.ts, from main's `getBackupSources`). Imported workspace records may keep `true` only for
 * these (T-418, see mergeWorkspacesById). Absent: nothing is approved (fail closed).
 *
 * v26 (T-601): `accent` / `material` follow the imported v1 fields when the file carries those but not the v26 field
 * (an older file: the migration's value is dropped with the other keys the file did not carry, so they are derived here
 * the same way). `scheme` is only imported from a file that has it. Old files' `teleportShortcut` is not imported.
 * v27 (T-602): `density` follows an imported `sidebarWidth` the same way. Workspace records of an older file get the
 * v27 block's values (their `density`, `isPopupSmartPositioning: true`).
 * v28 (T-603): the `isolatedData` notes an older (pre-T-208) file carries for a new workspace lose their Settings/Plugins pseudo-notes.
 * v29 (T-604): `onboarding` is device-level: never exported, never imported (the migration's value is dropped).
 *
 * Known limits (T-156, deliberately not handled here):
 * - Only the store is updated. `launchAtStartup` is not pushed to the main process (IPC), so it takes effect after a
 *   restart, not live.
 * - Live top-level settings (theme, sidebarWidth, ...) are not re-applied when the imported `workspaces` update the
 *   config of the active workspace; the active workspace config and the top-level values can differ until the next sync.
 */
export function buildSettingsImport(text: string, local: AppState, approvedPlugins: ReadonlySet<string> = new Set()): SettingsImportPatch {
    const raw = parseImportJson(text);
    const version = exportVersion(raw);
    const sanitized = sanitizeSettings(raw);
    if (Object.keys(sanitized).length === 0) throw new ImportError('no settings found');
    let migrated: unknown;
    try {
        migrated = migrateKobarStorage(structuredClone(sanitized), version);
    } catch {
        throw new ImportError('migration failed');
    }
    // Only keys the file itself carried: fields a migration block adds (e.g. a default featureOrder) are dropped.
    const clean = isPlainObject(migrated) ? sanitizeSettings(migrated) : {};
    for (const key of Object.keys(clean)) if (!own(sanitized, key)) delete clean[key];
    if (Object.keys(clean).length === 0) throw new ImportError('no settings found');

    const patch: AnyRecord = {};
    for (const key of SETTINGS_KEYS) if (own(clean, key)) patch[key] = clean[key];
    deriveAppearance(patch, local as unknown as AnyRecord);
    if (isPlainObject(clean.legacyBackup)) {
        // T-601/T-602/T-603/T-604: a v26/v27/v28/v29 backup slot the migration created during this import only holds the
        // file's own replaced values (e.g. its teleportShortcut, its pseudo-notes); it is not carried into the local backup.
        // Slots the file already had are kept.
        const fileBackup = isPlainObject(sanitized.legacyBackup) ? sanitized.legacyBackup : {};
        for (const key of Object.keys(clean.legacyBackup)) {
            const migrationSlot = [V26_BACKUP_SLOT, V27_BACKUP_SLOT, V28_BACKUP_SLOT, V29_BACKUP_SLOT].some((slot) => slot.test(key));
            const createdHere = migrationSlot && !own(fileBackup, key);
            if (createdHere) delete clean.legacyBackup[key];
        }
        patch.legacyBackup = mergeLegacyBackup(clean.legacyBackup, local.legacyBackup ?? {});
    }
    if (Array.isArray(clean.workspaces)) {
        const liveSettings: AnyRecord = { ...(local as unknown as AnyRecord), ...patch };
        const defaults: AnyRecord = {};
        for (const key of WORKSPACE_DEFAULT_KEYS) defaults[key] = liveSettings[key];
        patch.workspaces = mergeWorkspacesById(clean.workspaces as AnyRecord[], local.workspaces ?? [], defaults, approvedPlugins);
    }
    return patch as SettingsImportPatch;
}

/**
 * v26 (T-601): keeps the imported appearance consistent. An imported `theme`/`customThemeColor` without `accent` sets the
 * accent they map to; an imported `design`/`glassOpacity` without `material` sets the material (the other half of a
 * pair comes from the local state). v27 (T-602): the density always follows the resulting `sidebarWidth`.
 */
function deriveAppearance(patch: AnyRecord, local: AnyRecord): void {
    if (!isAccent(patch.accent) && (own(patch, 'theme') || own(patch, 'customThemeColor'))) {
        const theme = own(patch, 'theme') ? patch.theme : local.theme;
        const color = own(patch, 'customThemeColor') ? patch.customThemeColor : local.customThemeColor;
        patch.accent = accentFromLegacy(theme, color);
    }
    if (!isMaterial(patch.material) && (own(patch, 'design') || own(patch, 'glassOpacity'))) {
        const design = own(patch, 'design') ? patch.design : local.design;
        const glassOpacity = own(patch, 'glassOpacity') ? patch.glassOpacity : local.glassOpacity;
        patch.material = materialFromLegacy(design, glassOpacity);
    }
    // The width wins (the Sidebar still renders from it until T-618): an imported density that disagrees with the
    // resulting width is replaced, so the pair stays consistent and a later workspace load never moves the bar.
    if (own(patch, 'density') || own(patch, 'sidebarWidth')) {
        const width = own(patch, 'sidebarWidth') ? patch.sidebarWidth : local.sidebarWidth;
        const density = own(patch, 'density') ? patch.density : local.density;
        const fromWidth = densityFromSidebarWidth(width);
        if (!isDensity(density) || density !== fromWidth) patch.density = fromWidth;
    }
}

/** Data import: schema-valid, non-system notes of a `{ notes: [...] }` file, without ids (the store assigns them). */
export function parseDataImport(text: string): ImportedNote[] {
    const raw = parseImportJson(text);
    if (!Array.isArray(raw.notes)) throw new ImportError('no notes array');
    if (raw.notes.length > IMPORT_LIMITS.maxNotes) throw new ImportError('too many notes');
    const notes: ImportedNote[] = [];
    for (const entry of raw.notes) {
        if (!isPlainObject(entry) || isSystemTab(entry)) continue;
        const res = noteSchema.safeParse(entry);
        if (res.success) notes.push(res.data);
    }
    if (raw.notes.length > 0 && notes.length === 0) throw new ImportError('no valid notes');
    return notes;
}
