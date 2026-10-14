// T-606: the main process relay of the Settings window state sync. Pure: no Electron import (the two window pushes are injected),
// so tests/settingsSync.test.ts covers it with fakes. electron/main/windows/settingsSync.cts wires it to the IPC registry.
//
// Rules:
//   - The main window's store is the single source of truth. Main only caches the main window's LATEST settings snapshot (small,
//     settings keys only) and relays; it never interprets an action. The main window renderer validates every action against its
//     allow-listed action table (src/store/sync.ts) and rejects anything else.
//   - Ordering: the main window renderer stamps `rev` (increasing within one renderer instance, `epoch`). A publish whose rev is not
//     newer than the cached one of the same epoch is stale and dropped. A main window crash / destroyed webContents resets the
//     relay at once (resetMain): the cache is cleared, the Settings window gets `state: null`, and the current epoch is retired.
//   - A main window reload is handled in TWO steps, so it does not depend on how its events interleave with IPC messages:
//     navigationStarted() (did-start-navigation, main frame, cross-document) remembers the epoch current at that moment. Only the
//     OLD document can have published it: the new document runs no script before its navigation starts. navigationCommitted()
//     (did-navigate) then retires exactly that epoch, so a late publish of the old document is dropped, and clears the cache only
//     if it still belongs to the old document. A new document's publish that arrives before did-navigate is processed is
//     therefore kept (never retired by mistake). A navigation that never commits (blocked, download, 204) retires nothing.
//   - Every message to the Settings window carries a `seq` stamped HERE that only ever increases (across main window reloads), so the
//     Settings window's mirror can drop anything older than what it already has.
//   - Actions are forwarded to the main window only while it has published a snapshot (hydrated). Otherwise they are dropped and
//     counted (nothing is queued: the Settings window shows the "waiting" state until a snapshot arrives).
//   - Echo-loop free by construction: actions only travel Settings -> main window, snapshots only main window -> Settings; the main
//     window never sends actions and the Settings window never re-sends what it receives.
import type { IpcSettingsAction, IpcSettingsPublish, IpcSettingsStateMessage } from '../../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};

/** Action `type`: an identifier (the main window's action table decides whether it exists). */
export const SETTINGS_ACTION_TYPE_PATTERN = /^(?=.{1,64}$)[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)?$/;
/** Upper bound of the plugin summary (T-610) as JSON text: 200 plugins of short strings fit in a fraction of this. */
export const SETTINGS_PLUGINS_MAX_CHARS = 100_000;
/** Upper bound of one action as JSON text (the largest legitimate payload is a feature order of a few hundred short ids). */
export const SETTINGS_ACTION_MAX_CHARS = 256_000;
/** Upper bound of one settings snapshot as JSON text (it holds settings keys only, no notes, chats or secrets). */
export const SETTINGS_STATE_MAX_CHARS = 1_000_000;
/** Upper bound of an epoch id. */
export const SETTINGS_EPOCH_MAX_CHARS = 64;
/** How many retired epochs are remembered (one per main window reload of this session is plenty). */
const RETIRED_EPOCHS_KEPT = 32;

/** Length of `value` as JSON text, or -1 when it cannot be serialised (cycles, BigInt, ...). */
export function jsonLength(value: unknown): number {
    try {
        const text = JSON.stringify(value);
        return typeof text === 'string' ? text.length : -1;
    } catch {
        return -1;
    }
}

export type SettingsRelayDrop = 'stale' | 'retired-epoch' | 'main-not-ready' | 'main-unavailable';

export interface SettingsRelayStats {
    published: number;
    forwarded: number;
    dropped: Record<SettingsRelayDrop, number>;
}

export interface SettingsRelayDeps {
    /** Pushes `settings:state` to the Settings window; a no-op while none is open. */
    sendToSettings(message: IpcSettingsStateMessage): void;
    /** Pushes `settings:apply-action` to the main window; false when it is not available. */
    sendToMain(action: IpcSettingsAction): boolean;
    log?(event: string, details?: Record<string, string | number>): void;
}

