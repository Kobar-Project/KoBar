// Global paste mode decisions (T-037). Pure logic, unit tested in tests/globalPaste.test.ts. The paste flow itself (R4) is the
// state machine in electron/lib/pasteSession.cts.

export type GlobalPasteModeAction = 'enable' | 'disable' | 'ignore';

/**
 * Decides what `set-global-paste-mode` should do. Non-boolean input is ignored, and so is a call that would not
 * change the current mode (no repeated shortcut registration or modifier-key release).
 */
export function decideGlobalPasteMode(currentlyActive: boolean, requested: unknown): GlobalPasteModeAction {
    if (typeof requested !== 'boolean') return 'ignore';
    if (requested === currentlyActive) return 'ignore';
    return requested ? 'enable' : 'disable';
}
