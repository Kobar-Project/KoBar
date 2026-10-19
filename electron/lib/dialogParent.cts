// MAC-033: which window a native dialog (message box, open/save dialog) should be attached to. Pure, no Electron import.
// On macOS a parented dialog is a sheet on that window; the Settings window is raised above the (floating) bar window, so a sheet on
// the bar would be hidden behind Settings. Everywhere else the parent stays the main window, exactly as before.

export interface DialogWindowLike {
    isDestroyed(): boolean;
    isVisible(): boolean;
    isFocused(): boolean;
}

export function pickDialogParent<T extends DialogWindowLike>(args: {
    isMac: boolean;
    mainWindow: T | null | undefined;
    settingsWindow: T | null | undefined;
}): T | null {
    const { isMac, mainWindow, settingsWindow } = args;
    if (isMac && settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible() && settingsWindow.isFocused()) {
        return settingsWindow;
    }
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    return null;
}
