// T-315: the registration phases of the main process. electron/main.cts is only the ordered list of calls into this file and into
// electron/main/app/*; every phase below contains exactly the statements that used to sit between the same two points of the old
// single-file main.cts, in their old order. The ORDER OF THE CALLS IN main.cts is the contract (tests/mainBootstrap.test.ts pins it).
import { app, ipcMain } from 'electron';
import * as path from 'path';
import { createAsyncLock } from '../lib/asyncLock.cjs';
import { configureNotifications, registerNotificationIpc } from './services/notifications.cjs';
import { initPinBorderStyle, registerPinIpc } from './services/pin.cjs';
import { registerUpdaterIpc } from './services/updater.cjs';
import { registerKoboxIpc } from './services/kobox.cjs';
import { registerFilesIpc } from './services/files.cjs';
import { registerLlmIpc } from './services/llm.cjs';
import { registerAutoLaunchIpc } from './services/autoLaunch.cjs';
import { registerClipboardIpc } from './services/clipboard.cjs';
import { registerGlobalPasteIpc } from './services/globalPaste.cjs';
import { registerScreenshotIpc } from './services/screenshot.cjs';
import { registerPipIpc } from './services/pip.cjs';
import {
    getLastSmtcAlbumArt,
    getLastSmtcSourceAppId,
    registerMediaIpc,
    setMediaPluginProbe,
    updateMediaDemand,
} from './services/media.cjs';
import { psRequest } from './services/native.cjs';
import { registerFullBackupIpc, registerStorageBackupIpc } from './services/backup.cjs';
import { registerNoteExportIpc } from './services/noteExport.cjs';
import { registerStorageIpc } from './services/storage/storageIpc.cjs';
import { registerSecretsIpc } from './services/secrets/secretsIpc.cjs';
import { createGcalServiceForApp, registerGcalIpc } from './services/gcal.cjs';
import { createExtensionsConfig } from './services/extensions/config.cjs';
import { createPluginConfirm } from './services/extensions/confirm.cjs';
import { registerInstalledExtensionsIpc } from './services/extensions/installed.cjs';
import { registerExtensionInstallIpc } from './services/extensions/install.cjs';
import { registerExtensionManagementIpc } from './services/extensions/manage.cjs';
import { createMediaPluginProbe } from './services/extensions/mediaPlugin.cjs';
import { createExtensionOrigins } from './services/extensions/origins.cjs';
import { registerPluginUpdatesIpc } from './services/extensions/update.cjs';
import { registerMouseEventsIpc, registerWindowIpc } from './windows/windowIpc.cjs';
import { registerSettingsWindowIpc } from './windows/settingsWindow.cjs';
import { registerAppControlIpc } from './app/appIpc.cjs';
import type { MainContext } from './app/context.cjs';
import { registerOpenExternalIpc } from './app/helpers.cjs';

/** Startup state that is read once, right after the context exists (needs the dev userData redirect to have run). */
export function configureStartupServices(ctx: MainContext): void {
    const { getUiLanguage } = ctx;
    // T-146 / T-309: pin border colour/width, loaded once at startup (missing/corrupt file -> default); the pin state lives in services/pin.cts.
    initPinBorderStyle(app.getPath('userData'));

    // T-307: build flavor / canSelfUpdate (T-216) live in electron/main/services/updater.cts; the notice rate limiters (T-042) in notifications.cts.
    configureNotifications({ getUiLanguage, iconPath: ctx.appPaths.iconPng });
}

/** hide-app .. send-notification: the app control channels, the storage backup, the updater, note export, pin and notifications. */
export function registerCoreIpc(ctx: MainContext): void {
    const { getUiLanguage, dialogPathsFile } = ctx;

    // IPC listeners
    registerAppControlIpc(ctx);

    // Pre-migration backup of `kobar-storage` (PROD-02, T-201): see services/backup.cts.
    registerStorageBackupIpc();

    // T-403: file-backed store transport (storage-snapshot / storage-write / storage-write-sync), see services/storage/storageIpc.cts.
    registerStorageIpc({ ipcMain, registry: ctx.registry, storage: ctx.storage });

    // T-411: secret-status / secret-set / secret-delete (encrypted with safeStorage; no channel returns a value), see services/secrets/.
    registerSecretsIpc({ registry: ctx.registry, secrets: ctx.secrets });

    // R2-15: Google Calendar v1 (Experimental, read-only, default OFF): gcal-* channels, see services/gcal.cts. Tokens never reach a renderer.
    const gcal = createGcalServiceForApp();
    registerGcalIpc({ registry: ctx.registry, service: gcal });
    void gcal.start();

    // T-307: ask-for-update, download-and-install-update, quit-and-install-update and check-for-updates-manual live in
    // electron/main/services/updater.cts.
    registerUpdaterIpc({ getUiLanguage });

    registerNoteExportIpc({ dialogPathsFile });

    // T-309: enter-pin-targeting, unpin-current-window, unpin-all-windows and get/set-pin-border-style live in electron/main/services/pin.cts.
    registerPinIpc();

    // T-307: the send-notification handler lives in electron/main/services/notifications.cts.
    registerNotificationIpc();
}

