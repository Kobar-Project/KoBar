// R-11: width of the note list column (the draggable divider between the list and the editor).
// Pure helpers shared by the store, the migration guard and the resizer; no store/window imports.

export const NOTE_LIST_WIDTH_MIN = 160;
export const NOTE_LIST_WIDTH_MAX = 420;
/** Equals the former fixed `w-48` column. */
export const NOTE_LIST_WIDTH_DEFAULT = 192;
/** Keyboard step of the separator (arrow keys). */
export const NOTE_LIST_WIDTH_STEP = 16;

/** Rounds and clamps to [MIN, MAX]; anything that is not a finite number falls back to the default. */
export function clampNoteListWidth(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return NOTE_LIST_WIDTH_DEFAULT;
    return Math.min(NOTE_LIST_WIDTH_MAX, Math.max(NOTE_LIST_WIDTH_MIN, Math.round(value)));
}

/**
 * Width after a key press on the separator, or `null` when the key is not handled. `rtl` flips the arrow keys because
 * the list sits at the inline start of the panel.
 */
export function noteListWidthForKey(key: string, width: number, rtl = false): number | null {
    const grow = rtl ? 'ArrowLeft' : 'ArrowRight';
    const shrink = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === grow) return clampNoteListWidth(width + NOTE_LIST_WIDTH_STEP);
    if (key === shrink) return clampNoteListWidth(width - NOTE_LIST_WIDTH_STEP);
    if (key === 'Home') return NOTE_LIST_WIDTH_MIN;
    if (key === 'End') return NOTE_LIST_WIDTH_MAX;
    return null;
}
