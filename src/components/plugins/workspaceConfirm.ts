// T-214 (WS-05, UI-26): what the Workspaces screen says before deleting a workspace or changing its data mode.
// Pure helpers (no React) so the copy selection can be tested.

import type { TranslationKeys } from '../../i18n';
import type { WorkspaceConfig } from '../../store/useAppStore';
import type { DeleteWorkspaceResult } from '../../store/workspace/deleteWorkspace';

export interface PendingWorkspaceConfirm {
    kind: 'delete' | 'isolation';
    preset: Pick<WorkspaceConfig, 'id' | 'name' | 'isIsolated' | 'isolatedData'>;
}

/** Confirmation lines (translation keys, `{name}` placeholder) for a pending action, in display order. */
export function workspaceConfirmMessageKeys(pending: PendingWorkspaceConfirm, activeWorkspaceId: string | null): TranslationKeys[] {
    const isActive = pending.preset.id === activeWorkspaceId;
    const keys: TranslationKeys[] = [];
    if (pending.kind === 'delete') {
        keys.push('workspaceDeleteConfirm');
        // A workspace that was ever isolated may own `_iso_<id>` plugin keys and isolated notes.
        if (pending.preset.isIsolated || pending.preset.isolatedData) keys.push('workspaceDeleteIsoNote');
        if (isActive) keys.push('workspaceDeleteActiveNote');
    } else {
        keys.push(pending.preset.isIsolated ? 'workspaceShareConfirm' : 'workspaceIsolateConfirm');
        if (isActive) keys.push('workspaceToggleActiveNote');
    }
    return keys;
}

/** Message shown after a delete attempt. */
export function deleteResultMessageKey(result: DeleteWorkspaceResult): TranslationKeys {
    if (result.success) return 'workspaceDeletedMsg';
    return result.reason === 'backup-failed' ? 'workspaceDeleteBackupFailed' : 'workspaceDeleteFailed';
}
