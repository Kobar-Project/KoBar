import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { V22_SETTING_DEFAULTS, migrateToV22, renumberDuplicateNoteIds } from '../src/store/migrations/v22';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-205: the kobar-storage v21 -> v22 block (WS-06 layout settings + WS-08 duplicate note id repair).
// Synthetic fixtures only.

// Persisted state is untyped legacy data; keep it loose like the migration itself.
type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

function migrateFixture(name: string) {
    const fixture = loadFixture(name);
    const input = structuredClone(fixture.state);
    // T-601/T-602/T-603: the v26 appearance keys, the v27 density changes and the v28 pseudo-note removal are undone
    // here (tests/migrate.v26/v27/v28.test.ts).
    const output = undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(fixture.state), fixture.version)))));
    return { input, output };
}

const ids = (notes: { id: unknown }[]) => notes.map((n) => n.id);
const withoutIds = (notes: Record<string, unknown>[]) =>
    notes.map((note) => {
        const rest = { ...note };
        delete rest.id;
        return rest;
    });

describe('v22 fixture: duplicate note ids in isolated workspaces', () => {
    const name = 'v21-ws-duplicate-ids.json';

    it('renumbers later duplicates in the top-level notes and keeps content and order', () => {
        const { input, output } = migrateFixture(name);
        expect(ids(output.notes)).toEqual([1, 2, 3, 4]);
        expect(withoutIds(output.notes)).toStrictEqual(withoutIds(input.notes));
        // activeNoteId keeps pointing at the first note with that id; the counter is raised to max(id)+1.
        expect(output.activeNoteId).toBe(2);
        expect(output.nextNoteId).toBe(5);
    });

    it('repairs globalNotes ids only (the shared context has no stored counters)', () => {
        const { input, output } = migrateFixture(name);
        expect(ids(output.globalNotes)).toEqual([1, 3, 4]);
        expect(withoutIds(output.globalNotes)).toStrictEqual(withoutIds(input.globalNotes));
    });

    it('repairs every isolated workspace the same way, consistent with the live top-level copy', () => {
        const { input, output } = migrateFixture(name);
        const [a, b, c] = output.workspaces;
        expect(a.isolatedData.notes).toStrictEqual(output.notes);
        expect(a.isolatedData.activeNoteId).toBe(2);
        expect(a.isolatedData.nextNoteId).toBe(5);

        expect(ids(b.isolatedData.notes)).toEqual([5, 7, 6, 8]);
        expect(withoutIds(b.isolatedData.notes)).toStrictEqual(withoutIds(input.workspaces[1].isolatedData.notes));
        // Dangling activeNoteId (9) -> first note id; stale counter (3) -> max(id)+1.
        expect(b.isolatedData.activeNoteId).toBe(5);
        expect(b.isolatedData.nextNoteId).toBe(9);
        expect(b.isolatedData.pluginData).toStrictEqual(input.workspaces[1].isolatedData.pluginData);

        expect(c).toStrictEqual(input.workspaces[2]);
    });

    it('takes the three layout settings from the active workspace', () => {
        const { output } = migrateFixture(name);
        expect(output.toggleWidth).toBe(40);
        expect(output.featureSpacing).toBe(20);
        expect(output.isPopupSmartPositioning).toBe(true);
    });

    it('changes nothing else and keeps workspace settings as stored', () => {
        // The v22 block alone: since T-408 the later v24 block syncs the active workspace's profile (tests/migrate.v24.test.ts).
        const { input } = migrateFixture(name);
        const output = structuredClone(input);
        migrateToV22(output);
        const strip = (s: State) => {
            const copy = structuredClone(s);
            for (const key of ['notes', 'globalNotes', 'nextNoteId', 'toggleWidth', 'featureSpacing', 'isPopupSmartPositioning']) {
                delete copy[key];
            }
            for (const w of copy.workspaces) delete w.isolatedData;
            return copy;
        };
        expect(strip(output)).toStrictEqual(strip(input));
    });
});

describe('v22 fixture: no active workspace', () => {
    const name = 'v21-no-active-workspace.json';

    it('uses the store defaults and ignores inactive workspace values', () => {
        const { output } = migrateFixture(name);
        expect(output.toggleWidth).toBe(V22_SETTING_DEFAULTS.toggleWidth);
        expect(output.featureSpacing).toBe(V22_SETTING_DEFAULTS.featureSpacing);
        expect(output.isPopupSmartPositioning).toBe(V22_SETTING_DEFAULTS.isPopupSmartPositioning);
    });

    it('keeps valid notes and a counter above max(id)+1 untouched (never lowered)', () => {
        const { input, output } = migrateFixture(name);
        expect(output.notes).toStrictEqual(input.notes);
        expect(output.globalNotes).toStrictEqual(input.globalNotes);
        expect(output.activeNoteId).toBe(7);
        expect(output.nextNoteId).toBe(10);
        expect(output.workspaces).toStrictEqual(input.workspaces);
    });

    it('equals the input plus exactly the three defaults', () => {
        const { input, output } = migrateFixture(name);
        expect(output).toStrictEqual({ ...input, ...V22_SETTING_DEFAULTS });
    });
});

