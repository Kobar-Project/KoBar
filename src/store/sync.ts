// T-606: the main window's half of the Settings window state sync. The MAIN window's store is the single source of truth: the
// Settings window (src/settings/mirror.ts) has no persist middleware and no store of its own, only a read-only mirror, and it
// changes settings by sending ACTIONS that are applied here. Host-internal: NOT part of window.api or the plugin contract.
//
//   - Bridge: the preload's `window.__kobarSettingsSync` is claimed exactly once, when this module is first imported (src/main.tsx
//     imports it right after src/storage/client, before any plugin script is injected), so plugins never reach these channels.
//   - Snapshot: only SETTINGS_SYNC_KEYS (the keys a settings export carries: no secrets, no chat history, no note bodies, no
//     workspace data) are published, as JSON-safe data. Publishing waits for hydration, is coalesced (one message per burst of
//     changes) and only happens when one of those keys actually changed. Every publish carries this renderer's `epoch` and an
//     increasing `rev`, so main drops stale or out-of-order messages (electron/lib/settingsSync.cts).
//   - Actions: applied only through the allow-listed SETTINGS_ACTIONS table: each entry is the store setter of one synced key and
//     its payload must pass that key's import schema (src/store/importExport.ts). Unknown types, bad payloads and actions that
//     arrive before hydration are rejected, counted and logged (type and reason only, never the payload).
//   - Echo-loop free: this side never sends actions; an applied action changes the store, which publishes a snapshot with
//     `ack` = the action id. The Settings window never re-sends what it receives.
import type { IpcClaimedSettingsSyncBridge, IpcSettingsAction, IpcSettingsState, IpcSettingsSyncBridge } from '../../shared/ipc-contract';
import { SETTINGS_KEYS, settingsSchema } from './importExport';
import type { PluginSyncLike } from './pluginSync';
import type { PluginSummary } from './pluginSummary';
import type { WorkspaceSummary } from './workspaceSummary';
import type { WorkspaceSyncLike } from './workspaceSync';
import type { SystemSummary } from './systemSummary';
import type { SystemSyncLike } from './systemSync';
import type { AppState } from './useAppStore';

/** The keys the Settings window sees and may change: exactly the settings an export carries (one list, see SETTINGS_KEYS). */
export const SETTINGS_SYNC_KEYS = SETTINGS_KEYS;
export type SettingsSyncKey = (typeof SETTINGS_SYNC_KEYS)[number];
/** The mirror's view of the main window's store. */
export type SettingsSyncState = Pick<AppState, SettingsSyncKey>;

/** Action type -> payload: `setTheme` -> AppState['theme'], ... One action per synced key, named after its store setter. */
export type SettingsActionPayloads = { [K in SettingsSyncKey as `set${Capitalize<K>}`]: AppState[K] };
export type SettingsActionType = keyof SettingsActionPayloads;

/** Compile-time check: every synced key has a store setter that accepts the key's own value type. */
type SetterAcceptsValue = {
    [K in SettingsSyncKey]: `set${Capitalize<K>}` extends keyof AppState
        ? AppState[`set${Capitalize<K>}`] extends (value: AppState[K]) => void
            ? true
            : false
        : false;
};
type RequireTrue<T extends true> = T;
export type SettingsSettersMatchKeys = RequireTrue<false extends SetterAcceptsValue[SettingsSyncKey] ? false : true>;

function setterOf(key: SettingsSyncKey): SettingsActionType {
    return `set${key.charAt(0).toUpperCase()}${key.slice(1)}` as SettingsActionType;
}

interface SettingsActionEntry {
    key: SettingsSyncKey;
    setter: SettingsActionType;
    /** Validates the payload (the key's import schema). */
    schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } };
}

/** The allow-listed action table. A Map, so `__proto__` / `toString` and friends are never entries. */
export const SETTINGS_ACTIONS: ReadonlyMap<string, SettingsActionEntry> = new Map(
    SETTINGS_SYNC_KEYS.map((key) => [setterOf(key), { key, setter: setterOf(key), schema: settingsSchema.shape[key] }])
);

