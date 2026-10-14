import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_PERSIST_EVENT, createDebouncedStorage, type StorageLike } from '../src/store/persistStorage';
import { migrateKobarStorage } from '../src/store/migrations';
import { KOBAR_STORAGE_VERSION } from './chain/runChain';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-201 (PROD-02): kobar-storage write lock until a successful hydration, and the failure mode
// (no writes for the session, stored value untouched, user informed). Synthetic fixtures only.

type PersistModule = typeof import('../src/store/persistStorage');
type StoreModule = typeof import('../src/store/useAppStore');
type ErrorModule = typeof import('../src/store/hydrationError');

const loaded: PersistModule[] = [];

/** Fresh module graph so the store hydrates from whatever is in localStorage right now. */
async function loadStore(): Promise<{ store: StoreModule; persist: PersistModule; errors: ErrorModule }> {
    vi.resetModules();
    const store = await import('../src/store/useAppStore');
    const persist = await import('../src/store/persistStorage');
    const errors = await import('../src/store/hydrationError');
    loaded.push(persist);
    return { store, persist, errors };
}

function fixture(name: string): { state: Record<string, unknown>; version: number } {
    return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/kobar-storage', name), 'utf8'));
}

function memoryBase(): StorageLike & { setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> } {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: vi.fn((k: string, v: string) => {
            map.set(k, v);
        }),
        removeItem: vi.fn((k: string) => {
            map.delete(k);
        }),
    };
}

afterEach(() => {
    // Silence every module instance loaded by this file so a stale timer/listener cannot write into a later test.
    for (const persist of loaded.splice(0)) persist.appPersistStorage.lockWrites('test-teardown');
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('createDebouncedStorage write lock', () => {
    it('drops setItem while locked, discards pending values on lock and flush writes nothing', () => {
        vi.useFakeTimers();
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base);
        storage.setItem('k', 'pending-before-lock');
        storage.lockWrites('test');
        expect(storage.isLocked()).toBe(true);
        expect(storage.lockReason()).toBe('test');
        expect(storage.hasPending()).toBe(false);

        storage.setItem('k', 'while-locked');
        expect(storage.hasPending()).toBe(false);
        storage.flush();
        vi.advanceTimersByTime(10_000);
        expect(base.setItem).not.toHaveBeenCalled();
        expect(storage.getItem('k')).toBeNull();
    });

    it('never removes the stored value while locked', () => {
        const base = memoryBase();
        base.setItem('k', 'disk');
        base.setItem.mockClear();
        const storage = createDebouncedStorage(() => base);
        storage.lockWrites('test');
        storage.removeItem('k');
        expect(base.removeItem).not.toHaveBeenCalled();
        expect(storage.getItem('k')).toBe('disk');
    });

    it('works normally again after unlockWrites', () => {
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base);
        storage.lockWrites('test');
        storage.unlockWrites();
        expect(storage.isLocked()).toBe(false);
        expect(storage.lockReason()).toBeNull();
        storage.setItem('k', 'v');
        storage.flush();
        expect(base.getItem('k')).toBe('v');
    });

    it('flush listeners write nothing while locked', () => {
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base);
        storage.lockWrites('test');
        storage.setItem('k', 'v');
        storage.flush();
        expect(base.setItem).not.toHaveBeenCalled();
    });
});