export interface SettingsRelay {
    /** `settings:publish-state` from the main window top frame (already schema-checked). */
    publish(message: IpcSettingsPublish): void;
    /** `settings:request-state` from the Settings window top frame: answers with the cached snapshot (or `state: null`). */
    requestState(): void;
    /** `settings:action` from the Settings window top frame (already schema-checked). */
    action(action: IpcSettingsAction): void;
    /** The main window renderer is gone (crash, destroyed): forget its state, retire its epoch and tell the Settings window. */
    resetMain(reason: string): void;
    /** did-start-navigation of the main window (main frame, cross-document): remembers the epoch of the document being left. */
    navigationStarted(): void;
    /** did-navigate of the main window: retires the epoch remembered at the start; clears the cache if it is still that epoch's. */
    navigationCommitted(): void;
    stats(): SettingsRelayStats;
}

export function createSettingsRelay(deps: SettingsRelayDeps): SettingsRelay {
    const log = deps.log ?? ((event, details) => console.warn('[KoBar] settings-sync:', event, details ?? {}));
    let cache: IpcSettingsPublish | null = null;
    let seq = 0;
    /** Epoch of the main window renderer instance the cache belongs to (kept after a reset to retire it). */
    let currentEpoch: string | null = null;
    const retired: string[] = [];
    /** Epoch current when the pending main-frame navigation started (null: none pending, or nothing published before it). */
    let leaving: string | null = null;
    const stats: SettingsRelayStats = {
        published: 0,
        forwarded: 0,
        dropped: { stale: 0, 'retired-epoch': 0, 'main-not-ready': 0, 'main-unavailable': 0 },
    };

    function drop(reason: SettingsRelayDrop, details: Record<string, string | number> = {}): void {
        stats.dropped[reason] += 1;
        log('dropped', { reason, ...details });
    }

    function retire(epoch: string): void {
        if (retired.includes(epoch)) return;
        retired.push(epoch);
        if (retired.length > RETIRED_EPOCHS_KEPT) retired.shift();
    }

    function push(): void {
        seq += 1;
        // `plugins` (T-610) travels with the state of the same publish, so both always belong together; omitted when absent.
        deps.sendToSettings({
            seq,
            state: cache ? cache.state : null,
            ack: cache ? cache.ack : 0,
            ...(cache && cache.plugins ? { plugins: cache.plugins } : {}),
            // T-612: same rule for the workspace summary.
            ...(cache && cache.workspaces ? { workspaces: cache.workspaces } : {}),
            // T-614: and for the system summary.
            ...(cache && cache.system ? { system: cache.system } : {}),
        });
    }

    return {
        publish(message) {
            if (retired.includes(message.epoch)) return drop('retired-epoch');
            if (cache && cache.epoch === message.epoch && message.rev <= cache.rev) return drop('stale', { rev: message.rev });
            // A new epoch without a reset (the navigation event was missed): the previous instance is retired as well.
            if (currentEpoch !== null && currentEpoch !== message.epoch) retire(currentEpoch);
            currentEpoch = message.epoch;
            cache = message;
            stats.published += 1;
            push();
        },
        requestState() {
            push();
        },
        action(action) {
            if (!cache) return drop('main-not-ready', { type: action.type });
            if (!deps.sendToMain(action)) return drop('main-unavailable', { type: action.type });
            stats.forwarded += 1;
        },
        resetMain(reason) {
            if (currentEpoch !== null) retire(currentEpoch);
            currentEpoch = null;
            leaving = null;
            const hadState = cache !== null;
            cache = null;
            if (hadState) log('main-reset', { reason });
            // Always tell the Settings window (its mirror drops to "waiting"); harmless when it already was.
            push();
        },
        navigationStarted() {
            leaving = currentEpoch;
        },
        navigationCommitted() {
            const old = leaving;
            leaving = null;
            if (old === null) return;
            retire(old);
            // The new document may already have published (its epoch is then current): keep its state.
            if (currentEpoch !== old) return;
            currentEpoch = null;
            cache = null;
            log('main-reset', { reason: 'navigate' });
            push();
        },
        stats() {
            return { published: stats.published, forwarded: stats.forwarded, dropped: { ...stats.dropped } };
        },
    };
}
