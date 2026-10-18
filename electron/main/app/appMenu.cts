// MAC-014: the macOS application menu (About, Settings Cmd+, , Hide, Quit, the Edit roles that make Cmd+C/V/X/A/Z work in text
// inputs, Close Window). KoBar is an agent app so the menu bar is not shown, but the key equivalents stay active. Windows / Linux:
// returns immediately and touches no menu (Windows keeps having no application menu). Dev-only View menu (reload, DevTools) is
// built only when the app is not packaged; packaged builds have no reload or DevTools item at all.
import { app, BrowserWindow, Menu } from 'electron';
import { buildMacMenuTemplate } from '../../lib/appMenuTemplate.cjs';
import { MAIN_STRINGS, normalizeLanguage, type MainLang } from '../../lib/mainStrings.cjs';
import { isMac } from '../platform.cjs';
import { appState } from '../state.cjs';
import { openSettingsWindow } from '../windows/settingsWindow.cjs';

function applyMenu(lang: MainLang): void {
    const template = buildMacMenuTemplate({
        strings: MAIN_STRINGS[normalizeLanguage(lang)],
        isDev: !app.isPackaged,
        onOpenSettings: () => {
            void openSettingsWindow();
        },
        onCloseWindow: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed() && win !== appState.mainWindow) win.close();
        },
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]));
}

export function installMacAppMenu(getUiLanguage: () => Promise<MainLang>): void {
    if (!isMac) return;
    applyMenu('en');
    // Same pattern as the tray: the saved UI language is read asynchronously, then the localised menu replaces the English one.
    void getUiLanguage()
        .then((lang) => applyMenu(lang))
        .catch(() => undefined);
}
