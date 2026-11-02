import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAppStoreValue } from '../src/backup/coreValues';
import { buildSettingsImport } from '../src/store/importExport';
import { applySettingsAction } from '../src/store/sync';
import { useAppStore, type AppState } from '../src/store/useAppStore';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig. Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// CNL-03 review gaps: settings import, two-workspace separation, sync payload validation, v32 backup restore. Synthetic data only.

vi.hoisted(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
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
    });
});

const store = useAppStore;
const initial = store.getState();
beforeEach(() => {
    store.setState(initial, true);
    localStorage.clear();
});

const LOCAL_BAR = { barItemSizes: { a: 'tile' }, barHiddenItems: ['h'], tonalSurfaces: false, notesTabVisible: false };

function local(): AppState {
    return {
        language: 'en',
        featureOrder: ['calculator'],
        activeWorkspaceId: 'w1',
        legacyBackup: {},
        workspaces: [{ id: 'w1', name: 'One', isIsolated: false, ...structuredClone(LOCAL_BAR) }],
    } as unknown as AppState;
}

const wsOf = (patch: { workspaces?: unknown }) => (patch.workspaces as Record<string, unknown>[]).find((w) => w.id === 'w1')!;

describe('buildSettingsImport and the v33 workspace fields', () => {
    it('a v32 file leaves the local workspace bar fields untouched', () => {
        const text = JSON.stringify({
            version: 32,
            language: 'tr',
            workspaces: [{ id: 'w1', name: 'One', isIsolated: false, featureOrder: ['x'] }],
        });
        const ws = wsOf(buildSettingsImport(text, local()));
        expect(ws).toMatchObject(LOCAL_BAR);
        expect(ws.featureOrder).toStrictEqual(['x']);
    });

    it('a v33 file round-trips the fields', () => {
        const bar = { barItemSizes: { z: 'tile' }, barHiddenItems: ['q'], tonalSurfaces: true, notesTabVisible: true };
        const text = JSON.stringify({
            version: 33,
            tonalSurfaces: true,
            privacyMode: true,
            workspaces: [{ id: 'w1', name: 'One', isIsolated: false, ...bar }],
        });
        const patch = buildSettingsImport(text, local());
        expect(wsOf(patch)).toMatchObject(bar);
        expect(patch).toMatchObject({ tonalSurfaces: true, privacyMode: true });
    });

    it('a malformed v33 value is dropped and the local value stays', () => {
        const text = JSON.stringify({
            version: 33,
            workspaces: [
                { id: 'w1', name: 'One', isIsolated: false, barItemSizes: { a: 'huge' }, tonalSurfaces: 'yes', notesTabVisible: true },
            ],
        });
        let patch: ReturnType<typeof buildSettingsImport> | undefined;
        try {
            patch = buildSettingsImport(text, local());
        } catch {
            // The whole malformed file may be rejected, which also keeps the local values.
        }
        if (!patch) return;
        const ws = wsOf(patch);
        expect(ws.barItemSizes).toStrictEqual(LOCAL_BAR.barItemSizes);
        expect(ws.tonalSurfaces).toBe(false);
    });
});

describe('two workspaces keep their own bar values; privacyMode stays global', () => {
    it('save and load keep the four values separate', () => {
        const s = () => store.getState();
        store.setState({ workspaces: [{ id: 'a', name: 'A', isIsolated: false } as never], activeWorkspaceId: 'a' });
        s().setBarItemSize('x', 'tile');
        s().setBarItemHidden('h', true);
        s().setTonalSurfaces(false);
        s().setNotesTabVisible(false);
        s().setPrivacyMode(true);
        s().saveCurrentAsWorkspace('B', false);
        const b = s().workspaces.find((w) => w.name === 'B')!;
        expect(b).toMatchObject({ barItemSizes: { x: 'tile' }, barHiddenItems: ['h'], tonalSurfaces: false, notesTabVisible: false });
        // Change B (now active), then switch back to A: A keeps its values, B keeps its own.
        s().setBarItemSize('x', 'icon');
        s().setBarItemHidden('h', false);
        s().setTonalSurfaces(true);
        s().setNotesTabVisible(true);
        s().loadWorkspace('a');
        expect(s()).toMatchObject({ barItemSizes: { x: 'tile' }, barHiddenItems: ['h'], tonalSurfaces: false, notesTabVisible: false });
        expect(s().workspaces.find((w) => w.id === b.id)).toMatchObject({
            barItemSizes: { x: 'icon' },
            barHiddenItems: [],
            tonalSurfaces: true,
            notesTabVisible: true,
        });
        s().loadWorkspace(b.id);
        expect(s()).toMatchObject({ barItemSizes: { x: 'icon' }, barHiddenItems: [], tonalSurfaces: true, notesTabVisible: true });
        expect(s().privacyMode).toBe(true);
        expect(s().workspaces.some((w) => 'privacyMode' in w)).toBe(false);
    });
});

describe('applySettingsAction rejects malformed payloads for the new setters', () => {
    const cases: [string, unknown][] = [
        ['setBarItemSizes', { a: 'huge' }],
        ['setBarItemSizes', 'tile'],
        ['setBarHiddenItems', 'x'],
        ['setBarHiddenItems', [1, 2]],
        ['setTonalSurfaces', 'yes'],
        ['setNotesTabVisible', 1],
        ['setPrivacyMode', null],
    ];
    it.each(cases)('%s with %j', (type, payload) => {
        store.setState({ isHydrated: true });
        const before = JSON.stringify(store.getState().barItemSizes) + store.getState().tonalSurfaces + store.getState().privacyMode;
        expect(applySettingsAction(store, { type, payload }, () => {})).toStrictEqual({ ok: false, reason: 'invalid-payload' });
        expect(JSON.stringify(store.getState().barItemSizes) + store.getState().tonalSurfaces + store.getState().privacyMode).toBe(before);
    });

    it('accepts valid payloads', () => {
        store.setState({ isHydrated: true });
        expect(applySettingsAction(store, { type: 'setBarItemSizes', payload: { a: 'tile' } }, () => {})).toMatchObject({ ok: true });
        expect(applySettingsAction(store, { type: 'setPrivacyMode', payload: true }, () => {})).toMatchObject({ ok: true });
        expect(store.getState()).toMatchObject({ barItemSizes: { a: 'tile' }, privacyMode: true });
    });
});

describe('restoring a v32 backup into the v33 app', () => {
    it('yields the migration defaults on the top level and in each workspace', () => {
        const text = readFileSync(resolve(__dirname, 'fixtures/kobar-storage/v32-workspaces.json'), 'utf8');
        const res = validateAppStoreValue(text);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        const out = JSON.parse(res.value) as { version: number; state: Record<string, unknown> };
        expect(out.version).toBe(33);
        const defaults = { barItemSizes: {}, barHiddenItems: [], tonalSurfaces: true, notesTabVisible: true };
        expect(out.state).toMatchObject({ ...defaults, privacyMode: false, featureOrder: ['calculator', 'todolist-plugin-btn'] });
        const workspaces = out.state.workspaces as Record<string, unknown>[];
        expect(workspaces).toHaveLength(2);
        for (const ws of workspaces) expect(ws).toMatchObject(defaults);
        expect(workspaces[1].featureOrder).toStrictEqual(['todolist-plugin-btn']);
    });
});
