import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ONBOARDING } from '../src/store/onboarding';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-604 (v29): the store's first-run state. A fresh install (nothing stored) starts `pending`; a stored v28 profile
// hydrates through the real store (persist + migrate) as `completed`, with the v1 tutorial state unchanged.
// Synthetic fixture only.

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
    return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/kobar-storage/v28-onboarding.json'), 'utf8'));
}

afterEach(() => {
    for (const persist of loaded.splice(0)) persist.appPersistStorage.lockWrites('test-teardown');
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('onboarding through the store (T-604)', () => {
    it('a fresh install starts pending, next to the unchanged v1 tutorial default', async () => {
        const { store } = await loadStore();
        const state = store.useAppStore.getState();
        expect(state.onboarding).toStrictEqual(DEFAULT_ONBOARDING);
        expect(state.onboarding).toStrictEqual({ status: 'pending', version: 1 });
        expect(state.tutorialState).toStrictEqual({ version: '1.0.0', status: 'pending' });
    });

    it('a stored v28 profile hydrates as completed; tutorialState and its setter keep working', async () => {
        const data = fixture();
        localStorage.setItem('kobar-storage', JSON.stringify(data));
        const { store, persist } = await loadStore();
        const state = store.useAppStore.getState();
        expect(store.useAppStore.persist.hasHydrated()).toBe(true);
        expect(state.onboarding).toStrictEqual({ status: 'completed', version: 1, migrated: true });
        expect(state.tutorialState).toStrictEqual(data.state.tutorialState);

        state.setTutorialState({ status: 'completed', snoozeUntil: undefined });
        expect(store.useAppStore.getState().tutorialState.status).toBe('completed');
        expect(store.useAppStore.getState().onboarding.status).toBe('completed');

        persist.flushAppPersist();
        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(32);
        expect(disk.state.onboarding).toStrictEqual({ status: 'completed', version: 1, migrated: true });
        expect(disk.state.legacyBackup.onboardingV29).toStrictEqual({ added: true, tutorialState: data.state.tutorialState });
    });

    it('setOnboarding merges valid updates and ignores invalid ones (plugins can call it)', async () => {
        const { store } = await loadStore();
        const { setOnboarding } = store.useAppStore.getState();
        setOnboarding({ status: 'skipped' });
        expect(store.useAppStore.getState().onboarding).toStrictEqual({ status: 'skipped', version: 1 });
        setOnboarding({ status: 'done' as never });
        setOnboarding({ version: 0 });
        setOnboarding({ migrated: false as never });
        expect(store.useAppStore.getState().onboarding).toStrictEqual({ status: 'skipped', version: 1 });
        // Only the known fields are stored: unknown keys from the caller are not persisted.
        setOnboarding({ status: 'pending', extra: 'x', __proto__: { y: 1 } } as never);
        expect(store.useAppStore.getState().onboarding).toStrictEqual({ status: 'pending', version: 1 });
        setOnboarding({ migrated: true, other: 1 } as never);
        expect(store.useAppStore.getState().onboarding).toStrictEqual({ status: 'pending', version: 1, migrated: true });
        // A garbage value in the store (left by a migration without a safe backup) is replaced, not merged into.
        store.useAppStore.setState({ onboarding: 'garbage' as never });
        setOnboarding({ status: 'completed' });
        expect(store.useAppStore.getState().onboarding).toStrictEqual({ status: 'completed', version: 1 });
    });
});
