// T-307: auto-launch at system startup (login item), moved unchanged out of main.cts. `isDev` and the two UI helpers that still live
// in main.cts are injected; nothing is read from main.cts state.
import { app, ipcMain } from 'electron';
import { type MainLang, t } from '../../lib/mainStrings.cjs';

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
function loginItemOptions(): Electron.LoginItemSettingsOptions {
    if (process.windowsStore || process.platform !== 'win32') return {};
    return { path: `"${process.execPath}"`, args: ['--hidden'] };
}

export function registerAutoLaunchIpc(deps: AutoLaunchDeps) {
    const { isDev, getUiLanguage, confirmWithUser } = deps;

    ipcMain.handle('get-auto-launch', () => {
        return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
    });

    ipcMain.on('set-auto-launch', async (_event, requested: unknown) => {
        if (isDev || typeof requested !== 'boolean') {
            return;
        }
        // No change requested: nothing to ask, nothing to do.
        if (app.getLoginItemSettings(loginItemOptions()).openAtLogin === requested) return;
        // Turning it ON changes system startup behavior, so the user confirms it natively (SEC-18).
        // On Cancel the OS state is unchanged; the Settings panel re-syncs its toggle via get-auto-launch after a toggle.
        if (requested) {
            const lang = await getUiLanguage();
            if (!(await confirmWithUser(t(lang, 'enableAutoLaunch'), undefined, t(lang, 'enable')))) return;
        }
        app.setLoginItemSettings({ openAtLogin: requested, ...loginItemOptions() });
    });
}
