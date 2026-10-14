import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { BACKUP_KEY_V30, MAX_BACKUP_CHARS_V30, migrateToV30 } from '../src/store/migrations/v30';
import { undoV30 } from './helpers/undoV30';

// T-615d: the kobar-storage v29 -> v30 block (fake notes created after v28, dead settingsWorkspaceViewMode). Synthetic data only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type S = Record<string, any>;
const real = (id: number) => ({ id, title: `Real ${id}`, icon: 'FileText', emoji: null, content: '<p>x</p>' });
const fakeSettings = (id: number) => ({ id, title: 'Settings', icon: 'settings', emoji: null, content: '', isSettings: true });
const fakePlugins = (id: number) => ({ id, title: 'Plugins', icon: 'extension', emoji: null, content: '', isPlugins: true });

function state(): S {
    return {
        notes: [real(1), fakeSettings(2), real(3), fakePlugins(4)],
        activeNoteId: 4,
        nextNoteId: 5,
        globalNotes: [fakePlugins(7), real(8)],
        workspaces: [
            { id: 'ws-a', isolatedData: { notes: [fakeSettings(1), real(2)], activeNoteId: 1, nextNoteId: 3 } },
            { id: 'ws-b', isolatedData: { notes: [real(1)] } },
            { id: 'ws-c' },
        ],
        settingsWorkspaceViewMode: 'cards',
        legacyBackup: { old: { keep: true } },
    };
}
const migrate = (s: S, version = 29): S => migrateKobarStorage(structuredClone(s), version);

describe('v30', () => {
    it('removes post-v28 fake notes from all three places, keeps real notes and leaves activeNoteId as stored', () => {
        const out = migrate(state());
        expect(out.notes.map((n: S) => n.id)).toEqual([1, 3]);
        expect(out.globalNotes.map((n: S) => n.id)).toEqual([8]);
        expect(out.workspaces[0].isolatedData.notes.map((n: S) => n.id)).toEqual([2]);
        expect(out.workspaces[1].isolatedData.notes.map((n: S) => n.id)).toEqual([1]);
        expect(out.activeNoteId).toBe(4);
        expect(out.nextNoteId).toBe(5);
        expect(out).not.toHaveProperty('settingsWorkspaceViewMode');
    });

    it('backs up what it removes first, keeps older slots, and is reversible', () => {
        const input = state();
        const out = migrate(input);
        const slot = out.legacyBackup[BACKUP_KEY_V30];
        expect(slot.top).toHaveLength(2);
        expect(slot.globalNotes).toHaveLength(1);
        expect(slot.workspaces).toHaveLength(1);
        expect(slot.settingsWorkspaceViewMode).toBe('cards');
        expect(out.legacyBackup.old).toStrictEqual({ keep: true });
        expect(undoV30(out)).toStrictEqual(input);
    });

    it('only the stale view mode: deleted with a backup, notes untouched', () => {
        const out = migrate({ notes: [real(1)], settingsWorkspaceViewMode: 'list' });
        expect(out.notes).toEqual([real(1)]);
        expect(out.legacyBackup[BACKUP_KEY_V30]).toStrictEqual({ settingsWorkspaceViewMode: 'list' });
    });

    it('is idempotent and writes no backup when there is nothing to clean', () => {
        const once = migrate(state());
        expect(migrate(once, 29)).toStrictEqual(once);
        const clean = { notes: [real(1)], legacyBackup: { a: 1 } };
        expect(migrate(clean)).toStrictEqual(clean);
        expect(migrate(state(), 30)).toStrictEqual(state());
    });

    it('uses the next free slot when the first is taken', () => {
        const input = { ...state(), legacyBackup: { [BACKUP_KEY_V30]: { n: 1 } } };
        const out = migrate(input);
        expect(out.legacyBackup[BACKUP_KEY_V30]).toStrictEqual({ n: 1 });
        expect(out.legacyBackup[`${BACKUP_KEY_V30}#2`]).toBeDefined();
    });

    it('removes nothing when the backup cannot be written', () => {
        for (const legacyBackup of ['text', 5, [1]]) {
            const input = { ...state(), legacyBackup };
            expect(migrate(input)).toStrictEqual(input);
        }
        const huge = { notes: [{ ...fakeSettings(1), content: 'x'.repeat(MAX_BACKUP_CHARS_V30 + 1) }], settingsWorkspaceViewMode: 'list' };
        expect(migrate(huge)).toStrictEqual(huge);
    });

    it('creates legacyBackup when it is missing and never throws on garbage', () => {
        const out = migrate({ notes: [fakePlugins(1)] });
        expect(out.notes).toEqual([]);
        expect(out.legacyBackup[BACKUP_KEY_V30].top).toHaveLength(1);
        for (const garbage of [
            null,
            undefined,
            5,
            'x',
            [],
            { notes: 'x', globalNotes: null, workspaces: [null, 1, { isolatedData: 5 }] },
        ]) {
            expect(() => migrateToV30(structuredClone(garbage))).not.toThrow();
        }
    });

    it('leaves entries with a non-true flag and non-object entries in place', () => {
        const notes = [{ id: 1, isSettings: 'yes' }, null, 5, real(2)];
        const out = migrate({ notes });
        expect(out.notes).toEqual(notes);
    });
});