export type SettingsActionRejection = 'invalid-action' | 'unknown-action' | 'not-hydrated' | 'invalid-payload' | 'failed';
export type SettingsActionResult = { ok: true; key: SettingsSyncKey } | { ok: false; reason: SettingsActionRejection };

/** The part of the app store the sync uses (useAppStore satisfies it). */
export interface SettingsSyncStore {
    getState(): Pick<AppState, SettingsSyncKey | SettingsActionType | 'isHydrated'>;
    subscribe(listener: (state: Pick<AppState, 'isHydrated'>) => void): () => void;
}

type Logger = (message: string, details: Record<string, string | number>) => void;
const defaultLog: Logger = (message, details) => console.warn(`[KoBar] settings-sync: ${message}`, details);

/** Applies ONE Settings window action through the table. Never throws. */
export function applySettingsAction(store: SettingsSyncStore, action: unknown, log: Logger = defaultLog): SettingsActionResult {
    const reject = (reason: SettingsActionRejection, type = ''): SettingsActionResult => {
        log('rejected an action', { reason, type: type.slice(0, 64) });
        return { ok: false, reason };
    };
    if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
        return reject('invalid-action');
    }
    const { type, payload } = action as { type: string; payload?: unknown };
    const entry = SETTINGS_ACTIONS.get(type);
    if (!entry) return reject('unknown-action', type);
    let state: ReturnType<SettingsSyncStore['getState']>;
    try {
        state = store.getState();
    } catch {
        return reject('failed', type);
    }
    // Before hydration the store still holds defaults; a write now would be overwritten (or, worse, persisted over the user's data).
    if (!state.isHydrated) return reject('not-hydrated', type);
    const parsed = entry.schema.safeParse(payload);
    if (!parsed.success) return reject('invalid-payload', type);
    const setter = state[entry.setter] as unknown;
    if (typeof setter !== 'function') return reject('unknown-action', type);
    try {
        (setter as (value: unknown) => void)(parsed.data);
    } catch {
        return reject('failed', type);
    }
    return { ok: true, key: entry.key };
}

/** The synced keys of `state` as plain JSON data (structured-clone and contextBridge safe, no shared references). */
export function selectSettingsState(state: Partial<Record<SettingsSyncKey, unknown>>): IpcSettingsState {
    const out: Record<string, unknown> = {};
    for (const key of SETTINGS_SYNC_KEYS) out[key] = state[key];
    return JSON.parse(JSON.stringify(out)) as IpcSettingsState;
}

function sameSyncedValues(a: Partial<Record<SettingsSyncKey, unknown>>, b: Partial<Record<SettingsSyncKey, unknown>>): boolean {
    return SETTINGS_SYNC_KEYS.every((key) => Object.is(a[key], b[key]));
}

/** Coalescing delay: a burst of changes (a slider drag, an import) becomes one message. */
export const SETTINGS_PUBLISH_DELAY_MS = 30;

export interface SettingsSyncStats {
    published: number;
    applied: number;
    rejected: Record<SettingsActionRejection, number>;
}

export interface SettingsSyncOptions {
    store: SettingsSyncStore;
    bridge: IpcClaimedSettingsSyncBridge | null;
    /** Defers one publish; defaults to a SETTINGS_PUBLISH_DELAY_MS timer. Returns a cancel function. */
    schedule?: (run: () => void) => () => void;
    epoch?: string;
    log?: Logger;
    /** Called after an action was applied (T-607: `launchAtStartup` re-reads the OS state). Errors are swallowed. */
    onApplied?: (key: SettingsSyncKey) => void;
    /** T-610: the plugin summary source and `plugin.*` action handler (absent: no `plugins` section, plugin actions are rejected). */
    plugins?: PluginSyncLike;
    /** T-612: the workspace summary source and `workspace.*` action handler (absent: no `workspaces` section, those actions are rejected). */
    workspaces?: WorkspaceSyncLike;
    /** T-614: the system summary source and `backup.*` / `update.*` action handler (absent: no `system` section, those actions are rejected). */
    system?: SystemSyncLike;
}

