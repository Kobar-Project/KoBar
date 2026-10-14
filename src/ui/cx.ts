/** Joins class names, skipping falsy values. Primitives only; keeps every class literal visible to Tailwind. */
export function cx(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}

/**
 * Shared interaction classes for primitives: clickable inside the frameless window's
 * drag regions and the pointer-events-none overlay root, keyboard focus ring via --kb-focus-ring (no ring on click).
 */
export const INTERACTIVE =
    'no-drag-region pointer-events-auto select-none focus-visible:outline-hidden focus-visible:shadow-[var(--kb-focus-ring)]';
