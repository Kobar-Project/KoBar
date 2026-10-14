// kobar-storage v26 -> v27 (T-602: density).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file. The mapping is
// deliberately copied here instead of imported from src/store/density.ts, which may change later.
//
// v27 adds one persisted field; the v1 fields stay and keep their values (plugins read
// `sidebarWidth`, `iconScale`, `featureSpacing`, `toggleWidth` and `isPopupSmartPositioning`, and a 1.2.x downgrade
// still reads them):
// - `density` (top level and every workspace record, per workspace like `sidebarWidth` today): from the profile's
//   `sidebarWidth`, the bar thickness that `--kb-bar-thickness` (40 / 48 / 56 px) replaces. Thresholds:
//   `sidebarWidth < 44` -> 'compact', `44..52` -> 'normal' (the old default 46 lands here), `> 52` -> 'comfortable'.
//   A missing, non-numeric, non-finite or implausible width (outside 10..1000, the settings import range) -> 'normal'
//   (the store fell back to 46 for a missing width, which is 'normal' too).
//   `iconScale`, `featureSpacing` and `toggleWidth` do not decide the density: they have no density counterpart (icon
//   size, gap between bar items and the note notch are fixed per density), so any rule mixing them in would be
//   a guess; they are not read and keep their values.
// - `isPopupSmartPositioning`: the new shell always places popups smartly, so v1 plugins read `true`. A present value
//   that is not `true` (false or garbage) is replaced by `true` after a raw backup. A missing value is not added (the
//   store default and the workspace-load fallback are `true` since v27).
// Present valid v27 values are kept. A present foreign `density` (no released version wrote it) is replaced after a raw
// backup.
// Raw backup: every value v27 replaces is first copied into `legacyBackup.densityV27` (or the first free slot
// `densityV27#2`, `#3`, ...): `{ top?: { values }, workspaces?: [{ index, id, values }] }`.
// The pre-v27 state is rebuilt by deleting `density` (top level and records) and restoring `values`.
// When that backup cannot be written (legacyBackup is not an object, every slot is taken, the entry cannot be cloned or
// is too large) nothing is replaced here; only the missing `density` keys are added.
// Notes, isolatedData, plugin data, workspace ids/names and every other field are never touched.
// Idempotent: a second run finds valid v27 values and writes no backup entry.

type Loose = Record<string, unknown>;

export const DENSITIES_V27 = ['compact', 'normal', 'comfortable'] as const;
export type DensityV27 = (typeof DENSITIES_V27)[number];

/** Density for a missing or invalid width (the default). */
export const DEFAULT_DENSITY_V27: DensityV27 = 'normal';
/** `sidebarWidth` below this is 'compact'. */
export const COMPACT_BELOW_V27 = 44;
/** `sidebarWidth` above this is 'comfortable'. */
export const COMFORTABLE_ABOVE_V27 = 52;
/** Plausible `sidebarWidth` range (the settings import schema, `num(10, 1000)`); anything else counts as invalid. */
const MIN_PLAUSIBLE_WIDTH_V27 = 10;
const MAX_PLAUSIBLE_WIDTH_V27 = 1000;

