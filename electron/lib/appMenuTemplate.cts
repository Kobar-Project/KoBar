// MAC-014: the macOS application menu as plain data (no Electron import). Without an explicit menu, Electron installs its default one,
// which offers Reload (Cmd+R) and DevTools (Cmd+Alt+I) in packaged builds; with a custom menu the Edit roles must be present or
// Cmd+C/V/X/A/Z stop working in text inputs. The View menu (reload, DevTools) exists only when `isDev` is true.
import type { MainStringKey } from './mainStrings.cjs';

export type MenuStrings = Readonly<Record<MainStringKey, string>>;

export interface MenuTemplateItem {
    role?: string;
    label?: string;
    type?: 'separator';
    accelerator?: string;
    click?: () => void;
    submenu?: MenuTemplateItem[];
}

export interface MacMenuOptions {
    strings: MenuStrings;
    isDev: boolean;
    onOpenSettings: () => void;
    onCloseWindow: () => void;
}

const SEP: MenuTemplateItem = { type: 'separator' };

export function buildMacMenuTemplate(options: MacMenuOptions): MenuTemplateItem[] {
    const { strings: s, isDev, onOpenSettings, onCloseWindow } = options;
    const template: MenuTemplateItem[] = [
        {
            label: 'KoBar',
            submenu: [
                { role: 'about', label: s.menuAbout },
                SEP,
                { label: s.menuSettings, accelerator: 'Command+,', click: () => onOpenSettings() },
                SEP,
                { role: 'hide', label: s.menuHide },
                { role: 'hideOthers', label: s.menuHideOthers },
                { role: 'unhide', label: s.menuShowAll },
                SEP,
                { role: 'quit', label: s.menuQuit },
            ],
        },
        {
            label: s.menuEdit,
            submenu: [
                { role: 'undo', label: s.menuUndo },
                { role: 'redo', label: s.menuRedo },
                SEP,
                { role: 'cut', label: s.menuCut },
                { role: 'copy', label: s.menuCopy },
                { role: 'paste', label: s.menuPaste },
                { role: 'pasteAndMatchStyle', label: s.menuPasteMatchStyle },
                { role: 'delete', label: s.menuDelete },
                { role: 'selectAll', label: s.menuSelectAll },
            ],
        },
    ];
    if (isDev) {
        template.push({
            label: 'View',
            submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
        });
    }
    // Deliberately no `role: 'close'`: Cmd+W on the focused bar window would close the main window and leave the app without its bar.
    template.push({
        label: s.menuWindow,
        submenu: [{ label: s.menuCloseWindow, accelerator: 'Command+W', click: () => onCloseWindow() }],
    });
    return template;
}
