// T-615b: transient state of the main window's settings / notes export-import dialog (opened by the relayed `data.*` actions, see
// src/store/systemSyncHost.ts). Same idea as restoreDialog.ts: never in the app store, never persisted.
import { useSyncExternalStore } from 'react';

export type TransferMode = 'exportSettings' | 'exportNotes' | 'importSettings' | 'importNotes';

let current: TransferMode | null = null;
const listeners = new Set<() => void>();

function set(next: TransferMode | null): void {
    if (current === next) return;
    current = next;
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            /* a failing listener must not break the others */
        }
    }
}

export const openDataTransferDialog = (mode: TransferMode): void => set(mode);
export const closeDataTransferDialog = (): void => set(null);
export const getDataTransferMode = (): TransferMode | null => current;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export function useDataTransferMode(): TransferMode | null {
    return useSyncExternalStore(subscribe, getDataTransferMode, getDataTransferMode);
}
