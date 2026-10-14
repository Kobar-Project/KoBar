import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { WORKSPACE_PROFILE_KEYS_V24 } from '../src/store/migrations/v24';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-007: fixture + snapshot coverage for the `kobar-storage` persist migration.
// Fixtures in tests/fixtures/kobar-storage/ are SYNTHETIC (never real user data) and mirror
// the Zustand persist storage shape `{ version, state }`. Zustand calls
// `migrate(state, storedVersion)` only when the stored version differs from the current one (24 since T-408).
// The v22, v23 and v24 blocks themselves are covered in tests/migrate.v22.test.ts, migrate.v23.test.ts and migrate.v24.test.ts.
// T-601: exact expectations of the older blocks compare `undoV26(undoV27(output))` (the v26 appearance keys are covered in
// tests/migrate.v26.test.ts); T-602 adds `undoV27` in front (tests/migrate.v27.test.ts), T-603 `undoV28` (tests/migrate.v28.test.ts),
// T-604 `undoV29` (tests/migrate.v29.test.ts).
// The snapshots show the latest state.
//
// The "legacy section behaviour" block documents the v<=20 behaviour as-is. These tests are NOT a statement that the
// behaviour is desired; they exist so that any future change to migrate is a conscious one.

// migrateKobarStorage is untyped on purpose (it reads arbitrary legacy shapes); reuse its loose type.
type State = ReturnType<typeof migrateKobarStorage>;
// A single workspace entry; migrate returns `any`, so this is `any` too (kept as a named alias for readability).
type Workspace = State;
type Fixture = { version: number; state: State };

const FIXTURE_VERSIONS = [0, 5, 12, 18, 20, 21, 22] as const;

