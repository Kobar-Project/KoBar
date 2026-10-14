import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_PROFILE_KEYS_V24 } from '../src/store/migrations/v24';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-408: a stored v23 profile hydrates through the real store (persist + migrate) into the v24 shape, and the store keeps
// working on it unchanged. Synthetic fixture only.

type PersistModule = typeof import('../src/store/persistStorage');
type StoreModule = typeof import('../src/store/useAppStore');

const loaded: PersistModule[] = [];

/** Fresh module graph so the store hydrates from whatever is in localStorage right now. */
async function loadStore(): Promise<{ store: StoreModule; persist: PersistModule }> {
    vi.resetModules();
    const store = await import('../src/store/useAppStore');
    const persist = await import('../src/store/persistStorage');
    loaded.push(persist);
    return { store, persist };
}

function fixture(): { state: Record<string, unknown>; version: number } {
    return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/kobar-storage/v23-workspaces.json'), 'utf8'));
}

afterEach(() => {
    for (const persist of loaded.splice(0)) persist.appPersistStorage.lockWrites('test-teardown');
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('v24 through the store', () => {
    it('hydrates a v23 profile with an active isolated workspace into one profile copy, keeping notes and the backup', async () => {
        const data = fixture();
        localStorage.setItem('kobar-storage', JSON.stringify(data));
        const { store, persist } = await loadStore();
        const state = store.useAppStore.getState();
        const raw = data.state as Record<string, unknown> & { workspaces: Record<string, unknown>[] };

        expect(store.useAppStore.persist.hasHydrated()).toBe(true);
        expect(state.activeWorkspaceId).toBe('ws-iso');
        expect(state.notes).toEqual(raw.notes);
        expect(state.globalNotes).toEqual(raw.globalNotes);
        expect(state.theme).toBe('ocean');
        const active = state.workspaces[0] as unknown as Record<string, unknown>;
        for (const key of WORKSPACE_PROFILE_KEYS_V24) expect(active[key], key).toEqual(state[key]);
        expect(state.workspaces[0].isolatedData).toEqual(raw.workspaces[0].isolatedData);
        // v26 (T-601) adds accent/material to every record (ws-shared: ember -> amber, style1 -> solid); v27 (T-602) adds
        // density (46 -> normal) and makes isPopupSmartPositioning true (raw false backed up in densityV27).
        expect(state.workspaces[1]).toEqual({
            ...raw.workspaces[1],
            accent: 'amber',
            material: 'solid',
            density: 'normal',
            isPopupSmartPositioning: true,
        });
        expect(state.legacyBackup?.densityV27).toEqual({
            workspaces: [{ index: 1, id: 'ws-shared', values: { isPopupSmartPositioning: false } }],
        });
        expect(state.workspaces[2].isIsolated).toBe(false);
        expect(state.legacyBackup?.todos).toEqual((raw.legacyBackup as { todos: unknown }).todos);
        expect(state.legacyBackup?.workspaceModelV24).toBeDefined();

        // Store behaviour is unchanged: a profile setter still writes the top level and the active record.
        state.setTheme('ember');
        expect(store.useAppStore.getState().theme).toBe('ember');
        expect(store.useAppStore.getState().workspaces[0].theme).toBe('ember');

        persist.flushAppPersist();
        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(32);
        expect(disk.state.workspaces[0].theme).toBe('ember');
        expect(disk.state.legacyBackup.workspaceModelV24.workspaces[0].values.theme).toBe('midnight');
    });
});
