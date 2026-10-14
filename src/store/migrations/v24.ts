// kobar-storage v23 -> v24 (T-408, workspace model: WS-10, WS-13, ARC-07).
// Pure: no store/window imports; works on the loose persisted shape and never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// The target workspace model expressed in the v1 fields that the store, plugins
// and a 1.2.x downgrade still read. Nothing new is stored at the top level (`legacyBackup` already exists) and every
// v1 field (`activeWorkspaceId`, `workspaces[].isIsolated`, the top-level profile fields) stays present:
// - Default workspace (WS-13): the state in which no `workspaces[]` record matches `activeWorkspaceId`. It is derived,
//   never stored as a record, so it cannot be deleted and the workspace list does not change. It is always shared
//   (context 'global') and its profile is the top-level profile fields. A non-string `activeWorkspaceId` that matches
//   no record becomes null (the stored marker of the Default workspace). A string id that matches no record is kept:
//   every reader already treats it as "no workspace", and plugins may read the raw id.
// - Isolation (WS-10): a workspace record without `isIsolated` gets an explicit `false` (every reader already treats a
//   missing value as shared, so no workspace changes its data context; nothing is lost, so this is not backed up).
//   A present non-boolean value is left alone: the store reads it by truthiness but the backup restore drops it as
//   invalid, so any rewrite would change one of the two readers.
// - Active profile, one copy (ARC-07): the profile fields of the active workspace record equal the top-level fields
//   (the live copy the user sees and every setter writes first). Stale or missing record values take the top-level
//   value, which is what the store itself writes into the record when the user leaves the workspace. `enabledExtensions`
//   is left alone: its third copy lives in extensions-config.json and its single source is T-409.
// Raw backup: every value v24 replaces is first copied into `legacyBackup.workspaceModelV24` (or the first free slot
// `workspaceModelV24#2`, `#3`, ...), together with the profile keys it adds to a record, so the pre-v24 values can be
// rebuilt exactly. A change whose backup cannot be written (legacyBackup is not an object, every slot is taken, or the
// size cap is reached) is skipped. Notes, globalNotes, isolatedData, pluginData, workspace ids and names are never touched.
// Idempotent: a second run finds nothing to change and writes no backup entry.

type Loose = Record<string, unknown>;

/** Workspace profile fields kept in sync with the top level (WorkspaceConfig minus identity, data and `enabledExtensions`). */
export const WORKSPACE_PROFILE_KEYS_V24 = [
    'isPinInjectorEnabled',
    'isKoBoxEnabled',
    'koBoxCleanupMode',
    'toggleWidth',
    'sidebarWidth',
    'iconScale',
    'featureSpacing',
    'showTooltips',
    'theme',
    'customThemeColor',
    'design',
    'glassOpacity',
    'featureOrder',
    'edgePosition',
    'isPopupSmartPositioning',
    'enableEyeAnimation',
    'orientation',
] as const;

export const BACKUP_KEY_V24 = 'workspaceModelV24';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for one backup entry, measured as JSON text (profile values are small; this only stops garbage). */
export const MAX_BACKUP_CHARS_V24 = 64 * 1024;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

function sameJson(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/** JSON length of a value, or Infinity when it cannot be serialized (such a change is never made). */
function jsonSize(value: unknown): number {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? 0 : text.length;
    } catch {
        return Infinity;
    }
}

