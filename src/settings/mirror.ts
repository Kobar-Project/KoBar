// T-606: the Settings window's READ-ONLY mirror of the main window's settings. No persist middleware and no app store here: the
// main window's store is the single source of truth (src/store/sync.ts). The mirror only shows the latest snapshot main relays
// (`window.settingsBridge`, electron/settings-preload.cts) and sends ACTIONS; it never changes its own state optimistically, so a
// value on screen is always one the main window really holds.
//
//   - Ordering: every snapshot carries a `seq` stamped by main that only increases; anything not newer than what the mirror has is
//     dropped (stale / duplicate / out of order).
//   - Main window not ready (starting, reloading, crashed): main sends `state: null`, the mirror goes back to `waiting` and
//     dispatch() refuses until a snapshot arrives. When the main window closes, this window closes with it.
//   - Echo-loop free: receiving a snapshot never dispatches anything.
//
// API for the pages (T-607+): useSettingsState(selector) and dispatchSettingsAction(type, payload), both typed after the action
// table of src/store/sync.ts (type-only import: nothing of the app store is bundled into this window).
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { IpcSettingsStateMessage, IpcSettingsWindowBridge } from '../../shared/ipc-contract';
import { sanitizePluginSummary, type PluginActionPayloads, type PluginActionType, type PluginSummary } from '../store/pluginSummary';
import {
    sanitizeWorkspaceSummary,
    type WorkspaceActionPayloads,
    type WorkspaceActionType,
    type WorkspaceSummary,
} from '../store/workspaceSummary';
import { sanitizeSystemSummary, type SystemActionPayloads, type SystemActionType, type SystemSummary } from '../store/systemSummary';
import type { SettingsActionPayloads, SettingsActionType, SettingsSyncState } from '../store/sync';

/** `unavailable`: no bridge (tests, browser). `waiting`: no snapshot from the main window yet. `ready`: `state` is current. */
export type SettingsMirrorStatus = 'unavailable' | 'waiting' | 'ready';

export interface SettingsMirrorState {
    status: SettingsMirrorStatus;
    /** Highest `seq` received from main (0 = none). */
    seq: number;
    state: SettingsSyncState | null;
    /** Id of the last action the main window processed (applied or rejected). */
    ack: number;
    /** T-610: the plugin summary of the same snapshot (null until the main window has read its plugin list). */
    plugins: PluginSummary | null;
    /** T-612: the workspace summary of the same snapshot (null until the main window is hydrated). */
    workspaces: WorkspaceSummary | null;
    /** T-614: the system summary (version, update centre, backup state) of the same snapshot. */
    system: SystemSummary | null;
}

/** What the mirror needs of window.settingsBridge (the R2-15 gcal* methods belong to the Integrations page only). */
export type SettingsMirrorBridge = Omit<IpcSettingsWindowBridge, `gcal${string}`>;

