// T-303: argument schemas and "invalid input" results of the channels registered through the typed IPC registry.
// Rules: a schema only checks what the handler already assumed (deliberately permissive: extra trailing arguments are
// accepted with `.rest(z.unknown())`, objects are loose), and `onInvalid` returns EXACTLY what the handler itself returns
// for that bad input, so a plugin or renderer that sends odd arguments sees the same result as before. Every finer
// check (path grants, repo format, reserved keys, ...) stays in the handler. tests/ipcRegistry.test.ts compares the
// `reason` strings below with the handlers in electron/main.cts.
import { z } from 'zod';
import {
    SETTINGS_ACTION_MAX_CHARS,
    SETTINGS_ACTION_TYPE_PATTERN,
    SETTINGS_EPOCH_MAX_CHARS,
    SETTINGS_PLUGINS_MAX_CHARS,
    SETTINGS_STATE_MAX_CHARS,
    jsonLength,
} from '../../lib/settingsSync.cjs';
import type { HandleOptions, OnOptions } from './registry.cjs';

/** A tuple whose first element matches `schema`; any further arguments are accepted and ignored (as before). */
function firstArg(schema: z.ZodType) {
    return z.tuple([schema]).rest(z.unknown());
}

// ─── File channels ───────────────────────────────────────────────

/** The handler throws 'Invalid file path' for a non-path and returns `{ type: 'error', content: String(e) }`. */
export const PARSE_FILE_OPTIONS: HandleOptions<'parse-file'> = {
    args: firstArg(z.string()),
    onInvalid: () => ({ type: 'error', content: 'Error: Invalid file path' }),
};

/** validateIconPath() returns null for a non-string, so the handler returns null. */
export const GET_FILE_ICON_OPTIONS: HandleOptions<'get-file-icon'> = {
    args: firstArg(z.string()),
    onInvalid: () => null,
};

/** Without an object there is no `format`, so normalizeImageFormat() fails and the handler returns 'invalid-format'. */
export const SAVE_SCREENSHOT_OPTIONS: HandleOptions<'save-screenshot'> = {
    args: firstArg(z.looseObject({})),
    onInvalid: () => ({ success: false, reason: 'invalid-format' }),
};

/** Internal channel of the preload's getFilePath: only the main window's top frame may grant (the handler checks it too). */
export const GRANT_PATH_OPTIONS: OnOptions = {
    args: firstArg(z.string()),
    senderPolicy: 'main-window-top-frame',
};

/** The handler ignores anything but an array (each item is still checked against the path grants). */
export const KOBOX_DROP_OPTIONS: OnOptions = {
    args: firstArg(z.array(z.unknown())),
};

/** cleanKoBox() ignores every other mode. */
export const KOBOX_CLEAN_OPTIONS: OnOptions = {
    args: firstArg(z.enum(['24h', 'quit'])),
};

// ─── Plugin channels ─────────────────────────────────────────────

/** canDeletePluginFolder() refuses a non-string id ('invalid-id'), so the handler returns false. */
export const UNINSTALL_EXTENSION_OPTIONS: HandleOptions<'uninstall-extension'> = {
    args: firstArg(z.string()),
    onInvalid: () => false,
};

/** Same shape check as the handler (string, 1-256 UTF-16 units); `enabled` stays unchecked (`enabled !== false`). */
export const TOGGLE_EXTENSION_ENABLED_OPTIONS: HandleOptions<'toggle-extension-enabled'> = {
    args: firstArg(z.string().min(1).max(256)),
    onInvalid: () => false,
};

/** The handler only accepts a non-null, non-array object and returns false otherwise. */
export const SET_EXTENSIONS_CONFIG_OPTIONS: HandleOptions<'set-extensions-config'> = {
    args: firstArg(z.looseObject({})),
    onInvalid: () => false,
};

export const INSTALL_FROM_PATH_INVALID_REASON = 'Invalid file path.';

/** The handler returns this reason for a missing, empty or non-string path. */
export const INSTALL_EXTENSION_FROM_PATH_OPTIONS: HandleOptions<'install-extension-from-path'> = {
    args: firstArg(z.string().min(1)),
    onInvalid: () => ({ success: false, reason: INSTALL_FROM_PATH_INVALID_REASON }),
};

export const INSTALL_FROM_GITHUB_INVALID_REASON = 'Invalid GitHub repository format.';

/** `id` is only a display/progress key and stays unchecked; a non-string repo fails parseGithubRepo() with this reason. */
export const INSTALL_EXTENSION_FROM_GITHUB_OPTIONS: HandleOptions<'install-extension-from-github'> = {
    args: z.tuple([z.unknown(), z.string()]).rest(z.unknown()),
    onInvalid: () => ({ success: false, reason: INSTALL_FROM_GITHUB_INVALID_REASON }),
};

// ─── Secret channels (T-411, new: no legacy result to match) ─────

/**
 * Only the main window's top frame may touch secrets (plugins run there too; they can never read a value back, there is no
 * such channel). Name and value must be strings; the name pattern, size and count limits are checked by the SecretService.
 */
