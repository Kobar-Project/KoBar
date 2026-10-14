// kobar-storage v27 -> v28 (T-603: fake notes, PROD-18).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// Up to v27 the Settings and Plugins panels were opened as pseudo-notes inside the notes list (`isSettings: true` /
// `isPlugins: true`, created by `openSettingsTab` / `openPluginsTab`), so they were persisted wherever notes are:
// - the top-level live context: `notes` (+ `activeNoteId`, `nextNoteId`),
// - the shared copy `globalNotes` (no counters),
// - every workspace record's `isolatedData.notes` (+ `isolatedData.activeNoteId`, `isolatedData.nextNoteId`).
// v28 removes them from those three places. Nothing else holds notes in `kobar-storage` (settings exports never carry
// `isolatedData`; `legacyBackup` slots are backups and are never edited).
//
// What counts as a fake note: a plain-object entry whose `isSettings` or `isPlugins` is exactly `true` (the only value any
// released version wrote). Title, icon and content are never looked at, so a real note that merely looks like one stays.
// Entries with any other flag value ('yes', 1, 'false', null ...) are left in place: no released version wrote them, and
// deleting a note because of a garbled flag could drop real content. Non-object entries (null, numbers ...) stay too.
//
// `activeNoteId` of a context that pointed at a removed fake note (the panel was open when the app closed) is moved to
// the first remaining note with a safe-integer id; without one it is left as stored (the store resolves it at runtime).
// `nextNoteId` is never changed (it stays above every remaining id). A context may end up with an empty list: the store
// already handles that (an isolated workspace load falls back to the welcome note; the panel offers "new note").
//
// Raw backup: before anything is removed, the removed entries and the replaced `activeNoteId` are copied into
// `legacyBackup.fakeNotesV28` (or the first free slot `fakeNotesV28#2`, `#3`, ...):
// `{ top?: { removed, values? }, globalNotes?: { removed }, workspaces?: [{ index, id, removed, values? }] }`,
// `removed` = `[{ index, note }]` with the note's position in the ORIGINAL list.
// The pre-v28 state is rebuilt by re-inserting every `note` at its `index` (ascending) and restoring `values`.
// When that backup cannot be written (legacyBackup is not an object, every slot is taken, the entry cannot be cloned or
// is too large) NOTHING is removed: the fake notes are harmless to keep (the runtime still understands them until
// T-615), while removing them without a copy would not be reversible.
// Idempotent: a second run finds no fake note and writes no backup entry.

type Loose = Record<string, unknown>;

export const BACKUP_KEY_V28 = 'fakeNotesV28';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for one backup entry, measured as JSON text (fake notes are empty; this only stops garbage). */
export const MAX_BACKUP_CHARS_V28 = 1024 * 1024;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const isPresent = (obj: Loose, key: string) => hasOwn(obj, key) && obj[key] !== undefined;

/** A pseudo-note of the old Settings / Plugins panels (flag exactly `true`). */
export function isFakeNoteV28(note: unknown): boolean {
    return isObject(note) && (note.isSettings === true || note.isPlugins === true);
}

interface RemovedNote {
    index: number;
    note: unknown;
}

interface ContextPlan {
    holder: Loose;
    listKey: 'notes' | 'globalNotes';
    kept: unknown[];
    removed: RemovedNote[];
    /** Set when `activeNoteId` moves off a removed fake note. */
    active?: { before: unknown; next: number };
}

/** Plans one note context; null when its list holds no fake note. `withActive`: the context has its own `activeNoteId`. */
function planContext(holder: Loose, listKey: 'notes' | 'globalNotes', withActive: boolean): ContextPlan | null {
    const list = holder[listKey];
    if (!Array.isArray(list)) return null;
    const kept: unknown[] = [];
    const removed: RemovedNote[] = [];
    list.forEach((note, index) => {
        if (isFakeNoteV28(note)) removed.push({ index, note });
        else kept.push(note);
    });
    if (removed.length === 0) return null;
    const plan: ContextPlan = { holder, listKey, kept, removed };
    if (withActive && isPresent(holder, 'activeNoteId')) {
        const active = holder.activeNoteId;
        const pointsAtRemoved = removed.some((r) => (r.note as Loose).id === active);
        const pointsAtKept = kept.some((note) => isObject(note) && note.id === active);
        if (pointsAtRemoved && !pointsAtKept) {
            const first = kept.find((note) => isObject(note) && Number.isSafeInteger(note.id)) as Loose | undefined;
            if (first) plan.active = { before: active, next: first.id as number };
        }
    }
    return plan;
}

interface Plan {
    top: ContextPlan | null;
    globalNotes: ContextPlan | null;
    workspaces: { index: number; id: unknown; plan: ContextPlan }[];
}

function buildPlan(state: Loose): Plan {
    const plan: Plan = { top: planContext(state, 'notes', true), globalNotes: planContext(state, 'globalNotes', false), workspaces: [] };
    if (Array.isArray(state.workspaces)) {
        state.workspaces.forEach((ws, index) => {
            if (!isObject(ws) || !isObject(ws.isolatedData)) return;
            const context = planContext(ws.isolatedData, 'notes', true);
            if (context) plan.workspaces.push({ index, id: ws.id, plan: context });
        });
    }
    return plan;
}

const isEmptyPlan = (plan: Plan) => plan.top === null && plan.globalNotes === null && plan.workspaces.length === 0;

interface ContextEntry {
    removed: RemovedNote[];
    values?: { activeNoteId: unknown };
}

interface BackupEntry {
    top?: ContextEntry;
    globalNotes?: { removed: RemovedNote[] };
    workspaces?: ({ index: number; id: unknown } & ContextEntry)[];
}

function contextEntry(plan: ContextPlan): ContextEntry {
    const entry: ContextEntry = { removed: plan.removed };
    if (plan.active) entry.values = { activeNoteId: plan.active.before };
    return entry;
}

function buildEntry(plan: Plan): BackupEntry {
    const entry: BackupEntry = {};
    if (plan.top) entry.top = contextEntry(plan.top);
    if (plan.globalNotes) entry.globalNotes = { removed: plan.globalNotes.removed };
    if (plan.workspaces.length > 0) {
        entry.workspaces = plan.workspaces.map((ws) => ({ index: ws.index, id: ws.id, ...contextEntry(ws.plan) }));
    }
    return entry;
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (isPresent(state, 'legacyBackup') && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V28 : `${BACKUP_KEY_V28}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

function backupClone(value: BackupEntry): { ok: true; value: BackupEntry } | { ok: false } {
    try {
        const text = JSON.stringify(value);
        if (text === undefined || text.length > MAX_BACKUP_CHARS_V28) return { ok: false };
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** Writes the backup entry; false when it cannot be written safely. */
function writeBackup(state: Loose, plan: Plan): boolean {
    const slot = freeBackupSlot(state);
    if (slot === null) return false;
    const clone = backupClone(buildEntry(plan));
    if (!clone.ok) return false;
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone.value };
    return true;
}

function applyContext(plan: ContextPlan): void {
    plan.holder[plan.listKey] = plan.kept;
    if (plan.active) plan.holder.activeNoteId = plan.active.next;
}

/** The whole v28 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV28(state: unknown): void {
    if (!isObject(state)) return;
    const plan = buildPlan(state);
    if (isEmptyPlan(plan)) return;
    // Backup first (verified copy of the removed notes), then the removal; without a safe backup nothing is removed.
    if (!writeBackup(state, plan)) return;
    if (plan.top) applyContext(plan.top);
    if (plan.globalNotes) applyContext(plan.globalNotes);
    for (const ws of plan.workspaces) applyContext(ws.plan);
}
