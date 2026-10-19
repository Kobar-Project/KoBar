// T-315: the small shared helpers that used to sit in the middle of main.cts, moved unchanged: the cached UI language, the single
// confirmation dialog gate, the external-URL gate, the main-window sender check and the protected app folders. The two pieces of live
// state (`uiLanguageCache`, `confirmInFlight`) are module-level here, so there is exactly one instance of each.
import { app, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { type ExternalDecision, classifyExternalUrl, describeUrlForDialog, truncateForDialog } from '../../lib/external.cjs';
import { pickDialogParent } from '../../lib/dialogParent.cjs';
import { type MainLang, normalizeLanguage, parseLanguage, t } from '../../lib/mainStrings.cjs';
// MAC-019: the query is shown in the confirm dialog on macOS only (Windows text unchanged).
import { isMac } from '../platform.cjs';
import { resolvePhysicalPath } from '../lib/physicalPath.cjs';
import { appState } from '../state.cjs';

// UI language for native dialogs and notices. The renderer owns it (zustand store, documented global
// window.useAppStore); main reads it on demand, caches it briefly, and falls back to the OS locale, then English.
// Only a supported language code can come out of parseLanguage, so a spoofed value cannot inject text.
const UI_LANGUAGE_CACHE_MS = 5000;
const UI_LANGUAGE_READ_TIMEOUT_MS = 800;
let uiLanguageCache: { lang: MainLang; at: number } | null = null;

export async function getUiLanguage(): Promise<MainLang> {
    if (uiLanguageCache && Date.now() - uiLanguageCache.at < UI_LANGUAGE_CACHE_MS) return uiLanguageCache.lang;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
            const raw: unknown = await Promise.race([
                appState.mainWindow.webContents.executeJavaScript('window.useAppStore && window.useAppStore.getState().language'),
                new Promise<undefined>((resolve) => {
                    timer = setTimeout(() => resolve(undefined), UI_LANGUAGE_READ_TIMEOUT_MS);
                }),
            ]);
            const lang = parseLanguage(raw);
            if (lang) {
                uiLanguageCache = { lang, at: Date.now() };
                return lang;
            }
        }
    } catch (e) {
        console.error('Could not read the UI language:', e);
    } finally {
        if (timer) clearTimeout(timer);
    }
    return normalizeLanguage(app.getLocale());
}

// MAC-033: parent for native dialogs. macOS: the focused Settings window (so the sheet is not hidden behind it), else the main window.
export function currentDialogParent(): Electron.BrowserWindow | null {
    return pickDialogParent({ isMac, mainWindow: appState.mainWindow, settingsWindow: appState.settingsWindow });
}

// True while a confirmation dialog is open, so a misbehaving plugin cannot pile dialogs up.
let confirmInFlight = false;

/** Live read of `confirmInFlight` (never a copy), for the plugin confirmation. */
export function isConfirmInFlight(): boolean {
    return confirmInFlight;
}

// Asks the user before KoBar does something an untrusted caller requested. Defaults to Cancel.
// Further confirm-class requests are refused (not queued) while one dialog is open.
// `message`, `detail` and `confirmLabel` come from lib/mainStrings (already localised); the Cancel label is localised here.
export async function confirmWithUser(message: string, detail?: string, confirmLabel?: string): Promise<boolean> {
    if (confirmInFlight) {
        console.error('Confirmation refused: another confirmation dialog is already open.');
        return false;
    }
    confirmInFlight = true;
    try {
        const lang = await getUiLanguage();
        const options: Electron.MessageBoxOptions = {
            type: 'warning',
            title: 'KoBar',
            message,
            detail,
            buttons: [confirmLabel ?? t(lang, 'open'), t(lang, 'cancel')],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
        };
        const parent = currentDialogParent();
        const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
        return result.response === 0;
    } finally {
        confirmInFlight = false;
    }
}

// Single gate for every address a renderer/plugin asks the OS to open (see electron/lib/external.cts).
// `decision` may be passed when the caller already classified the same string.
export async function openExternalChecked(raw: unknown, decision: ExternalDecision = classifyExternalUrl(raw)): Promise<void> {
    try {
        if (decision.kind === 'deny') {
            console.error('Blocked external URL:', decision.reason);
            return;
        }
        if (decision.kind === 'confirm') {
            const lang = await getUiLanguage();
            const message = t(lang, 'openAddress', { target: describeUrlForDialog(decision.url, isMac ? 240 : 120, isMac) });
            const detail = truncateForDialog(decision.url.href, 200) + '\n\n' + t(lang, 'onlyContinueIfTrust');
            if (!(await confirmWithUser(message, detail))) return;
        }
        await shell.openExternal(decision.url.href);
    } catch (e) {
        console.error('Failed to open external URL:', e);
    }
}

// Only the main window's top frame may call the full-backup / restore channels (and the `main-window-top-frame` sender policy).
export function isMainWindowTopFrame(event: Electron.IpcMainInvokeEvent): boolean {
    return (
        !!appState.mainWindow &&
        !appState.mainWindow.isDestroyed() &&
        event.sender === appState.mainWindow.webContents &&
        event.senderFrame === appState.mainWindow.webContents.mainFrame
    );
}

// T-606: the `settings-window-top-frame` sender policy (the Settings window's state-sync channels). Never true for the main window.
export function isSettingsWindowTopFrame(event: Electron.IpcMainInvokeEvent): boolean {
    const win = appState.settingsWindow;
    return !!win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
}

// App-owned folders that renderer-supplied paths must not read from, copy out of or write into
// (SEC-02). Includes the MSIX physical location of userData for the Store build. KoBox is the
// one user-facing exception for reads/writes (users drag files out of it into AI Hub, or save there).
export function getProtectedAppRoots(): string[] {
    const userData = app.getPath('userData');
    const roots = [userData, path.join(userData, 'extensions'), resolvePhysicalPath(userData)];
    return Array.from(new Set(roots));
}

// KoBox as the renderer sees it plus its MSIX physical location (kobox-open opens the latter).
export function createGetKoBoxRoots(koBoxPath: string): () => string[] {
    return function getKoBoxRoots(): string[] {
        return Array.from(new Set([koBoxPath, resolvePhysicalPath(koBoxPath)]));
    };
}

export function registerOpenExternalIpc(): void {
    ipcMain.on('open-external', (_event, url: string) => {
        void openExternalChecked(url);
    });
}
