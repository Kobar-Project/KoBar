// T-610: the main window's side of Settings > Plugins. Publishes a small plugin summary (src/store/pluginSummary.ts) and applies a short
// allow-list of `plugin.*` actions the Settings window relays (src/store/sync.ts routes them here). Host-internal: NOT part of
// window.api or the plugin contract, and it has no install / delete logic of its own: every action calls the SAME functions the
// old plugin UI (the former PluginStore / UpdatePluginsView screens, removed in T-615) calls (window.api + the store's sync functions).
//
//   - Every action is validated (zod, strict objects), and its plugin id must be in the plugin list published RIGHT NOW: an unknown id
//     (never installed, or removed since the Settings window's snapshot) is rejected, never forwarded to window.api.
//   - Actions run one after another (a queue), and the id is checked when its turn comes, so a stale snapshot in the Settings window
//     (toggle after an uninstall, double click, update during an update) can neither act on a gone plugin nor interleave two installs.
//   - The summary never contains code, repo URLs or paths: the update repo stays in this module (`updates`), taken from what
//     `check-plugin-updates` reported, never from the Settings window.
//   - T-611 (Discover): the catalogue (the registry list) is fetched HERE, only on `plugin.refreshCatalog`, and published without repo
//     links. `plugin.install {id}` needs an id of the catalogue held right now and calls the same installExtensionFromGithub as the old
//     detail view with the repo of that entry (main still applies its own checks and confirmation). `plugin.installFromFile` /
//     `plugin.installFromGithub` carry NO payload: the first runs the existing file picker (a native dialog in main), the second only
//     opens the Plugins tab where the old search box takes the link. The Settings window can never send a path or a URL.
//   - The list is fed by the plugin loader (App.tsx onInstalledList, fetched on every reload trigger): no extra polling.
//     Update checks (network) only run on `plugin.checkUpdates`; `plugin.update` / `plugin.updateAll` never check by themselves.
import { z } from 'zod';
import { PLUGIN_CANCELED_REASON } from '../components/plugins/pluginResults';
import {
    normalizePluginRepo,
    PLUGIN_SUMMARY_LIMITS,
    type PluginActionType,
    type PluginCatalog,
    type PluginCatalogItem,
    type PluginSummary,
    type PluginSummaryItem,
} from './pluginSummary';

const pluginId = z.string().min(1).max(PLUGIN_SUMMARY_LIMITS.id);
const noPayload = z.strictObject({});

/** The allow-listed `plugin.*` actions and their payload schemas. A Map, so `__proto__` / `toString` are never entries. */
export const PLUGIN_ACTIONS: ReadonlyMap<string, { schema: z.ZodType }> = new Map<PluginActionType, { schema: z.ZodType }>([
    ['plugin.setEnabled', { schema: z.strictObject({ id: pluginId, enabled: z.boolean() }) }],
    ['plugin.uninstall', { schema: z.strictObject({ id: pluginId }) }],
    ['plugin.update', { schema: z.strictObject({ id: pluginId }) }],
    ['plugin.updateAll', { schema: noPayload }],
    ['plugin.checkUpdates', { schema: noPayload }],
    ['plugin.openSettings', { schema: z.strictObject({ id: pluginId }) }],
    ['plugin.refreshCatalog', { schema: noPayload }],
    ['plugin.install', { schema: z.strictObject({ id: pluginId }) }],
    ['plugin.installFromFile', { schema: noPayload }],
    ['plugin.installFromGithub', { schema: noPayload }],
]);

export type PluginActionRejection =
    | 'unknown-action'
    | 'invalid-payload'
    | 'unknown-plugin'
    | 'not-removable'
    | 'no-update'
    | 'no-settings-panel'
    | 'already-installed'
    | 'unavailable'
    | 'failed';
export type PluginActionResult = { ok: true } | { ok: false; reason: PluginActionRejection };

/** What sync.ts needs from this module. */
export interface PluginSyncLike {
    /** The current summary, or null until the plugin list was read once. */
    getSummary(): PluginSummary | null;
    /** Called when the summary may have changed; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** True for `plugin.*` types (sync.ts routes those here instead of the settings action table). */
    owns(type: string): boolean;
    /** Validates and runs one action; never rejects. */
    handle(action: unknown): Promise<PluginActionResult>;
}

