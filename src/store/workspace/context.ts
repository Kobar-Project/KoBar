// Pure helpers that resolve which notes belong to a workspace context (T-204, WS-02/WS-08).
// No store imports: the store imports this module, so it must stay free of cycles.
//
// Model:
// - The live `notes`/`activeNoteId`/`nextNoteId` always belong to the ACTIVE context.
// - An isolated workspace owns `isolatedData` (kept in sync while it is active).
// - The shared context lives in the live fields while no isolated workspace is active; while an
//   isolated workspace is active its canonical copy is `globalNotes` (no separate active/next id
//   is stored for it, so both are derived from the notes).

export interface ContextNote {
    id: number;
}

export interface ContextWorkspace<N extends ContextNote = ContextNote> {
    id: string;
    isIsolated: boolean;
    isolatedData?: {
        notes?: N[];
        activeNoteId?: number;
        nextNoteId?: number;
    };
}

export interface ContextState<N extends ContextNote = ContextNote> {
    notes: N[];
    activeNoteId: number;
    nextNoteId: number;
    globalNotes?: N[];
    activeWorkspaceId: string | null;
    workspaces: ContextWorkspace<N>[];
}

export interface ResolvedContextNotes<N extends ContextNote = ContextNote> {
    notes: N[];
    /** Always an id present in `notes`, or null when `notes` is empty. */
    activeNoteId: number | null;
    /** Always greater than every id in `notes`. */
    nextNoteId: number;
}

/** max(id) + 1, never lower than `fallback` (a stored counter) and never below 1. */
export function computeNextNoteId(notes: readonly ContextNote[] | undefined, fallback?: number): number {
    let maxId = 0;
    for (const n of notes ?? []) {
        if (typeof n?.id === 'number' && Number.isFinite(n.id) && n.id > maxId) maxId = n.id;
    }
    const stored = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 1;
    return Math.max(maxId + 1, stored, 1);
}

/** Keeps `preferred` if it points at an existing note, otherwise the first note id, otherwise null. */
export function resolveActiveNoteId(notes: readonly ContextNote[] | undefined, preferred?: number | null): number | null {
    const list = notes ?? [];
    if (typeof preferred === 'number' && list.some((n) => n.id === preferred)) return preferred;
    return list.length > 0 ? list[0].id : null;
}

function build<N extends ContextNote>(notes: N[] | undefined, activeNoteId?: number | null, nextNoteId?: number): ResolvedContextNotes<N> {
    const list = Array.isArray(notes) ? notes : [];
    return {
        notes: list,
        activeNoteId: resolveActiveNoteId(list, activeNoteId),
        nextNoteId: computeNextNoteId(list, nextNoteId),
    };
}

/**
 * Returns the notes (and a consistent activeNoteId/nextNoteId) of the context `ws` belongs to.
 * `ws === null` means the shared context. The returned arrays are NOT copied; callers that store
 * them elsewhere must deep-copy.
 */
export function resolveContextNotes<N extends ContextNote>(
    state: ContextState<N>,
    ws: ContextWorkspace<N> | null
): ResolvedContextNotes<N> {
    if (ws && ws.id === state.activeWorkspaceId) {
        return build(state.notes, state.activeNoteId, state.nextNoteId);
    }
    if (ws && ws.isIsolated) {
        const iso = ws.isolatedData;
        return build(iso?.notes, iso?.activeNoteId, iso?.nextNoteId);
    }
    // Shared context.
    const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    if (activeWs && activeWs.isIsolated) {
        return build(state.globalNotes, null, undefined);
    }
    return build(state.notes, state.activeNoteId, state.nextNoteId);
}