function tryClone<T>(value: T): { ok: true; value: T } | { ok: false } {
    try {
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** True when the Default workspace is active: no workspace record matches `activeWorkspaceId` (store `findActiveWorkspace`). */
export function isDefaultWorkspaceActiveV24(state: unknown): boolean {
    if (!isObject(state)) return true;
    const id = state.activeWorkspaceId;
    if (id === null || id === undefined) return true;
    const workspaces: unknown[] = Array.isArray(state.workspaces) ? state.workspaces : [];
    return !workspaces.some((w) => isObject(w) && w.id === id);
}

/** A planned change of one field. `added` = the key did not exist before (nothing is overwritten). */
interface FieldChange {
    holder: Loose;
    key: string;
    next: unknown;
    added: boolean;
    before?: unknown;
}

interface WorkspaceBackup {
    index: number;
    id: unknown;
    values: Loose;
    added: string[];
}

interface BackupEntry {
    activeWorkspaceId?: unknown;
    workspaces?: WorkspaceBackup[];
}

/** Planned changes, grouped so the backup entry can be built in the same order. */
interface Plan {
    top: FieldChange[];
    workspaces: { index: number; ws: Loose; changes: FieldChange[] }[];
}

function planActiveProfile(state: Loose, ws: Loose, changes: FieldChange[]): void {
    for (const key of WORKSPACE_PROFILE_KEYS_V24) {
        if (!hasOwn(state, key) || state[key] === undefined) continue; // the store default applies; nothing to copy
        if (hasOwn(ws, key) && sameJson(ws[key], state[key])) continue;
        const clone = tryClone(state[key]);
        if (!clone.ok) continue;
        const added = !hasOwn(ws, key) || ws[key] === undefined;
        changes.push({ holder: ws, key, next: clone.value, added, before: ws[key] });
    }
}

function buildPlan(state: Loose): Plan {
    const plan: Plan = { top: [], workspaces: [] };
    const activeId = state.activeWorkspaceId;
    const workspaces: unknown[] = Array.isArray(state.workspaces) ? state.workspaces : [];

    if (activeId !== null && activeId !== undefined && typeof activeId !== 'string' && isDefaultWorkspaceActiveV24(state)) {
        plan.top.push({ holder: state, key: 'activeWorkspaceId', next: null, added: false, before: activeId });
    }

    // Same rule as the store's patchActiveWorkspace(): a non-empty id, every record carrying it.
    const syncProfile = typeof activeId === 'string' && activeId !== '';
    workspaces.forEach((ws, index) => {
        if (!syncProfile || !isObject(ws) || ws.id !== activeId) return;
        const changes: FieldChange[] = [];
        planActiveProfile(state, ws, changes);
        if (changes.length > 0) plan.workspaces.push({ index, ws, changes });
    });
    return plan;
}

/** Keeps the changes whose backup fits into the size cap and builds the backup entry for exactly those. */
function fitBackup(plan: Plan): { entry: BackupEntry; kept: FieldChange[] } {
    const entry: BackupEntry = {};
    const kept: FieldChange[] = [];
    let budget = MAX_BACKUP_CHARS_V24;

    for (const change of plan.top) {
        const size = jsonSize(change.before) + change.key.length + 8;
        if (size > budget) continue;
        budget -= size;
        entry.activeWorkspaceId = change.before;
        kept.push(change);
    }
    for (const { index, ws, changes } of plan.workspaces) {
        const header = jsonSize(ws.id) + 48;
        if (header > budget) continue;
        const item: WorkspaceBackup = { index, id: ws.id, values: {}, added: [] };
        let used = header;
        for (const change of changes) {
            const size = (change.added ? 0 : jsonSize(change.before)) + change.key.length + 8;
            if (used + size > budget) continue;
            used += size;
            if (change.added) item.added.push(change.key);
            else item.values[change.key] = change.before;
            kept.push(change);
        }
        if (item.added.length === 0 && Object.keys(item.values).length === 0) continue;
        budget -= used;
        if (!entry.workspaces) entry.workspaces = [];
        entry.workspaces.push(item);
    }
    return { entry, kept };
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (hasOwn(state, 'legacyBackup') && state.legacyBackup !== undefined && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V24 : `${BACKUP_KEY_V24}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

/** WS-10: an explicit `isIsolated: false` on every workspace record that has none (lossless, see the header). */
function fillMissingIsIsolated(state: Loose): void {
    if (!Array.isArray(state.workspaces)) return;
    for (const ws of state.workspaces) {
        if (isObject(ws) && (!hasOwn(ws, 'isIsolated') || ws.isIsolated === undefined)) ws.isIsolated = false;
    }
}

/** The changes that replace stored values: only made once their raw values are inside `legacyBackup`. */
function applyBackedUpChanges(state: Loose): void {
    const plan = buildPlan(state);
    if (plan.top.length === 0 && plan.workspaces.length === 0) return;

    const slot = freeBackupSlot(state);
    if (slot === null) return; // no safe place for the raw values: change nothing
    const { entry, kept } = fitBackup(plan);
    if (kept.length === 0) return;

    // Backup first (verified copy of the raw values), then the changes.
    const clonedEntry = tryClone(entry);
    if (!clonedEntry.ok) return;
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clonedEntry.value };

    for (const change of kept) change.holder[change.key] = change.next;
}

/** The whole v24 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV24(state: unknown): void {
    if (!isObject(state)) return;
    applyBackedUpChanges(state);
    fillMissingIsIsolated(state);
}
