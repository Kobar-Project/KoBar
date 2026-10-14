import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { setupLocalStorageIsolation } from '../src/utils/localStorageIsolation';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-011: pins the current behaviour of src/utils/localStorageIsolation.ts. Synthetic data only.
// File is `.dom.test.ts` (not `.test.ts`) because the module needs the store + localStorage.

// Map-backed fake: assigning localStorage.setItem = fn on jsdom Storage goes through the named-property setter and stores an item.
// The stub is intentionally never unstubbed: vitest isolates test files.
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
const store = useAppStore;
// The persist middleware rewrites the system key kobar-storage on every setState; ignore it unless a test seeds it explicitly.
const keys = (): string[] => [...raw.keys()].filter((k) => k !== 'kobar-storage');

function ws(id: string, isIsolated: boolean): WorkspaceConfig {
    return { id, name: `ws-${id}`, isIsolated } as unknown as WorkspaceConfig;
}

function activate(id: string, isolated: boolean): void {
    store.setState({ workspaces: [ws(id, isolated)], activeWorkspaceId: id });
}

// After setup the patched methods stay installed for the whole file; reset the backing map directly.
// The shared-mode clear() warning is emitted once per module load, and tests/setup.ts calls localStorage.clear() in its global
// beforeEach (shared state), so the warning fires before the first test body. Capture it with a file-wide console.warn mock
// (a plain recorder, so afterEach's restoreAllMocks cannot reset it) and keep it out of the test output.
const warnCalls: unknown[][] = [];
const warnMock = (...args: unknown[]): void => {
    warnCalls.push(args);
};
const originalWarn = console.warn;
const CLEAR_WARNING = 'localStorage.clear() is ignored in shared workspaces';
const clearWarnings = (): number => warnCalls.filter((c) => String(c[0]).includes(CLEAR_WARNING)).length;

beforeAll(() => {
    console.warn = warnMock;
    setupLocalStorageIsolation();
});
afterAll(() => {
    console.warn = originalWarn;
});
beforeEach(() => {
    activate('shared', false);
    raw.clear();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('localStorageIsolation: key suffixing', () => {
    it('isolated active workspace: setItem/getItem/removeItem use the _iso_<wsId> suffix', () => {
        activate('w1', true);
        localStorage.setItem('plugin-key', 'v');
        expect(keys()).toEqual(['plugin-key_iso_w1']);
        expect(localStorage.getItem('plugin-key')).toBe('v');
        localStorage.removeItem('plugin-key');
        expect(keys()).toEqual([]);
    });

    it('shared active workspace: no suffix', () => {
        activate('w1', false);
        localStorage.setItem('plugin-key', 'v');
        expect(keys()).toEqual(['plugin-key']);
        expect(localStorage.getItem('plugin-key')).toBe('v');
    });

    it('unknown active workspace id behaves like shared (no suffix)', () => {
        store.setState({ workspaces: [ws('w1', true)], activeWorkspaceId: 'missing' });
        localStorage.setItem('k', 'v');
        expect(keys()).toEqual(['k']);
    });

    it.each(['kobar-storage', 'kobar_force_theme_color', 'kobar_license_key', 'kobar_language', 'kobar_onboarding_completed'])(
        'system key %s is never suffixed, even in an isolated workspace',
        (key) => {
            activate('w1', true);
            localStorage.setItem(key, 'sys');
            expect(raw.get(key)).toBe('sys');
            expect(raw.has(`${key}_iso_w1`)).toBe(false);
            expect(localStorage.getItem(key)).toBe('sys');
        }
    );

    it('empty key is passed through unsuffixed', () => {
        activate('w1', true);
        localStorage.setItem('', 'v');
        expect(keys()).toEqual(['']);
    });

    it('each isolated workspace sees only its own value; shared sees the unsuffixed one', () => {
        activate('a', true);
        localStorage.setItem('k', 'A');
        activate('b', true);
        expect(localStorage.getItem('k')).toBeNull();
        localStorage.setItem('k', 'B');
        activate('shared', false);
        expect(localStorage.getItem('k')).toBeNull();
        localStorage.setItem('k', 'S');
        activate('a', true);
        expect(localStorage.getItem('k')).toBe('A');
        expect(keys().sort()).toEqual(['k', 'k_iso_a', 'k_iso_b']);
    });

    it('falls back to the plain key (and warns) when reading store state throws', () => {
        activate('w1', true);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(store, 'getState').mockImplementation(() => {
            throw new Error('boom');
        });
        localStorage.setItem('k', 'v');
        expect(warn).toHaveBeenCalled();
        expect(keys()).toEqual(['k']);
    });
});

describe('localStorageIsolation: clear()', () => {
    function seed(): void {
        raw.set('kobar-storage', 'sys');
        raw.set('kobar_language', 'tr');
        raw.set('plain', '1');
        raw.set('k_iso_a', '2');
        raw.set('k_iso_b', '3');
    }

    it('isolated mode removes only keys ending with its own suffix', () => {
        activate('a', true);
        seed();
        localStorage.clear();
        expect([...raw.keys()].sort()).toEqual(['k_iso_b', 'kobar-storage', 'kobar_language', 'plain']);
    });

    it('shared mode is a no-op: app keys, plugin keys and iso keys all survive; never throws', () => {
        activate('shared', false);
        seed();
        const before = [...raw.keys()].sort();
        // Already fired once (setup's beforeEach clear); the explicit clears below must not warn again.
        expect(clearWarnings()).toBe(1);
        expect(() => localStorage.clear()).not.toThrow();
        localStorage.clear();
        expect(clearWarnings()).toBe(1);
        expect([...raw.keys()].sort()).toEqual(before);
        expect(raw.get('kobar-storage')).toBe('sys');
    });

    it('never removes system keys', () => {
        activate('a', true);
        seed();
        localStorage.clear();
        expect(raw.get('kobar-storage')).toBe('sys');
        expect(raw.get('kobar_language')).toBe('tr');
    });

    it('isolated mode matches the exact "_iso_<id>" tail only', () => {
        raw.set('k_iso_a', '1');
        raw.set('k_iso_xa', '2');
        raw.set('k_iso_a_iso_a', '3');
        activate('a', true);
        localStorage.clear();
        expect(raw.has('k_iso_xa')).toBe(true);
        expect(raw.has('k_iso_a')).toBe(false);
        expect(raw.has('k_iso_a_iso_a')).toBe(false);
    });
});
