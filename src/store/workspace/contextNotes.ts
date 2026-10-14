// Pure read/write helpers for the notes of a context (T-406), on the current persisted shape.
// No store imports: the store imports this module, so it must stay free of cycles.
//
// Writes return a PATCH for `set()`, they never mutate `state`. The rules mirror the inline pattern every note action
// uses today (addNote, deleteNote, updateNote*, open*Tab, setActiveNoteId):
// - the live `notes`/`activeNoteId`/`nextNoteId` always take the written values;
// - an isolated active workspace also gets them merged into its `isolatedData`;
// - otherwise (shared context) written notes are mirrored to `globalNotes` (ids are not stored for it separately).
// Only the fields passed in are written; nothing is normalised or deep-copied here (callers own those decisions).

import { findActiveWorkspace } from './activeWorkspace';
import { resolveContextNotes, type ContextNote, type ContextState, type ContextWorkspace, type ResolvedContextNotes } from './context';
import { activeContextId, GLOBAL_CONTEXT_ID, workspaceIdOfContext, type ContextId } from './contextId';

export interface ContextNotesWrite<N extends ContextNote = ContextNote> {
    notes?: N[];
    activeNoteId?: number;
    nextNoteId?: number;
}

export interface ContextNotesPatch<
    N extends ContextNote = ContextNote,
    W extends ContextWorkspace<N> = ContextWorkspace<N>,
> extends ContextNotesWrite<N> {
    globalNotes?: N[];
    workspaces?: W[];
}

export interface ContextNotesState<
    N extends ContextNote = ContextNote,
    W extends ContextWorkspace<N> = ContextWorkspace<N>,
> extends ContextState<N> {
    workspaces: W[];
}

/** Only the defined fields, in a fixed order (notes, activeNoteId, nextNoteId). */
function definedFields<N extends ContextNote>(data: ContextNotesWrite<N>): ContextNotesWrite<N> {
    const out: ContextNotesWrite<N> = {};
    if (data.notes !== undefined) out.notes = data.notes;
    if (data.activeNoteId !== undefined) out.activeNoteId = data.activeNoteId;
    if (data.nextNoteId !== undefined) out.nextNoteId = data.nextNoteId;
    return out;
}

function mergeIsolatedData<N extends ContextNote, W extends ContextWorkspace<N>>(
    workspaces: W[],
    id: string,
    fields: ContextNotesWrite<N>
): W[] {
    return workspaces.map((w) => (w.id === id ? { ...w, isolatedData: { ...(w.isolatedData || {}), ...fields } } : w));
}

/** The isolated workspace a context id names; undefined for 'global' or when it no longer names an isolated workspace. */
export function workspaceOfContext<W extends ContextWorkspace>(state: { workspaces: readonly W[] }, contextId: ContextId): W | undefined {
    const id = workspaceIdOfContext(contextId);
    if (id === null) return undefined;
    const ws = state.workspaces.find((w) => w.id === id);
    return ws && ws.isIsolated ? ws : undefined;
}

/** Notes of the active context (the live fields, with a consistent activeNoteId/nextNoteId). Arrays are not copied. */
export function readActiveContextNotes<N extends ContextNote>(state: ContextState<N>): ResolvedContextNotes<N> {
    return resolveContextNotes(state, findActiveWorkspace(state) ?? null);
}

/**
 * Notes of any context: 'global' -> the shared notes (live, or `globalNotes` while an isolated workspace is active);
 * 'ws:<id>' -> that isolated workspace's notes. Null when the id names no isolated workspace. Arrays are not copied.
 */
export function readContextNotes<N extends ContextNote>(state: ContextState<N>, contextId: ContextId): ResolvedContextNotes<N> | null {
    if (contextId === GLOBAL_CONTEXT_ID) return resolveContextNotes(state, null);
    const ws = workspaceOfContext(state, contextId);
    return ws ? resolveContextNotes(state, ws) : null;
}

/** Patch that writes `data` to the active context (live fields + its owner, see the rules above). */
export function writeActiveContextNotes<N extends ContextNote, W extends ContextWorkspace<N>>(
    state: ContextNotesState<N, W>,
    data: ContextNotesWrite<N>
): ContextNotesPatch<N, W> {
    const fields = definedFields(data);
    const activeWs = findActiveWorkspace(state);
    if (activeWs && activeWs.isIsolated) {
        return { ...fields, workspaces: mergeIsolatedData(state.workspaces, activeWs.id, fields) };
    }
    return fields.notes !== undefined ? { ...fields, globalNotes: fields.notes } : { ...fields };
}

/**
 * Patch that writes `data` to `contextId`. The active context goes through writeActiveContextNotes; an inactive
 * isolated workspace only gets its `isolatedData` merged; the inactive shared context (an isolated workspace is
 * active) only stores notes, as `globalNotes` (its activeNoteId/nextNoteId are derived, so they are ignored).
 * An id that names no isolated workspace yields an empty patch.
 */
export function writeContextNotes<N extends ContextNote, W extends ContextWorkspace<N>>(
    state: ContextNotesState<N, W>,
    contextId: ContextId,
    data: ContextNotesWrite<N>
): ContextNotesPatch<N, W> {
    if (contextId === activeContextId(state)) return writeActiveContextNotes(state, data);
    const fields = definedFields(data);
    if (contextId === GLOBAL_CONTEXT_ID) {
        return fields.notes !== undefined ? { globalNotes: fields.notes } : {};
    }
    const ws = workspaceOfContext(state, contextId);
    if (!ws) return {};
    return { workspaces: mergeIsolatedData(state.workspaces, ws.id, fields) };
}
