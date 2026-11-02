import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { migrateToV33 } from '../src/store/migrations/v33';

// CNL-03: the kobar-storage v32 -> v33 block (Canlı: bar presentation, tonal surfaces, notes tab, privacy mode). Synthetic data only.

type State = Record<string, unknown>;

const DEFAULTS = { barItemSizes: {}, barHiddenItems: [], tonalSurfaces: true, notesTabVisible: true };

const v32 = (): State => ({
    featureOrder: ['calculator', 'todolist-plugin-btn'],
    notes: [{ id: 1 }],
    workspaces: [
        { id: 'a', name: 'A', featureOrder: ['x', 'y'] },
        { id: 'b', name: 'B', featureOrder: ['z'] },
    ],
    activeWorkspaceId: 'a',
});

describe('v33: Canlı persisted fields', () => {
    it('is the current version', () => {
        expect(KOBAR_STORAGE_VERSION).toBe(33);
    });

    it('adds the defaults on the top level and in every workspace, featureOrder untouched', () => {
        const state = v32();
        migrateToV33(state);
        expect(state).toMatchObject({ ...DEFAULTS, privacyMode: false, featureOrder: ['calculator', 'todolist-plugin-btn'] });
        const workspaces = state.workspaces as State[];
        expect(workspaces[0]).toStrictEqual({ id: 'a', name: 'A', featureOrder: ['x', 'y'], ...DEFAULTS });
        expect(workspaces[1]).toStrictEqual({ id: 'b', name: 'B', featureOrder: ['z'], ...DEFAULTS });
        expect(workspaces[0]).not.toHaveProperty('privacyMode');
        expect(state.notes).toStrictEqual([{ id: 1 }]);
    });

    it('runs from migrateKobarStorage for a v32 state', () => {
        const out = migrateKobarStorage(v32(), 32) as State;
        expect(out).toMatchObject({ ...DEFAULTS, privacyMode: false });
    });

    it('cleans invalid values and keeps valid ones', () => {
        const state: State = {
            barItemSizes: { ok: 'tile', icon1: 'icon', bad: 'huge', num: 3, '': 'tile' },
            barHiddenItems: ['a', 'a', 7, null, 'b'],
            tonalSurfaces: 'yes',
            notesTabVisible: false,
            privacyMode: 1,
            workspaces: [{ barItemSizes: [1, 2], barHiddenItems: 'x', tonalSurfaces: false, notesTabVisible: 0 }, 'junk', null],
        };
        migrateToV33(state);
        expect(state.barItemSizes).toStrictEqual({ ok: 'tile', icon1: 'icon' });
        expect(state.barHiddenItems).toStrictEqual(['a', 'b']);
        expect(state.tonalSurfaces).toBe(true);
        expect(state.notesTabVisible).toBe(false);
        expect(state.privacyMode).toBe(false);
        expect((state.workspaces as unknown[])[0]).toStrictEqual({
            barItemSizes: {},
            barHiddenItems: [],
            tonalSurfaces: false,
            notesTabVisible: true,
        });
        expect((state.workspaces as unknown[]).slice(1)).toStrictEqual(['junk', null]);
    });

    it('drops a __proto__ key', () => {
        const state: State = { barItemSizes: JSON.parse('{"__proto__":"tile","a":"tile"}') };
        migrateToV33(state);
        expect(Object.keys(state.barItemSizes as object)).toStrictEqual(['a']);
    });

    it('is idempotent', () => {
        const once = v32();
        migrateToV33(once);
        const twice = structuredClone(once);
        migrateToV33(twice);
        expect(twice).toStrictEqual(once);
    });

    it('does not throw on garbage', () => {
        for (const garbage of [null, undefined, 5, 'x', [], { workspaces: 'no' }]) {
            expect(() => migrateToV33(garbage)).not.toThrow();
        }
    });
});