describe('useAppStore hydration with the write lock', () => {
    it.each([
        'v0.json',
        'v5.json',
        'v12.json',
        'v18.json',
        'v20.json',
        // T-205: v21 is an old version since the v22 bump.
        'v21.json',
        'v21-ws-duplicate-ids.json',
        'v21-no-active-workspace.json',
    ])('old-version fixture %s: migrated state and current version reach disk', async (name) => {
        const data = fixture(name);
        localStorage.setItem('kobar-storage', JSON.stringify(data));
        const { store, persist } = await loadStore();

        expect(store.useAppStore.persist.hasHydrated()).toBe(true);
        expect(store.useAppStore.getState().isHydrated).toBe(true);
        expect(persist.appPersistStorage.isLocked()).toBe(false);
        // The first post-unlock write (setHydrated) is pending with the migrated state.
        expect(persist.appPersistStorage.hasPending()).toBe(true);

        persist.flushAppPersist();
        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(KOBAR_STORAGE_VERSION);

        const expected = migrateKobarStorage(structuredClone(data.state), data.version) as Record<string, unknown>;
        const partialize = store.useAppStore.persist.getOptions().partialize!;
        const persistedKeys = Object.keys(JSON.parse(JSON.stringify(partialize(store.useAppStore.getState()))));
        expect(Object.keys(disk.state).sort()).toEqual([...persistedKeys].sort());
        for (const key of persistedKeys) {
            if (key in expected) expect(disk.state[key], key).toEqual(expected[key]);
        }
    });

    it('current-version data: unlocks and keeps the data', async () => {
        // A current (v22) blob: the v21 fixture already migrated, stored with the current version.
        const v21 = fixture('v21.json');
        const data = { state: migrateKobarStorage(structuredClone(v21.state), v21.version), version: KOBAR_STORAGE_VERSION };
        localStorage.setItem('kobar-storage', JSON.stringify(data));
        const { store, persist } = await loadStore();
        expect(persist.appPersistStorage.isLocked()).toBe(false);
        persist.flushAppPersist();
        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(KOBAR_STORAGE_VERSION);
        expect(disk.state.notes).toEqual(data.state.notes);
        expect(disk.state.workspaces).toEqual(data.state.workspaces);
        expect(store.useAppStore.getState().notes).toEqual(data.state.notes);
    });

    it('T-205: a v21 profile with duplicate note ids hydrates to v22 with unique ids and the active workspace layout', async () => {
        const data = fixture('v21-ws-duplicate-ids.json');
        localStorage.setItem('kobar-storage', JSON.stringify(data));
        const { store, persist } = await loadStore();
        const state = store.useAppStore.getState();
        expect(state.notes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
        expect(state.notes.map((n) => n.content)).toEqual((data.state.notes as { content: string }[]).map((n) => n.content));
        expect(state.activeNoteId).toBe(2);
        expect(state.nextNoteId).toBe(5);
        expect(state.toggleWidth).toBe(40);
        expect(state.featureSpacing).toBe(20);
        expect(state.isPopupSmartPositioning).toBe(true);

        persist.flushAppPersist();
        const disk = JSON.parse(localStorage.getItem('kobar-storage') as string);
        expect(disk.version).toBe(KOBAR_STORAGE_VERSION);
        expect(disk.state.toggleWidth).toBe(40);
    });

    it('T-205 (WS-06): the three layout settings survive a restart', async () => {
        const first = await loadStore();
        first.store.useAppStore.getState().setToggleWidth(37);
        first.store.useAppStore.getState().setFeatureSpacing(14);
        first.store.useAppStore.getState().setIsPopupSmartPositioning(true);
        first.persist.flushAppPersist();
        first.persist.appPersistStorage.lockWrites('test-restart');

        const second = await loadStore();
        const state = second.store.useAppStore.getState();
        expect(state.toggleWidth).toBe(37);
        expect(state.featureSpacing).toBe(14);
        expect(state.isPopupSmartPositioning).toBe(true);
    });

    it('fresh profile (nothing stored): unlocks and persists normally', async () => {
        const { store, persist } = await loadStore();
        expect(persist.appPersistStorage.isLocked()).toBe(false);
        store.useAppStore.setState({ notePanelWidth: 345 });
        persist.flushAppPersist();
        expect(JSON.parse(localStorage.getItem('kobar-storage') as string).state.notePanelWidth).toBe(345);
    });

    it.each([
        ['unparseable JSON', '{"state": {"notes": [ broken'],
        ['migrate throws (state is null)', '{"state":null,"version":5}'],
    ])('failed hydration (%s): nothing is written, original kept byte-for-byte, user informed', async (_label, original) => {
        localStorage.setItem('kobar-storage', original);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
        const { store, persist, errors } = await loadStore();

        expect(persist.appPersistStorage.isLocked()).toBe(true);
        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(store.useAppStore.persist.hasHydrated()).toBe(false);
        expect(document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)).not.toBeNull();
        expect(window.api.sendNotification).toHaveBeenCalledTimes(1);

        // The in-memory store keeps working...
        store.useAppStore.setState({ notePanelWidth: 777 });
        store.useAppStore.getState().setNotePanelWidth?.(778);
        expect(store.useAppStore.getState().notePanelWidth).toBeGreaterThanOrEqual(777);
        // ...but nothing reaches disk: debounce, explicit flush, unload and the main-process flush request.
        await new Promise((resolve) => setTimeout(resolve, 600));
        persist.flushAppPersist();
        window.dispatchEvent(new Event('beforeunload'));
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new Event(FLUSH_PERSIST_EVENT));
        store.useAppStore.persist.clearStorage();

        expect(localStorage.getItem('kobar-storage')).toBe(original);
        expect(setItem.mock.calls.filter(([key]) => key === 'kobar-storage')).toEqual([]);
        expect(removeItem.mock.calls.filter(([key]) => key === 'kobar-storage')).toEqual([]);
    });

    it('failed hydration (localStorage.getItem throws): lock stays and nothing is written', async () => {
        const original = JSON.stringify(fixture('v21.json'));
        localStorage.setItem('kobar-storage', original);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const realGetItem = Storage.prototype.getItem;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
            if (key === 'kobar-storage') throw new DOMException('denied', 'SecurityError');
            return realGetItem.call(this, key);
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { store, persist, errors } = await loadStore();

        expect(persist.appPersistStorage.isLocked()).toBe(true);
        expect(persist.appPersistStorage.lockReason()).toBe(errors.HYDRATION_FAILED_LOCK_REASON);
        expect(store.useAppStore.persist.hasHydrated()).toBe(false);
        expect(document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)).not.toBeNull();

        store.useAppStore.setState({ notePanelWidth: 812 });
        persist.flushAppPersist();
        window.dispatchEvent(new Event(FLUSH_PERSIST_EVENT));
        expect(setItem.mock.calls.filter(([key]) => key === 'kobar-storage')).toEqual([]);
        vi.mocked(Storage.prototype.getItem).mockRestore();
        expect(localStorage.getItem('kobar-storage')).toBe(original);
    });

    it('the error banner is dismissible, fixed-position and localized', async () => {
        localStorage.setItem('kobar-storage', 'not json');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { errors } = await loadStore();
        const banner = document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)!;
        expect(banner.style.position).toBe('fixed');
        expect(banner.getAttribute('role')).toBe('alert');
        expect(banner.classList.contains('pointer-events-auto')).toBe(true);
        expect(banner.textContent).toContain('KoBar could not read your saved settings');
        // Shown once even if called again.
        expect(errors.showHydrationErrorBanner('en')).toBe(banner);
        banner.querySelector('button')!.click();
        expect(document.getElementById(errors.HYDRATION_ERROR_BANNER_ID)).toBeNull();
    });
});

describe('store source wiring', () => {
    const source = readFileSync(resolve(__dirname, '../src/store/useAppStore.ts'), 'utf8');

    it('locks writes before the persist store is created and unlocks only on success', () => {
        const lock = source.indexOf("appPersistStorage.lockWrites('hydration-pending')");
        const create = source.indexOf('export const useAppStore = create<AppState>()(');
        expect(lock).toBeGreaterThan(0);
        expect(lock).toBeLessThan(create);
        expect(source.match(/appPersistStorage\.unlockWrites\(\)/g)).toHaveLength(1);
        expect(source).toMatch(/if \(error \|\| !fetchedState\) \{\s*\/\/[^\n]*\s*handleHydrationFailure\(/);
    });
});
