// T-411: IPC of the SecretService (secretService.cts). Three channels, registered through the typed registry with argument
// schemas and the main-window-top-frame sender policy (electron/main/ipc/schemas.cts):
//   secret-status  -> { exists, last4 }        secret-set -> stores a value, answers with the new status only
//   secret-delete  -> removes a secret
// There is deliberately NO channel that returns a secret's value: main-process callers use `SecretService.getSecret`.
// The handlers never throw (the registry would log the error object) and never echo the value back.
// T-417: the renderer cannot be told apart from a plugin (same realm, same `window.api`), so every channel only accepts names
// in the plugin namespace `plugin-<plugin id>-<key>`. A well-formed name outside it (a core name) answers `reserved-name`
// before the service runs: the renderer can neither read the status of, overwrite nor delete a core secret.
// Pure: no Electron runtime import (the registry is injected), so it is unit-tested with a fake ipcMain.
import type { IpcSecretResult } from '../../../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };
import type { IpcRegistry } from '../../ipc/registry.cjs';
import { SECRET_DELETE_OPTIONS, SECRET_SET_OPTIONS, SECRET_STATUS_OPTIONS } from '../../ipc/schemas.cjs';
import { type SecretResult, type SecretService, isCoreSecretName, isPluginSecretName } from './secretService.cjs';

/** Channels of this module (tests check that nothing else, in particular no "get value" channel, is registered). */
export const SECRET_CHANNELS = ['secret-status', 'secret-set', 'secret-delete'] as const;

/** Copies the known fields only, so nothing the service might add later can reach the renderer unnoticed. */
export function toIpcSecretResult(result: SecretResult): IpcSecretResult {
    const out: IpcSecretResult = { success: result.success === true };
    if (result.reason !== undefined) out.reason = result.reason;
    if (result.status) {
        const { name, exists, last4, encryptionAvailable, unreadable } = result.status;
        out.status = { name, exists, last4, encryptionAvailable, unreadable };
    }
    return out;
}

/**
 * Why a renderer may not use `name` (T-417), or null when it may. Malformed names (and the bare or misused `plugin-` prefix) are
 * `invalid-name`; well-formed core names are `reserved-name`.
 */
export function rendererSecretNameError(name: unknown): 'invalid-name' | 'reserved-name' | null {
    if (isPluginSecretName(name)) return null;
    return isCoreSecretName(name) ? 'reserved-name' : 'invalid-name';
}

function safely(run: () => SecretResult): IpcSecretResult {
    try {
        return toIpcSecretResult(run());
    } catch {
        return { success: false, reason: 'io' };
    }
}

export interface SecretsIpcDeps {
    registry: IpcRegistry;
    secrets: SecretService;
}

export function registerSecretsIpc({ registry, secrets }: SecretsIpcDeps): void {
    /** Runs `run` only for a plugin-namespace name; anything else is refused without touching the service. */
    const forPlugin = (name: unknown, run: () => SecretResult) =>
        safely(() => {
            const reason = rendererSecretNameError(name);
            return reason === null ? run() : { success: false, reason };
        });
    registry.handle('secret-status', SECRET_STATUS_OPTIONS, (_event, name) => forPlugin(name, () => secrets.status(name)));
    registry.handle('secret-set', SECRET_SET_OPTIONS, (_event, name, value) => forPlugin(name, () => secrets.set(name, value)));
    registry.handle('secret-delete', SECRET_DELETE_OPTIONS, (_event, name) => forPlugin(name, () => secrets.delete(name)));
}
