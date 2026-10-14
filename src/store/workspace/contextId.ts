// Pure helpers that name the note/data context a workspace reads and writes (T-406).
// No store imports: the store imports this module, so it must stay free of cycles.
//
// contextId is derived from the current persisted shape (activeWorkspaceId + workspaces[].isIsolated), never stored:
// - 'global'  : the shared context (no workspace active, a shared workspace active, or an unknown active id);
// - 'ws:<id>' : an isolated workspace owns its own notes (`isolatedData`) and plugin keys (`_iso_<id>`).
// The prefix keeps both apart even when an (imported) workspace id is the literal string 'global'.
// It always agrees with resolveDataContext() in ./dataContext: 'global' <=> empty isolation suffix.

import { findActiveWorkspace } from './activeWorkspace';

export const GLOBAL_CONTEXT_ID = 'global';
const WORKSPACE_CONTEXT_PREFIX = 'ws:';

export type ContextId = typeof GLOBAL_CONTEXT_ID | `ws:${string}`;

export interface ContextIdWorkspace {
    id: string;
    isIsolated?: boolean;
}

export interface ContextIdState {
    activeWorkspaceId: string | null;
    workspaces: readonly ContextIdWorkspace[];
}

/** The context `ws` reads and writes while it is active. `null`/`undefined` and shared workspaces map to 'global'. */
export function contextIdOf(ws: ContextIdWorkspace | null | undefined): ContextId {
    return ws && ws.isIsolated ? `${WORKSPACE_CONTEXT_PREFIX}${ws.id}` : GLOBAL_CONTEXT_ID;
}

/** The context the live `notes`/`activeNoteId`/`nextNoteId` currently belong to. */
export function activeContextId(state: ContextIdState): ContextId {
    return contextIdOf(findActiveWorkspace(state));
}

/**
 * The workspace id inside an isolated context id; null for 'global' and for anything that is not a context id.
 * Takes a plain string on purpose: it is the parser for ids of unknown origin. 'ws:' yields '' because imported
 * workspace ids may be the empty string, and contextIdOf() must round-trip for every id.
 */
export function workspaceIdOfContext(contextId: string): string | null {
    if (typeof contextId !== 'string' || !contextId.startsWith(WORKSPACE_CONTEXT_PREFIX)) return null;
    return contextId.slice(WORKSPACE_CONTEXT_PREFIX.length);
}
