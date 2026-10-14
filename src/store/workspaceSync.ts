// T-612: the main window's side of Settings > Workspaces. Publishes a small workspace summary (src/store/workspaceSummary.ts) and
// applies a short allow-list of `workspace.*` actions the Settings window relays (src/store/sync.ts routes them here). Host-internal:
// NOT part of window.api or the plugin contract, and it has NO workspace logic of its own: every action calls the SAME store
// actions the old Workspaces screen called (saveCurrentAsWorkspace, updateWorkspaceName, loadWorkspace, deleteWorkspaceWithBackup).
//
//   - Every action is validated (zod, strict objects). Names are trimmed, must not be empty, are capped (200) and may hold no
//     control characters (the old screen only trimmed; the cap and the control-character check are new and only reject).
//   - An id must be in the workspace list held RIGHT NOW, checked when the action's turn comes (actions run one after another), so a
//     stale Settings snapshot (rename after a delete, double click on delete) can never act on a gone workspace.
//   - Delete keeps the old safety net: automatic backup first, nothing deleted when it fails. Its outcome is announced in the
//     main window exactly like the old screen did (eye notification); the Settings window just sees the list change.
//   - Nothing is published before hydration, and actions before hydration are rejected.
import { z } from 'zod';
import { deleteResultMessageKey } from '../components/plugins/workspaceConfirm';
import { translate } from '../i18n/translate';
import type { TranslationKeys } from '../i18n';
import { toast } from '../ui/toastStore';
import type { DeleteWorkspaceResult } from './workspace/deleteWorkspace';
import { WORKSPACE_SUMMARY_LIMITS, type WorkspaceActionType, type WorkspaceSummary, type WorkspaceSummaryItem } from './workspaceSummary';

// C0 control characters and DEL, written as escapes so no control character lives in this file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const workspaceId = z.string().min(1).max(WORKSPACE_SUMMARY_LIMITS.id);
const workspaceName = z
    .string()
    .trim()
    .min(1)
    .max(WORKSPACE_SUMMARY_LIMITS.name)
    .refine((name) => !CONTROL_CHARS.test(name));

/** The allow-listed `workspace.*` actions and their payload schemas. A Map, so `__proto__` / `toString` are never entries. */
export const WORKSPACE_ACTIONS: ReadonlyMap<string, { schema: z.ZodType }> = new Map<WorkspaceActionType, { schema: z.ZodType }>([
    ['workspace.create', { schema: z.strictObject({ name: workspaceName, isolated: z.boolean() }) }],
    ['workspace.rename', { schema: z.strictObject({ id: workspaceId, name: workspaceName }) }],
    ['workspace.delete', { schema: z.strictObject({ id: workspaceId }) }],
    ['workspace.switch', { schema: z.strictObject({ id: workspaceId }) }],
]);

export type WorkspaceActionRejection =
    'unknown-action' | 'invalid-payload' | 'unknown-workspace' | 'unavailable' | 'limit-reached' | 'failed';
export type WorkspaceActionResult = { ok: true } | { ok: false; reason: WorkspaceActionRejection };

/** What sync.ts needs from this module. */
export interface WorkspaceSyncLike {
    /** The current summary, or null until the store is hydrated. */
    getSummary(): WorkspaceSummary | null;
    /** Called when the summary may have changed; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** True for `workspace.*` types. */
    owns(type: string): boolean;
    /** Validates and runs one action; never rejects. */
    handle(action: unknown): Promise<WorkspaceActionResult>;
}

/** The slice of the app store used (useAppStore satisfies it). */
export interface WorkspaceSyncState {
    isHydrated: boolean;
    language?: string;
    workspaces: ReadonlyArray<{ id: string; name: string; isIsolated?: boolean; isolatedData?: unknown }>;
    activeWorkspaceId: string | null;
    saveCurrentAsWorkspace(name: string, isIsolated?: boolean): void;
    loadWorkspace(id: string): void;
    updateWorkspaceName(id: string, name: string): void;
    deleteWorkspaceWithBackup(id: string): Promise<DeleteWorkspaceResult>;
}

export interface WorkspaceSyncStore {
    getState(): WorkspaceSyncState;
    subscribe(listener: (state: WorkspaceSyncState) => void): () => void;
}

export interface WorkspaceSyncDeps {
    store: WorkspaceSyncStore;
    log?: (message: string, details: Record<string, string | number>) => void;
    /** Outcome announcer (default: a toast). */
    notify?: (message: string, ok: boolean) => void;
}

