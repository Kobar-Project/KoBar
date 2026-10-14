import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import { migrateToV24 } from '../src/store/migrations/v24';
import {
    BACKUP_KEY_V25,
    DEFAULT_EXTENSIONS_KEY_V25,
    MAX_BACKUP_CHARS_V25,
    isValidDefaultExtensionsConfigV25,
    migrateToV25,
} from '../src/store/migrations/v25';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-409: the kobar-storage v24 -> v25 block (persisted Default workspace plugin list). Synthetic fixtures only.

type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

/** A realistic stored v24 state: the v23 fixture after the v24 block, with the given active workspace. */
function v24With(activeWorkspaceId: string | null): State {
    const { state } = loadFixture('v23-workspaces.json');
    state.activeWorkspaceId = activeWorkspaceId;
    migrateToV24(state);
    return state;
}

// T-601/T-602/T-603: the v26, v27 and v28 changes are undone (covered in tests/migrate.v26/v27/v28.test.ts), so the expectations stay v25's own.
const migrate = (state: State, version = 24): State =>
    undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), version)))));

describe('v25: what a stored v24 state looks like afterwards', () => {
    it.each([null, 'ws-shared', 'ws-iso', 'ws-legacy', 'dangling-id'])(
        'active %s: the state is unchanged (no key invented, plugin sets and the file shape untouched)',
        (active) => {
            const state = v24With(active);
            const output = migrate(state);
            expect(output).toStrictEqual(state);
            expect(Object.prototype.hasOwnProperty.call(output, DEFAULT_EXTENSIONS_KEY_V25)).toBe(false);
            expect(output.currentExtensionsConfig).toStrictEqual({ 'fixture.plugin': true, 'other.plugin': false });
        }
    );

    it('keeps a valid saved list and null', () => {
        for (const value of [null, {}, { 'fixture.plugin': false, 'other.plugin': true }]) {
            const state = { ...v24With('ws-shared'), [DEFAULT_EXTENSIONS_KEY_V25]: value };
            expect(migrate(state)).toStrictEqual(state);
        }
    });
});

describe('v25: foreign values of the new key', () => {
    it('a plain object keeps its boolean entries; the raw value is backed up first', () => {
        const raw = { 'fixture.plugin': false, bad: 'yes', nested: { enabled: true } };
        const state = { ...v24With('ws-shared'), [DEFAULT_EXTENSIONS_KEY_V25]: raw };
        const output = migrate(state);
        expect(output[DEFAULT_EXTENSIONS_KEY_V25]).toStrictEqual({ 'fixture.plugin': false });
        expect(output.legacyBackup[BACKUP_KEY_V25]).toStrictEqual(raw);
        // The older backup content stays.
        expect(output.legacyBackup.todos).toStrictEqual(state.legacyBackup.todos);
    });

    it.each([['a string'], [42], [true], [[{ x: true }]]])('%j becomes null after a raw backup', (raw) => {
        const state = { ...v24With(null), [DEFAULT_EXTENSIONS_KEY_V25]: raw };
        const output = migrate(state);
        expect(output[DEFAULT_EXTENSIONS_KEY_V25]).toBeNull();
        expect(output.legacyBackup[BACKUP_KEY_V25]).toStrictEqual(raw);
    });

    it('uses the next free backup slot', () => {
        const state = {
            ...v24With(null),
            legacyBackup: { [BACKUP_KEY_V25]: 'older', [`${BACKUP_KEY_V25}#2`]: 'older-2' },
            [DEFAULT_EXTENSIONS_KEY_V25]: 'garbage',
        };
        const output = migrate(state);
        expect(output.legacyBackup[`${BACKUP_KEY_V25}#3`]).toBe('garbage');
        expect(output.legacyBackup[BACKUP_KEY_V25]).toBe('older');
    });

    it('changes nothing when the raw value cannot be backed up', () => {
        const notAnObject = { ...v24With(null), legacyBackup: 'kept', [DEFAULT_EXTENSIONS_KEY_V25]: 'garbage' };
        expect(migrate(notAnObject)).toStrictEqual(notAnObject);

        const slots: Record<string, string> = {};
        for (let n = 1; n <= 10; n++) slots[n === 1 ? BACKUP_KEY_V25 : `${BACKUP_KEY_V25}#${n}`] = 'taken';
        const full = { ...v24With(null), legacyBackup: slots, [DEFAULT_EXTENSIONS_KEY_V25]: 'garbage' };
        expect(migrate(full)).toStrictEqual(full);

        const huge = { ...v24With(null), [DEFAULT_EXTENSIONS_KEY_V25]: 'x'.repeat(MAX_BACKUP_CHARS_V25 + 1) };
        expect(migrate(huge)).toStrictEqual(huge);
    });

    it('prototype names are never copied into the saved list', () => {
        const raw = JSON.parse('{"__proto__": true, "constructor": false, "ok": true}');
        const state = { ...v24With(null), [DEFAULT_EXTENSIONS_KEY_V25]: raw };
        const output = migrate(state);
        expect(Object.keys(output[DEFAULT_EXTENSIONS_KEY_V25])).toStrictEqual(['ok']);
        expect(Object.getPrototypeOf(output[DEFAULT_EXTENSIONS_KEY_V25])).toBe(Object.prototype);
        expect(isValidDefaultExtensionsConfigV25(raw)).toBe(false);
    });
});

describe('v25: garbage, idempotency and version gating', () => {
    it('never throws on garbage states', () => {
        for (const garbage of [null, undefined, 1, 'x', [], {}, { defaultExtensionsConfig: undefined }]) {
            expect(() => migrateToV25(structuredClone(garbage))).not.toThrow();
        }
    });

    it('is idempotent: a second run changes nothing and writes no second backup', () => {
        const state = { ...v24With('ws-iso'), [DEFAULT_EXTENSIONS_KEY_V25]: { a: true, b: 'no' } };
        const once = migrate(state);
        const twice = structuredClone(once);
        migrateToV25(twice);
        expect(twice).toStrictEqual(once);
        expect(Object.keys(twice.legacyBackup).filter((k) => k.startsWith(BACKUP_KEY_V25))).toHaveLength(1);
    });

    it('a stored v25 or newer state is not touched', () => {
        const state = { ...v24With(null), [DEFAULT_EXTENSIONS_KEY_V25]: 'garbage' };
        expect(undoV26(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 25)))))).toStrictEqual(state);
        expect(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 26))))).toStrictEqual(state);
        expect(undoV29(migrateKobarStorage(structuredClone(state), 27))).toStrictEqual(state);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(25);
    });
});

describe('v25: chain from every older fixture', () => {
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

    it.each(names)('%s: no Default list is invented and the plugin sets stay as they were', (name) => {
        const fixture = loadFixture(name);
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        expect(Object.prototype.hasOwnProperty.call(output, DEFAULT_EXTENSIONS_KEY_V25)).toBe(false);
        expect(output.currentExtensionsConfig).toStrictEqual(fixture.state.currentExtensionsConfig);
        const sets = (s: State) => (Array.isArray(s.workspaces) ? s.workspaces.map((w: State) => w.enabledExtensions) : []);
        expect(sets(output)).toStrictEqual(sets(fixture.state));
        // Rerunning the whole chain from the current version is a no-op.
        expect(migrateKobarStorage(structuredClone(output), KOBAR_STORAGE_VERSION)).toStrictEqual(output);
    });
});
