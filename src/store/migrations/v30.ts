// kobar-storage v29 -> v30 (T-615d: cleanup after the Settings/Plugins panels left the notes list).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// Two things happen here:
// 1. Fake notes (`isSettings`/`isPlugins` === true, see ./v28) that were created AFTER v28 ran are removed again from the
//    same three places as in v28 (`notes`, `globalNotes`, every `isolatedData.notes`). Between T-603 and T-615c the
//    runtime could still create them (`openPluginsTab` / `openSettingsTab`), and a downgrade to such a build may too.
//    `activeNoteId` is NOT moved: the note list copes with an id that points to no note (shows the first note).
// 2. The persisted `settingsWorkspaceViewMode` (view mode of the deleted Settings panel) is deleted.
//
// Raw backup: before anything changes, the removed notes (with their original index) and the deleted view mode are copied into
// `legacyBackup.cleanupV30` (or the first free slot `cleanupV30#2`, `#3`, ...):
// `{ top?: [{index, note}], globalNotes?: [{index, note}], workspaces?: [{index, id, removed}], settingsWorkspaceViewMode?: value }`.
// When that backup cannot be written (legacyBackup is not an object, every slot is taken, the entry is too large or cannot be
// cloned) NOTHING is changed. Idempotent: a second run finds nothing to clean and writes no backup entry.

import { isFakeNoteV28 } from './v28';

type Loose = Record<string, unknown>;

export const BACKUP_KEY_V30 = 'cleanupV30';
export const VIEW_MODE_KEY_V30 = 'settingsWorkspaceViewMode';
const MAX_BACKUP_SLOTS = 10;
export const MAX_BACKUP_CHARS_V30 = 1024 * 1024;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

interface Removed {
    index: number;
    note: unknown;
}

interface ListPlan {
    holder: Loose;
    key: 'notes' | 'globalNotes';
    kept: unknown[];
    removed: Removed[];
}

function planList(holder: Loose, key: 'notes' | 'globalNotes'): ListPlan | null {
    const list = holder[key];
    if (!Array.isArray(list)) return null;
    const kept: unknown[] = [];
    const removed: Removed[] = [];
    list.forEach((note, index) => {
        if (isFakeNoteV28(note)) removed.push({ index, note });
        else kept.push(note);
    });
    return removed.length > 0 ? { holder, key, kept, removed } : null;
}

function freeSlot(state: Loose): string | null {
    if (hasOwn(state, 'legacyBackup') && state.legacyBackup !== undefined && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V30 : `${BACKUP_KEY_V30}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

/** The whole v30 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV30(state: unknown): void {
    if (!isObject(state)) return;
    const top = planList(state, 'notes');
    const globalNotes = planList(state, 'globalNotes');
    const workspaces: { index: number; id: unknown; plan: ListPlan }[] = [];
    if (Array.isArray(state.workspaces)) {
        state.workspaces.forEach((ws, index) => {
            if (!isObject(ws) || !isObject(ws.isolatedData)) return;
            const plan = planList(ws.isolatedData, 'notes');
            if (plan) workspaces.push({ index, id: ws.id, plan });
        });
    }
    const hasViewMode = hasOwn(state, VIEW_MODE_KEY_V30);
    if (!top && !globalNotes && workspaces.length === 0 && !hasViewMode) return;

    const entry: Loose = {};
    if (top) entry.top = top.removed;
    if (globalNotes) entry.globalNotes = globalNotes.removed;
    if (workspaces.length > 0) entry.workspaces = workspaces.map((w) => ({ index: w.index, id: w.id, removed: w.plan.removed }));
    if (hasViewMode) entry[VIEW_MODE_KEY_V30] = state[VIEW_MODE_KEY_V30];

    const slot = freeSlot(state);
    if (slot === null) return;
    let clone: Loose;
    try {
        const text = JSON.stringify(entry);
        if (text === undefined || text.length > MAX_BACKUP_CHARS_V30) return;
        clone = structuredClone(entry);
    } catch {
        return;
    }
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone };

    for (const plan of [top, globalNotes, ...workspaces.map((w) => w.plan)]) {
        if (plan) plan.holder[plan.key] = plan.kept;
    }
    if (hasViewMode) delete state[VIEW_MODE_KEY_V30];
}
