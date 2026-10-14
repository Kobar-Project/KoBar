import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import {
    BACKUP_KEY_V24,
    MAX_BACKUP_CHARS_V24,
    WORKSPACE_PROFILE_KEYS_V24,
    isDefaultWorkspaceActiveV24,
    migrateToV24,
} from '../src/store/migrations/v24';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-408: the kobar-storage v23 -> v24 block (workspace model on the v1 fields). Synthetic fixtures only.

// Persisted state is untyped legacy data; keep it loose like the migration itself.
type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

/** The v23 fixture with the given active workspace (null = Default). */
function v23With(activeWorkspaceId: string | null): State {
    const { state } = loadFixture('v23-workspaces.json');
    state.activeWorkspaceId = activeWorkspaceId;
    return state;
}

// T-601/T-602/T-603: the v26, v27 and v28 changes are undone (covered in tests/migrate.v26/v27/v28.test.ts), so the expectations stay v24's own.
const migrate = (state: State, version = 23): State =>
    undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), version)))));

/**
 * What a 1.2.x build (and today's store) reads from the v1 fields: the active record, its data context, the live
 * profile and notes, and every workspace's identity, isolation and isolated data.
 */
function v1View(state: State) {
    const workspaces: State[] = Array.isArray(state.workspaces) ? state.workspaces : [];
    const active = workspaces.find((w) => w.id === state.activeWorkspaceId);
    return {
        activeWorkspaceId: state.activeWorkspaceId ?? null,
        context: active && active.isIsolated ? `ws:${active.id}` : 'global',
        liveProfile: Object.fromEntries(WORKSPACE_PROFILE_KEYS_V24.map((key) => [key, state[key]])),
        currentExtensionsConfig: state.currentExtensionsConfig,
        notes: state.notes,
        activeNoteId: state.activeNoteId,
        nextNoteId: state.nextNoteId,
        globalNotes: state.globalNotes,
        globalPluginData: state.globalPluginData,
        workspaces: workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            isolated: !!w.isIsolated,
            isolatedData: w.isolatedData,
            enabledExtensions: w.enabledExtensions,
        })),
    };
}

/** Profile a 1.2.x `loadWorkspace(id)` applies: for the active record it first snapshots the live (top-level) values. */
function profileApplied(state: State, id: string) {
    const record = (state.workspaces as State[]).find((w) => w.id === id);
    const source = id === state.activeWorkspaceId ? state : record;
    return Object.fromEntries(WORKSPACE_PROFILE_KEYS_V24.map((key) => [key, source[key]]));
}

/** Rebuilds the pre-v24 workspace records from `legacyBackup.workspaceModelV24` (the documented undo path). */
function undoFromBackup(state: State, slot: string = BACKUP_KEY_V24): State {
    const out = structuredClone(state);
    const entry = out.legacyBackup[slot];
    if ('activeWorkspaceId' in entry) out.activeWorkspaceId = entry.activeWorkspaceId;
    for (const item of entry.workspaces ?? []) {
        const ws = out.workspaces[item.index];
        expect(ws.id).toStrictEqual(item.id);
        Object.assign(ws, item.values);
        for (const key of item.added) delete ws[key];
    }
    delete out.legacyBackup[slot];
    return out;
}

describe('v24: isolated workspace active', () => {
    const input = v23With('ws-iso');
    const output = migrate(input);

    it('syncs the active record from the top-level profile (one copy) and records every replaced value', () => {
        const ws = output.workspaces[0];
        for (const key of WORKSPACE_PROFILE_KEYS_V24) expect(ws[key]).toStrictEqual(input[key]);
        expect(output.legacyBackup).toStrictEqual({
            todos: input.legacyBackup.todos,
            [BACKUP_KEY_V24]: {
                workspaces: [
                    {
                        index: 0,
                        id: 'ws-iso',
                        values: {
                            koBoxCleanupMode: '24h',
                            sidebarWidth: 50,
                            theme: 'midnight',
                            featureOrder: ['com.kobar.aihub.btn', 'copypaste'],
                        },
                        added: ['enableEyeAnimation'],
                    },
                ],
            },
        });
    });

    it('never touches the top level, notes, isolated data, plugin data or enabledExtensions', () => {
        expect(v1View(output)).toStrictEqual(v1View(input));
        expect(output.workspaces[0].isolatedData).toStrictEqual(input.workspaces[0].isolatedData);
        expect(output.workspaces[0].enabledExtensions).toStrictEqual({ 'fixture.plugin': false });
        const topLevel = (s: State) => {
            const copy = structuredClone(s);
            delete copy.workspaces;
            delete copy.legacyBackup;
            return copy;
        };
        expect(topLevel(output)).toStrictEqual(topLevel(input));
    });

    it('leaves inactive records alone except an explicit isIsolated: false where it was missing', () => {
        expect(output.workspaces[1]).toStrictEqual(input.workspaces[1]);
        expect(output.workspaces[2]).toStrictEqual({ ...input.workspaces[2], isIsolated: false });
    });

    it('the backup restores the exact pre-v24 records', () => {
        const undone = undoFromBackup(output);
        delete undone.workspaces[2].isIsolated; // the lossless fill is not recorded
        expect(undone).toStrictEqual(input);
    });

    it('every workspace load still applies the same profile (1.2.x and today)', () => {
        for (const id of ['ws-iso', 'ws-shared', 'ws-legacy']) expect(profileApplied(output, id)).toStrictEqual(profileApplied(input, id));
    });
});

