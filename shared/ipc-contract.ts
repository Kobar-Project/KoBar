/**
 * IPC contract (T-302): the single, typed description of every channel between the Electron main process and the
 * renderer (through electron/preload.cts and electron/pip-preload.cts).
 *
 * TYPE-ONLY MODULE. It contains `export type` / `export interface` declarations only and emits no runtime code, so it
 * must be imported with `import type`. It has no imports of its own (not even from electron/ or src/), which keeps it
 * usable from both TypeScript projects:
 *   - electron/ (CommonJS, Node16 resolution): this file is ESM (the root package is `"type": "module"`), and tsc
 *     (TS1541) requires the resolution mode on a type-only import of an ES module from a `.cts` file, so write
 *     `import type { InvokeArgs } from '../shared/ipc-contract.js' with { 'resolution-mode': 'import' };`
 *     (verified in T-302 with tsc and esbuild: the import is erased and nothing is bundled).
 *   - src/ and tests/ (ESNext, bundler resolution): `import type { ... } from '../../shared/ipc-contract'`.
 *
 * The channel groups (a channel name belongs to exactly one group):
 *   - `IpcInvokeMap`  `ipcRenderer.invoke(channel, ...args)` answered by `ipcMain.handle`; the renderer gets a Promise.
 *   - `IpcSendMap`    `ipcRenderer.send(channel, ...args)` handled by `ipcMain.on`; fire and forget, no reply.
 *   - `IpcSyncMap`    `ipcRenderer.sendSync(channel, ...args)` handled by `ipcMain.on` and answered through
 *                     `event.returnValue` (blocks the renderer; internal use only).
 *   - `IpcEventMap`   main -> renderer pushes (`webContents.send(channel, ...args)`), consumed with `ipcRenderer.on`.
 *
 * Every entry is `{ args: [...] }` plus `result` for the request/response groups. `args` is the exact wire tuple (what
 * is passed after the channel name), which can differ from the `window.api` method signature (for example
 * `saveNoteAsText(title, content)` sends one `{ title, content }` object). `result` is the resolved value (the
 * `invoke` Promise is already unwrapped).
 *
 * How T-303 uses this file: the preload and main wiring is moved onto typed helpers, for example
 * `invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>` in the preload and
 * `handle<C extends InvokeChannel>(channel: C, fn: (event, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<...>)`
 * in main, so a wrong argument or return type becomes a compile error. Handlers still validate their input at runtime
 * (the renderer is untrusted), so the argument types here are the contract a well-behaved caller follows, not a
 * guarantee. Changing a shape here changes it for both sides; that is the point.
 *
 * Plugin contract v1 is NOT changed by this file: the `window.api` surface is declared in src/types/global.d.ts. Where a
 * channel backs a `window.api` member the shapes here are identical or more precise; since T-304 global.d.ts derives the
 * identical ones from this file (`InvokeMethod` & co. below), and tests/ipcContract.test.ts pins the whole `window.api`
 * type to its v1 shape at compile time, so a change here that would alter a plugin-visible type fails `tsc -b`. tests/ipcContract.test.ts also parses electron/main.cts and the preloads, so adding,
 * renaming or removing a channel there without updating this file fails the test.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Shared payload shapes
// ---------------------------------------------------------------------------------------------------------------------

/** Mirrors Electron.Rectangle (a plain serialisable object on the wire). */
export interface IpcRectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The serialised Electron.Display fields the renderer can rely on. Electron may include more fields; they are not part
 * of the contract.
 */
export interface IpcDisplay {
    id: number;
    label: string;
    bounds: IpcRectangle;
    workArea: IpcRectangle;
    size: { width: number; height: number };
    workAreaSize: { width: number; height: number };
    scaleFactor: number;
    rotation: number;
    internal: boolean;
    touchSupport: 'available' | 'unavailable' | 'unknown';
    monochrome: boolean;
    colorDepth: number;
    displayFrequency: number;
}

/** A clipboard entry travelling renderer -> main (`write-to-clipboard`, `execute-global-paste`). Main only acts on 'text' and 'image'. */
export interface IpcClipboardEntry {
    type: string;
    content: string;
}

/** A clipboard entry main announces to a subscribed renderer (`clipboard-updated`). `image` content is a data URL. */
export interface IpcClipboardUpdate {
    type: 'text' | 'image';
    content: string;
}

