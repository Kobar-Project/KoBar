// T-610: the small, secret-free, read-only plugin summary the main window publishes to the Settings window (next to the settings
// snapshot, never inside it) and the payload types of the `plugin.*` actions the Settings window may send back. Plain TS only (no
// zod, no store): the Settings window bundles this file for the mirror. The summary carries NO code, repo URL, path, description
// or manifest: only what a list row needs (R-16: plus a strict "owner/name" repo, shown as a link; no install uses it). The action validation lives in ./pluginSync (main window only).
import type { IpcPluginCatalog, IpcPluginCatalogItem, IpcPluginSummary, IpcPluginSummaryItem } from '../../shared/ipc-contract';

export type PluginSummaryItem = IpcPluginSummaryItem;
export type PluginSummary = IpcPluginSummary;
export type PluginCatalog = IpcPluginCatalog;
export type PluginCatalogItem = IpcPluginCatalogItem;

/** Upper bounds (the electron schema for `settings:publish-state` repeats them: electron/main/ipc/schemas.cts). */
export const PLUGIN_SUMMARY_LIMITS = Object.freeze({
    items: 200,
    id: 128,
    name: 200,
    version: 64,
    // T-611 catalogue
    catalogItems: 100,
    description: 400,
    author: 100,
    category: 60,
});

export const EMPTY_PLUGIN_CATALOG: PluginCatalog = Object.freeze({
    status: 'idle',
    error: null,
    items: Object.freeze([]) as unknown as PluginCatalogItem[],
    installingId: null,
    lastInstall: null,
}) as PluginCatalog;

export const EMPTY_PLUGIN_SUMMARY: PluginSummary = Object.freeze({
    items: Object.freeze([]) as unknown as PluginSummaryItem[],
    status: Object.freeze({ checked: false, checking: false, updating: false }),
    lastUpdate: null,
}) as PluginSummary;

/** Action type -> payload of the allow-listed plugin actions (handled by src/store/pluginSync.ts in the main window). */
export interface PluginActionPayloads {
    'plugin.setEnabled': { id: string; enabled: boolean };
    'plugin.uninstall': { id: string };
    'plugin.update': { id: string };
    'plugin.updateAll': Record<string, never>;
    'plugin.checkUpdates': Record<string, never>;
    'plugin.openSettings': { id: string };
    /** T-611: (re)fetches the catalogue; the Settings window never sends a URL. */
    'plugin.refreshCatalog': Record<string, never>;
    /** T-611: installs a catalogue plugin; the id must be in the live catalogue (the repo never leaves the main window). */
    'plugin.install': { id: string };
    /** T-611: only opens the existing file picker in the main window. No path travels. */
    'plugin.installFromFile': Record<string, never>;
    /** T-611: only opens the Plugins tab of the main window (the link is typed there). No URL travels. */
    'plugin.installFromGithub': Record<string, never>;
}
export type PluginActionType = keyof PluginActionPayloads;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null =>
    typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

const GITHUB_OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i;

function isStrictRepo(value: string): boolean {
    const parts = value.split('/');
    if (parts.length !== 2) return false;
    const [owner, name] = parts;
    return GITHUB_OWNER_RE.test(owner) && GITHUB_REPO_RE.test(name) && name !== '.' && name !== '..';
}

/** R-16: strict "owner/name" from "owner/name" or "https://github.com/owner/name[.git]" (same rules as electron/lib/pluginOrigins.cts), else null. */
export function normalizePluginRepo(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 200) return null;
    const textValue = value.trim();
    if (isStrictRepo(textValue)) return textValue;
    const match = GITHUB_URL_RE.exec(textValue);
    if (!match) return null;
    const repo = `${match[1]}/${match[2]}`;
    return isStrictRepo(repo) ? repo : null;
}

/** The GitHub page of a plugin repo, or null when `repo` is not a strict "owner/name". */
export function pluginRepoUrl(repo: string | null): string | null {
    const strict = normalizePluginRepo(repo);
    return strict ? `https://github.com/${strict}` : null;
}