describe('v22 block: idempotence and no-op guarantees', () => {
    const names = ['v21-ws-duplicate-ids.json', 'v21-no-active-workspace.json', 'v21.json'];

    it.each(names)('%s: migrating the result again is a no-op (as v21 and as v22)', (name) => {
        const { output } = migrateFixture(name);
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(output), 21)))))).toStrictEqual(output);
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(output), 22)))))).toStrictEqual(output);
    });

    it('already-valid v21 data with the three settings present stays byte-identical', () => {
        const state = { ...loadFixture('v21.json').state, toggleWidth: 33, featureSpacing: 4, isPopupSmartPositioning: true };
        const before = JSON.stringify(state);
        // The v22 block alone (the v24 block fills the active workspace's profile copy in this fixture).
        const output = structuredClone(state);
        migrateToV22(output);
        expect(JSON.stringify(output)).toBe(before);
    });

    it('never overwrites a valid value already in the persisted data', () => {
        const state = loadFixture('v21-ws-duplicate-ids.json').state;
        state.toggleWidth = 0;
        state.isPopupSmartPositioning = false;
        // T-602: v27 sets isPopupSmartPositioning to true after a raw backup; undoV27 shows the v22 result.
        const output = undoV27(undoV28(undoV29(migrateKobarStorage(state, 21))));
        expect(output.toggleWidth).toBe(0);
        expect(output.isPopupSmartPositioning).toBe(false);
        expect(output.featureSpacing).toBe(20);
    });

    it('replaces invalid types: top-level garbage -> active workspace value, workspace garbage -> default', () => {
        const output = undoV27(
            undoV28(
                undoV29(
                    migrateKobarStorage(
                        {
                            toggleWidth: '40',
                            featureSpacing: Number.NaN,
                            isPopupSmartPositioning: 'yes',
                            activeWorkspaceId: 'w',
                            workspaces: [{ id: 'w', toggleWidth: 31, featureSpacing: '9', isPopupSmartPositioning: null }],
                        },
                        21
                    )
                )
            )
        );
        expect(output.toggleWidth).toBe(31);
        expect(output.featureSpacing).toBe(8);
        expect(output.isPopupSmartPositioning).toBe(false);
    });

    it('an activeWorkspaceId that matches no workspace falls back to the defaults', () => {
        const output = migrateKobarStorage({ activeWorkspaceId: 'gone', workspaces: [{ id: 'other', toggleWidth: 50 }] }, 21);
        expect(output.toggleWidth).toBe(22);
    });

    it('does not run for a state that is already v22', () => {
        const output = migrateKobarStorage({ notes: [{ id: 1 }, { id: 1 }] }, 22);
        expect(undoV26(undoV27(undoV28(undoV29(output))))).toStrictEqual({ notes: [{ id: 1 }, { id: 1 }] });
    });
});

describe('v22 block: edge cases of the note repair', () => {
    it('leaves activeNoteId alone when there is no note to point at, and adds no counter for an empty list', () => {
        const output = migrateKobarStorage({ notes: [], activeNoteId: 4 }, 21);
        expect(output.activeNoteId).toBe(4);
        expect(output).not.toHaveProperty('nextNoteId');
    });

    it('adds a missing top-level counter when notes exist, but never adds one to isolatedData', () => {
        const output = migrateKobarStorage(
            { notes: [{ id: 3 }], workspaces: [{ id: 'w', isIsolated: true, isolatedData: { notes: [{ id: 2 }, { id: 2 }] } }] },
            21
        );
        expect(output.nextNoteId).toBe(4);
        expect(output.workspaces[0].isolatedData).toStrictEqual({ notes: [{ id: 2 }, { id: 3 }] });
    });

    it('repairs a non-numeric stored counter and a null activeNoteId', () => {
        const output = migrateKobarStorage({ notes: [{ id: 2 }, { id: 5 }], activeNoteId: null, nextNoteId: 'x' }, 21);
        expect(output.activeNoteId).toBe(2);
        expect(output.nextNoteId).toBe(6);
    });

    it('keeps entries without a numeric id exactly where and as they are', () => {
        const odd = [null, 7, 'text', { id: '1', content: 'string id' }, { content: 'no id' }];
        const output = migrateKobarStorage({ notes: [{ id: 1 }, ...odd, { id: 1, content: 'dup' }] }, 21);
        expect(output.notes).toStrictEqual([{ id: 1 }, ...odd, { id: 2, content: 'dup' }]);
    });

    it('leaves ids beyond the safe-integer range (>= 2^53) and their counters untouched', () => {
        const big = 2 ** 53;
        const unsafe = { notes: [{ id: big }, { id: big }], activeNoteId: big, nextNoteId: 3 };
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(unsafe), 21)))))).toStrictEqual({
            ...unsafe,
            ...V22_SETTING_DEFAULTS,
        });

        // A duplicate whose new id would be MAX_SAFE_INTEGER + 1 cannot be renumbered safely, so it stays.
        const max = Number.MAX_SAFE_INTEGER;
        const edge = { notes: [{ id: max }, { id: max }], activeNoteId: max, nextNoteId: 5 };
        const out = undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(edge), 21)))));
        expect(out).toStrictEqual({ ...edge, ...V22_SETTING_DEFAULTS });
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(out), 21)))))).toStrictEqual(out);

        // Safe duplicates next to an unsafe id are still repaired.
        const mixed = migrateKobarStorage({ notes: [{ id: big }, { id: 1 }, { id: 1 }], nextNoteId: 2 }, 21);
        expect(mixed.notes).toStrictEqual([{ id: big }, { id: 1 }, { id: 2 }]);
        expect(mixed.nextNoteId).toBe(3);
    });

    it('tolerates garbage and missing fields without throwing', () => {
        const garbage: unknown[] = [
            {},
            { notes: null, globalNotes: 'x', workspaces: null },
            { notes: 'x', activeNoteId: 'y', nextNoteId: {} },
            { notes: {}, globalNotes: {} },
            { workspaces: [null, 1, 'w', [], { isolatedData: null }, { isolatedData: [] }, { isolatedData: { notes: {} } }] },
            { workspaces: { broken: true }, activeWorkspaceId: 'broken' },
            { workspaces: [{ id: 'a', isolatedData: { notes: [{ id: 1 }, { id: 1 }], nextNoteId: 'x', activeNoteId: 'z' } }] },
            { notes: [{ id: Number.NaN }, { id: Infinity }, { id: -1 }, { id: -1 }] },
        ];
        for (const state of garbage) {
            expect(() => migrateKobarStorage(structuredClone(state), 21)).not.toThrow();
        }
        for (const state of [null, undefined, 5, 'text', [], true]) {
            expect(() => migrateToV22(state)).not.toThrow();
        }
    });
});