/** The window.api members used (all optional: a missing one makes the action fail with 'unavailable'). */
export interface PluginSyncApi {
    checkPluginUpdates?: () => Promise<unknown>;
    toggleExtensionEnabled?: (id: string, enabled: boolean) => Promise<unknown>;
    uninstallExtension?: (id: string) => Promise<boolean>;
    installExtensionFromGithub?: (id: string, repo: string) => Promise<{ success: boolean; reason?: string }>;
    installExtensionFromFile?: () => Promise<{ success: boolean; reason?: string }>;
}

/** The store functions used (the same the old plugin UI calls). */
export interface PluginSyncStore {
    setExtensionEnabledInWorkspace(id: string, enabled: boolean): void;
    syncEnabledExtensions(): void;
    triggerExtensionReload(): void;
    openPluginsTab(): void;
    openPluginSettings(id: string | null): void;
    setSelectedPluginId(id: string | null): void;
}

export interface PluginSyncDeps {
    api: () => PluginSyncApi | undefined;
    store: () => PluginSyncStore;
    hasSettingsPanel: (id: string) => boolean;
    /** T-611: reads the plugin registry (the parsed JSON). Absent: the catalogue is unavailable. Must enforce its own timeout. */
    fetchRegistry?: () => Promise<unknown>;
    /** T-611: false while the machine reports no network (tells "offline" apart from "failed"). */
    isOnline?: () => boolean;
    /** Subscribes to plugin registry changes (a settings panel appears once the plugin script ran). */
    subscribeRegistry?: (listener: () => void) => () => void;
    log?: (message: string, details: Record<string, string | number>) => void;
}