/** The sidebar's hit-test rectangle, relative to the window. */
export interface IpcSidebarRect {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

/**
 * The window model the renderer lays itself out in (T-320; dynamic since T-321, window model A). Answered by `get-window-geometry`
 * and pushed with `window-geometry-changed` whenever main re-fits the window.
 * `width` / `height` are the main window's size, which on Windows equals the ACTIVE display's bounds (the display the bar lives on).
 * macOS also gets display-sized geometry (its window is sized to the display at creation, as before; the answer describes the
 * display under the window centre), but the renderer reads `width` / `centerX` / `centerY` only in its non-macOS branches and keeps
 * using `window.innerWidth` on macOS. `centerX` / `centerY` are half of the size, window-relative. `fallbackScreenWidth` / `fallbackScreenHeight` are used while main has not yet reported the
 * visible screen size. `displayId`, `displayBounds`, `workArea` and `scaleFactor` describe the active display in screen DIP
 * coordinates (`displayBounds` is where the window's origin sits on screen).
 */
export interface IpcWindowGeometry {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    fallbackScreenWidth: number;
    fallbackScreenHeight: number;
    displayId: number;
    displayBounds: IpcRectangle;
    workArea: IpcRectangle;
    scaleFactor: number;
}

/** Payload of the `media-update` channel: one OS media session, or `null` when nothing is playing. */
export interface IpcMediaTrack {
    title: string;
    artist: string;
    albumArt: string | null;
    isPlaying: boolean;
    sourceAppId?: string;
}
export type IpcMediaUpdate = IpcMediaTrack | null;

export type IpcMediaCommand = 'play' | 'pause' | 'next' | 'prev';

/** The channels of `media-resync` (the renderer asks main to resend the last payload of a deduplicated channel). */
export type IpcMediaResyncChannel = 'media-update' | 'video-urls-update';

/** `{ success, reason? }`: the common outcome of file, backup and install operations. `reason` is only set on failure. */
export interface IpcOperationResult {
    success: boolean;
    reason?: string;
}

/** The same, with the written path on success (note export, screenshot save, full backup). */
export interface IpcSaveResult extends IpcOperationResult {
    path?: string;
}

export interface IpcPinBorderStyle {
    /** `#RRGGBB` */
    color: string;
    /** Integer 1-4 (CSS px) */
    width: number;
}

export interface IpcLlmApiKeys {
    openai?: string;
    gemini?: string;
    anthropic?: string;
    localUrl?: string;
}

/** Request body of `llm-request`. `messages` are provider-specific chat messages (OpenAI-style, content may be an array for vision). */
export interface IpcLlmRequest {
    chatId: string;
    messageId: string;
    provider: string;
    model: string;
    messages: unknown[];
    apiKeys?: IpcLlmApiKeys;
    systemPrompt?: string;
}

/** Common identity of one streamed LLM message. */
export interface IpcLlmStreamRef {
    chatId: string;
    messageId: string;
}

export interface IpcParsedFile {
    type: 'text' | 'image' | 'error';
    content: string;
    error?: string;
}

export interface IpcScreenCapture {
    displayId: string;
    bounds: IpcRectangle;
    scaleFactor: number;
    imageDataUrl: string;
}

export interface IpcScreenshotCaptureResult {
    captures: IpcScreenCapture[];
    windowPosition: { x: number; y: number };
    error?: 'permission_denied' | 'rate_limited';
    retryAfterMs?: number;
}

export interface IpcSaveScreenshotRequest {
    /** Base64 or data-URL image payload. */
    buffer: string;
    format: string;
    destinationPath?: string;
    defaultPath?: string;
}

export interface IpcUpdateCheckResult {
    status: 'success' | 'error' | 'disabled';
    updateAvailable?: boolean;
    version?: string;
    message?: string;
}

export interface IpcUpdateProgress {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
}

export interface IpcBackupPlugin {
    id: string;
    folder: string;
    name: string;
    version: string;
    enabled: boolean;
    githubRepo: string;
}

export interface IpcBackupSources {
    extensionsConfig: Record<string, boolean>;
    plugins: IpcBackupPlugin[];
}

/**
 * NOTE (T-303): these fields are copied from the plugin's untrusted manifest.json (and, for updates, GitHub release data).
 * Main does not type-check them, so the declared types are what the code intends, not a guarantee; T-303 must sanitise
 * them in main or loosen the types before relying on them.
 */
export interface IpcInstalledExtension {
    id: string;
    name: string;
    version: string;
    description: string;
    icon: string;
    image: string;
    isBeta: boolean;
    isPlayground: boolean;
    storeImage: string[];
    categories: string[];
    versionNote: string;
    githubRepo: string;
    enabled: boolean;
    code: string;
}

/**
 * NOTE (T-303): these fields are copied from the plugin's untrusted manifest.json (and, for updates, GitHub release data).
 * Main does not type-check them, so the declared types are what the code intends, not a guarantee; T-303 must sanitise
 * them in main or loosen the types before relying on them.
 */
export interface IpcPluginUpdate {
    id: string;
    name: string;
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    repo: string;
    source?: 'registry' | 'github' | 'zip' | 'bundled' | 'legacy';
    legacyOrigin?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// File-backed store transport (T-403). Internal to the host: these channels and shapes are
// NOT part of window.api and are never reachable by plugins (the preload hands them out once, see IpcStorageBridge).
// ---------------------------------------------------------------------------------------------------------------------

/** Key allowlist of the file-backed store: an enum value, never a path segment. Only the host persist key exists in M4. */
export type IpcStorageKey = 'kobar-storage';

/** Where a hydration snapshot came from: the key's file, a rotation backup, or nothing (the renderer falls back to localStorage). */
export type IpcStorageSnapshotSource = 'file' | 'bak' | 'none';

/** Answer of `storage-snapshot`: one hydration read. It re-baselines main's `seq` for the key; writes continue from `seq`. */
export interface IpcStorageSnapshot {
    /** False when reading failed, the store is unavailable or the sender was refused (the renderer falls back to localStorage). */
    ok: boolean;
    key: string;
    source: IpcStorageSnapshotSource;
    /** The seq baseline: the next write must use a larger seq and send this value as `baseSeq`. */
    seq: number;
    schemaVersion: number;
    /** The persist string verbatim, or null when there is no stored value. */
    value: string | null;
    /** Epoch ms of the stored value's write, or null. */
    writtenAt: number | null;
    /** Data on disk was written by a newer storage schema: nothing is written this session. */
    readOnly: boolean;
    disabled: boolean;
    /** The key's file was corrupt (moved to `.corrupt/`); the value, if any, came from `.bak/`. */
    recoveredFromCorrupt: boolean;
    /** The file exists but could not be read: writes are refused until a later snapshot succeeds. */
    unreadable: boolean;
    /** `lastCleanShutdown` recorded by the previous session, or null when unknown (no manifest / store unavailable). */
    previousCleanShutdown: boolean | null;
    /**
     * `manifest.migratedFromLocalStorageAt` (epoch ms), or null. The ONLY signal that the localStorage -> file migration ran
     * (T-404/T-405): manifest.json itself exists from the first startup of T-403 on.
     */
    migratedFromLocalStorageAt: number | null;
}

/** One write of the whole value of a key. `seq` is monotonic per hydration, `baseSeq` is the seq of the snapshot it builds on. */
export interface IpcStorageWriteRequest {
    key: IpcStorageKey;
    seq: number;
    baseSeq: number;
    value: string;
}

export type IpcStorageWriteFailure =
    | 'invalid-request'
    | 'invalid-key'
    | 'invalid-seq'
    | 'invalid-value'
    | 'too-large'
    | 'stale'
    | 'stale-base'
    | 'read-only'
    | 'disabled'
    | 'unavailable'
    | 'io'
    | 'backup-failed'
    | 'rehydrated'
    | 'unreadable'
    /** The sender is not the main window's top frame. */
    | 'denied'
    /** The sender wrote before it received a snapshot (main never accepts a write without a hydration baseline). */
    | 'not-hydrated';

/** Answer of `storage-write` / `storage-write-sync`. `ok` means the value (or a newer one, `superseded`) is on disk. */
export interface IpcStorageWriteAck {
    key: string;
    seq: number;
    ok: boolean;
    reason?: IpcStorageWriteFailure;
    /** True when the same data may be sent again later (I/O trouble); false for rejections that will never succeed. */
    retryable?: boolean;
    code?: string;
    superseded?: boolean;
}

/**
 * T-404: every localStorage key with its raw value (`_iso_` and plugin keys included), sent once so main can write the
 * masked archive `kobar-data/localstorage-snapshot/`. Main masks; localStorage itself is never changed.
 */
export interface IpcLocalStorageSnapshotRequest {
    entries: Array<[key: string, value: string]>;
}

export type IpcLocalStorageSnapshotStatus =
    /** The snapshot, its `.done` marker and `manifest.migratedFromLocalStorageAt` were written. */
    | 'written'
    /** A snapshot was taken before (manifest field or `.done` marker): nothing was written. */
    | 'already-done'
    | 'denied'
    | 'not-hydrated'
    | 'invalid-request'
    | 'too-large'
    | 'disabled'
    | 'read-only'
    | 'unavailable'
    | 'io';

/** Answer of `storage-localstorage-snapshot`. Counts only, never values or key names. */
export interface IpcLocalStorageSnapshotResult {
    ok: boolean;
    status: IpcLocalStorageSnapshotStatus;
    /** When the snapshot was taken (epoch ms), or null when there is none. */
    migratedFromLocalStorageAt: number | null;
    /** Keys stored in the snapshot (values masked), keys kept by name and size only. */
    keyCount?: number;
    omittedCount?: number;
}

/** What the host gets from `window.__kobarStorage.claim()` (only the FIRST claim gets it; every later claim gets null). */
export interface IpcClaimedStorageBridge {
    /** The boot snapshot the preload read before any page script ran, or null when that read failed. */
    snapshot: IpcStorageSnapshot | null;
    /** A new hydration read (`storage-snapshot`); null when it failed. Re-baselines main's seq. */
    readSnapshot(): IpcStorageSnapshot | null;
    write(request: IpcStorageWriteRequest): Promise<IpcStorageWriteAck>;
    /** Blocking one-shot write for the unload path. */
    writeSync(request: IpcStorageWriteRequest): IpcStorageWriteAck;
    /** T-404: the one-time masked localStorage archive (`storage-localstorage-snapshot`). */
    archiveLocalStorage(request: IpcLocalStorageSnapshotRequest): Promise<IpcLocalStorageSnapshotResult>;
}

/** The internal object the preload exposes as `window.__kobarStorage` (not window.api). */
export interface IpcStorageBridge {
    claim(): IpcClaimedStorageBridge | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings window state sync (T-606). The MAIN window's store is the single source of truth; the Settings window keeps a
// read-only mirror and sends actions. Flow:
//   Settings window --settings:action--> main --settings:apply-action--> main window renderer (allow-listed action table)
//   main window renderer --settings:publish-state--> main (caches the latest) --settings:state--> Settings window
//   Settings window --settings:request-state--> main (answers with the cached snapshot, or `state: null` while not ready)
// None of these is part of window.api. The main window's half is a claim-once bridge (`window.__kobarSettingsSync`, claimed by the
// host before any plugin script runs); the Settings window's half is its own narrow preload (`window.settingsBridge`).
// ---------------------------------------------------------------------------------------------------------------------

/** The settings-relevant, JSON-safe part of the main window's store (keys: SETTINGS_SYNC_KEYS in src/store/sync.ts). */
export type IpcSettingsState = Record<string, unknown>;

/** One action of the Settings window. `type` names an entry of the main window's action table; anything else is rejected there. */
export interface IpcSettingsAction {
    /** Increasing per Settings window session; echoed back as `ack` once the main window processed it (applied or rejected). */
    id: number;
    type: string;
    payload?: unknown;
}

/** One installed plugin as the Settings window sees it (T-610). No code, repo, path or manifest: a list row's data only. */
export interface IpcPluginSummaryItem {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    /** False for dev playground plugins (the old UI offers no uninstall for them either). */
    removable: boolean;
    updateAvailable: boolean;
    latestVersion: string | null;
    /** The plugin registered a v1 settings panel (it opens in the main window). */
    hasSettingsPanel: boolean;
    /** R-16: strict "owner/name" GitHub repo from the manifest (display link only), or null. */
    repo: string | null;
}

/** One catalogue (registry) entry as the Settings window sees it (T-611). Read-only: no repo, URL, code or path. */
export interface IpcPluginCatalogItem {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    category: string;
    beta: boolean;
    /** R-16: strict "owner/name" GitHub repo of the entry (display link only; installs still use the main window's own copy), or null. */
    repo: string | null;
    /** Computed by the main window from its live installed list. */
    installed: boolean;
}

/** The plugin catalogue state (T-611): fetched by the main window only when the Discover tab asks for it. */
export interface IpcPluginCatalog {
    /** `idle`: never requested. `error`: the last fetch failed (`error` says why). */
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: 'offline' | 'failed' | null;
    items: IpcPluginCatalogItem[];
    /** Id of the catalogue plugin being installed right now, or null. */
    installingId: string | null;
    /** Outcome of the last catalogue install, null before any. */
    lastInstall: { id: string; result: 'success' | 'failed' | 'canceled' } | null;
}

/** The plugin summary the main window publishes next to the settings state (T-610), size-capped and schema-checked in main. */
export interface IpcPluginSummary {
    items: IpcPluginSummaryItem[];
    /** T-611: absent from older publishers; the Settings window treats absence as `idle`. */
    catalog?: IpcPluginCatalog;
    status: { checked: boolean; checking: boolean; updating: boolean };
    /** Outcome counts of the last "update" run, null before any. */
    lastUpdate: { updated: number; failed: number; canceled: number } | null;
}

/** One workspace as the Settings window sees it (T-612). No notes, no isolated data, no plugin data: a list row's data only. */
export interface IpcWorkspaceSummaryItem {
    id: string;
    name: string;
    isolated: boolean;
    /** The workspace owns isolated data (also while it is switched back to shared): deleting it removes that data. A flag only. */
    hasIsolatedData: boolean;
    /** True for the workspace the main window currently runs in. */
    active: boolean;
}

/** The workspace summary the main window publishes next to the settings state (T-612), size-capped and schema-checked in main. */
export interface IpcWorkspaceSummary {
    items: IpcWorkspaceSummaryItem[];
}

/** Update centre states the Settings window shows (T-614). */
export type IpcSystemUpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'downloaded' | 'error';

/**
 * The system summary the main window publishes next to the settings state (T-614): app version, the update centre state and whether
 * a full backup export is running. Plain codes, numbers and a version string: no paths, no error text, no secrets.
 */
export interface IpcSystemSummary {
    version: string;
    /** False in the Microsoft Store build (the Store updates the app): the Settings window hides the update centre. */
    updatesEnabled: boolean;
    update: { status: IpcSystemUpdateStatus; version: string; percent: number };
    backup: { busy: boolean; last: 'done' | 'failed' | 'canceled' | null };
}

/** main window renderer -> main: the current settings state. `rev` increases within one renderer instance (`epoch`). */
export interface IpcSettingsPublish {
    /** Random id of the publishing renderer instance; a reload starts a new epoch. */
    epoch: string;
    rev: number;
    /** Id of the last Settings window action this renderer processed, applied or rejected (0 = none). */
    ack: number;
    state: IpcSettingsState;
    /** T-610: the plugin summary (optional: absent until the main window has read its plugin list). */
    plugins?: IpcPluginSummary;
    /** T-612: the workspace summary (optional: absent until the main window has hydrated). */
    workspaces?: IpcWorkspaceSummary;
    /** T-614: the system summary (version, update centre, backup state). */
    system?: IpcSystemSummary;
}

/** main -> Settings window. `seq` is stamped by main and only ever increases (across main window reloads too). */
export interface IpcSettingsStateMessage {
    seq: number;
    /** Null while the main window has no hydrated state to offer (starting, reloading, crashed). */
    state: IpcSettingsState | null;
    ack: number;
    /** T-610: the plugin summary of the same publish as `state` (absent when there is none). */
    plugins?: IpcPluginSummary;
    /** T-612: the workspace summary of the same publish as `state` (absent when there is none). */
    workspaces?: IpcWorkspaceSummary;
    /** T-614: the system summary of the same publish as `state` (absent when there is none). */
    system?: IpcSystemSummary;
}

/** What the host gets from `window.__kobarSettingsSync.claim()` (only the FIRST claim; later claims get null). */
export interface IpcClaimedSettingsSyncBridge {
    publish(message: IpcSettingsPublish): void;
    /** Subscribes to the actions main forwards from the Settings window; returns the unsubscribe function. */
    onAction(callback: (action: IpcSettingsAction) => void): () => void;
    /** T-615: opens (or focuses) the Settings window, optionally at one page. Fire and forget. */
    openSettings(page?: string): void;
}

/** The internal object the main window preload exposes as `window.__kobarSettingsSync` (not window.api). */
export interface IpcSettingsSyncBridge {
    claim(): IpcClaimedSettingsSyncBridge | null;
}

/** `window.settingsBridge`: the ONLY thing electron/settings-preload.cts exposes, to the Settings window only. */
export interface IpcSettingsWindowBridge {
    onState(callback: (message: IpcSettingsStateMessage) => void): () => void;
    requestState(): void;
    dispatch(action: IpcSettingsAction): void;
    /** T-615: the main window asked for a page while this window was already open; returns the unsubscribe function. */
    onShowPage(callback: (page: string) => void): () => void;
    /** R2-15: Google Calendar (Experimental) controls of the Settings > Integrations page. Never returns a token. */
    gcalStatus(): Promise<IpcGcalStatus>;
    gcalConnect(): Promise<IpcGcalConnectResult>;
    gcalDisconnect(): Promise<IpcGcalStatus>;
    gcalSetEnabled(enabled: boolean): Promise<IpcGcalStatus>;
    gcalRefresh(): Promise<IpcGcalStatus>;
}

/**
 * Google Calendar v1 (R2-15, host addition, EXPERIMENTAL, read-only). Only these shapes ever reach the renderer: never a token, an
 * e-mail address or the client secret. `state`: `not-configured` (no gcal-client.local.json), `not-connected`, `connected`,
 * `reconnect-needed` (the refresh token was rejected, e.g. the 7-day Testing-mode expiry).
 */
export type IpcGcalState = 'not-configured' | 'not-connected' | 'connected' | 'reconnect-needed';

export interface IpcGcalStatus {
    state: IpcGcalState;
    /** The user's feature switch (default false); while false, `gcalListEvents` answers `[]` and no timer runs. */
    enabled: boolean;
    /** A client id/secret file was found and is valid. */
    configured: boolean;
    /** `state === 'connected'`. */
    connected: boolean;
    /** Epoch milliseconds of the last successful fetch, or null. */
    lastRefreshAt: number | null;
}

export type IpcGcalConnectFailure =
    | 'disabled'
    | 'not-configured'
    | 'encryption-unavailable'
    | 'busy'
    | 'timeout'
    | 'denied'
    | 'state-mismatch'
    | 'exchange-failed'
    | 'io'
    | 'denied-sender';

export interface IpcGcalConnectResult {
    success: boolean;
    reason?: IpcGcalConnectFailure;
    status: IpcGcalStatus;
}

/** One Google event. All-day: `start` / `end` are `YYYY-MM-DD` and `end` is INCLUSIVE; otherwise ISO 8601 with a UTC offset. */
export interface IpcGcalEvent {
    /** `google:<Google event id>` (never collides with plugin event ids). */
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    calendar: 'google';
}

/** ISO 8601 strings; the range is validated (valid dates, from < to, at most 400 days). */
export interface IpcGcalRange {
    from: string;
    to: string;
}

/**
 * Why a `secret-*` call failed (T-411). `encryption-unavailable`: safeStorage cannot encrypt, nothing was saved (no plaintext fallback).
 * `reserved-name` (T-417): a well-formed name outside the plugin namespace `plugin-<plugin id>-<key>`; those are core names that
 * only the main process may touch.
 */
export type IpcSecretFailure =
    | 'invalid-request'
    | 'invalid-name'
    | 'reserved-name'
    | 'invalid-value'
    | 'too-large'
    | 'limit-reached'
    | 'encryption-unavailable'
    | 'encryption-failed'
    | 'io'
    | 'denied';

/** What the renderer may learn about a stored secret (T-411): never the value, only whether it exists and its last 4 characters. */
export interface IpcSecretStatus {
    name: string;
    exists: boolean;
    /** Last 4 characters, or null when there is none, it cannot be decrypted, or the secret is too short to show any of it. */
    last4: string | null;
    /** safeStorage can encrypt on this system; when false, `secret-set` refuses to save. */
    encryptionAvailable: boolean;
    /** The secret exists but cannot be decrypted (encryption unavailable, another OS user/profile, corrupt file). */
    unreadable: boolean;
}

export interface IpcSecretResult {
    success: boolean;
    reason?: IpcSecretFailure;
    status?: IpcSecretStatus;
}

// ---------------------------------------------------------------------------------------------------------------------
// invoke: renderer -> main, answered with a value (ipcRenderer.invoke / ipcMain.handle)
// ---------------------------------------------------------------------------------------------------------------------

export interface IpcInvokeMap {
    /** The four strings are sent by the preload but ignored by main, which shows fixed text (SEC-15). Resolves true when the user chose to download. */
    'ask-for-update': {
        args: [payload: { title: string; message: string; yesLabel: string; noLabel: string }];
        result: boolean;
    };
    'save-note-as-text': { args: [payload: { title: string; content: string }]; result: IpcSaveResult };
    'check-for-updates-manual': { args: []; result: IpcUpdateCheckResult };
    'get-pin-border-style': { args: []; result: IpcPinBorderStyle };
    'set-pin-border-style': {
        args: [style: IpcPinBorderStyle];
        result: { success: boolean; error?: 'invalid-style' | 'persist-failed' };
    };
    /** Never rejects: failures come back as `{ type: 'error', content }`. */
    'parse-file': { args: [filePath: string]; result: IpcParsedFile };
    'cancel-llm-request': { args: [messageId: string]; result: void };
    /** Resolves when the request ends; the answer itself streams through the `llm-stream-*` events. */
    'llm-request': { args: [data: IpcLlmRequest]; result: void };
    'get-auto-launch': { args: []; result: boolean };
    'start-screenshot-capture': { args: []; result: IpcScreenshotCaptureResult };
    'save-screenshot': { args: [data: IpcSaveScreenshotRequest]; result: IpcSaveResult };
    'get-active-video-urls': { args: []; result: string[] };
    /** The SMTC source app id (empty string when unknown). */
    'get-smtc-source': { args: []; result: string };
    /** `null` when the calling window cannot be resolved. */
    'recenter-window-on-widget': {
        args: [relativeX: number, relativeY: number, width: number, height: number];
        result: { x: number; y: number; displayBounds: IpcRectangle } | null;
    };
    'get-displays-info': { args: []; result: { primaryDisplay: IpcDisplay; allDisplays: IpcDisplay[] } };
    'get-screen-bounds': { args: []; result: IpcRectangle };
    /** A PNG data URL, or `null` when the path is refused or no icon could be read. */
    'get-file-icon': { args: [filePath: string]; result: string | null };
    /** An `audio/ogg` data URL, or `null` for an unknown melody name. */
    'get-melody-audio': { args: [melodyName: string]; result: string | null };
    'get-installed-extensions': { args: []; result: IpcInstalledExtension[] };
    'get-backup-sources': { args: []; result: IpcBackupSources };
    'save-full-backup': { args: [text: string]; result: IpcSaveResult };
    'create-pre-restore-backup': { args: [text: string]; result: IpcOperationResult };
    'create-pre-delete-backup': { args: [text: string]; result: IpcOperationResult };
    'apply-restore-and-relaunch': { args: [extensionsConfig: Record<string, boolean>]; result: IpcOperationResult };
    'check-plugin-updates': { args: []; result: IpcPluginUpdate[] };
    'uninstall-extension': { args: [id: string]; result: boolean };
    'toggle-extension-enabled': { args: [id: string, enabled: boolean]; result: boolean };
    'set-extensions-config': { args: [config: Record<string, boolean>]; result: boolean };
    'install-extension-from-file': { args: []; result: IpcOperationResult };
    'install-extension-from-path': { args: [filePath: string]; result: IpcOperationResult };
    'install-extension-from-github': { args: [id: string, repo: string]; result: IpcOperationResult };
    'get-app-version': { args: []; result: string };
    'is-dev': { args: []; result: boolean };
    /** T-411: `{ exists, last4 }` of an encrypted secret; there is deliberately NO channel that returns a secret's value. */
    'secret-status': { args: [name: string]; result: IpcSecretResult };
    /** T-411: encrypts (safeStorage) and stores a secret; refuses when encryption is unavailable. Answers with the new status only. */
    'secret-set': { args: [name: string, value: string]; result: IpcSecretResult };
    'secret-delete': { args: [name: string]; result: IpcSecretResult };
    /** R2-15 (Experimental, read-only): Google Calendar. Main window top frame; tokens never leave main. */
    'gcal-status': { args: []; result: IpcGcalStatus };
    'gcal-connect': { args: []; result: IpcGcalConnectResult };
    'gcal-disconnect': { args: []; result: IpcGcalStatus };
    'gcal-list-events': { args: [range: IpcGcalRange]; result: IpcGcalEvent[] };
    /** R2-15: the same service for the Settings window only (settings-preload, never window.api). */
    'gcal-settings-status': { args: []; result: IpcGcalStatus };
    'gcal-settings-connect': { args: []; result: IpcGcalConnectResult };
    'gcal-settings-disconnect': { args: []; result: IpcGcalStatus };
    'gcal-settings-set-enabled': { args: [enabled: boolean]; result: IpcGcalStatus };
    'gcal-settings-refresh': { args: []; result: IpcGcalStatus };
    /** Internal (T-403): queued, coalesced write of the file-backed store; resolves with the ack after the rename. Not part of window.api. */
    'storage-write': { args: [request: IpcStorageWriteRequest]; result: IpcStorageWriteAck };
    /** Internal (T-404): one-time masked copy of localStorage into kobar-data/localstorage-snapshot/. Not part of window.api. */
    'storage-localstorage-snapshot': { args: [request: IpcLocalStorageSnapshotRequest]; result: IpcLocalStorageSnapshotResult };
}

// ---------------------------------------------------------------------------------------------------------------------
// send: renderer -> main, no reply (ipcRenderer.send / ipcMain.on)
// ---------------------------------------------------------------------------------------------------------------------

export interface IpcSendMap {
    'hide-app': { args: [] };
    'quit-app': { args: [] };
    /** Internal ack of the `flush-persist` event; carries the id main sent (T-129). Not part of window.api. */
    'flush-persist-done': { args: [id: number] };
    'download-and-install-update': { args: [] };
    'quit-and-install-update': { args: [] };
    'enter-pin-targeting': { args: [] };
    'unpin-current-window': { args: [] };
    'unpin-all-windows': { args: [] };
    'send-notification': { args: [payload: { title: string; body: string }] };
    /** Internal: reports a path the user dropped or picked (T-042). Not part of window.api. */
    'grant-path': { args: [filePath: string] };
    'kobox-drop': { args: [filePaths: string[]] };
    'kobox-open': { args: [] };
    'kobox-clean': { args: [mode: '24h' | 'quit'] };
    'set-auto-launch': { args: [enabled: boolean] };
    'start-clipboard-listener': { args: [] };
    'stop-clipboard-listener': { args: [] };
    'write-to-clipboard': { args: [data: IpcClipboardEntry] };
    'set-ignore-mouse-events': { args: [ignore: boolean] };
    'set-global-paste-mode': { args: [isActive: boolean] };
    'execute-global-paste': { args: [data: IpcClipboardEntry] };
    'trigger-screenshot': { args: [] };
    'take-screenshot': { args: [hideApp: boolean] };
    'cancel-screenshot': { args: [] };
    'copy-screenshot-to-clipboard': { args: [dataUrl: string] };
    'screenshot-session-complete': { args: [] };
    'open-pip': { args: [payload: { url: string; title: string; albumArt?: string }] };
    'close-pip': { args: [] };
    /** Also sent by the narrow PiP preload (`pipApi.move`). */
    'move-window': { args: [delta: { dx: number; dy: number }] };
    'update-sidebar-rect': { args: [rect: IpcSidebarRect] };
    'launch-file': { args: [filePath: string] };
    /** Internal: a late `media-update` / `video-urls-update` subscriber asks for the last payload (T-128). Not part of window.api. */
    'media-resync': { args: [channel: IpcMediaResyncChannel] };
    'media-command': { args: [command: IpcMediaCommand] };
    'open-external': { args: [url: string] };
    /**
     * Internal (T-605): opens or focuses the Settings window, optionally at one page (T-615; an unknown page name is ignored). Main
     * window top frame only. Not part of window.api: the only sender is the claim-once `__kobarSettingsSync` host bridge.
     */
    'settings:open': { args: [page?: string] };
    /** Internal (T-606): an action of the Settings window (narrow settings-preload). Settings window top frame only. */
    'settings:action': { args: [action: IpcSettingsAction] };
    /** Internal (T-606): the Settings window asks for the current snapshot (answered with `settings:state`). Settings window top frame only. */
    'settings:request-state': { args: [] };
    /** Internal (T-606): the main window's settings state, claim-once bridge only. Main window top frame only. Not part of window.api. */
    'settings:publish-state': { args: [message: IpcSettingsPublish] };
    /** Legacy v1 plugin API (`registerTeleportShortcut`). The preload sends it but main has no handler (no-op). */
    'register-teleport-shortcut': { args: [shortcut: string] };
}

// ---------------------------------------------------------------------------------------------------------------------
// sync: renderer -> main, blocking, answered through event.returnValue (ipcRenderer.sendSync / ipcMain.on)
// ---------------------------------------------------------------------------------------------------------------------

export interface IpcSyncMap {
    /** Internal pre-migration backup of `kobar-storage` (PROD-02, T-201); the backup path is never returned. Not part of window.api. */
    'backup-kobar-storage': { args: [raw: string]; result: { created: boolean; reason: string | null } };
    /** The calling window's `[x, y]`; `[0, 0]` when it cannot be resolved. */
    'get-window-position-sync': { args: []; result: [number, number] };
    /** The window model (T-320, host addition); `null` for a sender other than the main window's top frame. */
    'get-window-geometry': { args: []; result: IpcWindowGeometry | null };
    /** Internal (T-403): the boot hydration snapshot, read once by the preload (and again only to re-baseline). Not part of window.api. */
    'storage-snapshot': { args: [key: IpcStorageKey]; result: IpcStorageSnapshot };
    /** Internal (T-403): blocking write for the unload path (same checks and 20 MB cap as `storage-write`). Not part of window.api. */
    'storage-write-sync': { args: [request: IpcStorageWriteRequest]; result: IpcStorageWriteAck };
}

// ---------------------------------------------------------------------------------------------------------------------
// event: main -> renderer pushes (webContents.send / ipcRenderer.on)
// ---------------------------------------------------------------------------------------------------------------------

export interface IpcEventMap {
    'edge-changed': { args: [edge: 'left' | 'right', bounds: IpcRectangle] };
    'force-center-mini-mode': { args: [] };
    /** The main window was re-fitted to a display (T-321, host addition): the new window model, same shape as `get-window-geometry`. */
    'window-geometry-changed': { args: [geometry: IpcWindowGeometry] };
    'clipboard-updated': { args: [data: IpcClipboardUpdate] };
    'open-settings': { args: [] };
    'request-next-paste': { args: [] };
    'clipboard-paste-error': { args: [data: { error: string; message: string }] };
    'pinned-window-changed': { args: [hwnd: number | null] };
    'pin-targeting-complete': { args: [] };
    'update-available': { args: [version: string] };
    'update-download-progress': { args: [progress: IpcUpdateProgress] };
    'update-download-complete': { args: [version: string] };
    'update-error': { args: [message: string] };
    'llm-stream-chunk': { args: [data: IpcLlmStreamRef & { chunk: string }] };
    'llm-stream-end': { args: [data: IpcLlmStreamRef] };
    'llm-stream-error': { args: [data: IpcLlmStreamRef & { error: string }] };
    /** Also pushed to the PiP window (narrow preload). Deduplicated by main; late subscribers use `media-resync`. */
    'media-update': { args: [data: IpcMediaUpdate] };
    /** Deduplicated by main; late subscribers use `media-resync`. */
    'video-urls-update': { args: [urls: string[]] };
    'pip-closed': { args: [] };
    'plugin-install-progress': { args: [data: { id: string; percent: number }] };
    /** Internal request to write the debounced persist state (T-129); the preload re-dispatches it as a DOM event and acks with `flush-persist-done`. */
    'flush-persist': { args: [id: number] };
    /** Internal (T-606): the settings snapshot, pushed to the Settings window only. */
    'settings:state': { args: [message: IpcSettingsStateMessage] };
    /** Internal (T-615): the Settings window is already open; show this page (pushed to the Settings window only, validated there). */
    'settings:show-page': { args: [page: string] };
    /** Internal (T-606): a Settings window action, pushed to the main window only (claim-once bridge). Not part of window.api. */
    'settings:apply-action': { args: [action: IpcSettingsAction] };
    /** Legacy v1 plugin API (`onTeleportTriggered`). The preload subscribes but main never sends it (no-op). */
    'teleport-triggered': { args: [data: { x: number; y: number }] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Helper types for T-303 (typed handle/invoke/send/on wrappers)
// ---------------------------------------------------------------------------------------------------------------------

export type InvokeChannel = keyof IpcInvokeMap;
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeMap[C]['args'];
export type InvokeResult<C extends InvokeChannel> = IpcInvokeMap[C]['result'];

export type SendChannel = keyof IpcSendMap;
export type SendArgs<C extends SendChannel> = IpcSendMap[C]['args'];

export type SyncChannel = keyof IpcSyncMap;
export type SyncArgs<C extends SyncChannel> = IpcSyncMap[C]['args'];
export type SyncResult<C extends SyncChannel> = IpcSyncMap[C]['result'];

export type EventChannel = keyof IpcEventMap;
export type EventArgs<C extends EventChannel> = IpcEventMap[C]['args'];

/** Every channel name in the contract. */
export type IpcChannel = InvokeChannel | SendChannel | SyncChannel | EventChannel;

// ---------------------------------------------------------------------------------------------------------------------
// Renderer side (T-304): the typed view of Electron's ipcRenderer used by electron/preload.cts and electron/pip-preload.cts
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The only `ipcRenderer` the preloads call: `const ipcRenderer: TypedIpcRenderer<Electron.IpcRendererEvent> = electronIpcRenderer;`
 * (Electron's untyped ipcRenderer is assignable to it, so this is a type annotation only, with no runtime wrapper). Every
 * call then has to name a channel of the right group with the contract's wire arguments, and gets the contract's result.
 * `E` is the IPC event object handed to `on` listeners (kept generic so this file needs no Electron import).
 */
export interface TypedIpcRenderer<E> {
    invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>;
    send<C extends SendChannel>(channel: C, ...args: SendArgs<C>): void;
    sendSync<C extends SyncChannel>(channel: C, ...args: SyncArgs<C>): SyncResult<C>;
    on<C extends EventChannel>(channel: C, listener: (event: E, ...args: EventArgs<C>) => void): unknown;
    removeListener<C extends EventChannel>(channel: C, listener: (event: E, ...args: EventArgs<C>) => void): unknown;
}

// window.api method shapes for a method that passes its arguments to the channel unchanged (src/types/global.d.ts derives
// those members from these; methods whose wire arguments differ stay hand-written there).

/** `(...wire args) => Promise<result>` for an `ipcRenderer.invoke` channel. */
export type InvokeMethod<C extends InvokeChannel> = (...args: InvokeArgs<C>) => Promise<InvokeResult<C>>;
/** `(...wire args) => void` for an `ipcRenderer.send` channel. */
export type SendMethod<C extends SendChannel> = (...args: SendArgs<C>) => void;
/** `(...wire args) => result` for an `ipcRenderer.sendSync` channel. */
export type SyncMethod<C extends SyncChannel> = (...args: SyncArgs<C>) => SyncResult<C>;
/** `on*(callback) => unsubscribe` for an event channel; the callback receives the payload without the IPC event. */
export type EventMethod<C extends EventChannel> = (callback: (...args: EventArgs<C>) => void) => () => void;
