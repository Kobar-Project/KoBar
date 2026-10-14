import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { BACKUP_KEY_V29, MAX_BACKUP_CHARS_V29, isOnboardingV29, migrateToV29, migratedOnboardingV29 } from '../src/store/migrations/v29';
import { isOnboardingState } from '../src/store/onboarding';
import { validateCoreValue } from '../src/backup/coreValues';
import { loadProfileFixture, migrateProfileToLatest } from './chain/runChain';
import { undoV29 } from './helpers/undoV29';
import { undoV30 } from './helpers/undoV30';

// T-604: the kobar-storage v28 -> v29 block (first-run state `onboarding`). Synthetic fixtures only.

type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const v28 = (): State => loadFixture('v28-onboarding.json').state;
// v30 (T-615d) runs in the same chain; these tests pin the v29 block alone, so its backup slot and removal are undone.
const migrate = (state: State, version = 28): State => undoV30(migrateKobarStorage(structuredClone(state), version));
const MIGRATED = { status: 'completed', version: 1, migrated: true };

describe('v29: an existing user (stored v28)', () => {
    it('is onboarded (completed, migrated) and keeps tutorialState exactly as stored', () => {
        const input = v28();
        const output = migrate(input);
        expect(output.onboarding).toStrictEqual(MIGRATED);
        expect(isOnboardingState(output.onboarding)).toBe(true);
        expect(output.tutorialState).toStrictEqual(input.tutorialState);
    });

    it('copies the raw tutorialState into the backup slot first; older slots stay', () => {
        const input = v28();
        const output = migrate(input);
        expect(output.legacyBackup[BACKUP_KEY_V29]).toStrictEqual({ added: true, tutorialState: input.tutorialState });
        for (const key of Object.keys(input.legacyBackup)) expect(output.legacyBackup[key]).toStrictEqual(input.legacyBackup[key]);
    });

    it('never touches anything but onboarding and the new backup slot', () => {
        const input = v28();
        const output = migrate(input);
        const strip = (s: State) => {
            const copy = structuredClone(s);
            delete copy.onboarding;
            delete copy.legacyBackup[BACKUP_KEY_V29];
            return copy;
        };
        expect(strip(output)).toStrictEqual(strip(input));
    });

    it('is reversible: the backup rebuilds the exact v28 state', () => {
        const input = v28();
        expect(undoV29(migrate(input))).toStrictEqual(input);
    });

    it.each([
        ['pending', { version: '1.0.0', status: 'pending' }],
        ['snoozed', { version: '1.0.0', status: 'snoozed', snoozeUntil: 4102444800000 }],
        ['completed', { version: '1.0.0', status: 'completed' }],
        ['garbage string', 'x'],
        ['garbage object', { status: 'weird', version: 7 }],
        ['null', null],
    ])('is completed whatever the tutorial says (%s)', (_name, tutorialState) => {
        const input = { ...v28(), tutorialState };
        const output = migrate(input);
        expect(output.onboarding).toStrictEqual(MIGRATED);
        expect(output.tutorialState).toStrictEqual(tutorialState);
        expect(output.legacyBackup[BACKUP_KEY_V29]).toStrictEqual({ added: true, tutorialState });
        expect(undoV29(output)).toStrictEqual(input);
    });

    it('without a tutorialState only onboarding is added (nothing to back up)', () => {
        const input = v28();
        delete input.tutorialState;
        const output = migrate(input);
        expect(output.onboarding).toStrictEqual(MIGRATED);
        expect(output.legacyBackup).toStrictEqual(input.legacyBackup);
        expect(migrate({ notes: [] })).toStrictEqual({ notes: [], onboarding: MIGRATED });
        expect(undoV29(output)).toStrictEqual(input);
    });
});

