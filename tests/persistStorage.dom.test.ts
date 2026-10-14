import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FLUSH_PERSIST_EVENT,
    appPersistStorage,
    createDebouncedStorage,
    flushAppPersist,
    installFlushListeners,
    onPersistWriteError,
    type StorageLike,
} from '../src/store/persistStorage';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { setupLocalStorageIsolation } from '../src/utils/localStorageIsolation';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-129: debounced persist writes, flush on unload / main-process request, swallowed write errors.
// Synthetic data only; never touches a real profile.

// Map-backed fake (same approach as tests/isolation.dom.test.ts): the isolation layer patches methods on the
// global localStorage, which jsdom's Storage would store as items. Never unstubbed: vitest isolates test files.
const fakeStorage = vi.hoisted(() => {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string): void => {
            map.set(k, String(v));
        },
        removeItem: (k: string): void => {
            map.delete(k);
        },
        clear: (): void => map.clear(),
        key: (i: number): string | null => [...map.keys()][i] ?? null,
        get length(): number {
            return map.size;
        },
    };
    vi.stubGlobal('localStorage', storage);
    return { map };
});

const raw = fakeStorage.map;

function memoryBase(): StorageLike & { setItem: ReturnType<typeof vi.fn> } {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: vi.fn((k: string, v: string) => {
            map.set(k, v);
        }),
        removeItem: (k: string) => {
            map.delete(k);
        },
    };
}

function persistedState(): { state: Record<string, unknown>; version: number } {
    return JSON.parse(raw.get('kobar-storage') as string);
}

beforeEach(() => {
    vi.useFakeTimers();
    flushAppPersist();
    raw.clear();
});

afterEach(() => {
    flushAppPersist();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('createDebouncedStorage', () => {
    it('coalesces rapid writes into one trailing write after 500 ms', () => {
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base);
        for (let i = 0; i < 10; i++) {
            storage.setItem('k', `v${i}`);
            vi.advanceTimersByTime(40);
        }
        expect(base.setItem).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(base.setItem).toHaveBeenCalledTimes(1);
        expect(base.setItem).toHaveBeenCalledWith('k', 'v9');
    });

    it('returns the pending value from getItem before it is written (read-your-writes)', () => {
        const base = memoryBase();
        base.setItem('k', 'old');
        base.setItem.mockClear();
        const storage = createDebouncedStorage(() => base);
        storage.setItem('k', 'new');
        expect(base.getItem('k')).toBe('old');
        expect(storage.getItem('k')).toBe('new');
        expect(storage.getItem('missing')).toBeNull();
    });

    it('flush() writes the latest value synchronously and cancels the timer', () => {
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base);
        storage.setItem('k', 'a');
        storage.setItem('k', 'b');
        storage.flush();
        expect(base.getItem('k')).toBe('b');
        expect(storage.hasPending()).toBe(false);
        vi.advanceTimersByTime(5000);
        expect(base.setItem).toHaveBeenCalledTimes(1);
        storage.flush();
        expect(base.setItem).toHaveBeenCalledTimes(1);
    });

    it('bounds the wait while writes keep coming (maxWait)', () => {
        const base = memoryBase();
        const storage = createDebouncedStorage(() => base, { delayMs: 500, maxWaitMs: 2000 });
        for (let t = 0; t < 2100; t += 100) {
            storage.setItem('k', `t${t}`);
            vi.advanceTimersByTime(100);
        }
        expect(base.setItem).toHaveBeenCalled();
        expect(base.setItem.mock.calls[0][1]).toBe('t1900');
    });

    it('removeItem drops the pending value and removes the stored one', () => {
        const base = memoryBase();
        base.setItem('k', 'disk');
        base.setItem.mockClear();
        const storage = createDebouncedStorage(() => base);
        storage.setItem('k', 'pending');
        storage.removeItem('k');
        expect(storage.getItem('k')).toBeNull();
        vi.advanceTimersByTime(1000);
        expect(base.setItem).not.toHaveBeenCalled();
        expect(base.getItem('k')).toBeNull();
    });

    it('swallows a throwing setItem (QuotaExceededError), reports it and keeps working', () => {
        const base = memoryBase();
        const quota = new DOMException('quota', 'QuotaExceededError');
        base.setItem.mockImplementationOnce(() => {
            throw quota;
        });
        const onError = vi.fn();
        const storage = createDebouncedStorage(() => base, { onError });
        storage.setItem('k', 'too-big');
        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
        expect(onError).toHaveBeenCalledWith(quota, 'k');
        expect(storage.hasPending()).toBe(false);

        storage.setItem('k', 'fits');
        expect(() => storage.flush()).not.toThrow();
        expect(base.getItem('k')).toBe('fits');
    });

    it('a throwing onError does not escape either', () => {
        const base = memoryBase();
        base.setItem.mockImplementation(() => {
            throw new Error('disk');
        });
        const storage = createDebouncedStorage(() => base, {
            onError: () => {
                throw new Error('handler');
            },
        });
        storage.setItem('k', 'v');
        expect(() => storage.flush()).not.toThrow();
    });

    it('resolves the base storage at write time, not at creation', () => {
        const first = memoryBase();
        const second = memoryBase();
        let current = first;
        const storage = createDebouncedStorage(() => current);
        storage.setItem('k', 'v');
        current = second;
        storage.flush();
        expect(first.setItem).not.toHaveBeenCalled();
        expect(second.getItem('k')).toBe('v');
    });
});

