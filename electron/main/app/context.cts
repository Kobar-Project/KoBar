// T-315: the values the rest of the bootstrap shares, built ONCE by createMainContext() after the dev userData redirect and the Chromium
// switches (see electron/main.cts). Everything here is construction only (paths, an empty registry, an empty grant store, the persist
// flusher); the side effects (pin style init, notifications config, IPC registration, ...) stay explicit calls in bootstrap.cts (called in order from main.cts).
// The live state (UI language cache, confirmInFlight) is module-level in helpers.cts, so there is exactly one instance of it.
import { app, ipcMain, safeStorage } from 'electron';
import * as path from 'path';
import { DIALOG_PATHS_FILE_NAME } from '../../lib/dialogPaths.cjs';
import { createPathGrants } from '../../lib/pathGrants.cjs';
import { createIpcRegistry } from '../ipc/registry.cjs';
import { mediaChangeFilter, updateMediaDemand } from '../services/media.cjs';
import { type SecretCipher, createSecretService } from '../services/secrets/secretService.cjs';
import { STORAGE_DIR_NAME } from '../services/storage/layout.cjs';
import { createLocalStorageSnapshotWriter } from '../services/storage/localStorageSnapshot.cjs';
import { createStorageIpc } from '../services/storage/storageIpc.cjs';
import { createStorageService } from '../services/storage/storageService.cjs';
import {
    createGetKoBoxRoots,
    confirmWithUser,
    getProtectedAppRoots,
    getUiLanguage,
    isConfirmInFlight,
    isMainWindowTopFrame,
    isSettingsWindowTopFrame,
    openExternalChecked,
} from './helpers.cjs';
import { createPersistSession } from './persist.cjs';
import type { RuntimeEnv } from './runtime.cjs';

// App-owned 'not-user-selected' reason string shared by the path-grant checks (SEC-02, T-042).
const NOT_USER_SELECTED = 'not-user-selected';

export function createMainContext(env: RuntimeEnv) {
    const { appPaths, loadsFromDist } = env;

    const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
    // T-037: last-used folder per file dialog kind (Electron 43+ no longer remembers it). Missing/corrupt -> no default.
    const dialogPathsFile = path.join(app.getPath('userData'), DIALOG_PATHS_FILE_NAME);

    // T-306: mainWindow, pipWindow and isAwaitingPinTarget live in `appState` (electron/main/state.cts), shared with the window modules.
    // T-303: typed IPC registry (contract types, optional argument schemas, error logging). The file and plugin channels
    // are registered through it; the remaining channels still use ipcMain directly until they move.
    const registry = createIpcRegistry({
        ipcMain,
        senderPolicies: {
            'main-window-top-frame': (event) => isMainWindowTopFrame(event),
            // T-606: the Settings window's state-sync channels (electron/main/windows/settingsSync.cts).
            'settings-window-top-frame': (event) => isSettingsWindowTopFrame(event),
        },
    });

    // T-403: transport of the file-backed store userData/kobar-data/ (services/storage/storageIpc.cts). Construction only: the
    // service touches the disk on the first snapshot request (the preload's boot read), not here.
    const storageService = createStorageService({
        root: path.join(app.getPath('userData'), STORAGE_DIR_NAME),
        appVersion: app.getVersion(),
    });
    const storage = createStorageIpc({
        service: storageService,
        // T-404: the one-time masked localStorage archive (kobar-data/localstorage-snapshot/), sent by the renderer after hydration.
        localStorageSnapshot: createLocalStorageSnapshotWriter({ service: storageService, appVersion: app.getVersion() }),
        isWriter: (event) => isMainWindowTopFrame(event),
    });

    // T-411: safeStorage-encrypted secrets in kobar-data/secrets/ (services/secrets/secretService.cts). Construction only; safeStorage
    // is first asked on a secret call (after app ready). Linux's 'basic_text' backend is a hard-coded key, so it counts as unavailable
    // (no plaintext-equivalent fallback). Main-process callers read values with `secrets.getSecret(name)`; the renderer never can.
    const secretCipher: SecretCipher = {
        isEncryptionAvailable: () =>
            safeStorage.isEncryptionAvailable() &&
            !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
        encryptString: (plainText) => safeStorage.encryptString(plainText),
        decryptString: (encrypted) => safeStorage.decryptString(encrypted),
    };
    const secrets = createSecretService({ root: path.join(app.getPath('userData'), STORAGE_DIR_NAME), cipher: secretCipher });

    // Debounced renderer persist (T-129): see app/persist.cts. T-403: the quit / session-end flush also waits for the file writes.
    const persist = createPersistSession(storage);

    const koBoxPath = path.join(app.getPath('userData'), 'KoBox');

    // ─── User-selected path grants (SEC-02, T-042) ───────────────────
    // parse-file, save-screenshot, kobox-drop and install-extension-from-path only accept paths the user chose in this session, exactly
    // (a granted folder does not cover the files beneath it): a File dropped or picked in the renderer
    // (resolved by webUtils.getPathForFile in the preload, which reports it here). save-screenshot also
    // accepts the path from the save dialog it opens itself. Plugins share the renderer realm, so a path string
    // alone proves nothing; a File with a real path cannot be fabricated by script. In memory only.
    // Residual risk: Chromium may also expose real-path Files for files pasted from Explorer
    // (clipboardData.files), so a paste the user makes into KoBar can grant those paths too.
    const pathGrants = createPathGrants();

    // T-306: what the window modules need from main.cts (`mediaChangeFilter` comes from services/media.cts, T-311).
    // T-316: a PiP window opening/closing re-evaluates the media polling demand.
    const onPipWindowChanged = () => {
        updateMediaDemand();
    };
    function windowDeps() {
        return {
            appPaths,
            windowStatePath,
            loadsFromDist,
            mediaChangeFilter,
            onPipWindowChanged,
            requestPersistFlush: persist.requestPersistFlush,
        };
    }

    return {
        ...env,
        windowStatePath,
        dialogPathsFile,
        koBoxPath,
        registry,
        storage,
        secrets,
        persist,
        pathGrants,
        notUserSelected: NOT_USER_SELECTED,
        windowDeps,
        getUiLanguage,
        confirmWithUser,
        isConfirmInFlight,
        openExternalChecked,
        getProtectedAppRoots,
        getKoBoxRoots: createGetKoBoxRoots(koBoxPath),
    };
}

export type MainContext = ReturnType<typeof createMainContext>;