export const BACKUP_KEY_V27 = 'densityV27';
const MAX_BACKUP_SLOTS = 10;
/** Upper bound for one backup entry, measured as JSON text (the values are short; this only stops garbage). */
export const MAX_BACKUP_CHARS_V27 = 64 * 1024;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOwn = (obj: Loose, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const isPresent = (obj: Loose, key: string) => hasOwn(obj, key) && obj[key] !== undefined;
const isDensityV27 = (value: unknown): value is DensityV27 =>
    typeof value === 'string' && (DENSITIES_V27 as readonly string[]).includes(value);

/** Density for a stored `sidebarWidth` (missing or invalid -> 'normal'). */
export function densityFromSidebarWidthV27(sidebarWidth: unknown): DensityV27 {
    if (typeof sidebarWidth !== 'number' || !Number.isFinite(sidebarWidth)) return DEFAULT_DENSITY_V27;
    if (sidebarWidth < MIN_PLAUSIBLE_WIDTH_V27 || sidebarWidth > MAX_PLAUSIBLE_WIDTH_V27) return DEFAULT_DENSITY_V27;
    if (sidebarWidth < COMPACT_BELOW_V27) return 'compact';
    if (sidebarWidth > COMFORTABLE_ABOVE_V27) return 'comfortable';
    return 'normal';
}

interface Op {
    holder: Loose;
    key: string;
    next: unknown;
    /** True when an existing value is replaced (needs a raw backup). */
    overwrite: boolean;
    /** null = top level, otherwise the workspace index. */
    group: number | null;
}

function planProfile(holder: Loose, group: number | null, ops: Op[], allowOverwrite: boolean): void {
    const densityPresent = isPresent(holder, 'density');
    if (!isDensityV27(holder.density) && (!densityPresent || allowOverwrite)) {
        ops.push({ holder, key: 'density', next: densityFromSidebarWidthV27(holder.sidebarWidth), overwrite: densityPresent, group });
    }
    if (allowOverwrite && isPresent(holder, 'isPopupSmartPositioning') && holder.isPopupSmartPositioning !== true) {
        ops.push({ holder, key: 'isPopupSmartPositioning', next: true, overwrite: true, group });
    }
}

function buildPlan(state: Loose, allowOverwrite: boolean): Op[] {
    const ops: Op[] = [];
    planProfile(state, null, ops, allowOverwrite);
    if (Array.isArray(state.workspaces)) {
        state.workspaces.forEach((ws, index) => {
            if (isObject(ws)) planProfile(ws, index, ops, allowOverwrite);
        });
    }
    return ops;
}

interface BackupEntry {
    top?: { values: Loose };
    workspaces?: { index: number; id: unknown; values: Loose }[];
}

function buildEntry(ops: Op[]): BackupEntry {
    const entry: BackupEntry = {};
    const byIndex = new Map<number, { index: number; id: unknown; values: Loose }>();
    for (const op of ops) {
        if (!op.overwrite) continue;
        const before = op.holder[op.key];
        if (op.group === null) {
            if (!entry.top) entry.top = { values: {} };
            entry.top.values[op.key] = before;
        } else {
            let item = byIndex.get(op.group);
            if (!item) {
                item = { index: op.group, id: op.holder.id, values: {} };
                byIndex.set(op.group, item);
            }
            item.values[op.key] = before;
        }
    }
    if (byIndex.size > 0) entry.workspaces = [...byIndex.values()].sort((a, b) => a.index - b.index);
    return entry;
}

/** The first free backup slot name, or null when legacyBackup cannot hold another entry. */
function freeBackupSlot(state: Loose): string | null {
    if (isPresent(state, 'legacyBackup') && !isObject(state.legacyBackup)) return null;
    const backup: Loose = isObject(state.legacyBackup) ? state.legacyBackup : {};
    for (let n = 1; n <= MAX_BACKUP_SLOTS; n++) {
        const slot = n === 1 ? BACKUP_KEY_V27 : `${BACKUP_KEY_V27}#${n}`;
        if (!hasOwn(backup, slot)) return slot;
    }
    return null;
}

function backupClone(value: BackupEntry): { ok: true; value: BackupEntry } | { ok: false } {
    try {
        const text = JSON.stringify(value);
        if (text === undefined || text.length > MAX_BACKUP_CHARS_V27) return { ok: false };
        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false };
    }
}

/** Writes the backup entry for the overwriting ops; false when it cannot be written safely. */
function writeBackup(state: Loose, ops: Op[]): boolean {
    const slot = freeBackupSlot(state);
    if (slot === null) return false;
    const clone = backupClone(buildEntry(ops));
    if (!clone.ok) return false;
    const existing = isObject(state.legacyBackup) ? state.legacyBackup : {};
    state.legacyBackup = { ...existing, [slot]: clone.value };
    return true;
}

function applyOps(ops: Op[]): void {
    for (const op of ops) op.holder[op.key] = op.next;
}

/** The whole v27 block. Mutates `state` in place like the older blocks; does nothing for a non-object state. */
export function migrateToV27(state: unknown): void {
    if (!isObject(state)) return;
    const ops = buildPlan(state, true);
    if (!ops.some((op) => op.overwrite)) {
        applyOps(ops);
        return;
    }
    // Backup first (verified copy of the raw values), then the changes; without a safe backup only the additions.
    if (writeBackup(state, ops)) applyOps(ops);
    else applyOps(buildPlan(state, false));
}