interface InstalledRow {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    removable: boolean;
    repo: string | null;
}
interface CatalogRow extends Omit<PluginCatalogItem, 'installed'> {
    /** Raw registry value, used for the install call; the summary only carries its strict normalised form (R-16). */
    repo: string | null;
}
interface UpdateRecord {
    repo: string;
    latestVersion: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const short = (value: unknown, max: number): string | null =>
    typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

export function createPluginSync(deps: PluginSyncDeps): PluginSyncLike & {
    /** Feeds the installed list (the loader's fetch; `code` and every other field are ignored). */
    setInstalledList(list: unknown): void;
} {
    const log = deps.log ?? ((message, details) => console.warn(`[KoBar] plugin-sync: ${message}`, details));
    const listeners = new Set<() => void>();
    let installed: InstalledRow[] | null = null;
    let updates = new Map<string, UpdateRecord>();
    const status = { checked: false, checking: false, updating: false };
    let lastUpdate: PluginSummary['lastUpdate'] = null;
    let queue: Promise<unknown> = Promise.resolve();
    const catalog: {
        status: PluginCatalog['status'];
        error: PluginCatalog['error'];
        rows: CatalogRow[];
        installingId: string | null;
        lastInstall: PluginCatalog['lastInstall'];
    } = { status: 'idle', error: null, rows: [], installingId: null, lastInstall: null };

    const notify = () => {
        for (const listener of Array.from(listeners)) {
            try {
                listener();
            } catch {
                /* a failing listener must not stop the others */
            }
        }
    };

    function getSummary(): PluginSummary | null {
        if (installed === null) return null;
        const items: PluginSummaryItem[] = installed.map((row) => {
            const update = updates.get(row.id);
            let hasPanel = false;
            try {
                hasPanel = deps.hasSettingsPanel(row.id);
            } catch {
                /* treated as no panel */
            }
            return {
                ...row,
                updateAvailable: !!update,
                latestVersion: update ? update.latestVersion : null,
                hasSettingsPanel: hasPanel,
            };
        });
        const installedIds = new Set(installed.map((row) => row.id));
        const catalogSummary: PluginCatalog = {
            status: catalog.status,
            error: catalog.error,
            items: catalog.rows.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                author: row.author,
                version: row.version,
                category: row.category,
                beta: row.beta,
                repo: normalizePluginRepo(row.repo),
                installed: installedIds.has(row.id),
            })),
            installingId: catalog.installingId,
            lastInstall: catalog.lastInstall ? { ...catalog.lastInstall } : null,
        };
        return { items, catalog: catalogSummary, status: { ...status }, lastUpdate: lastUpdate ? { ...lastUpdate } : null };
    }

    function setInstalledList(list: unknown): void {
        if (!Array.isArray(list)) return;
        const rows: InstalledRow[] = [];
        const seen = new Set<string>();
        for (const entry of list.slice(0, PLUGIN_SUMMARY_LIMITS.items)) {
            if (!isRecord(entry)) continue;
            const id = short(entry.id, PLUGIN_SUMMARY_LIMITS.id);
            if (id === null || seen.has(id)) continue;
            seen.add(id);
            rows.push({
                id,
                name: short(entry.name, PLUGIN_SUMMARY_LIMITS.name) ?? id,
                version: short(entry.version, PLUGIN_SUMMARY_LIMITS.version) ?? '',
                enabled: entry.enabled !== false,
                removable: entry.isPlayground !== true,
                repo: normalizePluginRepo(entry.githubRepo) ?? normalizePluginRepo(entry.githubLink),
            });
        }
        installed = rows;
        // An update only stays offered while its plugin is installed and still differs from the release.
        const byId = new Map(rows.map((row) => [row.id, row]));
        updates = new Map(Array.from(updates).filter(([id, update]) => byId.has(id) && byId.get(id)!.version !== update.latestVersion));
        notify();
    }

    function parseRegistry(data: unknown): CatalogRow[] {
        const rows: CatalogRow[] = [];
        const seen = new Set<string>();
        if (!Array.isArray(data)) throw new Error('registry is not a list');
        for (const entry of data.slice(0, PLUGIN_SUMMARY_LIMITS.catalogItems)) {
            if (!isRecord(entry)) continue;
            const id = short(entry.id, PLUGIN_SUMMARY_LIMITS.id);
            if (id === null || seen.has(id)) continue;
            seen.add(id);
            rows.push({
                id,
                name: short(entry.name, PLUGIN_SUMMARY_LIMITS.name) ?? id,
                description: short(entry.description, PLUGIN_SUMMARY_LIMITS.description) ?? '',
                author: short(entry.author, PLUGIN_SUMMARY_LIMITS.author) ?? '',
                version: short(entry.version, PLUGIN_SUMMARY_LIMITS.version) ?? '',
                category: short(entry.category, PLUGIN_SUMMARY_LIMITS.category) ?? '',
                beta: entry.isBeta === true,
                repo: short(entry.githubRepo, 200),
            });
        }
        return rows;
    }

    async function refreshCatalog(): Promise<PluginActionResult> {
        if (!deps.fetchRegistry) return { ok: false, reason: 'unavailable' };
        catalog.status = 'loading';
        catalog.error = null;
        notify();
        try {
            if (deps.isOnline && !deps.isOnline()) throw new Error('offline');
            catalog.rows = parseRegistry(await deps.fetchRegistry());
            catalog.status = 'ready';
            return { ok: true };
        } catch {
            let offline = false;
            try {
                offline = deps.isOnline ? !deps.isOnline() : false;
            } catch {
                /* treated as online */
            }
            catalog.rows = [];
            catalog.status = 'error';
            catalog.error = offline ? 'offline' : 'failed';
            log('catalogue fetch failed', {});
            return { ok: false, reason: 'failed' };
        } finally {
            notify();
        }
    }

    async function installFromCatalog(api: PluginSyncApi, id: string): Promise<PluginActionResult> {
        // The id is looked up in the catalogue held RIGHT NOW (after any refresh queued before this action).
        const row = catalog.rows.find((entry) => entry.id === id);
        if (!row) return { ok: false, reason: 'unknown-plugin' };
        if (find(id)) return { ok: false, reason: 'already-installed' };
        if (!api.installExtensionFromGithub || !row.repo) return { ok: false, reason: 'unavailable' };
        catalog.installingId = id;
        catalog.lastInstall = null;
        notify();
        let result: 'success' | 'failed' | 'canceled' = 'failed';
        try {
            // Same call as the former detail view: the first argument is the progress key.
            const outcome = await api.installExtensionFromGithub(id, row.repo);
            result = outcome.success ? 'success' : outcome.reason === PLUGIN_CANCELED_REASON ? 'canceled' : 'failed';
        } catch {
            result = 'failed';
        } finally {
            catalog.installingId = null;
            catalog.lastInstall = { id, result };
            // A full reload as after any install: the loader then republishes the installed list.
            if (result === 'success') deps.store().triggerExtensionReload();
            notify();
        }
        return result === 'failed' ? { ok: false, reason: 'failed' } : { ok: true };
    }

    const find = (id: string): InstalledRow | undefined => installed?.find((row) => row.id === id);

    async function checkUpdates(api: PluginSyncApi): Promise<PluginActionResult> {
        if (!api.checkPluginUpdates) return { ok: false, reason: 'unavailable' };
        status.checking = true;
        notify();
        try {
            const result = await api.checkPluginUpdates();
            const next = new Map<string, UpdateRecord>();
            if (Array.isArray(result)) {
                for (const entry of result) {
                    if (!isRecord(entry)) continue;
                    const id = short(entry.id, PLUGIN_SUMMARY_LIMITS.id);
                    const repo = short(entry.repo, 200);
                    const latestVersion = short(entry.latestVersion, PLUGIN_SUMMARY_LIMITS.version);
                    if (id !== null && repo !== null && latestVersion !== null && find(id)) next.set(id, { repo, latestVersion });
                }
            }
            updates = next;
            status.checked = true;
            return { ok: true };
        } catch {
            log('update check failed', {});
            return { ok: false, reason: 'failed' };
        } finally {
            status.checking = false;
            notify();
        }
    }

    /** Installs the update of `id` exactly like the old update view does. */
    async function updateOne(api: PluginSyncApi, id: string): Promise<'success' | 'failed' | 'canceled'> {
        const update = updates.get(id);
        if (!update || !api.installExtensionFromGithub) return 'failed';
        try {
            // The first argument is only the progress key: the stable plugin id, never the manifest name.
            const result = await api.installExtensionFromGithub(id, update.repo);
            if (result.success) {
                updates.delete(id);
                return 'success';
            }
            return result.reason === PLUGIN_CANCELED_REASON ? 'canceled' : 'failed';
        } catch {
            return 'failed';
        }
    }

    async function runUpdates(api: PluginSyncApi, ids: string[]): Promise<PluginActionResult> {
        status.updating = true;
        const tally = { updated: 0, failed: 0, canceled: 0 };
        notify();
        try {
            for (const id of ids) {
                const outcome = await updateOne(api, id);
                if (outcome === 'success') tally.updated += 1;
                else if (outcome === 'canceled') tally.canceled += 1;
                else tally.failed += 1;
            }
        } finally {
            status.updating = false;
            lastUpdate = tally;
            // A full reload (as after any install): the loader then republishes the list with the new versions.
            if (tally.updated > 0) deps.store().triggerExtensionReload();
            notify();
        }
        return tally.failed > 0 && tally.updated === 0 ? { ok: false, reason: 'failed' } : { ok: true };
    }

    async function run(type: PluginActionType, payload: Record<string, unknown>): Promise<PluginActionResult> {
        const api = deps.api();
        if (installed === null) return { ok: false, reason: 'unavailable' };
        const id = typeof payload.id === 'string' ? payload.id : null;
        // The id is checked against the CURRENT list when the action's turn comes (a stale Settings snapshot may name a gone plugin).
        // `plugin.install` names a CATALOGUE plugin (not installed yet): installFromCatalog checks the catalogue instead.
        const row = id === null ? undefined : find(id);
        if (id !== null && !row && type !== 'plugin.install') return { ok: false, reason: 'unknown-plugin' };
        switch (type) {
            case 'plugin.setEnabled': {
                if (!api?.toggleExtensionEnabled) return { ok: false, reason: 'unavailable' };
                const enabled = payload.enabled === true;
                // Same sequence as the old store UI (handleToggleExtension).
                deps.store().setExtensionEnabledInWorkspace(id!, enabled);
                await api.toggleExtensionEnabled(id!, enabled);
                deps.store().syncEnabledExtensions();
                return { ok: true };
            }
            case 'plugin.uninstall': {
                if (!api?.uninstallExtension) return { ok: false, reason: 'unavailable' };
                if (!row!.removable) return { ok: false, reason: 'not-removable' };
                // Same call as the old store UI (handleUninstallExtension): main re-checks the folder and shows its own confirmation.
                const removed = await api.uninstallExtension(id!);
                if (!removed) return { ok: false, reason: 'failed' };
                // Forget the plugin at once (the loader republishes the list a moment later), so queued actions on it are rejected.
                installed = installed!.filter((entry) => entry.id !== id);
                updates.delete(id!);
                notify();
                deps.store().syncEnabledExtensions();
                return { ok: true };
            }
            case 'plugin.update': {
                if (!api) return { ok: false, reason: 'unavailable' };
                if (!updates.has(id!)) return { ok: false, reason: 'no-update' };
                return runUpdates(api, [id!]);
            }
            case 'plugin.updateAll': {
                if (!api) return { ok: false, reason: 'unavailable' };
                const ids = Array.from(updates.keys()).filter((key) => find(key));
                if (ids.length === 0) return { ok: false, reason: 'no-update' };
                return runUpdates(api, ids);
            }
            case 'plugin.checkUpdates':
                return api ? checkUpdates(api) : { ok: false, reason: 'unavailable' };
            case 'plugin.refreshCatalog':
                return refreshCatalog();
            case 'plugin.install':
                return api ? installFromCatalog(api, id!) : { ok: false, reason: 'unavailable' };
            case 'plugin.installFromFile': {
                if (!api?.installExtensionFromFile) return { ok: false, reason: 'unavailable' };
                // The existing picker (a native dialog owned by main) with its own validation and confirmation; no path comes from here.
                const outcome = await api.installExtensionFromFile();
                if (outcome.success) {
                    deps.store().triggerExtensionReload();
                    return { ok: true };
                }
                return outcome.reason === PLUGIN_CANCELED_REASON ? { ok: true } : { ok: false, reason: 'failed' };
            }
            case 'plugin.installFromGithub':
                // T-615: the link form lives in the main window's plugin host (no plugin runtime in the Settings window).
                deps.store().openPluginSettings(null);
                return { ok: true };
            case 'plugin.openSettings': {
                if (!deps.hasSettingsPanel(id!)) return { ok: false, reason: 'no-settings-panel' };
                // The v1 panel is rendered by the main window's plugin host tab (T-615; the Settings window has no plugin runtime).
                deps.store().openPluginSettings(id!);
                return { ok: true };
            }
        }
    }

    return {
        getSummary,
        setInstalledList,
        subscribe(listener) {
            listeners.add(listener);
            let off: () => void = () => {};
            try {
                off = deps.subscribeRegistry?.(notify) ?? off;
            } catch {
                /* no registry: the panel flag simply updates with the next list */
            }
            return () => {
                listeners.delete(listener);
                off();
            };
        },
        owns: (type) => PLUGIN_ACTIONS.has(type),
        handle(action) {
            const { type, payload } = (isRecord(action) ? action : {}) as { type?: unknown; payload?: unknown };
            const entry = typeof type === 'string' ? PLUGIN_ACTIONS.get(type) : undefined;
            if (!entry) return Promise.resolve({ ok: false, reason: 'unknown-action' });
            const parsed = entry.schema.safeParse(payload === undefined ? {} : payload);
            if (!parsed.success) return Promise.resolve({ ok: false, reason: 'invalid-payload' });
            const job = queue.then(async (): Promise<PluginActionResult> => {
                try {
                    return await run(type as PluginActionType, parsed.data as Record<string, unknown>);
                } catch {
                    log('action failed', { type: String(type).slice(0, 64) });
                    return { ok: false, reason: 'failed' };
                }
            });
            queue = job;
            return job;
        },
    };
}
