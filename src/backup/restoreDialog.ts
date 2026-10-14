// T-615a: transient open/closed state of the main window's restore dialog (opened by the relayed `backup.restore` action, see
// src/store/systemSyncHost.ts). Deliberately NOT in the app store and never persisted: it only lives as long as the window.
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            /* a failing listener must not break the others */
        }
    }
}

export const openRestoreDialog = (): void => set(true);
export const closeRestoreDialog = (): void => set(false);
export const isRestoreDialogOpen = (): boolean => open;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export function useRestoreDialogOpen(): boolean {
    return useSyncExternalStore(subscribe, isRestoreDialogOpen, isRestoreDialogOpen);
}
