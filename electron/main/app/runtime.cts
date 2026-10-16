// T-315: process-level setup that used to open main.cts, moved unchanged and split into the calls main.cts makes in the same order:
// the runtime facts, the dev userData redirect, the Chromium switches and the app identity + single instance lock.
// `redirectDevUserData` must run before anything reads app.getPath('userData') (see electron/main.cts).
import { app } from 'electron';
import * as path from 'path';
import type { AppPaths } from '../lib/appPaths.cjs';
import { appState } from '../state.cjs';
import { queueOpenFileArgs } from '../services/openWithFile.cjs';
import { teleportToPrimaryCenter } from '../windows/mainWindow.cjs';

export interface RuntimeEnv {
    readonly isWin: boolean;
    readonly isDev: boolean;
    /** Every path derived from the bundle directory (T-305). */
    readonly appPaths: AppPaths;
    /** Dev-only: load the built dist/*.html via file:// instead of the Vite dev server. */
    readonly loadsFromDist: boolean;
}

/** `appPaths` is built by main.cts from its own `__dirname` (dist-electron after the esbuild bundle), see lib/appPaths.cts. */
export function createRuntimeEnv(appPaths: AppPaths): RuntimeEnv {
    const isWin = process.platform === 'win32';
    const isDev = !app.isPackaged;
    // Dev-only: load the built dist/*.html via file:// instead of the Vite dev server. Enabled by the T-131 CSP diagnostic variant
    // (KOBAR_CSP_REPORT=file, see setupCspDiagnostics) or by KOBAR_E2E_LOAD_DIST=1 (T-104 e2e smoke test; no CSP diagnostics).
    const loadsFromDist = isDev && (process.env.KOBAR_CSP_REPORT === 'file' || process.env.KOBAR_E2E_LOAD_DIST === '1');
    return { isWin, isDev, appPaths, loadsFromDist };
}

export function redirectDevUserData(env: RuntimeEnv): void {
    const { isDev } = env;
    if (isDev) {
        app.setName('KoBarDev');
        // T-104: an explicit --user-data-dir (e.g. the e2e smoke test's temp fixture profile) wins over the KoBarDev redirect,
        // so test runs never touch the developer's real dev profile. Dev-only; packaged builds are unaffected.
        const explicitUserData = app.commandLine.getSwitchValue('user-data-dir');
        if (!explicitUserData || !path.isAbsolute(explicitUserData)) {
            app.setPath('userData', path.join(app.getPath('appData'), 'KoBarDev'));
        }
    }
}

export function applyChromiumSwitches(): void {
    // GPU is MANDATORY for transparent windows in modern Electron.
    // Any attempt to disable it results in an invisible (black) window.
    console.log('[SYS] Hardware Acceleration: FORCED ENABLED');

    // SURGICAL FIX FOR VIDEO BLACKOUT & OCCLUSION
    app.commandLine.appendSwitch(
        'disable-features',
        'CalculateNativeWinOcclusion,WindowOcclusion,HardwareMediaKeyHandling,MediaSessionService'
    );
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

export function claimSingleInstance(env: RuntimeEnv): void {
    const { isDev } = env;
    // Set Application User Model ID to fix Windows Taskbar, Notifications, and Task Manager Startup icons
    const AUMID = isDev ? 'com.eedali.kobar.dev' : 'com.eedali.kobar';
    app.setAppUserModelId(AUMID);

    // Single Instance Lock
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
        app.quit();
    } else {
        app.on('second-instance', (_event, argv) => {
            // "Open with KoBar": a .txt file passed to the second instance becomes a note in this one.
            void queueOpenFileArgs(argv);
            // Someone tried to run a second instance, we should focus our window.
            if (appState.mainWindow) {
                // Teleport to primary display center instead of just showing
                teleportToPrimaryCenter();
            }
        });
    }
}