const SECRET_CHANNEL_POLICY = {
    onInvalid: () => ({ success: false, reason: 'invalid-request' as const }),
    senderPolicy: 'main-window-top-frame' as const,
    onDenied: () => ({ success: false, reason: 'denied' as const }),
};

export const SECRET_STATUS_OPTIONS: HandleOptions<'secret-status'> = { args: firstArg(z.string()), ...SECRET_CHANNEL_POLICY };
export const SECRET_SET_OPTIONS: HandleOptions<'secret-set'> = {
    args: z.tuple([z.string(), z.string()]).rest(z.unknown()),
    ...SECRET_CHANNEL_POLICY,
};
export const SECRET_DELETE_OPTIONS: HandleOptions<'secret-delete'> = { args: firstArg(z.string()), ...SECRET_CHANNEL_POLICY };

// ─── Window channels (T-605, new: no legacy result to match) ─────

/**
 * Opens (or focuses) the Settings window, optionally at one page (T-615; an unknown page is ignored by the handler, the window
 * still opens). Only the main window's top frame may ask; the sender is the claim-once host bridge, never window.api.
 */
export const SETTINGS_OPEN_OPTIONS: OnOptions = {
    args: z.tuple([z.string().max(32).optional()]),
    senderPolicy: 'main-window-top-frame',
};

// ─── Settings window state sync (T-606, new: no legacy result to match) ─────

/**
 * `settings:action`: one Settings window action. `type` is an identifier (the main window's action table decides if it exists).
 * A strict shape (z.object); the handler forwards only `{ id, type, payload }` (the registry passes the original object on).
 */
export const SETTINGS_ACTION_OPTIONS: OnOptions = {
    args: firstArg(
        z
            .object({
                id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
                type: z.string().regex(SETTINGS_ACTION_TYPE_PATTERN),
                payload: z.unknown(),
            })
            .refine((action) => {
                const length = jsonLength(action);
                return length >= 0 && length <= SETTINGS_ACTION_MAX_CHARS;
            })
    ),
    senderPolicy: 'settings-window-top-frame',
};

/** `settings:request-state`: no arguments; the Settings window top frame asks for the current snapshot. */
export const SETTINGS_REQUEST_STATE_OPTIONS: OnOptions = {
    args: z.tuple([]).rest(z.unknown()),
    senderPolicy: 'settings-window-top-frame',
};

/**
 * T-610: the plugin summary next to the settings snapshot. Strict objects and bounded strings / counts (the renderer-side
 * limits are PLUGIN_SUMMARY_LIMITS in src/store/pluginSummary.ts); the whole section is also capped as JSON text.
 */
const PLUGIN_SUMMARY_SCHEMA = z
    .strictObject({
        catalog: z
            .strictObject({
                status: z.enum(['idle', 'loading', 'ready', 'error']),
                error: z.enum(['offline', 'failed']).nullable(),
                items: z
                    .array(
                        z.strictObject({
                            id: z.string().min(1).max(128),
                            name: z.string().max(200),
                            description: z.string().max(400),
                            author: z.string().max(100),
                            version: z.string().max(64),
                            category: z.string().max(60),
                            beta: z.boolean(),
                            repo: z.string().max(160).nullable(),
                            installed: z.boolean(),
                        })
                    )
                    .max(100),
                installingId: z.string().min(1).max(128).nullable(),
                lastInstall: z
                    .strictObject({ id: z.string().min(1).max(128), result: z.enum(['success', 'failed', 'canceled']) })
                    .nullable(),
            })
            .optional(),
        items: z
            .array(
                z.strictObject({
                    id: z.string().min(1).max(128),
                    name: z.string().max(200),
                    version: z.string().max(64),
                    enabled: z.boolean(),
                    removable: z.boolean(),
                    updateAvailable: z.boolean(),
                    latestVersion: z.string().max(64).nullable(),
                    hasSettingsPanel: z.boolean(),
                    repo: z.string().max(160).nullable(),
                })
            )
            .max(200),
        status: z.strictObject({ checked: z.boolean(), checking: z.boolean(), updating: z.boolean() }),
        lastUpdate: z
            .strictObject({
                updated: z.number().int().nonnegative().max(100_000),
                failed: z.number().int().nonnegative().max(100_000),
                canceled: z.number().int().nonnegative().max(100_000),
            })
            .nullable(),
    })
    .refine((summary) => {
        const length = jsonLength(summary);
        return length >= 0 && length <= SETTINGS_PLUGINS_MAX_CHARS;
    });

/**
 * T-612: the workspace summary next to the settings snapshot: ids, names and two flags only (no notes, no isolated data). Limits
 * repeat WORKSPACE_SUMMARY_LIMITS in src/store/workspaceSummary.ts.
 */
const WORKSPACE_SUMMARY_SCHEMA = z.strictObject({
    items: z
        .array(
            z.strictObject({
                id: z.string().min(1).max(128),
                name: z.string().max(200),
                isolated: z.boolean(),
                hasIsolatedData: z.boolean(),
                active: z.boolean(),
            })
        )
        .max(200),
});