export interface SettingsSync {
    stop(): void;
    stats(): SettingsSyncStats;
}

function newEpoch(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const defaultSchedule = (run: () => void) => {
    const handle = setTimeout(run, SETTINGS_PUBLISH_DELAY_MS);
    return () => clearTimeout(handle);
};

/** Starts publishing settings snapshots and applying Settings window actions. Without a bridge (tests, browser) it does nothing. */
export function startSettingsSync(options: SettingsSyncOptions): SettingsSync {
    const { store, bridge } = options;
    const stats: SettingsSyncStats = {
        published: 0,
        applied: 0,
        rejected: { 'invalid-action': 0, 'unknown-action': 0, 'not-hydrated': 0, 'invalid-payload': 0, failed: 0 },
    };
    const snapshotStats = (): SettingsSyncStats => ({ ...stats, rejected: { ...stats.rejected } });
    if (!bridge) return { stop: () => {}, stats: snapshotStats };

    const schedule = options.schedule ?? defaultSchedule;
    const log = options.log ?? defaultLog;
    const epoch = options.epoch ?? newEpoch();
    let rev = 0;
    let ack = 0;
    let lastPublished: Partial<Record<SettingsSyncKey, unknown>> | null = null;
    let force = false;
    let lastPluginsJson: string | null = null;
    let lastWorkspacesJson: string | null = null;
    let lastSystemJson: string | null = null;
    let cancelPending: (() => void) | null = null;
    let stopped = false;

    function flush(): void {
        cancelPending = null;
        if (stopped) return;
        const state = store.getState();
        if (!state.isHydrated) return;
        // T-610: the plugin summary (compared as JSON text: it is small) travels with the snapshot as a separate optional section.
        let plugins: PluginSummary | null = null;
        let pluginsJson: string | null = null;
        try {
            plugins = options.plugins?.getSummary() ?? null;
            pluginsJson = plugins ? JSON.stringify(plugins) : null;
        } catch {
            plugins = null;
        }
        // T-612: same for the workspace summary (ids, names, two flags).
        let workspaces: WorkspaceSummary | null = null;
        let workspacesJson: string | null = null;
        try {
            workspaces = options.workspaces?.getSummary() ?? null;
            workspacesJson = workspaces ? JSON.stringify(workspaces) : null;
        } catch {
            workspaces = null;
        }
        // T-614: and for the system summary (version, update centre, backup state: codes and numbers).
        let system: SystemSummary | null = null;
        let systemJson: string | null = null;
        try {
            system = options.system?.getSummary() ?? null;
            systemJson = system ? JSON.stringify(system) : null;
        } catch {
            system = null;
        }
        if (
            !force &&
            lastPublished &&
            sameSyncedValues(lastPublished, state) &&
            pluginsJson === lastPluginsJson &&
            workspacesJson === lastWorkspacesJson &&
            systemJson === lastSystemJson
        ) {
            return;
        }
        force = false;
        lastPluginsJson = pluginsJson;
        lastWorkspacesJson = workspacesJson;
        lastSystemJson = systemJson;
        let snapshot: IpcSettingsState;
        try {
            snapshot = selectSettingsState(state);
        } catch {
            log('could not serialise the settings state', {});
            return;
        }
        // The synced values only (references, compared with Object.is): never a copy of the whole store.
        lastPublished = Object.fromEntries(SETTINGS_SYNC_KEYS.map((key) => [key, state[key]]));
        rev += 1;
        stats.published += 1;
        try {
            bridge!.publish({
                epoch,
                rev,
                ack,
                state: snapshot,
                ...(plugins ? { plugins } : {}),
                ...(workspaces ? { workspaces } : {}),
                ...(system ? { system } : {}),
            });
        } catch {
            log('publish failed', { rev });
        }
    }

    function request(forced: boolean): void {
        if (stopped) return;
        if (forced) force = true;
        if (cancelPending) return;
        cancelPending = schedule(flush);
    }

    // A plugin summary change (list, update check, registry) republishes even though no synced setting changed.
    const unsubscribePlugins = options.plugins?.subscribe(() => request(false)) ?? (() => {});
    const unsubscribeWorkspaces = options.workspaces?.subscribe(() => request(false)) ?? (() => {});
    const unsubscribeSystem = options.system?.subscribe(() => request(false)) ?? (() => {});
    const unsubscribeStore = store.subscribe((state) => {
        if (!state.isHydrated) return;
        if (lastPublished === null) return request(true);
        if (!sameSyncedValues(lastPublished, store.getState())) request(false);
    });
    // Already hydrated (the persist backend can hydrate synchronously): publish the first snapshot now.
    if (store.getState().isHydrated) request(true);

    let unsubscribeActions: () => void = () => {};
    try {
        unsubscribeActions = bridge.onAction((action: IpcSettingsAction) => {
            if (stopped) return;
            const actionId = (action as { id?: unknown } | null)?.id;
            const plugins = options.plugins;
            const workspaces = options.workspaces;
            const system = options.system;
            const asyncOwner =
                typeof action?.type === 'string'
                    ? plugins?.owns(action.type)
                        ? { handler: plugins, label: 'plugin' }
                        : workspaces?.owns(action.type)
                          ? { handler: workspaces, label: 'workspace' }
                          : system?.owns(action.type)
                            ? { handler: system, label: 'system' }
                            : null
                    : null;
            if (asyncOwner) {
                // T-610 / T-612: plugin and workspace actions run asynchronously (queued, validated against the live list); the ack
                // follows when done.
                void asyncOwner.handler.handle(action).then((result) => {
                    if (stopped) return;
                    if (!result.ok) log(`rejected a ${asyncOwner.label} action`, { reason: result.reason, type: action.type.slice(0, 64) });
                    if (typeof actionId === 'number' && Number.isSafeInteger(actionId) && actionId >= 0) ack = Math.max(ack, actionId);
                    request(true);
                });
                return;
            }
            const result = applySettingsAction(store, action, log);
            if (result.ok) {
                stats.applied += 1;
                try {
                    options.onApplied?.(result.key);
                } catch {
                    log('onApplied failed', { key: result.key });
                }
            } else stats.rejected[result.reason] += 1;
            const id = (action as { id?: unknown } | null)?.id;
            if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) ack = id;
            // Always answer (forced), so the Settings window sees the ack even for a rejected or no-op action.
            request(true);
        });
    } catch {
        log('could not subscribe to actions', {});
    }

    return {
        stop() {
            stopped = true;
            unsubscribeStore();
            unsubscribePlugins();
            unsubscribeWorkspaces();
            unsubscribeSystem();
            unsubscribeActions();
            cancelPending?.();
            cancelPending = null;
        },
        stats: snapshotStats,
    };
}

/** Claims the preload bridge. Null outside Electron (tests, browser) or when it was already claimed. */
export function claimSettingsSyncBridge(target: unknown = globalThis): IpcClaimedSettingsSyncBridge | null {
    try {
        const bridge = (target as { __kobarSettingsSync?: Partial<IpcSettingsSyncBridge> } | null)?.__kobarSettingsSync;
        if (!bridge || typeof bridge.claim !== 'function') return null;
        return bridge.claim() ?? null;
    } catch {
        return null;
    }
}

/** The host's claimed bridge, claimed when this module is first imported (before any plugin script runs). */
export const settingsSyncBridge: IpcClaimedSettingsSyncBridge | null = claimSettingsSyncBridge();
