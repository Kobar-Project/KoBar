// T-306: state shared between the window modules (electron/main/windows/*, tray.cts) and the code that still lives in main.cts.
// One typed, mutable object instead of module-level `let`s: every reader goes through `appState.<field>` at the moment it needs the
// value, so nobody ever holds a stale copy of a window reference. Nothing here is persisted.
import type { BrowserWindow } from 'electron';

export interface AppState {
    /** The sidebar's frameless, transparent main window. Null until createWindow() ran. */
    mainWindow: BrowserWindow | null;
    /** The Picture-in-Picture video window. Null while none is open. */
    pipWindow: BrowserWindow | null;
    /** T-605: the Settings window (a normal framed window). Null while none is open. */
    settingsWindow: BrowserWindow | null;
    /** True between "pin a window" being requested and the main window losing focus to the target (set in services/pin.cts). */
    isAwaitingPinTarget: boolean;
}

export const appState: AppState = {
    mainWindow: null,
    pipWindow: null,
    settingsWindow: null,
    isAwaitingPinTarget: false,
};