describe('v29: a present onboarding value (no released version wrote it)', () => {
    it('a valid completed or skipped record is kept as it is (no backup slot)', () => {
        for (const onboarding of [
            { status: 'completed', version: 1 },
            { status: 'skipped', version: 3 },
            { status: 'completed', version: 1, migrated: true },
        ]) {
            const input = { ...v28(), onboarding };
            expect(migrate(input)).toStrictEqual(input);
        }
    });

    it('pending or any other value is replaced after a raw backup; reversible', () => {
        for (const onboarding of [
            { status: 'pending', version: 1 },
            { status: 'completed', version: 0 },
            { status: 'completed', version: 1.5 },
            { status: 'completed', version: 1, migrated: false },
            { status: 'completed', version: 1, extra: true },
            { status: 'done', version: 1 },
            'completed',
            null,
            [],
            42,
        ]) {
            const input = { ...v28(), onboarding };
            const output = migrate(input);
            expect(output.onboarding, JSON.stringify(onboarding)).toStrictEqual(MIGRATED);
            expect(output.legacyBackup[BACKUP_KEY_V29]).toStrictEqual({ values: { onboarding }, tutorialState: input.tutorialState });
            expect(undoV29(output)).toStrictEqual(input);
        }
    });

    it('a replaced value is backed up even without a tutorialState', () => {
        const output = migrate({ onboarding: { status: 'pending', version: 1 } });
        expect(output).toStrictEqual({
            onboarding: MIGRATED,
            legacyBackup: { [BACKUP_KEY_V29]: { values: { onboarding: { status: 'pending', version: 1 } } } },
        });
        expect(undoV29(output)).toStrictEqual({ onboarding: { status: 'pending', version: 1 } });
    });

    it('isOnboardingV29 matches the runtime guard of src/store/onboarding.ts', () => {
        const samples = [
            { status: 'pending', version: 1 },
            { status: 'skipped', version: 2, migrated: true },
            { status: 'completed', version: 1, migrated: false },
            { status: 'completed', version: -1 },
            { status: 'skipped', version: 1, note: 'x' },
            { status: 'completed' },
            { version: 1 },
            null,
            [],
            'completed',
        ];
        for (const value of samples) expect(isOnboardingV29(value), JSON.stringify(value)).toBe(isOnboardingState(value));
    });
});

describe('v29: backups and failure modes', () => {
    it('uses the next free backup slot', () => {
        const state = v28();
        state.legacyBackup = { ...state.legacyBackup, [BACKUP_KEY_V29]: 'older', [`${BACKUP_KEY_V29}#2`]: 'older-2' };
        const output = migrate(state);
        expect(output.legacyBackup[`${BACKUP_KEY_V29}#3`]).toStrictEqual({ added: true, tutorialState: state.tutorialState });
        expect(output.legacyBackup[BACKUP_KEY_V29]).toBe('older');
        expect(output.legacyBackup[`${BACKUP_KEY_V29}#2`]).toBe('older-2');
        expect(undoV29(output)).toStrictEqual(state);
    });

    it('creates legacyBackup when the state has none', () => {
        const tutorialState = { version: '1.0.0', status: 'pending' };
        const output = migrate({ tutorialState });
        expect(output).toStrictEqual({
            tutorialState,
            onboarding: MIGRATED,
            legacyBackup: { [BACKUP_KEY_V29]: { added: true, tutorialState } },
        });
        expect(undoV29(output)).toStrictEqual({ tutorialState });
    });

    it('without a safe backup nothing is replaced; a missing onboarding is still added', () => {
        const slots: Record<string, string> = {};
        for (let n = 1; n <= 10; n++) slots[n === 1 ? BACKUP_KEY_V29 : `${BACKUP_KEY_V29}#${n}`] = 'taken';
        const huge = { ...v28(), tutorialState: { version: 'x'.repeat(MAX_BACKUP_CHARS_V29 + 1), status: 'pending' } };
        const bad = [{ legacyBackup: 'not-an-object' }, { legacyBackup: null }, { legacyBackup: [] }, { legacyBackup: slots }];
        for (const state of [...bad.map((extra) => ({ ...v28(), ...extra })), huge]) {
            // Missing onboarding: added without a backup (an existing user must not see the first run).
            const added = migrate(state);
            expect(added).toStrictEqual({ ...state, onboarding: MIGRATED });
            // undoV29 reads the newest v29 slot, so it only applies when the state holds none of its own.
            if (state.legacyBackup !== slots) expect(undoV29(added)).toStrictEqual(state);
            // Present foreign value: left as stored.
            const foreign = { ...state, onboarding: { status: 'pending', version: 1 } };
            expect(migrate(foreign)).toStrictEqual(foreign);
        }
    });
});