describe('installFlushListeners', () => {
    it.each(['beforeunload', 'pagehide', FLUSH_PERSIST_EVENT])('flushes on window "%s"', (type) => {
        const flush = vi.fn();
        const uninstall = installFlushListeners({ flush }, window);
        window.dispatchEvent(new Event(type));
        expect(flush).toHaveBeenCalledTimes(1);
        uninstall();
        window.dispatchEvent(new Event(type));
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('flushes when the document becomes hidden, not when it becomes visible', () => {
        const flush = vi.fn();
        const uninstall = installFlushListeners({ flush }, window);
        const visibility = vi.spyOn(document, 'visibilityState', 'get');
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).not.toHaveBeenCalled();
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(flush).toHaveBeenCalledTimes(1);
        uninstall();
    });
});

describe('useAppStore persist through the debounced storage', () => {
    it('keeps the last change before close on disk (pagehide flush), same key / version / shape', () => {
        useAppStore.setState({ notePanelWidth: 333 });
        useAppStore.setState({ notePanelWidth: 444 });
        // Not written synchronously any more...
        expect(raw.has('kobar-storage')).toBe(false);
        // ...but readable through the storage (rehydrate path).
        expect(JSON.parse(appPersistStorage.getItem('kobar-storage') as string).state.notePanelWidth).toBe(444);

        window.dispatchEvent(new Event('pagehide'));

        const persisted = persistedState();
        expect(persisted.version).toBe(32);
        expect(persisted.state.notePanelWidth).toBe(444);
        const partialize = useAppStore.persist.getOptions().partialize!;
        expect(Object.keys(persisted.state).sort()).toEqual(
            Object.keys(JSON.parse(JSON.stringify(partialize(useAppStore.getState())))).sort()
        );
    });

    it('flushes on the main-process request event (before-quit / session-end path)', () => {
        useAppStore.setState({ notePanelHeight: 555 });
        window.dispatchEvent(new Event(FLUSH_PERSIST_EVENT));
        expect(persistedState().state.notePanelHeight).toBe(555);
    });

    it('writes once after the debounce when no flush happens', () => {
        const setItem = vi.spyOn(localStorage, 'setItem');
        for (let i = 0; i < 20; i++) useAppStore.setState({ notePanelWidth: 400 + i });
        expect(setItem).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(persistedState().state.notePanelWidth).toBe(419);
    });

    it('a failing localStorage write does not crash, keeps the in-memory state and logs once', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const listener = vi.fn();
        const unsubscribe = onPersistWriteError(listener);
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });

        useAppStore.setState({ notePanelWidth: 601 });
        expect(() => flushAppPersist()).not.toThrow();
        useAppStore.setState({ notePanelWidth: 602 });
        expect(() => vi.advanceTimersByTime(500)).not.toThrow();

        expect(useAppStore.getState().notePanelWidth).toBe(602);
        expect(error).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[0][1]).toBe('kobar-storage');
        unsubscribe();
    });

    it('kobar-storage stays un-suffixed under workspace isolation, so a switch cannot misroute a pending write', () => {
        setupLocalStorageIsolation();
        const isolated = { id: 'iso', name: 'ws-iso', isIsolated: true } as unknown as WorkspaceConfig;
        const shared = { id: 'shared', name: 'ws-shared', isIsolated: false } as unknown as WorkspaceConfig;

        // Pending write made while a shared workspace is active, flushed after switching to an isolated one.
        useAppStore.setState({ workspaces: [shared, isolated], activeWorkspaceId: 'shared', notePanelWidth: 701 });
        useAppStore.setState({ activeWorkspaceId: 'iso' });
        flushAppPersist();

        expect([...raw.keys()].filter((k) => k.startsWith('kobar-storage'))).toEqual(['kobar-storage']);
        expect(persistedState().state.activeWorkspaceId).toBe('iso');
        expect(persistedState().state.notePanelWidth).toBe(701);
        // Plugin keys are still isolated exactly as before.
        localStorage.setItem('plugin-key', 'v');
        expect(raw.has('plugin-key_iso_iso')).toBe(true);
    });
});