describe('v24: shared workspace active', () => {
    it('syncs the shared record, keeps its leftover isolatedData and the global context', () => {
        const input = v23With('ws-shared');
        const output = migrate(input);
        const ws = output.workspaces[1];
        for (const key of WORKSPACE_PROFILE_KEYS_V24) expect(ws[key]).toStrictEqual(input[key]);
        expect(ws.isolatedData).toStrictEqual(input.workspaces[1].isolatedData);
        expect(ws.isIsolated).toBe(false);
        expect(output.workspaces[0]).toStrictEqual(input.workspaces[0]);
        expect(v1View(output)).toStrictEqual(v1View(input));
        expect(v1View(output).context).toBe('global');
        expect(undoFromBackup(output).workspaces.slice(0, 2)).toStrictEqual(input.workspaces.slice(0, 2));
    });
});

describe('v24: Default workspace (no workspace active)', () => {
    it('null active id: nothing but the isIsolated fill changes, no backup entry', () => {
        const input = v23With(null);
        const output = migrate(input);
        expect(isDefaultWorkspaceActiveV24(output)).toBe(true);
        expect(output.legacyBackup).toStrictEqual(input.legacyBackup);
        const expected = structuredClone(input);
        expected.workspaces[2].isIsolated = false;
        expect(output).toStrictEqual(expected);
    });

    it('a dangling string id is kept as is (readers already treat it as Default) and syncs nothing', () => {
        const input = v23With('ws-gone');
        const output = migrate(input);
        expect(output.activeWorkspaceId).toBe('ws-gone');
        expect(isDefaultWorkspaceActiveV24(output)).toBe(true);
        expect(output.workspaces.slice(0, 2)).toStrictEqual(input.workspaces.slice(0, 2));
        expect(output.legacyBackup).toStrictEqual(input.legacyBackup);
    });

    it('a non-string id matching no record becomes null, with the raw value backed up', () => {
        for (const raw of [42, { id: 'ws-iso' }, true, ['ws-iso']]) {
            const input = { ...v23With(null), activeWorkspaceId: raw };
            const output = migrate(input);
            expect(output.activeWorkspaceId).toBeNull();
            expect(output.legacyBackup[BACKUP_KEY_V24]).toStrictEqual({ activeWorkspaceId: raw });
            expect(v1View(output).context).toBe('global');
        }
    });

    it('a non-string id that matches a record is an active workspace and is kept', () => {
        const state = { activeWorkspaceId: 7, theme: 'ocean', workspaces: [{ id: 7, name: 'n', isIsolated: true, theme: 'x' }] };
        const output = migrate(state);
        expect(output.activeWorkspaceId).toBe(7);
        expect(isDefaultWorkspaceActiveV24(output)).toBe(false);
        // Not synced either: v24 only syncs non-empty string ids (the only kind the store creates); anything else stays as stored.
        expect(output.workspaces[0].theme).toBe('x');
    });

    it('an empty-string id syncs nothing (patchActiveWorkspace treats it as no workspace)', () => {
        const state = { activeWorkspaceId: '', theme: 'ocean', workspaces: [{ id: '', name: 'n', isIsolated: false, theme: 'x' }] };
        expect(migrate(state).workspaces[0].theme).toBe('x');
    });
});

describe('v24: isolation flags', () => {
    it('fills a missing isIsolated with false and leaves non-boolean values alone', () => {
        const state = {
            activeWorkspaceId: null,
            workspaces: [{ id: 'a' }, { id: 'b', isIsolated: 'yes' }, { id: 'c', isIsolated: null }, { id: 'd', isIsolated: true }],
        };
        const output = migrate(state);
        expect(output.workspaces.map((w: State) => w.isIsolated)).toStrictEqual([false, 'yes', null, true]);
        expect(output).not.toHaveProperty('legacyBackup');
    });
});

