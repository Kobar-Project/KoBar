// KoBar main process entry (esbuild entry: electron/main.cts -> dist-electron/main.cjs). T-315: this file only wires the main process.
// It is a list of imports and ONE ordered sequence of calls; the logic lives in electron/main/** (app/, services/, windows/, bootstrap.cts).
// ORDER MATTERS and is pinned by tests/mainBootstrap.test.ts:
//   1. the dev userData redirect (redirectDevUserData) runs before anything reads app.getPath('userData');
//   2. the context is built once (createMainContext), after the redirect and the Chromium switches;
//   3. the side-effect calls and IPC registrations keep the order the single-file main.cts had (two pure steps moved: koBoxPath/pathGrants are built inside createMainContext, and initPinBorderStyle runs after the registry/persist construction; both are order-insensitive, verified by a startup trace in T-315).
import { createAppPaths } from './main/lib/appPaths.cjs';
import { registerAppInfoIpc } from './main/app/appIpc.cjs';
import { createMainContext } from './main/app/context.cjs';
import { registerAppLifecycle } from './main/app/lifecycle.cjs';
import { applyChromiumSwitches, claimSingleInstance, createRuntimeEnv, redirectDevUserData } from './main/app/runtime.cjs';
import { registerNavigationGuards } from './main/app/security.cjs';
import {
    configureStartupServices,
    createExtensionServices,
    registerCoreIpc,
    registerExtensionChannels,
    registerFileAccessIpc,
    registerFullBackup,
    registerInstalledExtensions,
    registerMediaAndExternalIpc,
    registerWindowServicesIpc,
} from './main/bootstrap.cjs';

// Process setup: runtime facts (every path is derived from the bundle directory, passed as this file's own __dirname), dev userData
// redirect, Chromium switches.
const env = createRuntimeEnv(createAppPaths(__dirname));
redirectDevUserData(env);
applyChromiumSwitches();

// Shared context (paths, registry, persist flusher, path grants, helpers), built once.
const ctx = createMainContext(env);
configureStartupServices(ctx);

// App identity, single instance lock, app lifecycle (whenReady / window-all-closed handlers).
claimSingleInstance(env);
registerAppLifecycle(ctx);

// IPC registrations and the security guards, in registration order.
registerCoreIpc(ctx);
registerFileAccessIpc(ctx);
registerWindowServicesIpc(ctx);
registerNavigationGuards(env);
registerMediaAndExternalIpc(ctx);
const extensions = createExtensionServices(ctx);
registerInstalledExtensions(ctx, extensions);
registerFullBackup(ctx, extensions);
registerExtensionChannels(ctx, extensions);
registerAppInfoIpc(env);
