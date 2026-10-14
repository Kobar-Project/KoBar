import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { captureLegacyFieldsV23, dedupeFeatureOrderV23, migrateToV23 } from '../src/store/migrations/v23';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-027: v22 -> v23. Synthetic data only.
const LEGACY = {
    todos: [{ id: 't1', text: 'synthetic' }],
    isTodoListEnabled: true,
    isColorPickerEnabled: false,
    colorPalettes: [['#111111', '#222222']],
    currentColor: '#abcdef',
};

describe('v23: legacyBackup', () => {
    it('stored v20: legacy fields (deleted by the old section) end up in legacyBackup, values intact', () => {
        const out = migrateKobarStorage({ featureOrder: ['a'], ...structuredClone(LEGACY) }, 20);
        // T-602: v27 adds its own slot (isPopupSmartPositioning false -> true), covered in tests/migrate.v27.test.ts.
        expect(undoV27(undoV28(undoV29(out))).legacyBackup).toStrictEqual(LEGACY);
        for (const key of Object.keys(LEGACY)) expect(out).not.toHaveProperty(key);
    });

    it('stored v22: fields still in the state are moved (verified) into legacyBackup', () => {
        const out = migrateKobarStorage(
            { ...structuredClone(LEGACY), toggleWidth: 22, featureSpacing: 8, isPopupSmartPositioning: false },
            22
        );
        expect(undoV27(undoV28(undoV29(out))).legacyBackup).toStrictEqual(LEGACY);
        expect(out).not.toHaveProperty('todos');
    });

    it('no legacy fields: no legacyBackup is created', () => {
        expect(migrateKobarStorage({ featureOrder: ['a'] }, 22)).not.toHaveProperty('legacyBackup');
    });

    it('stored v23+ is not touched', () => {
        const state = { featureOrder: ['a', 'a'], todos: [1] };
        // T-601/T-602: the v26 and v27 changes are undone (covered in tests/migrate.v26.test.ts, migrate.v27.test.ts).
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 23)))))).toStrictEqual(state);
    });

    it('an existing backup wins and a differing live value is kept in legacyBackup.conflicts', () => {
        const state: Record<string, unknown> = { legacyBackup: { todos: ['old'] }, todos: ['new'], currentColor: '#000000' };
        migrateToV23(state, {});
        expect(state.legacyBackup).toStrictEqual({ todos: ['old'], currentColor: '#000000', conflicts: { todos: ['new'] } });
        expect(state).not.toHaveProperty('todos'); // the differing live value lives on in conflicts
        expect(state).not.toHaveProperty('currentColor');
    });

    it('conflicts: first write wins, a different later value goes to the next free slot (lossless)', () => {
        const state: Record<string, unknown> = {
            legacyBackup: { todos: ['old'], conflicts: { todos: ['first'] } },
            todos: ['second'],
            currentColor: '#111111',
        };
        migrateToV23(state, {});
        expect(state.legacyBackup).toStrictEqual({
            todos: ['old'],
            currentColor: '#111111',
            conflicts: { todos: ['first'], 'todos#2': ['second'] },
        });
        expect(state).not.toHaveProperty('todos');
        expect(state).not.toHaveProperty('currentColor');
    });

    it('conflicts: reruns reuse an identical slot and fill the next free one', () => {
        const backup = { todos: ['old'], conflicts: { todos: ['first'], 'todos#2': ['second'] } };
        const same: Record<string, unknown> = { legacyBackup: structuredClone(backup), todos: ['second'] };
        migrateToV23(same, {});
        expect(same.legacyBackup).toStrictEqual(backup);
        expect(same).not.toHaveProperty('todos');

        const third: Record<string, unknown> = { legacyBackup: structuredClone(backup), todos: ['third'] };
        migrateToV23(third, {});
        expect((third.legacyBackup as Record<string, unknown>).conflicts).toStrictEqual({
            ...backup.conflicts,
            'todos#3': ['third'],
        });
        expect(third).not.toHaveProperty('todos');
    });

    it('tolerates garbage', () => {
        expect(() => migrateToV23(null, {})).not.toThrow();
        expect(captureLegacyFieldsV23(null)).toStrictEqual({});
        expect(() => migrateToV23({ legacyBackup: 'x', todos: [1] }, {})).not.toThrow();
    });

    it('is idempotent', () => {
        const once = migrateKobarStorage({ ...structuredClone(LEGACY), featureOrder: ['a', 'a'] }, 20);
        const twice = migrateKobarStorage(structuredClone(once), 22);
        expect(twice).toStrictEqual(once);
    });
});

describe('v23: featureOrder duplicates', () => {
    it('keeps the first occurrence, order and non-string entries', () => {
        expect(dedupeFeatureOrderV23(['a', 'b', 'a', 1, 'c', 'b', 1])).toStrictEqual(['a', 'b', 1, 'c', 1]);
    });

    it('also dedupes workspace featureOrder arrays (and ignores non-arrays)', () => {
        const out = migrateKobarStorage(
            { workspaces: [{ id: 'w', featureOrder: ['p', 'q', 'p'] }, { id: 'v', featureOrder: 'x' }, null] },
            22
        );
        expect(out.workspaces[0].featureOrder).toStrictEqual(['p', 'q']);
        expect(out.workspaces[1].featureOrder).toBe('x');
    });

    it('applies to stored v21 and v22 profiles without touching anything else in the bar', () => {
        const out = migrateKobarStorage({ featureOrder: ['x', 'y', 'x'] }, 21);
        expect(out.featureOrder).toStrictEqual(['x', 'y']);
        expect(out.featureOrder).not.toContain('ko-calender-plugin-btn');
    });
});