/** KoBox, files, LLM proxy, auto-launch and clipboard. */
export function registerFileAccessIpc(ctx: MainContext): void {
    const {
        isDev,
        registry,
        pathGrants,
        koBoxPath,
        notUserSelected,
        getUiLanguage,
        getProtectedAppRoots,
        getKoBoxRoots,
        confirmWithUser,
        openExternalChecked,
    } = ctx;

    // T-312: grant-path, kobox-drop, kobox-open and kobox-clean live in electron/main/services/kobox.cts; parse-file, get-file-icon and
    // launch-file in electron/main/services/files.cts. The paths, grants and dialogs they need are built in app/context.cts and injected.
    registerKoboxIpc({ registry, pathGrants, koBoxPath, notUserSelected, getProtectedAppRoots });
    registerFilesIpc({
        registry,
        pathGrants,
        notUserSelected,
        getUiLanguage,
        getProtectedAppRoots,
        getKoBoxRoots,
        confirmWithUser,
        openExternalChecked,
    });

    // LLM proxy (T-313: llm-request, cancel-llm-request and the AbortController map live in electron/main/services/llm.cts; scheduled for removal in 2.0).
    registerLlmIpc();

    // Auto-launch at system startup (T-307: login-item logic and the two IPC handlers live in electron/main/services/autoLaunch.cts).
    registerAutoLaunchIpc({ isDev, getUiLanguage, confirmWithUser });

    // Clipboard listener and write handlers (T-308: electron/main/services/clipboard.cts).
    registerClipboardIpc();
}

/** set-ignore-mouse-events, global paste, screenshot, PiP and the window / display queries. */
export function registerWindowServicesIpc(ctx: MainContext): void {
    const { registry, pathGrants, notUserSelected, getUiLanguage, getProtectedAppRoots, getKoBoxRoots, windowDeps } = ctx;

    registerMouseEventsIpc();

    // Global paste mode and the paste token (T-308: electron/main/services/globalPaste.cts); the PowerShell bridge is native.cts (T-309).
    registerGlobalPasteIpc({ psRequest });

    // Screenshot Studio capture, PrintScreen trigger, save-screenshot and the capture flash/rate limiter (T-310: electron/main/services/screenshot.cts).
    registerScreenshotIpc({ registry, pathGrants, notUserSelected, getUiLanguage, getProtectedAppRoots, getKoBoxRoots });

    // Video PiP IPC (open/close, video URL scan, SMTC source query) and move-window (T-310: electron/main/services/pip.cts).
    registerPipIpc({ windowDeps, getLastSmtcAlbumArt, getLastSmtcSourceAppId });

    registerWindowIpc();

    // T-605: settings:open (main window top frame only) and the Settings window itself (electron/main/windows/settingsWindow.cts).
    registerSettingsWindowIpc(registry, { appPaths: ctx.appPaths, loadsFromDist: ctx.loadsFromDist, getUiLanguage });
}

/** Media (melodies, resync, commands) and open-external. */
export function registerMediaAndExternalIpc(ctx: MainContext): void {
    const { appPaths } = ctx;

    // T-311: melodies (get-melody-audio), media-resync and media-command; the media polling itself lives in electron/main/services/media.cts.
    registerMediaIpc({ appPaths });

    registerOpenExternalIpc();
}

/**
 * extensions-config.json, the install origins and the plugin confirmation (T-314). userData is read here, after the dev
 * setPath('userData') in main.cts, exactly where the module-level constants used to be.
 */