describe('v24: duplicates, caps and backup slots', () => {
    it('syncs every record carrying the active id (same rule as patchActiveWorkspace)', () => {
        const state = {
            activeWorkspaceId: 'w',
            theme: 'ocean',
            workspaces: [
                { id: 'w', name: 'first', isIsolated: true, theme: 'a' },
                { id: 'w', name: 'second', isIsolated: true, theme: 'b' },
            ],
        };
        const output = migrate(state);
        expect(output.workspaces.map((w: State) => w.theme)).toStrictEqual(['ocean', 'ocean']);
        expect(output.legacyBackup[BACKUP_KEY_V24].workspaces.map((w: State) => [w.index, w.values.theme])).toStrictEqual([
            [0, 'a'],
            [1, 'b'],
        ]);
    });

    it('an existing entry is never overwritten: the next free slot is used', () => {
        const state = { ...v23With('ws-iso'), legacyBackup: { [BACKUP_KEY_V24]: { earlier: true } } };
        const output = migrate(state);
        expect(output.legacyBackup[BACKUP_KEY_V24]).toStrictEqual({ earlier: true });
        expect(output.legacyBackup[`${BACKUP_KEY_V24}#2`].workspaces[0].values.theme).toBe('midnight');
        expect(undoFromBackup(output, `${BACKUP_KEY_V24}#2`).workspaces[0]).toStrictEqual(state.workspaces[0]);
    });

    it('no free slot or a non-object legacyBackup: values that would need a backup are not changed', () => {
        const full: Record<string, unknown> = {};
        for (let n = 1; n <= 10; n++) full[n === 1 ? BACKUP_KEY_V24 : `${BACKUP_KEY_V24}#${n}`] = n;
        for (const legacyBackup of [full, 'garbage', 5, ['x']]) {
            const input = { ...v23With('ws-iso'), legacyBackup };
            const output = migrate(input);
            expect(output.legacyBackup).toStrictEqual(legacyBackup);
            expect(output.workspaces[0]).toStrictEqual(input.workspaces[0]);
            expect(output.workspaces[2].isIsolated).toBe(false); // lossless, still applied
        }
    });

    it('a value too large to back up stays where it is; the other keys are still synced', () => {
        const huge = Array.from({ length: 20000 }, (_, i) => `stale-plugin-${i}`);
        expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_BACKUP_CHARS_V24);
        const input = v23With('ws-iso');
        input.workspaces[0].featureOrder = huge;
        const output = migrate(input);
        expect(output.workspaces[0].featureOrder).toStrictEqual(huge);
        expect(output.workspaces[0].theme).toBe('ocean');
        expect(JSON.stringify(output.legacyBackup).length).toBeLessThan(MAX_BACKUP_CHARS_V24);
    });
});

describe('v24: garbage, idempotency and version gating', () => {
    it('tolerates garbage without throwing', () => {
        for (const state of [null, undefined, 5, 'x', [], [1, 2]]) {
            expect(() => migrateToV24(state)).not.toThrow();
            expect(() => migrateKobarStorage(state, 23)).not.toThrow();
        }
        const shapes = [
            { workspaces: 'x', activeWorkspaceId: 'a' },
            { workspaces: [null, 1, 'a', [], { id: 'a' }], activeWorkspaceId: 'a', theme: 'ocean' },
            { workspaces: [{ id: 'a', isIsolated: true }], activeWorkspaceId: 'a', featureOrder: null, theme: undefined },
            { workspaces: {}, activeWorkspaceId: {}, legacyBackup: null },
        ];
        for (const shape of shapes) expect(() => migrate(shape)).not.toThrow();
        const mixed = migrate(shapes[1]);
        expect(mixed.workspaces.slice(0, 4)).toStrictEqual([null, 1, 'a', []]);
        expect(mixed.workspaces[4]).toStrictEqual({ id: 'a', theme: 'ocean', isIsolated: false });
        expect(migrate(shapes[2]).workspaces[0]).toStrictEqual({ id: 'a', isIsolated: true, featureOrder: null });
        // legacyBackup: null is not an object: nothing that needs a backup changes.
        expect(migrate(shapes[3])).toStrictEqual(shapes[3]);
    });

    it.each([null, 'ws-iso', 'ws-shared', 'ws-gone'])('is idempotent (active %s): a second run changes nothing', (id) => {
        const once = migrate(v23With(id));
        expect(migrate(once)).toStrictEqual(once);
        expect(migrate(once, 21)).toStrictEqual(once);
        const direct = structuredClone(once);
        migrateToV24(direct);
        expect(direct).toStrictEqual(once);
    });

    it('a stored v24 or newer state is not touched', () => {
        const state = v23With('ws-iso');
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 24)))))).toStrictEqual(state);
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 25)))))).toStrictEqual(state);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(24);
    });
});

