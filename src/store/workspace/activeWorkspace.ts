// Pure helpers around the ACTIVE workspace on the current persisted shape (T-406, ARC-07).
// No store imports: the store imports this module, so it must stay free of cycles.
//
// Today the active workspace's profile lives twice: in the top-level state (live) and in `workspaces[i]`.
// Every profile setter writes both; patchActiveWorkspace() is the "also update the active workspace" half of that.

export interface ActiveWorkspaceItem {
    id: string;
}

export interface ActiveWorkspaceState<W extends ActiveWorkspaceItem = ActiveWorkspaceItem> {
    activeWorkspaceId: string | null;
    workspaces: W[];
}

/** The active workspace, or undefined when none is active or the id no longer exists. */
export function findActiveWorkspace<W extends ActiveWorkspaceItem>(state: {
    activeWorkspaceId: string | null;
    workspaces: readonly W[];
}): W | undefined {
    return state.workspaces.find((w) => w.id === state.activeWorkspaceId);
}

/**
 * Returns `workspaces` with the active entry patched (shallow merge, or `update(w)` for a function).
 * Without an active id the SAME array is returned; an active id that matches nothing still yields a new array
 * with the same items (same as the inline `activeWorkspaceId ? workspaces.map(...) : workspaces` pattern).
 */
export function patchActiveWorkspace<W extends ActiveWorkspaceItem>(
    state: ActiveWorkspaceState<W>,
    update: Partial<W> | ((w: W) => W)
): W[] {
    if (!state.activeWorkspaceId) return state.workspaces;
    return state.workspaces.map((w) => {
        if (w.id !== state.activeWorkspaceId) return w;
        return typeof update === 'function' ? update(w) : { ...w, ...update };
    });
}
