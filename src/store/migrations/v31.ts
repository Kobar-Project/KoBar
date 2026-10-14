// kobar-storage v30 -> v31 (R-11: resizable note list column).
// Pure: no store/window imports; never throws on garbage.
// Frozen once released: later behaviour changes go into a new version block, never into this file.
//
// v31 adds one optional persisted top-level field, `noteListWidth` (px). No released version wrote it, so a missing key is
// left missing (the store default 192 applies, which equals the former fixed column width). Only a key that is already
// present is normalized: a finite number is rounded and clamped to 160..420, anything else is deleted (-> default).
// The values are cosmetic, so no `legacyBackup` entry is written. Notes, workspaces and every other field are never touched.
// A 1.2.x / v30 downgrade drops the field on its first write (it is not in their partialize); nothing else is lost.
// Idempotent. The bounds are copied here on purpose instead of imported from src/notes/noteListWidth.ts.

const MIN_V31 = 160;
const MAX_V31 = 420;
export const NOTE_LIST_WIDTH_KEY_V31 = 'noteListWidth';

export function migrateToV31(state: unknown): void {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return;
    const record = state as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, NOTE_LIST_WIDTH_KEY_V31)) return;
    const value = record[NOTE_LIST_WIDTH_KEY_V31];
    if (typeof value === 'number' && Number.isFinite(value)) {
        record[NOTE_LIST_WIDTH_KEY_V31] = Math.min(MAX_V31, Math.max(MIN_V31, Math.round(value)));
    } else {
        delete record[NOTE_LIST_WIDTH_KEY_V31];
    }
}