describe('v24: chain from every older fixture', () => {
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
    ];

    // Every note content string stored anywhere (top-level, global, isolated workspaces), as in tests/migrate.test.ts.
    const noteContents = (state: State): string[] => {
        const out: string[] = [];
        for (const n of state.notes ?? []) out.push(`notes:${n.content}`);
        for (const n of state.globalNotes ?? []) out.push(`globalNotes:${n.content}`);
        for (const w of state.workspaces ?? []) for (const n of w.isolatedData?.notes ?? []) out.push(`ws:${w.id}:${n.content}`);
        return out.sort();
    };

    it.each(names)('%s: notes and data contexts survive, the active record mirrors the top level, a rerun is a no-op', (name) => {
        const fixture = loadFixture(name);
        const output = undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(fixture.state), fixture.version)))));
        // The legacy section (stored v<=20) copies notes into globalNotes, so the output may hold more, never less.
        const after = noteContents(output);
        for (const entry of noteContents(fixture.state)) expect(after).toContain(entry);
        expect(v1View(output).context).toBe(v1View(fixture.state).context);
        expect(v1View(output).workspaces.map((w) => [w.id, w.name, w.isolated])).toStrictEqual(
            v1View(fixture.state).workspaces.map((w) => [w.id, w.name, w.isolated])
        );
        expect(JSON.parse(JSON.stringify(output))).toEqual(output);
        if (!isDefaultWorkspaceActiveV24(output)) {
            const active = output.workspaces.find((w: State) => w.id === output.activeWorkspaceId);
            for (const key of WORKSPACE_PROFILE_KEYS_V24) if (output[key] !== undefined) expect(active[key]).toStrictEqual(output[key]);
        }
        for (const ws of output.workspaces ?? []) expect(typeof ws.isIsolated).toBe('boolean');
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(output), 23)))))).toStrictEqual(output);
    });
});

describe('v24: rollback shape (1.2.x reads the v24 output)', () => {
    it.each([null, 'ws-iso', 'ws-shared'])('active %s: every v1 field a 1.2.x build reads is present and unchanged', (id) => {
        const input = v23With(id);
        const output = migrate(input);
        // Simulated with the CURRENT migrateKobarStorage (not the real 1.2.x migrate): a stored version above every block
        // target runs no block, so the state is used as is. 1.2.x itself reads the v1 fields checked below.
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(output), 24)))))).toStrictEqual(output);
        expect(v1View(output)).toStrictEqual(v1View(input));
        for (const ws of input.workspaces) {
            expect(profileApplied(output, ws.id)).toStrictEqual(profileApplied(input, ws.id));
        }
        // 1.2.x (persist version 21) has no `legacyBackup` in partialize: its first write drops the whole backup (v23 fields
        // and workspaceModelV24). The replaced record values are what 1.2.x writes on the next switch anyway. Upgrading a
        // state that still carries the v24 output (with or without legacyBackup) is a no-op.
        expect(migrate(output, 23)).toStrictEqual(output);
    });
});

describe('v24: big state', () => {
    it('handles many workspaces with many notes; only the active record changes and the backup stays small', () => {
        const note = (id: number) => ({ id, title: `n${id}`, icon: 'FileText', emoji: null, content: `<p>${'x'.repeat(200)}</p>` });
        const notes = Array.from({ length: 300 }, (_, i) => note(i + 1));
        const workspaces = Array.from({ length: 150 }, (_, i) => ({
            id: `ws-${i}`,
            name: `W${i}`,
            isIsolated: i % 2 === 0,
            theme: 'midnight',
            featureOrder: ['a', 'b'],
            isolatedData:
                i % 2 === 0 ? { notes: structuredClone(notes), activeNoteId: 1, nextNoteId: 301, pluginData: { p: { i } } } : undefined,
        }));
        const input = {
            ...v23With(null),
            notes,
            globalNotes: structuredClone(notes),
            workspaces,
            activeWorkspaceId: 'ws-42',
            legacyBackup: undefined,
        };
        const output = migrate(input);
        expect(output.notes).toStrictEqual(input.notes);
        expect(output.globalNotes).toStrictEqual(input.globalNotes);
        output.workspaces.forEach((ws: State, i: number) => {
            expect(ws.isolatedData).toStrictEqual(input.workspaces[i].isolatedData);
            if (i !== 42) expect(ws).toStrictEqual(input.workspaces[i]);
        });
        expect(output.workspaces[42].theme).toBe('ocean');
        expect(JSON.stringify(output.legacyBackup).length).toBeLessThan(2000);
    });
});
