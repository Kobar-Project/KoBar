import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { BACKUP_KEY_V28, MAX_BACKUP_CHARS_V28, isFakeNoteV28, migrateToV28 } from '../src/store/migrations/v28';
import { validateCoreValue } from '../src/backup/coreValues';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-603: the kobar-storage v27 -> v28 block (Settings/Plugins pseudo-notes removed, PROD-18). Synthetic fixtures only.

type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const v27 = (): State => loadFixture('v27-fake-notes.json').state;
// T-604: the v29 onboarding change is undone (covered in tests/migrate.v29.test.ts), so the expectations stay v28's own.
const migrate = (state: State, version = 27): State => undoV29(migrateKobarStorage(structuredClone(state), version));
const byId = (state: State, id: string) => state.workspaces.find((w: State) => w.id === id);
const ids = (notes: unknown[]) => notes.map((n) => (n === null ? null : (n as { id: unknown }).id));

/** Every note list a v27 state can hold. */
function allNoteLists(state: State): unknown[][] {
    const lists: unknown[][] = [];
    if (Array.isArray(state?.notes)) lists.push(state.notes);
    if (Array.isArray(state?.globalNotes)) lists.push(state.globalNotes);
    for (const ws of Array.isArray(state?.workspaces) ? state.workspaces : []) {
        if (Array.isArray(ws?.isolatedData?.notes)) lists.push(ws.isolatedData.notes);
    }
    return lists;
}

describe('v28: an existing user (stored v27)', () => {
    it('removes the pseudo-notes from notes, globalNotes and every isolatedData; real notes stay in order', () => {
        const input = v27();
        const output = migrate(input);
        expect(output.notes).toStrictEqual([input.notes[0], input.notes[2], input.notes[4], null]);
        expect(output.globalNotes).toStrictEqual([input.globalNotes[0]]);
        expect(byId(output, 'ws-iso').isolatedData.notes).toStrictEqual([input.workspaces[0].isolatedData.notes[1]]);
        expect(byId(output, 'ws-only-fakes').isolatedData.notes).toStrictEqual([]);
        for (const list of allNoteLists(output)) for (const note of list) expect(isFakeNoteV28(note)).toBe(false);
    });

    it('keeps real notes that look like the panels (title, icon) and notes with a garbled flag', () => {
        const output = migrate(v27());
        expect(output.notes[1]).toMatchObject({ id: 3, title: 'Settings', icon: 'settings', isSettings: false });
        expect(output.notes[2]).toMatchObject({ id: 5, isSettings: 'yes' });
        expect(byId(output, 'ws-iso').isolatedData.notes[0]).toMatchObject({ id: 2, title: 'Plugins', icon: 'extension' });
    });

    it('moves an activeNoteId off a removed pseudo-note to the first remaining note; counters stay', () => {
        const input = v27();
        const output = migrate(input);
        expect(output.activeNoteId).toBe(1);
        expect(output.nextNoteId).toBe(input.nextNoteId);
        expect(byId(output, 'ws-iso').isolatedData).toMatchObject({ activeNoteId: 2, nextNoteId: 3 });
        // No note left to point at: left as stored (the store resolves it at runtime).
        expect(byId(output, 'ws-only-fakes').isolatedData).toMatchObject({ activeNoteId: 1, nextNoteId: 2 });
    });

    it('backs up every removed note with its original position before removing it', () => {
        const input = v27();
        const output = migrate(input);
        const [iso, , onlyFakes] = input.workspaces;
        expect(output.legacyBackup[BACKUP_KEY_V28]).toStrictEqual({
            top: {
                removed: [
                    { index: 1, note: input.notes[1] },
                    { index: 3, note: input.notes[3] },
                ],
                values: { activeNoteId: 2 },
            },
            globalNotes: { removed: [{ index: 1, note: input.globalNotes[1] }] },
            workspaces: [
                { index: 0, id: 'ws-iso', removed: [{ index: 0, note: iso.isolatedData.notes[0] }], values: { activeNoteId: 1 } },
                { index: 2, id: 'ws-only-fakes', removed: [{ index: 0, note: onlyFakes.isolatedData.notes[0] }] },
            ],
        });
        // Older backup slots stay as they are.
        expect(output.legacyBackup.workspaceModelV24).toStrictEqual(input.legacyBackup.workspaceModelV24);
        expect(output.legacyBackup.densityV27).toStrictEqual(input.legacyBackup.densityV27);
    });

    it('never touches anything but the note lists, their activeNoteId and the new backup slot', () => {
        const input = v27();
        const output = migrate(input);
        const strip = (s: State) => {
            const copy = structuredClone(s);
            delete copy.notes;
            delete copy.globalNotes;
            delete copy.activeNoteId;
            delete copy.legacyBackup[BACKUP_KEY_V28];
            for (const ws of copy.workspaces) {
                if (ws.isolatedData && Array.isArray(ws.isolatedData.notes)) {
                    delete ws.isolatedData.notes;
                    delete ws.isolatedData.activeNoteId;
                }
            }
            return copy;
        };
        expect(strip(output)).toStrictEqual(strip(input));
        // ws-garbage: a non-list `notes` is left exactly as stored.
        expect(byId(output, 'ws-garbage')).toStrictEqual(byId(input, 'ws-garbage'));
    });

    it('is reversible: the backup rebuilds the exact v27 state', () => {
        const input = v27();
        expect(undoV28(migrate(input))).toStrictEqual(input);
    });
});