export interface SettingsMirror {
    store: StoreApi<SettingsMirrorState>;
    /** Subscribes to snapshots and asks main for the current one. Idempotent. */
    start(): void;
    stop(): void;
    /** Handles one `settings:state` message (exported for tests). */
    receive(message: unknown): void;
    /** Sends an action to the main window; returns its id, or null when the mirror is not ready (nothing is sent then). */
    dispatch<T extends SettingsActionType>(type: T, payload: SettingsActionPayloads[T]): number | null;
    /** Sends one `plugin.*` action (T-610); same rules as dispatch(). */
    dispatchPlugin<T extends PluginActionType>(type: T, payload: PluginActionPayloads[T]): number | null;
    /** Sends one `workspace.*` action (T-612); same rules as dispatch(). */
    dispatchWorkspace<T extends WorkspaceActionType>(type: T, payload: WorkspaceActionPayloads[T]): number | null;
    /** Sends one `backup.*` / `update.*` action (T-614); same rules as dispatch(). */
    dispatchSystem<T extends SystemActionType>(type: T, payload: SystemActionPayloads[T]): number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface SettingsMirrorOptions {
    /** First action id; defaults to the current time in ms so ids keep increasing across a reload of this window. */
    firstActionId?: number;
}

export function createSettingsMirror(bridge: SettingsMirrorBridge | null, options: SettingsMirrorOptions = {}): SettingsMirror {
    const store = createStore<SettingsMirrorState>()(() => ({
        status: bridge ? 'waiting' : 'unavailable',
        seq: 0,
        state: null,
        ack: 0,
        plugins: null,
        workspaces: null,
        system: null,
    }));
    let nextActionId = options.firstActionId ?? Date.now();
    let unsubscribe: (() => void) | null = null;

    function receive(message: unknown): void {
        if (!isPlainObject(message)) return;
        const { seq, state, ack } = message as Partial<IpcSettingsStateMessage>;
        if (typeof seq !== 'number' || !Number.isFinite(seq)) return;
        if (seq <= store.getState().seq) return;
        const next = isPlainObject(state) ? (state as unknown as SettingsSyncState) : null;
        store.setState({
            seq,
            state: next,
            ack: typeof ack === 'number' && Number.isFinite(ack) ? ack : 0,
            status: next ? 'ready' : 'waiting',
            // Same message, same seq: the summary is never older or newer than the settings it came with.
            plugins: next ? sanitizePluginSummary((message as { plugins?: unknown }).plugins) : null,
            workspaces: next ? sanitizeWorkspaceSummary((message as { workspaces?: unknown }).workspaces) : null,
            system: next ? sanitizeSystemSummary((message as { system?: unknown }).system) : null,
        });
    }

    function send(type: string, payload: unknown): number | null {
        if (!bridge || store.getState().status !== 'ready') return null;
        const id = nextActionId;
        nextActionId += 1;
        bridge.dispatch({ id, type, payload });
        return id;
    }

    return {
        store,
        start() {
            if (!bridge || unsubscribe) return;
            unsubscribe = bridge.onState(receive);
            bridge.requestState();
        },
        stop() {
            unsubscribe?.();
            unsubscribe = null;
        },
        receive,
        dispatch: (type, payload) => send(type, payload),
        dispatchPlugin: (type, payload) => send(type, payload),
        dispatchWorkspace: (type, payload) => send(type, payload),
        dispatchSystem: (type, payload) => send(type, payload),
    };
}

/** The preload's bridge, when it looks like one. */
export function readSettingsBridge(target: unknown = globalThis): IpcSettingsWindowBridge | null {
    const bridge = (target as { settingsBridge?: Partial<IpcSettingsWindowBridge> } | null)?.settingsBridge;
    if (!bridge) return null;
    const ok = typeof bridge.onState === 'function' && typeof bridge.requestState === 'function' && typeof bridge.dispatch === 'function';
    return ok ? (bridge as IpcSettingsWindowBridge) : null;
}

/** This window's mirror (started by src/settings/main.tsx). */
export const settingsMirror: SettingsMirror = createSettingsMirror(readSettingsBridge());

/** Selects from the mirror; re-renders when the selected value changes. */
export function useSettingsState<T>(selector: (state: SettingsMirrorState) => T): T {
    return useStore(settingsMirror.store, selector);
}

/** Sends one allow-listed action to the main window (see SettingsMirror.dispatch). */
export function dispatchSettingsAction<T extends SettingsActionType>(type: T, payload: SettingsActionPayloads[T]): number | null {
    return settingsMirror.dispatch(type, payload);
}

/** The plugin summary (T-610); null while the main window has not published its plugin list. */
export function usePluginSummary(): PluginSummary | null {
    return useStore(settingsMirror.store, (s) => s.plugins);
}

/** Sends one allow-listed `plugin.*` action to the main window (see SettingsMirror.dispatchPlugin). */
export function dispatchPluginAction<T extends PluginActionType>(type: T, payload: PluginActionPayloads[T]): number | null {
    return settingsMirror.dispatchPlugin(type, payload);
}

/** The workspace summary (T-612); null while the main window has not published it. */
export function useWorkspaceSummary(): WorkspaceSummary | null {
    return useStore(settingsMirror.store, (s) => s.workspaces);
}

/** Sends one allow-listed `workspace.*` action to the main window (see SettingsMirror.dispatchWorkspace). */
export function dispatchWorkspaceAction<T extends WorkspaceActionType>(type: T, payload: WorkspaceActionPayloads[T]): number | null {
    return settingsMirror.dispatchWorkspace(type, payload);
}

/** The system summary (T-614); null while the main window has not published it. */
export function useSystemSummary(): SystemSummary | null {
    return useStore(settingsMirror.store, (s) => s.system);
}

/** Sends one allow-listed `backup.*` / `update.*` action to the main window (see SettingsMirror.dispatchSystem). */
export function dispatchSystemAction<T extends SystemActionType>(type: T, payload: SystemActionPayloads[T]): number | null {
    return settingsMirror.dispatchSystem(type, payload);
}