describe('v29: garbage, idempotency and version gating', () => {
    it('never throws on garbage states; non-object states are left alone', () => {
        for (const value of [null, undefined, 1, 'x', [], [{ onboarding: 1 }], true]) {
            const copy = structuredClone(value);
            expect(() => migrateToV29(copy)).not.toThrow();
            expect(copy).toStrictEqual(value);
        }
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const state: Record<string, unknown> = { tutorialState: cyclic };
        expect(() => migrateToV29(state)).not.toThrow();
        expect(state.onboarding).toStrictEqual(MIGRATED);
        expect(state).not.toHaveProperty('legacyBackup');
    });

    it('is idempotent: a second run changes nothing and writes no second backup', () => {
        const once = migrate(v28());
        const twice = structuredClone(once);
        migrateToV29(twice);
        expect(twice).toStrictEqual(once);
        expect(Object.keys(twice.legacyBackup).filter((k) => k.startsWith(BACKUP_KEY_V29))).toHaveLength(1);
        expect(migrate(once, 28)).toStrictEqual(once);
    });

    it('writes a fresh record on every run (no shared object)', () => {
        expect(migratedOnboardingV29()).not.toBe(migratedOnboardingV29());
    });

    it('a stored v29 state is not touched (a fresh install keeps the store default)', () => {
        const state = v28();
        expect(undoV30(migrateKobarStorage(structuredClone(state), 29))).toStrictEqual(state);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(29);
    });

    it('older stored versions run v29 too', () => {
        const out = migrateKobarStorage({ notes: [{ id: 1 }] }, 20);
        expect(out.onboarding).toStrictEqual(MIGRATED);
        // The legacy section adds no tutorialState for v20 (only v<=19), so there is nothing to back up.
        expect(out.legacyBackup?.[BACKUP_KEY_V29]).toBeUndefined();
        const v18 = migrateKobarStorage({ notes: [] }, 18);
        expect(v18.tutorialState).toStrictEqual({ version: '1.0.0', status: 'pending' });
        expect(v18.onboarding).toStrictEqual(MIGRATED);
        expect(v18.legacyBackup[BACKUP_KEY_V29]).toStrictEqual({ added: true, tutorialState: { version: '1.0.0', status: 'pending' } });
    });
});

describe('v29 on the backup restore path', () => {
    const restore = (state: unknown, version: number) => validateCoreValue('app-store', JSON.stringify({ state, version }));

    it('a v28 backup value is migrated to v29 like a stored state', () => {
        const res = restore(v28(), 28);
        if (!res.ok) throw new Error('restore rejected');
        const restored = JSON.parse(res.value);
        expect(restored.version).toBe(KOBAR_STORAGE_VERSION);
        expect(restored.state.onboarding).toStrictEqual(MIGRATED);
        expect(restored.state.tutorialState).toStrictEqual(v28().tutorialState);
        expect(restored.state.legacyBackup[BACKUP_KEY_V29]).toStrictEqual({ added: true, tutorialState: v28().tutorialState });
    });

    it('a current backup keeps its own valid onboarding (a pending one too); a missing or invalid one becomes completed', () => {
        const pending = restore({ ...v28(), onboarding: { status: 'pending', version: 1 } }, 29);
        if (!pending.ok) throw new Error('restore rejected');
        expect(JSON.parse(pending.value).state.onboarding).toStrictEqual({ status: 'pending', version: 1 });
        for (const onboarding of [{ status: 'done', version: 1 }, { status: 'pending', version: 1, extra: 1 }, 'x']) {
            const invalid = restore({ ...v28(), onboarding }, 29);
            if (!invalid.ok) throw new Error('restore rejected');
            expect(JSON.parse(invalid.value).state.onboarding).toStrictEqual(MIGRATED);
            expect(invalid.appStore?.droppedFields).toContain('onboarding');
        }
        const missing = restore(v28(), 29);
        if (!missing.ok) throw new Error('restore rejected');
        expect(JSON.parse(missing.value).state.onboarding).toStrictEqual(MIGRATED);
    });

    it('what the migration adds alone (onboarding, the tutorialState copy) never makes an empty value valid', () => {
        expect(restore({}, 28)).toEqual({ ok: false, problem: 'invalid-shape' });
        expect(restore({ tutorialState: 'garbage' }, 28)).toEqual({ ok: false, problem: 'invalid-shape' });
        expect(restore({ onboarding: { status: 'pending', version: 1 } }, 29)).toEqual({ ok: false, problem: 'invalid-shape' });
        expect(restore({ tutorialState: { version: '1.0.0', status: 'pending' } }, 28)).toMatchObject({ ok: true });
    });
});

describe('v29: chain from every older fixture', () => {
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
        'v28-onboarding.json',
    ];

    it.each(names)('%s: every existing user ends up onboarded, tutorialState unchanged; a rerun is a no-op', (name) => {
        const fixture = loadFixture(name);
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        expect(output.onboarding).toStrictEqual(MIGRATED);
        if (fixture.state.tutorialState !== undefined) expect(output.tutorialState).toStrictEqual(fixture.state.tutorialState);
        expect(migrateKobarStorage(structuredClone(output), 28)).toStrictEqual(output);
    });

    it('profile chain (v21 profile): reaches v29 onboarded with the snoozed tutorial kept', () => {
        const out = JSON.parse(migrateProfileToLatest(loadProfileFixture(21)).localStorage['kobar-storage']);
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
        expect(out.state.onboarding).toStrictEqual(MIGRATED);
        expect(out.state.tutorialState).toMatchObject({ status: 'snoozed' });
    });
});
