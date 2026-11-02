// MAC-033: which window a native dialog (message box, open/save dialog) should be attached to. Pure, no Electron import.
// On macOS a parented dialog is a sheet on that window; the Settings window is raised above the (floating) bar window, so a sheet on
// the bar would be hidden behind Settings. CNL: the same happens on Windows (a dialog parented to the bar opened behind Settings),
// so a focused, visible Settings window is the parent everywhere; otherwise the main window, as before.

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
    // CNL: on every platform (was macOS only): a dialog the owner triggers from Settings must open in front of it, not behind it.
    void isMac;
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible() && settingsWindow.isFocused()) {
        return settingsWindow;
    }
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
    return null;
}