function loadFixture(version: number): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/v${version}.json`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

function migrateFixture(version: number) {
    const fixture = loadFixture(version);
    const input = structuredClone(fixture.state);
    const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
    return { fixture, input, output };
}

// Every note content string stored anywhere in the state (top-level, global, isolated workspaces).
function collectNoteContents(state: State): string[] {
    const contents: string[] = [];
    for (const n of state.notes ?? []) contents.push(`notes:${n.id}:${n.content}`);
    for (const n of state.globalNotes ?? []) contents.push(`globalNotes:${n.id}:${n.content}`);
    for (const w of state.workspaces ?? []) {
        for (const n of w.isolatedData?.notes ?? []) contents.push(`ws:${w.id}:${n.id}:${n.content}`);
    }
    return contents;
}

describe('migrateKobarStorage fixtures', () => {
    it.each(FIXTURE_VERSIONS)('fixture v%i declares its own version', (version) => {
        expect(loadFixture(version).version).toBe(version);
    });

    describe.each(FIXTURE_VERSIONS)('v%i -> latest invariants', (version) => {
        it('matches the stored snapshot', () => {
            const { output } = migrateFixture(version);
            expect(output).toMatchSnapshot();
        });

        it('keeps notes, activeNoteId and nextNoteId untouched', () => {
            const { input, output } = migrateFixture(version);
            expect(output.notes).toStrictEqual(input.notes);
            expect(output.activeNoteId).toBe(input.activeNoteId);
            expect(output.nextNoteId).toBe(input.nextNoteId);
        });

        it('keeps workspace ids, names and isolated data', () => {
            const { input, output } = migrateFixture(version);
            const pick = (ws: Workspace[] | undefined) =>
                (ws ?? []).map((w: Workspace) => ({ id: w.id, name: w.name, isolatedNotes: w.isolatedData?.notes }));
            expect(pick(output.workspaces)).toStrictEqual(pick(input.workspaces));
        });

        it('drops no user note content', () => {
            const { input, output } = migrateFixture(version);
            const after = collectNoteContents(output);
            for (const entry of collectNoteContents(input)) {
                expect(after).toContain(entry);
            }
        });

        it('produces a JSON-serializable state', () => {
            const { output } = migrateFixture(version);
            const json = JSON.stringify(output);
            // toEqual ignores keys whose value is undefined (they disappear in JSON).
            expect(JSON.parse(json)).toEqual(output);
        });

        // Since T-205, stored v21+ runs only the versioned blocks (v22+), so this checks idempotence of those blocks,
        // not of the legacy section (that only runs for stored versions <= 20).
        it('is stable when the output is fed again as v21 (chain idempotency)', () => {
            const { output } = migrateFixture(version);
            const again = migrateKobarStorage(structuredClone(output), 21);
            expect(again).toStrictEqual(output);
        });

        it('fills the v22 layout settings with defaults (no fixture has an active workspace value)', () => {
            const { output } = migrateFixture(version);
            expect(output.toggleWidth).toBe(22);
            expect(output.featureSpacing).toBe(8);
            // v27 (T-602) makes it readable as true; the v22 default (false) is the backed-up raw value.
            expect(output.isPopupSmartPositioning).toBe(true);
            expect(undoV27(undoV28(undoV29(output))).isPopupSmartPositioning).toBe(false);
        });
    });
});

describe('migrateKobarStorage per-fixture expectations', () => {
    it('v0: fills every block, drops legacy fields, puts AI hub first', () => {
        const { output } = migrateFixture(0);
        expect(output.featureOrder).toEqual([
            'com.kobar.aihub.btn',
            'copypaste',
            'todolist-plugin-btn',
            'calculator',
            'kobar-colorpicker-plugin-btn',
            'pininjector',
            'kobox',
            'snippetvault-plugin-btn',
        ]);
        expect(output).not.toHaveProperty('todos');
        expect(output).not.toHaveProperty('isTodoListEnabled');
        expect(output).not.toHaveProperty('isColorPickerEnabled');
        expect(output).not.toHaveProperty('colorPalettes');
        expect(output).not.toHaveProperty('currentColor');
        expect(output.snippets).toEqual([]);
        expect(output.workspaces).toEqual([]);
        expect(output.globalNotes).toEqual(output.notes);
        expect(output.globalPluginData).toEqual({});
        expect(output.activeWorkspaceId).toBeNull();
        expect(output.tutorialState).toEqual({ version: '1.0.0', status: 'pending' });
        expect(output.orientation).toBe('vertical');
        expect(output.edgePosition).toBe('right');
        expect(output.enableEyeAnimation).toBe(true);
        expect(output.customThemeColor).toBe('#f4a125');
        expect(output.isAiHubEnabled).toBe(true);
        expect(output.isPinInjectorEnabled).toBe(true);
        expect(output.isKoBoxEnabled).toBe(true);
        expect(output.koBoxCleanupMode).toBe('24h');
        expect(output.isSnippetVaultEnabled).toBe(true);
    });

    it('v5: removes "shortcuts", adds snippet vault, keeps user KoBox choices', () => {
        const { output } = migrateFixture(5);
        expect(output.featureOrder[0]).toBe('com.kobar.aihub.btn');
        expect(output.featureOrder).not.toContain('shortcuts');
        expect(output.featureOrder).toContain('snippetvault-plugin-btn');
        expect(output.isKoBoxEnabled).toBe(false);
        expect(output.koBoxCleanupMode).toBe('quit');
        expect(output.isSnippetVaultEnabled).toBe(true);
        // Snippets keep their content; password/color keys are added as undefined,
        // and an empty-string password becomes undefined.
        expect(output.snippets).toHaveLength(2);
        expect(output.snippets[0]).toStrictEqual({
            id: 's1', title: 'Synthetic snippet', content: 'echo fixture', password: undefined, color: undefined,
        });
        expect(output.snippets[1].password).toBeUndefined();
    });

    it('v12: creates empty workspaces, keeps snippet password/color, renames legacy colorpicker id', () => {
        const { output } = migrateFixture(12);
        expect(output.workspaces).toEqual([]);
        expect(output.snippets[0].password).toBe('fixture-hash');
        expect(output.snippets[1].color).toBe('#00ff00');
        expect(output.featureOrder).toContain('kobar-colorpicker-plugin-btn');
        expect(output.featureOrder).not.toContain('colorpicker');
        expect(output.featureOrder).not.toContain('ko-calender-plugin-btn');
        expect(output.theme).toBe('custom');
        expect(output.customThemeColor).toBe('#f4a125');
    });

    it('v18: adds tutorial and highlight flags, keeps orientation, normalises workspaces', () => {
        const { output } = migrateFixture(18);
        expect(output.tutorialState).toEqual({ version: '1.0.0', status: 'pending' });
        expect(output.isHighlightingToggleNotes).toBe(false);
        expect(output.isHighlightingSettingsBtn).toBe(false);
        expect(output.isHighlightingPluginsBtn).toBe(false);
        expect(output.orientation).toBe('horizontal');
        expect(output.edgePosition).toBe('top');
        expect(output.enableEyeAnimation).toBe(false);
        expect(output.customThemeColor).toBe('#336699');
        expect(output.workspaces[0].isIsolated).toBe(false);
        expect(output.workspaces[0]).toHaveProperty('isolatedData', undefined);
        expect(output.workspaces[0].enabledExtensions).toEqual({ 'fixture.plugin': true });
        expect(output.workspaces[1].isIsolated).toBe(true);
    });

    it('v20: copies notes into globalNotes, keeps tutorial state, null isolatedData becomes undefined', () => {
        const { output } = migrateFixture(20);
        expect(output.globalNotes).toStrictEqual(output.notes);
        expect(output.globalNotes).not.toBe(output.notes);
        expect(output.tutorialState).toEqual({ version: '1.0.0', status: 'completed' });
        expect(output.workspaces[0].isolatedData).toBeUndefined();
        expect(output.workspaces[1].isolatedData.pluginData).toEqual({ 'fixture.plugin': { counter: 3 } });
        expect(output.featureOrder).toEqual([
            'com.kobar.aihub.btn', 'copypaste', 'kobox', 'fixture.plugin-btn',
        ]);
    });

    it('v22: legacy fields move into legacyBackup, duplicate featureOrder ids (also in a workspace) keep the first', () => {
        const { input, output } = migrateFixture(22);
        // v24 (T-408) adds its own backup slot next to the v23 fields; checked in tests/migrate.v24.test.ts.
        const { workspaceModelV24, ...legacyBackup } = undoV26(undoV27(undoV28(undoV29(output)))).legacyBackup;
        expect(workspaceModelV24).toBeDefined();
        expect(legacyBackup).toStrictEqual({
            todos: input.todos, isTodoListEnabled: true, isColorPickerEnabled: false,
            colorPalettes: input.colorPalettes, currentColor: '#336699',
        });
        for (const key of ['todos', 'isTodoListEnabled', 'isColorPickerEnabled', 'colorPalettes', 'currentColor']) {
            expect(output).not.toHaveProperty(key);
        }
        expect(output.featureOrder).toEqual(['com.kobar.aihub.btn', 'copypaste', 'kobox', 'fixture.plugin-btn']);
        expect(output.workspaces[1].featureOrder).toEqual(['calculator', 'kobox']);
    });

    it('v21: current-shape state passes through unchanged except the v22 layout defaults and the v24 active profile copy', () => {
        const { input, output } = migrateFixture(21);
        const top = { ...input, toggleWidth: 22, featureSpacing: 8, isPopupSmartPositioning: false };
        // v24 (T-408): the active workspace record (ws-focus) mirrors the top-level profile; the keys it gained are recorded.
        const [focus, shared] = input.workspaces;
        const added = WORKSPACE_PROFILE_KEYS_V24.filter((key) => !(key in focus));
        const activeProfile = Object.fromEntries(WORKSPACE_PROFILE_KEYS_V24.map((key) => [key, top[key]]));
        expect(undoV26(undoV27(undoV28(undoV29(output))))).toStrictEqual({
            ...top,
            workspaces: [{ ...focus, ...activeProfile }, shared],
            legacyBackup: { workspaceModelV24: { workspaces: [{ index: 0, id: 'ws-focus', values: {}, added }] } },
        });
    });
});

describe('migrateKobarStorage legacy section behaviour (v<=20; v23 fixes marked T-027)', () => {
    it('mutates the input in place and returns the same object', () => {
        const input = loadFixture(20).state;
        const result = migrateKobarStorage(input, 20);
        expect(result).toBe(input);
        expect(input.globalNotes).toBeDefined();
    });

    // T-205: the unconditional legacy section runs for every stored version <= 20 only; a stored v21+ state
    // only gets the versioned blocks (see "v21+ skips the legacy section" below).
    // T-027 (owner decision a): the calendar button is only for fresh installs; no stored profile gets it appended.
    it('never appends "ko-calender-plugin-btn" to a stored profile (fresh installs get it from the store defaults)', () => {
        for (const version of [0, 3, 4, 7, 15, 20]) {
            const result = migrateKobarStorage({ featureOrder: ['com.kobar.aihub.btn', 'copypaste'] }, version);
            expect(result.featureOrder).not.toContain('ko-calender-plugin-btn');
        }
    });

    it('renames legacy "colorpicker"/"todolist" ids on every run, regardless of version (<= 20)', () => {
        for (const version of [7, 15, 20]) {
            const result = migrateKobarStorage({ featureOrder: ['colorpicker', 'todolist'] }, version);
            expect(result.featureOrder).toEqual([
                'kobar-colorpicker-plugin-btn', 'todolist-plugin-btn',
            ]);
        }
    });

    it('moves legacy color picker / todo fields into legacyBackup (T-027), regardless of version (<= 20)', () => {
        for (const version of [7, 15, 20]) {
            const result = migrateKobarStorage({
                todos: [{ id: 'x' }], isTodoListEnabled: true,
                isColorPickerEnabled: true, colorPalettes: [], currentColor: '#000000',
            }, version);
            for (const key of ['todos', 'isTodoListEnabled', 'isColorPickerEnabled', 'colorPalettes', 'currentColor']) {
                expect(result).not.toHaveProperty(key);
            }
            expect(undoV26(undoV27(undoV28(undoV29(result)))).legacyBackup).toEqual({
                todos: [{ id: 'x' }], isTodoListEnabled: true,
                isColorPickerEnabled: true, colorPalettes: [], currentColor: '#000000',
            });
        }
    });

    it('v21+ skips the legacy section: no calendar append, no renames; v22 defaults and the v23 backup move apply', () => {
        const result = migrateKobarStorage({ featureOrder: ['a', 'colorpicker'], todos: [1], isColorPickerEnabled: true }, 21);
        expect(undoV26(undoV27(undoV28(undoV29(result))))).toStrictEqual({
            featureOrder: ['a', 'colorpicker'],
            legacyBackup: { todos: [1], isColorPickerEnabled: true },
            toggleWidth: 22,
            featureSpacing: 8,
            isPopupSmartPositioning: false,
        });
        const later = { featureOrder: ['a'], todos: [1] };
        expect(migrateKobarStorage(structuredClone(later), 99)).toStrictEqual(later);
    });

    it('v21+: a corrupt blob does not reach the legacy code (the v22 block alone tolerates it)', () => {
        expect(migrateKobarStorage(null, 21)).toBeNull();
        expect(() => migrateKobarStorage({ featureOrder: 'not-an-array' }, 21)).not.toThrow();
        expect(() => migrateKobarStorage({ featureOrder: { broken: true } }, 21)).not.toThrow();
        expect(migrateKobarStorage({ featureOrder: 'not-an-array' }, 21).featureOrder).toBe('not-an-array');
        // Below 21 the legacy section still runs and still throws on a non-array featureOrder (unchanged).
        expect(() => migrateKobarStorage({ featureOrder: 'not-an-array' }, 20)).toThrow();
    });

    it('no longer leaves duplicate ids after the rename (v23 keeps the first occurrence)', () => {
        const result = migrateKobarStorage({ featureOrder: ['com.kobar.aihub.btn', 'colorpicker', 'todolist'] }, 1);
        const count = (id: string) => result.featureOrder.filter((f: string) => f === id).length;
        expect(count('kobar-colorpicker-plugin-btn')).toBe(1);
        expect(count('todolist-plugin-btn')).toBe(1);
    });

    it('the <=19 and <=18 blocks both set tutorialState (redundant); an existing value is kept', () => {
        expect(migrateKobarStorage({}, 19).tutorialState).toEqual({ version: '1.0.0', status: 'pending' });
        expect(migrateKobarStorage({}, 18).tutorialState).toEqual({ version: '1.0.0', status: 'pending' });
        expect(migrateKobarStorage({}, 20)).not.toHaveProperty('tutorialState');
        const kept = { version: '1.0.0', status: 'completed' };
        expect(migrateKobarStorage({ tutorialState: kept }, 0).tutorialState).toBe(kept);
    });

    it('fills a missing featureOrder only inside the <=6 block (v7+ stays without one)', () => {
        expect(migrateKobarStorage({}, 6).featureOrder).toEqual([
            'com.kobar.aihub.btn', 'copypaste', 'todolist-plugin-btn', 'snippetvault-plugin-btn',
            'pininjector', 'kobox', 'kobar-colorpicker-plugin-btn', 'calculator',
        ]);
        for (const version of [7, 12, 20, 21]) {
            expect(migrateKobarStorage({}, version)).not.toHaveProperty('featureOrder');
        }
    });

    it('the fallback featureOrder (<=6, missing) has no "ko-calender-plugin-btn"', () => {
        expect(migrateKobarStorage({}, 0).featureOrder).not.toContain('ko-calender-plugin-btn');
    });

    it('legacy "shortcuts"/"aihub" ids survive when the AI hub button is already present', () => {
        const result = migrateKobarStorage({ featureOrder: ['shortcuts', 'com.kobar.aihub.btn', 'aihub'] }, 6);
        expect(result.featureOrder).toContain('shortcuts');
        expect(result.featureOrder).toContain('aihub');
    });

    it('the version === 0 block only adds "calculator"; its "enabled by default" comment has no code', () => {
        const at0 = migrateKobarStorage({ featureOrder: ['com.kobar.aihub.btn'] }, 0);
        const at1 = migrateKobarStorage({ featureOrder: ['com.kobar.aihub.btn'] }, 1);
        expect(at0.featureOrder).toEqual([...at1.featureOrder.slice(0, 1), 'calculator', ...at1.featureOrder.slice(1)]);
        delete at0.featureOrder;
        delete at1.featureOrder;
        expect(at0).toStrictEqual(at1);
    });

    it('a v21 state migrated twice yields the same output (idempotent)', () => {
        const once = migrateKobarStorage(structuredClone(loadFixture(21).state), 21);
        const twice = migrateKobarStorage(structuredClone(once), 21);
        expect(twice).toStrictEqual(once);
    });

    it('without "notes": globalNotes becomes [] and notes stays absent', () => {
        const result = migrateKobarStorage({ featureOrder: ['ko-calender-plugin-btn'] }, 20);
        expect(result).not.toHaveProperty('notes');
        expect(result.globalNotes).toEqual([]);
    });

    it('without "workspaces": only versions <=12 create an empty list', () => {
        expect(migrateKobarStorage({}, 12).workspaces).toEqual([]);
        for (const version of [13, 18, 20, 21]) {
            expect(migrateKobarStorage({}, version)).not.toHaveProperty('workspaces');
        }
    });

    it('a non-array "workspaces" value is left as is', () => {
        const result = migrateKobarStorage({ workspaces: { broken: true } }, 20);
        expect(result.workspaces).toEqual({ broken: true });
    });
});
