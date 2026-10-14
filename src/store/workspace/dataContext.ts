// Pure helpers that decide when a workspace action switches the plugin DATA CONTEXT (T-206, WS-03).
// No store imports: the store imports this module, so it must stay free of cycles.
//
// The data context is what plugins see through the localStorage isolation layer
// (src/utils/localStorageIsolation.ts): the active workspace id plus the key suffix that applies to it
// (`_iso_<id>` while the active workspace is isolated, none otherwise).
//
// Rule (documented in T-206):
// - `load` always counts as a switch (old behaviour: every load reloads plugins and fires
//   `kobar:workspace-changed`, even shared -> shared or re-loading the active workspace).
// - `save`, `toggle-isolation`, `delete` and `set-active` (T-153: leaving the active workspace) count as a
//   switch only when the active workspace id changes or the isolation suffix of the active context changes.
//   In practice: save always switches (the new workspace becomes active), toggle switches only for the
//   ACTIVE workspace, delete only for the ACTIVE one, set-active (null) only when a workspace was active.

export type WorkspaceContextReason = 'load' | 'save' | 'toggle-isolation' | 'delete' | 'set-active';

export interface DataContextWorkspace {
    id: string;
    isIsolated?: boolean;
}

export interface DataContextState {
    activeWorkspaceId: string | null;
    workspaces: readonly DataContextWorkspace[];
}

export interface DataContext {
    /** The active workspace id as stored (null = no workspace active). */
    workspaceId: string | null;
    /** Key suffix plugins' localStorage keys get: `_iso_<id>` for an isolated active workspace, '' otherwise. */
    isolationSuffix: string;
}

/** Mirrors getIsolatedKey() in src/utils/localStorageIsolation.ts. */
export function resolveDataContext(state: DataContextState): DataContext {
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return {
        workspaceId: state.activeWorkspaceId ?? null,
        isolationSuffix: activeWs && activeWs.isIsolated ? `_iso_${activeWs.id}` : '',
    };
}

export function isSameDataContext(a: DataContext, b: DataContext): boolean {
    return a.workspaceId === b.workspaceId && a.isolationSuffix === b.isolationSuffix;
}

/** True when the transition `prev -> next` caused by `reason` must reload plugins and notify them. */
export function shouldSwitchDataContext(reason: WorkspaceContextReason, prev: DataContextState, next: DataContextState): boolean {
    if (reason === 'load') return true;
    return !isSameDataContext(resolveDataContext(prev), resolveDataContext(next));
}