export function createExtensionServices(ctx: MainContext) {
    const { getUiLanguage, confirmWithUser, isConfirmInFlight } = ctx;

    // ─── Dynamic Extensions IPC Handlers ────────────────────────────────
    const { extensionsDir, extensionsConfigPath, getExtensionsConfig, saveExtensionsConfig } = createExtensionsConfig(
        app.getPath('userData')
    );
    const {
        loadExtensionOrigins,
        recordExtensionOrigin,
        forgetExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
    } = createExtensionOrigins({ userData: app.getPath('userData'), extensionsDir });
    const { confirmPluginAction } = createPluginConfirm({ getUiLanguage, confirmWithUser, isConfirmInFlight });
    // T-318: one lock for every decision + write sequence on extensions/, extensions-config.json and the origins file (install, update,
    // uninstall, toggle, set-extensions-config) and for the reads that also write the origins snapshot. Never nested.
    const { run: withInstallLock } = createAsyncLock();

    return {
        extensionsDir,
        extensionsConfigPath,
        getExtensionsConfig,
        saveExtensionsConfig,
        loadExtensionOrigins,
        recordExtensionOrigin,
        forgetExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
        confirmPluginAction,
        withInstallLock,
    };
}

export type ExtensionServices = ReturnType<typeof createExtensionServices>;

export function registerInstalledExtensions(ctx: MainContext, extensions: ExtensionServices): void {
    const { isDev, registry, appPaths } = ctx;
    const { extensionsDir, getExtensionsConfig, loadExtensionOrigins, withInstallLock } = extensions;

    registerInstalledExtensionsIpc({
        registry,
        isDev,
        appPaths,
        extensionsDir,
        getExtensionsConfig,
        loadExtensionOrigins,
        withInstallLock,
    });
}

/** get-backup-sources, save-full-backup and the pre-restore / pre-delete / restore channels. */
export function registerFullBackup(ctx: MainContext, extensions: ExtensionServices): void {
    const { dialogPathsFile, getUiLanguage, getProtectedAppRoots } = ctx;
    const { extensionsDir, extensionsConfigPath, getExtensionsConfig } = extensions;

    registerFullBackupIpc({
        dialogPathsFile,
        extensionsDir,
        extensionsConfigPath,
        getExtensionsConfig,
        getUiLanguage,
        getProtectedAppRoots,
    });
}

/** check-plugin-updates, the plugin management channels and the three install channels (electron/main/services/extensions/*.cts). */
export function registerExtensionChannels(ctx: MainContext, extensions: ExtensionServices): void {
    const { isDev, registry, appPaths, pathGrants, notUserSelected, dialogPathsFile, getUiLanguage } = ctx;
    const {
        extensionsDir,
        getExtensionsConfig,
        saveExtensionsConfig,
        loadExtensionOrigins,
        recordExtensionOrigin,
        forgetExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
        confirmPluginAction,
        withInstallLock,
    } = extensions;

    // T-316: media polling runs only while the media plugin (KoPlayer) is enabled or a PiP window is open. The probe reads the installed
    // plugins and extensions-config.json like get-installed-extensions; every config change below re-evaluates the demand.
    const playgroundDir = isDev ? appPaths.pluginsPlayground : path.join(app.getAppPath(), 'pluginsPlayground');
    setMediaPluginProbe(createMediaPluginProbe({ extensionsDir, playgroundDir, getExtensionsConfig }));
    const onExtensionsConfigChanged = () => {
        updateMediaDemand();
    };

    // T-314: check-plugin-updates, the plugin management channels and the three install channels (electron/main/services/extensions/*.cts).
    registerPluginUpdatesIpc({ registry, extensionsDir, loadExtensionOrigins, withInstallLock });
    registerExtensionManagementIpc({
        registry,
        isDev,
        appPaths,
        extensionsDir,
        getExtensionsConfig,
        saveExtensionsConfig,
        forgetExtensionOrigin,
        confirmPluginAction,
        onExtensionsConfigChanged,
        withInstallLock,
    });
    registerExtensionInstallIpc({
        registry,
        pathGrants,
        notUserSelected,
        isDev,
        dialogPathsFile,
        getUiLanguage,
        extensionsDir,
        getExtensionsConfig,
        saveExtensionsConfig,
        recordExtensionOrigin,
        findUpdateTarget,
        readInstalledPluginState,
        sameInstalledState,
        confirmPluginAction,
        onExtensionsConfigChanged,
        withInstallLock,
    });
}