describe('v28: what counts as a pseudo-note', () => {
    it('only a plain object whose isSettings or isPlugins is exactly true', () => {
        expect(isFakeNoteV28({ id: 1, isSettings: true })).toBe(true);
        expect(isFakeNoteV28({ id: 1, isPlugins: true })).toBe(true);
        expect(isFakeNoteV28({ id: 1, isSettings: false, isPlugins: true })).toBe(true);
        expect(isFakeNoteV28({ isSettings: true })).toBe(true);
        for (const flag of [false, 'true', 'yes', 'false', 1, 0, null, undefined, {}, []]) {
            expect(isFakeNoteV28({ id: 1, isSettings: flag, isPlugins: flag }), String(flag)).toBe(false);
        }
        for (const entry of [null, undefined, 1, 'isSettings', [], [{ isSettings: true }], { title: 'Settings', icon: 'settings' }]) {
            expect(isFakeNoteV28(entry), JSON.stringify(entry)).toBe(false);
        }
    });

    it('a state without pseudo-notes is not touched (no backup slot)', () => {
        const state = {
            notes: [
                { id: 1, title: 'Settings', icon: 'settings', content: '' },
                { id: 2, title: 'Plugins', isPlugins: 'true' },
            ],
            activeNoteId: 2,
            globalNotes: [{ id: 1, isSettings: false }],
            workspaces: [{ id: 'w', isolatedData: { notes: [{ id: 1, isPlugins: 1 }], activeNoteId: 1 } }],
        };
        expect(migrate(state)).toStrictEqual(state);
    });
});

describe('v28: activeNoteId, backups and failure modes', () => {
    it('an activeNoteId on a kept note, a missing one or one without a safe-integer target stays as stored', () => {
        const kept = migrate({ notes: [{ id: 1 }, { id: 2, isSettings: true }], activeNoteId: 1 });
        expect(kept.activeNoteId).toBe(1);
        expect(kept.legacyBackup[BACKUP_KEY_V28].top).toStrictEqual({ removed: [{ index: 1, note: { id: 2, isSettings: true } }] });
        expect(migrate({ notes: [{ id: 1 }, { id: 2, isSettings: true }] })).not.toHaveProperty('activeNoteId');
        const unsafe = migrate({ notes: [{ id: 'x' }, { id: 2.5 }, null, { id: 2, isPlugins: true }], activeNoteId: 2 });
        expect(unsafe.activeNoteId).toBe(2);
        expect(unsafe.notes).toStrictEqual([{ id: 'x' }, { id: 2.5 }, null]);
    });

    it('a duplicate id on a real note keeps activeNoteId (it still points at a note)', () => {
        const out = migrate({ notes: [{ id: 7, isSettings: true }, { id: 3 }, { id: 7, title: 'real' }], activeNoteId: 7 });
        expect(out.activeNoteId).toBe(7);
        expect(out.notes).toStrictEqual([{ id: 3 }, { id: 7, title: 'real' }]);
    });

    it('globalNotes has no activeNoteId of its own; the top-level one only follows the top-level list', () => {
        const out = migrate({ notes: [{ id: 1 }], activeNoteId: 4, globalNotes: [{ id: 4, isPlugins: true }, { id: 5 }] });
        expect(out.activeNoteId).toBe(4);
        expect(out.globalNotes).toStrictEqual([{ id: 5 }]);
    });

    it('uses the next free backup slot', () => {
        const state = v27();
        state.legacyBackup = { ...state.legacyBackup, [BACKUP_KEY_V28]: 'older', [`${BACKUP_KEY_V28}#2`]: 'older-2' };
        const output = migrate(state);
        expect(output.legacyBackup[`${BACKUP_KEY_V28}#3`].globalNotes.removed).toHaveLength(1);
        expect(output.legacyBackup[BACKUP_KEY_V28]).toBe('older');
        expect(output.legacyBackup[`${BACKUP_KEY_V28}#2`]).toBe('older-2');
        expect(undoV28(output)).toStrictEqual(state);
    });

    it('creates legacyBackup when the state has none', () => {
        const output = migrate({ notes: [{ id: 1 }, { id: 2, isSettings: true }], activeNoteId: 2 });
        expect(output).toStrictEqual({
            notes: [{ id: 1 }],
            activeNoteId: 1,
            legacyBackup: {
                [BACKUP_KEY_V28]: { top: { removed: [{ index: 1, note: { id: 2, isSettings: true } }], values: { activeNoteId: 2 } } },
            },
        });
        expect(undoV28(output)).toStrictEqual({ notes: [{ id: 1 }, { id: 2, isSettings: true }], activeNoteId: 2 });
    });

    it('without a safe backup nothing is removed', () => {
        const slots: Record<string, string> = {};
        for (let n = 1; n <= 10; n++) slots[n === 1 ? BACKUP_KEY_V28 : `${BACKUP_KEY_V28}#${n}`] = 'taken';
        const huge = v27();
        huge.notes[1].content = 'x'.repeat(MAX_BACKUP_CHARS_V28 + 1);
        const cases = [
            { ...v27(), legacyBackup: 'not-an-object' },
            { ...v27(), legacyBackup: null },
            { ...v27(), legacyBackup: [] },
            { ...v27(), legacyBackup: slots },
            huge,
        ];
        for (const state of cases) expect(migrate(state)).toStrictEqual(state);
    });
});