/** T-614: the system summary: version string, update centre state, backup state. Codes and numbers only. */
const SYSTEM_SUMMARY_SCHEMA = z.strictObject({
    version: z.string().max(64),
    updatesEnabled: z.boolean(),
    manualUpdate: z.boolean().optional(), // MAC-016
    update: z.strictObject({
        status: z.enum(['idle', 'checking', 'upToDate', 'available', 'downloading', 'downloaded', 'error']),
        version: z.string().max(64),
        percent: z.number().int().min(0).max(100),
    }),
    backup: z.strictObject({
        busy: z.boolean(),
        last: z.enum(['done', 'failed', 'canceled']).nullable(),
    }),
});

/** `settings:publish-state`: the main window's settings snapshot (settings keys only), from its top frame (claim-once bridge). */
export const SETTINGS_PUBLISH_STATE_OPTIONS: OnOptions = {
    args: firstArg(
        z.looseObject({
            epoch: z.string().min(1).max(SETTINGS_EPOCH_MAX_CHARS),
            rev: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            ack: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            plugins: PLUGIN_SUMMARY_SCHEMA.optional(),
            workspaces: WORKSPACE_SUMMARY_SCHEMA.optional(),
            system: SYSTEM_SUMMARY_SCHEMA.optional(),
            state: z.record(z.string(), z.unknown()).refine((state) => {
                const length = jsonLength(state);
                return length >= 0 && length <= SETTINGS_STATE_MAX_CHARS;
            }),
        })
    ),
    senderPolicy: 'main-window-top-frame',
};

// ─── Google Calendar channels (R2-15, Experimental, read-only; new: no legacy result to match) ─────

const GCAL_EMPTY_STATUS = { state: 'not-configured', enabled: false, configured: false, connected: false, lastRefreshAt: null } as const;

/** Refused or malformed calls answer with an inert status; nothing about the real state leaks to a wrong sender. */
const gcalStatusFallback = () => ({ ...GCAL_EMPTY_STATUS });
const gcalConnectFallback = () => ({ success: false, reason: 'denied-sender' as const, status: { ...GCAL_EMPTY_STATUS } });

const NO_ARGS = z.tuple([]).rest(z.unknown());
const MAIN_FRAME = 'main-window-top-frame' as const;
const SETTINGS_FRAME = 'settings-window-top-frame' as const;

/** window.api (main window top frame). Plugins share that realm; they only ever get statuses and events, never a token. */
export const GCAL_STATUS_OPTIONS: HandleOptions<'gcal-status'> = {
    args: NO_ARGS,
    onInvalid: gcalStatusFallback,
    senderPolicy: MAIN_FRAME,
    onDenied: gcalStatusFallback,
};
export const GCAL_CONNECT_OPTIONS: HandleOptions<'gcal-connect'> = {
    args: NO_ARGS,
    onInvalid: gcalConnectFallback,
    senderPolicy: MAIN_FRAME,
    onDenied: gcalConnectFallback,
};
export const GCAL_DISCONNECT_OPTIONS: HandleOptions<'gcal-disconnect'> = {
    args: NO_ARGS,
    onInvalid: gcalStatusFallback,
    senderPolicy: MAIN_FRAME,
    onDenied: gcalStatusFallback,
};
/** The range is only shape-checked here (two strings); the service validates the dates and the 400-day limit. */
export const GCAL_LIST_EVENTS_OPTIONS: HandleOptions<'gcal-list-events'> = {
    args: firstArg(z.looseObject({ from: z.string().max(64), to: z.string().max(64) })),
    onInvalid: () => [],
    senderPolicy: MAIN_FRAME,
    onDenied: () => [],
};

/** Settings window only (settings-preload). */
export const GCAL_SETTINGS_STATUS_OPTIONS: HandleOptions<'gcal-settings-status'> = {
    args: NO_ARGS,
    onInvalid: gcalStatusFallback,
    senderPolicy: SETTINGS_FRAME,
    onDenied: gcalStatusFallback,
};
export const GCAL_SETTINGS_CONNECT_OPTIONS: HandleOptions<'gcal-settings-connect'> = {
    args: NO_ARGS,
    onInvalid: gcalConnectFallback,
    senderPolicy: SETTINGS_FRAME,
    onDenied: gcalConnectFallback,
};
export const GCAL_SETTINGS_DISCONNECT_OPTIONS: HandleOptions<'gcal-settings-disconnect'> = {
    args: NO_ARGS,
    onInvalid: gcalStatusFallback,
    senderPolicy: SETTINGS_FRAME,
    onDenied: gcalStatusFallback,
};
export const GCAL_SETTINGS_SET_ENABLED_OPTIONS: HandleOptions<'gcal-settings-set-enabled'> = {
    args: firstArg(z.boolean()),
    onInvalid: gcalStatusFallback,
    senderPolicy: SETTINGS_FRAME,
    onDenied: gcalStatusFallback,
};
export const GCAL_SETTINGS_REFRESH_OPTIONS: HandleOptions<'gcal-settings-refresh'> = {
    args: NO_ARGS,
    onInvalid: gcalStatusFallback,
    senderPolicy: SETTINGS_FRAME,
    onDenied: gcalStatusFallback,
};
