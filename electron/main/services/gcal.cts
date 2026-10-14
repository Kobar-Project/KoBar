// R2-15: Google Calendar v1 (EXPERIMENTAL, READ-ONLY): thin Electron wiring around electron/lib/gcalService.cts (all logic is there, pure and
// unit-tested with fakes). This file only supplies the real dependencies and registers the IPC channels:
//   window.api (main window top frame):  gcal-status, gcal-connect, gcal-disconnect, gcal-list-events
//   Settings window (settings-preload):  gcal-settings-status / -connect / -disconnect / -set-enabled / -refresh
// Tokens never reach a renderer; the refresh token is encrypted with safeStorage in userData/google-calendar.json (never in a backup).
import { app, safeStorage, shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { GCAL_CLIENT_FILE_NAME, loadClientConfig } from '../../lib/gcalConfig.cjs';
import { GCAL_AUTH_ENDPOINT, type CreateLoopbackServer } from '../../lib/gcalOAuth.cjs';
import { type GcalService, createGcalService } from '../../lib/gcalService.cjs';
import { GCAL_FLAG_FILE_NAME, GCAL_TOKEN_FILE_NAME, createGcalTokenStore } from '../../lib/gcalTokenStore.cjs';
import type { IpcRegistry } from '../ipc/registry.cjs';
import {
    GCAL_CONNECT_OPTIONS,
    GCAL_DISCONNECT_OPTIONS,
    GCAL_LIST_EVENTS_OPTIONS,
    GCAL_SETTINGS_CONNECT_OPTIONS,
    GCAL_SETTINGS_DISCONNECT_OPTIONS,
    GCAL_SETTINGS_REFRESH_OPTIONS,
    GCAL_SETTINGS_SET_ENABLED_OPTIONS,
    GCAL_SETTINGS_STATUS_OPTIONS,
    GCAL_STATUS_OPTIONS,
} from '../ipc/schemas.cjs';

/** Every channel of this module (tests check that none of them can return a token). */
export const GCAL_CHANNELS = [
    'gcal-status',
    'gcal-connect',
    'gcal-disconnect',
    'gcal-list-events',
    'gcal-settings-status',
    'gcal-settings-connect',
    'gcal-settings-disconnect',
    'gcal-settings-set-enabled',
    'gcal-settings-refresh',
] as const;

/** Writes `text` to a temp file and renames it over `filePath`, so a crash never leaves a half-written token file. */
async function writeFileAtomic(filePath: string, text: string): Promise<void> {
    const temp = `${filePath}.tmp`;
    await fs.writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, filePath);
}

export function createGcalServiceForApp(): GcalService {
    const userData = app.getPath('userData');
    const candidates = [path.join(app.getAppPath(), GCAL_CLIENT_FILE_NAME), path.join(process.resourcesPath ?? '', GCAL_CLIENT_FILE_NAME)];
    return createGcalService({
        loadConfig: () => loadClientConfig(candidates, (filePath) => fs.readFile(filePath, 'utf8')),
        store: createGcalTokenStore({
            tokenFile: path.join(userData, GCAL_TOKEN_FILE_NAME),
            flagFile: path.join(userData, GCAL_FLAG_FILE_NAME),
            cipher: {
                // Linux's 'basic_text' backend is a hard-coded key, so it counts as unavailable (same rule as the SecretService).
                isEncryptionAvailable: () =>
                    safeStorage.isEncryptionAvailable() &&
                    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
                encryptString: (plainText) => safeStorage.encryptString(plainText),
                decryptString: (encrypted) => safeStorage.decryptString(encrypted),
            },
            fs: {
                readFile: (filePath) => fs.readFile(filePath, 'utf8'),
                writeFile: writeFileAtomic,
                unlink: (filePath) => fs.unlink(filePath),
            },
        }),
        fetch: (url, init) => fetch(url, init),
        openExternal: (url) => {
            // Only the Google consent page that authorize() builds itself is ever opened.
            if (!url.startsWith(`${GCAL_AUTH_ENDPOINT}?`)) throw new Error('unexpected URL');
            return shell.openExternal(url);
        },
        createServer: ((handler) => http.createServer(handler)) as CreateLoopbackServer,
        now: () => Date.now(),
    });
}

export interface GcalIpcDeps {
    registry: IpcRegistry;
    service: GcalService;
}

export function registerGcalIpc({ registry, service }: GcalIpcDeps): void {
    registry.handle('gcal-status', GCAL_STATUS_OPTIONS, () => service.status());
    registry.handle('gcal-connect', GCAL_CONNECT_OPTIONS, () => service.connect());
    registry.handle('gcal-disconnect', GCAL_DISCONNECT_OPTIONS, () => service.disconnect());
    registry.handle('gcal-list-events', GCAL_LIST_EVENTS_OPTIONS, (_event, range) => service.listEvents(range));

    registry.handle('gcal-settings-status', GCAL_SETTINGS_STATUS_OPTIONS, () => service.status());
    registry.handle('gcal-settings-connect', GCAL_SETTINGS_CONNECT_OPTIONS, () => service.connect());
    registry.handle('gcal-settings-disconnect', GCAL_SETTINGS_DISCONNECT_OPTIONS, () => service.disconnect());
    registry.handle('gcal-settings-set-enabled', GCAL_SETTINGS_SET_ENABLED_OPTIONS, (_event, enabled) => service.setEnabled(enabled));
    registry.handle('gcal-settings-refresh', GCAL_SETTINGS_REFRESH_OPTIONS, () => service.refresh());
}
