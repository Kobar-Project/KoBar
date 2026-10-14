// T-612: the small, secret-free, read-only workspace summary the main window publishes to the Settings window (next to the settings
// snapshot and the plugin summary) and the payload types of the `workspace.*` actions the Settings window may send back. Plain TS
// only (no zod, no store): the Settings window bundles this file for the mirror. The summary carries ids, names and two flags:
// NO notes, NO isolated data, NO plugin data. The action validation lives in ./workspaceSync (main window only).
import type { IpcWorkspaceSummary, IpcWorkspaceSummaryItem } from '../../shared/ipc-contract';

export type WorkspaceSummaryItem = IpcWorkspaceSummaryItem;
export type WorkspaceSummary = IpcWorkspaceSummary;

/** Upper bounds (the electron schema for `settings:publish-state` repeats them: electron/main/ipc/schemas.cts). */
export const WORKSPACE_SUMMARY_LIMITS = Object.freeze({ items: 200, id: 128, name: 200 });

/** Action type -> payload of the allow-listed workspace actions (handled by src/store/workspaceSync.ts in the main window). */
export interface WorkspaceActionPayloads {
    /** Saves the CURRENT layout as a new workspace (the same store action as the old screen's "Save current settings"). */
    'workspace.create': { name: string; isolated: boolean };
    'workspace.rename': { id: string; name: string };
    /** Same path as the old screen: automatic backup first, then the store's delete. The id must be in the live list. */
    'workspace.delete': { id: string };
    /** Loads (switches to) a saved workspace. */
    'workspace.switch': { id: string };
}
export type WorkspaceActionType = keyof WorkspaceActionPayloads;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The summary from untrusted data (a snapshot message): invalid items are dropped, duplicates keep the first. Null when not a summary. */
export function sanitizeWorkspaceSummary(raw: unknown): WorkspaceSummary | null {
    if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
    const seen = new Set<string>();
    const items: WorkspaceSummaryItem[] = [];
    for (const entry of raw.items.slice(0, WORKSPACE_SUMMARY_LIMITS.items)) {
        if (!isRecord(entry)) continue;
        const id = entry.id;
        if (typeof id !== 'string' || id.length === 0 || id.length > WORKSPACE_SUMMARY_LIMITS.id || seen.has(id)) continue;
        seen.add(id);
        const name = typeof entry.name === 'string' && entry.name.length <= WORKSPACE_SUMMARY_LIMITS.name ? entry.name : '';
        items.push({
            id,
            name: name || id,
            isolated: entry.isolated === true,
            hasIsolatedData: entry.hasIsolatedData === true,
            active: entry.active === true,
        });
    }
    return { items };
}