// Deterministic PRNG so the property-style test is reproducible.
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('v22 note repair: property-style check on random note lists', () => {
    it('keeps every note and its content, makes ids unique, keeps order and a valid activeNoteId', () => {
        const random = mulberry32(205);
        const int = (max: number) => Math.floor(random() * max);

        for (let run = 0; run < 500; run++) {
            const notes: Record<string, unknown>[] = [];
            const length = int(25);
            for (let i = 0; i < length; i++) {
                notes.push({ id: 1 + int(8), title: `t${run}-${i}`, content: `<p>${run}-${i}</p>`, emoji: i % 3 ? null : 'x' });
            }
            const hasActive = random() < 0.8;
            const activeNoteId = int(12);
            const nextNoteId = random() < 0.2 ? undefined : int(15);
            const state: Record<string, unknown> = { notes, nextNoteId };
            if (hasActive) state.activeNoteId = activeNoteId;
            const snapshot = structuredClone(state);

            const out = migrateKobarStorage(state, 21) as { notes: Record<string, unknown>[]; activeNoteId?: number; nextNoteId?: number };
            const original = snapshot.notes as Record<string, unknown>[];

            // Same notes, same order, same content; only ids of later duplicates may change.
            expect(out.notes).toHaveLength(original.length);
            expect(withoutIds(out.notes)).toStrictEqual(withoutIds(original));
            const outIds = out.notes.map((n) => n.id as number);
            expect(new Set(outIds).size).toBe(outIds.length);
            const seen = new Set<unknown>();
            original.forEach((n, i) => {
                if (!seen.has(n.id)) expect(outIds[i]).toBe(n.id);
                seen.add(n.id);
            });
            // The input note objects themselves are never mutated.
            expect(notes).toStrictEqual(original);

            const maxId = Math.max(0, ...outIds);
            if (outIds.length > 0) {
                expect(out.nextNoteId).toBeGreaterThan(maxId);
                if (typeof snapshot.nextNoteId === 'number') expect(out.nextNoteId).toBeGreaterThanOrEqual(snapshot.nextNoteId);
                if (hasActive) {
                    expect(outIds).toContain(out.activeNoteId);
                    if (original.some((n) => n.id === activeNoteId)) expect(out.activeNoteId).toBe(activeNoteId);
                }
            } else {
                expect(out.activeNoteId).toBe(snapshot.activeNoteId);
            }

            // Idempotent.
            expect(migrateKobarStorage(structuredClone(out), 21)).toStrictEqual(out);
        }
    });

    it('renumberDuplicateNoteIds returns the same array when there is nothing to repair', () => {
        const list = [{ id: 1 }, { id: 3 }];
        expect(renumberDuplicateNoteIds(list)).toBe(list);
        const dup = [{ id: 1 }, { id: 1 }];
        const fixed = renumberDuplicateNoteIds(dup);
        expect(fixed).not.toBe(dup);
        expect(dup).toStrictEqual([{ id: 1 }, { id: 1 }]);
        expect(fixed).toStrictEqual([{ id: 1 }, { id: 2 }]);
    });
});