export function createWorkspaceSync(deps: WorkspaceSyncDeps): WorkspaceSyncLike {
    const log = deps.log ?? ((message, details) => console.warn(`[KoBar] workspace-sync: ${message}`, details));
    let queue: Promise<unknown> = Promise.resolve();

    function getSummary(): WorkspaceSummary | null {
        const state = deps.store.getState();
        if (!state.isHydrated || !Array.isArray(state.workspaces)) return null;
        const items: WorkspaceSummaryItem[] = [];
        const seen = new Set<string>();
        for (const ws of state.workspaces.slice(0, WORKSPACE_SUMMARY_LIMITS.items)) {
            const id = ws?.id;
            if (typeof id !== 'string' || id.length === 0 || id.length > WORKSPACE_SUMMARY_LIMITS.id || seen.has(id)) continue;
            seen.add(id);
            const name = typeof ws.name === 'string' ? ws.name.slice(0, WORKSPACE_SUMMARY_LIMITS.name) : '';
            items.push({
                id,
                name: name || id,
                isolated: ws.isIsolated === true,
                hasIsolatedData: ws.isIsolated === true || !!ws.isolatedData,
                active: id === state.activeWorkspaceId,
            });
        }
        return { items };
    }

    function announce(key: TranslationKeys, name: string, ok: boolean): void {
        try {
            const state = deps.store.getState();
            // T-624: an outcome is information, so it is a toast (the eye bubble is for hints only).
            const message = translate(state.language, key).replace('{name}', () => name);
            if (deps.notify) deps.notify(message, ok);
            else if (ok) toast.success(message);
            else toast.error(message);
        } catch {
            /* a notification is a courtesy: the list already shows the result */
        }
    }

    async function run(type: WorkspaceActionType, payload: Record<string, unknown>): Promise<WorkspaceActionResult> {
        const state = deps.store.getState();
        if (!state.isHydrated) return { ok: false, reason: 'unavailable' };
        const id = typeof payload.id === 'string' ? payload.id : null;
        // The id is checked against the list held NOW, when this action's turn comes (a stale Settings snapshot may name a gone one).
        const target = id === null ? undefined : state.workspaces.find((ws) => ws.id === id);
        if (id !== null && !target) return { ok: false, reason: 'unknown-workspace' };
        switch (type) {
            case 'workspace.create': {
                // The summary (and so the Settings list) is capped: never create what could not be listed.
                if (state.workspaces.length >= WORKSPACE_SUMMARY_LIMITS.items) return { ok: false, reason: 'limit-reached' };
                const name = payload.name as string;
                state.saveCurrentAsWorkspace(name, payload.isolated === true);
                announce('workspaceSavedMsg', name, true);
                return { ok: true };
            }
            case 'workspace.rename':
                state.updateWorkspaceName(id!, payload.name as string);
                return { ok: true };
            case 'workspace.switch':
                state.loadWorkspace(id!);
                return { ok: true };
            case 'workspace.delete': {
                let result: DeleteWorkspaceResult;
                try {
                    result = await state.deleteWorkspaceWithBackup(id!);
                } catch {
                    result = { success: false, reason: 'delete-failed' };
                }
                announce(deleteResultMessageKey(result), target!.name, result.success);
                return result.success ? { ok: true } : { ok: false, reason: 'failed' };
            }
        }
    }

    return {
        getSummary,
        subscribe(listener) {
            let last = deps.store.getState();
            return deps.store.subscribe((next) => {
                // Only what the summary shows: the list, the active one, hydration.
                const same =
                    next.workspaces === last.workspaces &&
                    next.activeWorkspaceId === last.activeWorkspaceId &&
                    next.isHydrated === last.isHydrated;
                last = next;
                if (same) return;
                try {
                    listener();
                } catch {
                    /* a failing listener must not break the store */
                }
            });
        },
        owns: (type) => WORKSPACE_ACTIONS.has(type),
        handle(action) {
            const { type, payload } = (typeof action === 'object' && action !== null ? action : {}) as {
                type?: unknown;
                payload?: unknown;
            };
            const entry = typeof type === 'string' ? WORKSPACE_ACTIONS.get(type) : undefined;
            if (!entry) return Promise.resolve({ ok: false, reason: 'unknown-action' });
            const parsed = entry.schema.safeParse(payload === undefined ? {} : payload);
            if (!parsed.success) return Promise.resolve({ ok: false, reason: 'invalid-payload' });
            const job = queue.then(async (): Promise<WorkspaceActionResult> => {
                try {
                    return await run(type as WorkspaceActionType, parsed.data as Record<string, unknown>);
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
