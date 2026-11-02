import { useSyncExternalStore } from 'react';

/**
 * Non-persisted bar presentation mode (thin or wide). The Sidebar publishes it after packing the items and App reads it
 * to size the bar wrapper from mode and density (instead of the legacy `sidebarWidth`).
 */
export type BarMode = 'thin' | 'wide';

let mode: BarMode = 'thin';
const listeners = new Set<() => void>();

export function setBarMode(next: BarMode): void {
    if (next === mode) return;
    mode = next;
    for (const listener of [...listeners]) listener();
}

export function getBarMode(): BarMode {
    return mode;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useBarMode(): BarMode {
    return useSyncExternalStore(subscribe, getBarMode, getBarMode);
}
