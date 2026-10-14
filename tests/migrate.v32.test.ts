import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { migrateToV32 } from '../src/store/migrations/v32';
import { validateCoreValue } from '../src/backup/coreValues';

// R-15: the kobar-storage v31 -> v32 block (optional `pluginPanelOffsets`). Synthetic data only.

type State = Record<string, unknown>;

const v21 = (): State =>
    (JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/kobar-storage/v21.json', import.meta.url)), 'utf8')) as { state: State })
        .state;

describe('v32: pluginPanelOffsets', () => {
    it('is the current version', () => {
        expect(KOBAR_STORAGE_VERSION).toBe(32);
    });

    it('leaves a missing key missing and touches nothing else', () => {
        const state = { notes: [{ id: 1 }], noteListWidth: 200 };
        const before = structuredClone(state);
        migrateToV32(state);
        expect(state).toStrictEqual(before);
    });

    it('keeps valid entries, rounds and clamps numbers', () => {
        const state: State = { pluginPanelOffsets: { a: { x: 10.4, y: -3 }, b: { x: 1e9 }, c: { y: -1e9 } } };
        migrateToV32(state);
        expect(state.pluginPanelOffsets).toStrictEqual({ a: { x: 10, y: -3 }, b: { x: 100000 }, c: { y: -100000 } });
    });

    it('drops non-finite axes, bad entries and entries without any axis', () => {
        const state: State = {
            pluginPanelOffsets: { a: { x: NaN, y: 4 }, b: { x: 'q' }, c: 5, d: null, e: [], f: {}, g: { x: Infinity } },
        };
        migrateToV32(state);
        expect(state.pluginPanelOffsets).toStrictEqual({ a: { y: 4 } });
    });

    it('deletes a key that is not an object', () => {
        for (const input of [null, 5, 'x', [], true]) {
            const state: State = { pluginPanelOffsets: input, keep: 1 };
            migrateToV32(state);
            expect(state).toStrictEqual({ keep: 1 });
        }
    });

    it('never throws on garbage and is idempotent', () => {
        for (const garbage of [null, undefined, 5, 'x', []]) expect(() => migrateToV32(garbage)).not.toThrow();
        const state: State = { pluginPanelOffsets: { a: { x: 3.7, y: NaN } } };
        migrateToV32(state);
        const once = structuredClone(state);
        migrateToV32(state);
        expect(state).toStrictEqual(once);
    });

    it('runs through migrateKobarStorage for a stored v31 and not for a stored v32', () => {
        const migrated = migrateKobarStorage({ pluginPanelOffsets: { a: { x: 1e9 } } }, 31) as State;
        expect(migrated.pluginPanelOffsets).toStrictEqual({ a: { x: 100000 } });
        const untouched = migrateKobarStorage({ pluginPanelOffsets: { a: { x: 1e9 } } }, 32) as State;
        expect(untouched.pluginPanelOffsets).toStrictEqual({ a: { x: 1e9 } });
    });

    it('a state from v21 gets no pluginPanelOffsets', () => {
        const out = migrateKobarStorage({ notes: [] }, 21) as State;
        expect('pluginPanelOffsets' in out).toBe(false);
    });

    it('a backup restore keeps valid offsets and drops an invalid map', () => {
        const restore = (pluginPanelOffsets: unknown) => {
            const res = validateCoreValue('app-store', JSON.stringify({ state: { ...v21(), pluginPanelOffsets }, version: 32 }));
            if (!res.ok) throw new Error('restore rejected');
            return JSON.parse(res.value).state as State;
        };
        expect(restore({ a: { x: 12 } }).pluginPanelOffsets).toStrictEqual({ a: { x: 12 } });
        expect('pluginPanelOffsets' in restore({ a: { x: 'wide' } })).toBe(false);
    });
});