describe('v28: garbage, idempotency and version gating', () => {
    it('never throws on garbage states and leaves non-list note fields alone', () => {
        const garbage = [
            null,
            undefined,
            1,
            'x',
            [],
            {},
            { notes: 'x' },
            { notes: null, globalNotes: {} },
            { notes: [null, 1, 'a', [], [{ isSettings: true }]] },
            { workspaces: 'x' },
            { workspaces: [null, 1, [], 'a', { isolatedData: null }, { isolatedData: { notes: {} } }, { isolatedData: [] }] },
        ];
        for (const value of garbage) {
            const copy = structuredClone(value);
            expect(() => migrateToV28(copy)).not.toThrow();
            expect(copy).toStrictEqual(value);
        }
        const odd = { workspaces: [null, { id: 'x', isolatedData: { notes: [{ id: 1, isPlugins: true }, { id: 2 }] } }] };
        migrateToV28(odd);
        expect(odd.workspaces[1]).toStrictEqual({ id: 'x', isolatedData: { notes: [{ id: 2 }] } });
    });

    it('is idempotent: a second run changes nothing and writes no second backup', () => {
        const once = migrate(v27());
        const twice = structuredClone(once);
        migrateToV28(twice);
        expect(twice).toStrictEqual(once);
        expect(Object.keys(twice.legacyBackup).filter((k) => k.startsWith(BACKUP_KEY_V28))).toHaveLength(1);
    });

    it('a stored v28 state is not touched', () => {
        const state = v27();
        expect(undoV29(migrateKobarStorage(structuredClone(state), 28))).toStrictEqual(state);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(28);
    });

    it('older stored versions run v28 too (the legacy section copies notes into globalNotes first)', () => {
        const out = migrateKobarStorage({ notes: [{ id: 1 }, { id: 2, isSettings: true }], activeNoteId: 2 }, 20);
        expect(out.notes).toStrictEqual([{ id: 1 }]);
        expect(out.globalNotes).toStrictEqual([{ id: 1 }]);
        expect(out.activeNoteId).toBe(1);
        expect(out.legacyBackup[BACKUP_KEY_V28].globalNotes.removed).toStrictEqual([{ index: 1, note: { id: 2, isSettings: true } }]);
    });
});

describe('v28 on the backup restore path', () => {
    it('a v27 backup value is migrated to v28 like a stored state', () => {
        const res = validateCoreValue('app-store', JSON.stringify({ state: v27(), version: 27 }));
        if (!res.ok) throw new Error('restore rejected');
        const restored = JSON.parse(res.value);
        expect(restored.version).toBe(KOBAR_STORAGE_VERSION);
        expect(ids(restored.state.notes)).toStrictEqual([1, 3, 5]); // the null entry is dropped by the restore validation
        expect(ids(restored.state.globalNotes)).toStrictEqual([1]);
        expect(restored.state.activeNoteId).toBe(1);
        expect(restored.state.legacyBackup[BACKUP_KEY_V28].top.removed).toHaveLength(2);
        for (const list of allNoteLists(restored.state)) for (const note of list) expect(isFakeNoteV28(note)).toBe(false);
    });
});

describe('v28: chain from every older fixture', () => {
    const names = [
        'v0.json',
        'v5.json',
        'v12.json',
        'v18.json',
        'v20.json',
        'v21.json',
        'v22.json',
        'v21-ws-duplicate-ids.json',
        'v21-no-active-workspace.json',
        'v23-workspaces.json',
        'v25-appearance.json',
        'v26-density.json',
        'v27-fake-notes.json',
    ];

    it.each(names)('%s: no pseudo-note anywhere, every real note kept; a rerun is a no-op', (name) => {
        const fixture = loadFixture(name);
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        // Compared without the id: the v22 block renumbers duplicate ids.
        const withoutId = (note: unknown) => (note !== null && typeof note === 'object' ? { ...note, id: undefined } : note);
        const realBefore = allNoteLists(fixture.state)
            .flat()
            .filter((n) => !isFakeNoteV28(n));
        const after = allNoteLists(output).flat();
        for (const note of after) expect(isFakeNoteV28(note)).toBe(false);
        // The legacy section (stored v<=20) copies notes into globalNotes, so the output may hold more, never less.
        const afterWithoutId = after.map(withoutId);
        for (const note of realBefore) expect(afterWithoutId).toContainEqual(withoutId(note));
        expect(migrateKobarStorage(structuredClone(output), 27)).toStrictEqual(output);
    });
});
