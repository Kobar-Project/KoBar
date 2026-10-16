// T-307: auto-launch at system startup (login item), moved unchanged out of main.cts. `isDev` and the two UI helpers that still live
// in main.cts are injected; nothing is read from main.cts state.
import { app, ipcMain } from 'electron';
import { type MainLang, t } from '../../lib/mainStrings.cjs';
import { type AutoLaunchSyncResult, type LoginItem, syncAutoLaunch } from '../../lib/autoLaunchSync.cjs';
import { appState } from '../state.cjs';

export interface AutoLaunchDeps {
    isDev: boolean;
    getUiLanguage(): Promise<MainLang>;
    confirmWithUser(message: string, detail?: string, confirmLabel?: string): Promise<boolean>;
}

// Auto-launch at system startup
// Query/set options must match what is written to the Run key, otherwise openAtLogin reads false on NSIS builds.
// NSIS builds write the quoted exe path plus --hidden (the quoted path also fixes the generic Task Manager icon).
// AppX (Store) builds pass no path/args, so Electron still reads/writes the HKCU Run key. The Store package's own
// StartupTask (build.appx.addAutoLaunchExtension) is NOT controlled or reported by this toggle: the Store build hides
// the toggle in Settings and points users to Windows Settings > Apps > Startup (T-139; implementing the StartupTask
// API is a follow-up).
// Source of truth (T-139): the OS login-item state. The persisted `launchAtStartup` default is deliberately NOT pushed
// to the OS at startup (no surprise registry writes); the OS changes only when the user flips the toggle here.
// The Run value name. It equals the AppUserModelId (electron's default value name), so entries written by 1.4.x stay valid.
export const AUTO_LAUNCH_NAME = 'com.eedali.kobar';
// T-1.4.3: the persisted setting is reconciled with the real Run/StartupApproved state on every start (`sync-auto-launch`):
// stale entries from an older install path or the old `electron.app.KoBar` value name are removed and ours is (re)written, and
// a switch-off in Task Manager > Startup apps is respected (the setting follows it). The old "never push at startup" rule of
// T-139 is replaced because it left upgraded users with a toggle that showed ON while Windows started nothing.
function loginItemOptions(): Electron.LoginItemSettingsOptions {
    if (process.windowsStore || process.platform !== 'win32') return {};
    return { path: `"${process.execPath}"`, args: ['--hidden'] };
}

function currentItems(): LoginItem[] {
    return app.getLoginItemSettings().launchItems ?? [];
}

/** The real state: our Run value exists and Windows has not switched it off. */
function readEnabled(): boolean {
    const own = currentItems().find((i) => i.name.toLowerCase() === AUTO_LAUNCH_NAME);
    return own !== undefined && own.enabled;
}

/** `explicit`: the user just flipped the toggle, so a Task Manager switch-off no longer wins. */
export function reconcileAutoLaunch(desired: boolean, explicit = false): AutoLaunchSyncResult {
    const args = loginItemOptions().args ?? [];
    return syncAutoLaunch({
        desired,
        explicit,
        items: currentItems(),
        name: AUTO_LAUNCH_NAME,
        execPath: process.execPath,
        args,
        register: () =>
            app.setLoginItemSettings({ openAtLogin: true, enabled: true, name: AUTO_LAUNCH_NAME, path: `"${process.execPath}"`, args }),
        remove: (name) => app.setLoginItemSettings({ openAtLogin: false, name }),
    });
}

function readEnabledAny(): boolean {
    if (process.windowsStore || process.platform !== 'win32') return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
    return readEnabled();
}

export function registerAutoLaunchIpc(deps: AutoLaunchDeps) {
    const { isDev, getUiLanguage, confirmWithUser } = deps;

    ipcMain.handle('get-auto-launch', () => {
        if (process.windowsStore || process.platform !== 'win32') return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
        return readEnabled();
    });

    // Called once per start by the main window with the persisted setting; answers what the setting should show. Only the first call
    // counts (the host calls it before plugin scripts are injected), so a plugin cannot use it to enable auto-launch unasked.
    let syncUsed = false;
    ipcMain.handle('sync-auto-launch', (event, desired: unknown): { enabled: boolean } | null => {
        const win = appState.mainWindow;
        if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return null;
        if (typeof desired !== 'boolean' || syncUsed) return null;
        syncUsed = true;
        // Dev, Store (StartupTask, not the Run key) and non-Windows builds are not reconciled.
        if (isDev || process.windowsStore || process.platform !== 'win32') return { enabled: desired };
        try {
            const result = reconcileAutoLaunch(desired);
            if (result.action !== 'none') console.log('[KoBar] auto-launch sync:', result.action, result.removedStale);
            return { enabled: result.enabled };
        } catch (err) {
            console.error('[KoBar] auto-launch sync failed:', err);
            return { enabled: desired };
        }
    });

    ipcMain.on('set-auto-launch', async (_event, requested: unknown) => {
        if (isDev || typeof requested !== 'boolean') {
            return;
        }
        // No change requested: nothing to ask, nothing to do.
        if (readEnabledAny() === requested) return;
        // Turning it ON changes system startup behavior, so the user confirms it natively (SEC-18).
        // On Cancel the OS state is unchanged; the Settings panel re-syncs its toggle via get-auto-launch after a toggle.
        if (requested) {
            const lang = await getUiLanguage();
            if (!(await confirmWithUser(t(lang, 'enableAutoLaunch'), undefined, t(lang, 'enable')))) return;
        }
        if (process.windowsStore || process.platform !== 'win32') {
            app.setLoginItemSettings({ openAtLogin: requested, ...loginItemOptions() });
        } else {
            reconcileAutoLaunch(requested, true);
        }
    });
}