/** One summary item from untrusted data, or null when it is not a valid item. Never throws. */
export function sanitizePluginItem(raw: unknown): PluginSummaryItem | null {
    if (!isRecord(raw)) return null;
    const id = text(raw.id, PLUGIN_SUMMARY_LIMITS.id);
    if (id === null) return null;
    const latest = text(raw.latestVersion, PLUGIN_SUMMARY_LIMITS.version);
    return {
        id,
        name: text(raw.name, PLUGIN_SUMMARY_LIMITS.name) ?? id,
        version: text(raw.version, PLUGIN_SUMMARY_LIMITS.version) ?? '',
        enabled: raw.enabled === true,
        removable: raw.removable === true,
        updateAvailable: raw.updateAvailable === true && latest !== null,
        latestVersion: raw.updateAvailable === true ? latest : null,
        hasSettingsPanel: raw.hasSettingsPanel === true,
        repo: normalizePluginRepo(raw.repo),
    };
}

/** The catalogue section from untrusted data; anything malformed yields the idle catalogue. Never throws. */
export function sanitizePluginCatalog(raw: unknown): PluginCatalog {
    if (!isRecord(raw)) return EMPTY_PLUGIN_CATALOG;
    const status = raw.status === 'loading' || raw.status === 'ready' || raw.status === 'error' ? raw.status : 'idle';
    const seen = new Set<string>();
    const items: PluginCatalogItem[] = [];
    for (const entry of Array.isArray(raw.items) ? raw.items.slice(0, PLUGIN_SUMMARY_LIMITS.catalogItems) : []) {
        if (!isRecord(entry)) continue;
        const id = text(entry.id, PLUGIN_SUMMARY_LIMITS.id);
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        items.push({
            id,
            name: text(entry.name, PLUGIN_SUMMARY_LIMITS.name) ?? id,
            description: text(entry.description, PLUGIN_SUMMARY_LIMITS.description) ?? '',
            author: text(entry.author, PLUGIN_SUMMARY_LIMITS.author) ?? '',
            version: text(entry.version, PLUGIN_SUMMARY_LIMITS.version) ?? '',
            category: text(entry.category, PLUGIN_SUMMARY_LIMITS.category) ?? '',
            beta: entry.beta === true,
            repo: normalizePluginRepo(entry.repo),
            installed: entry.installed === true,
        });
    }
    const last = isRecord(raw.lastInstall) ? raw.lastInstall : null;
    const lastId = last ? text(last.id, PLUGIN_SUMMARY_LIMITS.id) : null;
    const result = last && (last.result === 'success' || last.result === 'failed' || last.result === 'canceled') ? last.result : null;
    return {
        status,
        error: status === 'error' ? (raw.error === 'offline' ? 'offline' : 'failed') : null,
        items,
        installingId: text(raw.installingId, PLUGIN_SUMMARY_LIMITS.id),
        lastInstall: lastId !== null && result !== null ? { id: lastId, result } : null,
    };
}

/** The summary from untrusted data (a snapshot message): invalid items are dropped, duplicates keep the first. Null when not a summary. */
export function sanitizePluginSummary(raw: unknown): PluginSummary | null {
    if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
    const seen = new Set<string>();
    const items: PluginSummaryItem[] = [];
    for (const entry of raw.items.slice(0, PLUGIN_SUMMARY_LIMITS.items)) {
        const item = sanitizePluginItem(entry);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
    }
    const status = isRecord(raw.status) ? raw.status : {};
    const last = isRecord(raw.lastUpdate) ? raw.lastUpdate : null;
    return {
        items,
        catalog: sanitizePluginCatalog(raw.catalog),
        status: { checked: status.checked === true, checking: status.checking === true, updating: status.updating === true },
        lastUpdate: last ? { updated: count(last.updated), failed: count(last.failed), canceled: count(last.canceled) } : null,
    };
}
