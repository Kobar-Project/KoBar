import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { migrateToV31 } from '../src/store/migrations/v31';
import { validateCoreValue } from '../src/backup/coreValues';
import { loadProfileFixture, migrateProfileToLatest } from './chain/runChain';

// R-11: the kobar-storage v30 -> v31 block (optional `noteListWidth`). Synthetic fixtures only.

type State = Record<string, unknown>;

const v21 = (): State =>
    (JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/kobar-storage/v21.json', import.meta.url)), 'utf8')) as { state: State })
        .state;

describe('v31: noteListWidth', () => {
    it('is the current version', () => {
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(31);
    });

    it('leaves a missing key missing (the store default applies) and touches nothing else', () => {
        const state = { notes: [{ id: 1 }], notePanelWidth: 400 };
        const before = structuredClone(state);
        migrateToV31(state);
        expect(state).toStrictEqual(before);
    });

    it('keeps a valid width, rounds a fractional one and clamps out-of-range numbers', () => {
        const cases: [unknown, number][] = [
            [200, 200],
            [200.4, 200],
            [10, 160],
            [9999, 420],
            [-5, 160],
        ];
        for (const [input, expected] of cases) {
            const state: State = { noteListWidth: input };
            migrateToV31(state);
            expect(state.noteListWidth).toBe(expected);
        }
    });

    it('deletes a key that is not a finite number', () => {
        for (const input of ['wide', null, NaN, Infinity, {}, [], true]) {
            const state: State = { noteListWidth: input, keep: 1 };
            migrateToV31(state);
            expect(state).toStrictEqual({ keep: 1 });
        }
    });

    it('never throws on garbage and is idempotent', () => {
        for (const garbage of [null, undefined, 5, 'x', []]) expect(() => migrateToV31(garbage)).not.toThrow();
        const state: State = { noteListWidth: 9999 };
        migrateToV31(state);
        const once = structuredClone(state);
        migrateToV31(state);
        expect(state).toStrictEqual(once);
    });

    it('runs through migrateKobarStorage for a stored v30 and not for a stored v31', () => {
        const migrated = migrateKobarStorage({ noteListWidth: 9999 }, 30) as State;
        expect(migrated.noteListWidth).toBe(420);
        const untouched = migrateKobarStorage({ noteListWidth: 9999 }, 31) as State;
        expect(untouched.noteListWidth).toBe(9999);
    });

    it('a v21 state (chain) gets no noteListWidth and ends at the latest version', () => {
        const input = v21();
        expect('noteListWidth' in input).toBe(false);
        const out = migrateKobarStorage(structuredClone(input), 21) as State;
        expect('noteListWidth' in out).toBe(false);
        const profile = migrateProfileToLatest(loadProfileFixture(21));
        const raw = JSON.parse(profile.localStorage['kobar-storage']) as { version: number; state: State };
        expect(raw.version).toBe(KOBAR_STORAGE_VERSION);
        expect('noteListWidth' in raw.state).toBe(false);
    });

    it('a backup restore keeps a width in range and drops one out of range', () => {
        const restore = (noteListWidth: unknown) => {
            const res = validateCoreValue('app-store', JSON.stringify({ state: { ...v21(), noteListWidth }, version: 31 }));
            if (!res.ok) throw new Error('restore rejected');
            return JSON.parse(res.value).state as State;
        };
        expect(restore(250).noteListWidth).toBe(250);
        expect('noteListWidth' in restore(5000)).toBe(false);
    });
});
