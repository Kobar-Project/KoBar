import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';
import {
    BACKUP_KEY_V27,
    COMFORTABLE_ABOVE_V27,
    COMPACT_BELOW_V27,
    MAX_BACKUP_CHARS_V27,
    densityFromSidebarWidthV27,
    migrateToV27,
} from '../src/store/migrations/v27';
import { COMFORTABLE_ABOVE, COMPACT_BELOW, densityFromSidebarWidth } from '../src/store/density';
import { validateCoreValue } from '../src/backup/coreValues';
import { loadProfileFixture, migrateProfileToLatest } from './chain/runChain';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-602: the kobar-storage v26 -> v27 block (density, isPopupSmartPositioning readable as true). Synthetic fixtures only.

type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const v26 = (): State => loadFixture('v26-density.json').state;
// T-603: the v28 pseudo-note removal is undone (covered in tests/migrate.v28.test.ts), so the expectations stay v27's own.
const migrate = (state: State, version = 26): State => undoV28(undoV29(migrateKobarStorage(structuredClone(state), version)));
const byId = (state: State, id: string) => state.workspaces.find((w: State) => w.id === id);

describe('v27: an existing user (stored v26)', () => {
    it('gets the density of its sidebarWidth and keeps every v1 layout field', () => {
        const input = v26();
        const output = migrate(input);
        expect(output.density).toBe('compact'); // sidebarWidth 40 < 44
        for (const key of ['sidebarWidth', 'iconScale', 'featureSpacing', 'toggleWidth']) {
            expect(output[key], key).toStrictEqual(input[key]);
        }
        expect(output.notes).toStrictEqual(input.notes);
        expect(output.globalNotes).toStrictEqual(input.globalNotes);
        expect(output.currentExtensionsConfig).toStrictEqual(input.currentExtensionsConfig);
        for (const key of ['scheme', 'accent', 'material', 'theme']) expect(output[key], key).toStrictEqual(input[key]);
    });

    it('maps every workspace profile on its own, missing or invalid widths -> normal', () => {
        const output = migrate(v26());
        expect(output.workspaces.map((w: State) => [w.id, w.density])).toStrictEqual([
            ['ws-work', 'compact'],
            ['ws-wide', 'comfortable'],
            ['ws-edge-low', 'normal'],
            ['ws-edge-high', 'normal'],
            ['ws-just-over', 'comfortable'],
            ['ws-garbage', 'normal'],
            ['ws-old', 'normal'],
        ]);
        // iconScale / featureSpacing / toggleWidth do not decide the density (ws-wide: iconScale 1.5 changes nothing).
        expect(byId(output, 'ws-wide')).toMatchObject({ sidebarWidth: 80, iconScale: 1.5 });
    });

    it('isPopupSmartPositioning reads true everywhere it was stored; the raw values are backed up; none is added', () => {
        const input = v26();
        const output = migrate(input);
        expect(output.isPopupSmartPositioning).toBe(true);
        expect(byId(output, 'ws-work').isPopupSmartPositioning).toBe(true);
        expect(byId(output, 'ws-wide').isPopupSmartPositioning).toBe(true);
        expect(byId(output, 'ws-edge-low').isPopupSmartPositioning).toBe(true);
        expect(byId(output, 'ws-garbage').isPopupSmartPositioning).toBe(true);
        expect(byId(output, 'ws-edge-high')).not.toHaveProperty('isPopupSmartPositioning');
        expect(byId(output, 'ws-old')).not.toHaveProperty('isPopupSmartPositioning');
        expect(output.legacyBackup[BACKUP_KEY_V27]).toStrictEqual({
            top: { values: { isPopupSmartPositioning: false } },
            workspaces: [
                { index: 0, id: 'ws-work', values: { isPopupSmartPositioning: false } },
                { index: 2, id: 'ws-edge-low', values: { isPopupSmartPositioning: false } },
                { index: 5, id: 'ws-garbage', values: { isPopupSmartPositioning: 'yes' } },
            ],
        });
        // Older backup slots stay as they are.
        expect(output.legacyBackup.workspaceModelV24).toStrictEqual(input.legacyBackup.workspaceModelV24);
        expect(output.legacyBackup.appearanceV26).toStrictEqual(input.legacyBackup.appearanceV26);
    });

    it('never touches identity, isolation, isolated data or plugin sets', () => {
        const input = v26();
        const output = migrate(input);
        output.workspaces.forEach((ws: State, i: number) => {
            const before = input.workspaces[i];
            const pick = (w: State) => ({
                id: w.id,
                name: w.name,
                isIsolated: w.isIsolated,
                isolatedData: w.isolatedData,
                enabledExtensions: w.enabledExtensions,
            });
            expect(pick(ws)).toStrictEqual(pick(before));
        });
    });

    it('is reversible: the backup rebuilds the exact v26 state', () => {
        const input = v26();
        expect(undoV27(migrate(input))).toStrictEqual(input);
    });
});

describe('v27: the sidebarWidth -> density mapping', () => {
    it('< 44 compact, 44..52 normal (default 46 included), > 52 comfortable', () => {
        expect(COMPACT_BELOW_V27).toBe(44);
        expect(COMFORTABLE_ABOVE_V27).toBe(52);
        const cases: [unknown, string][] = [
            [40, 'compact'],
            [43.99, 'compact'],
            [10, 'compact'],
            [44, 'normal'],
            [46, 'normal'],
            [52, 'normal'],
            [52.01, 'comfortable'],
            [64, 'comfortable'],
            [120, 'comfortable'],
            [1000, 'comfortable'],
        ];
        for (const [width, density] of cases) expect(densityFromSidebarWidthV27(width), String(width)).toBe(density);
    });

    it('missing, non-numeric, non-finite or implausible widths -> normal', () => {
        for (const width of [undefined, null, '40', '64', true, {}, [], Number.NaN, Infinity, -Infinity, 0, 9.99, -40, 1000.5, 1e9]) {
            expect(densityFromSidebarWidthV27(width), String(width)).toBe('normal');
        }
    });

    it('the frozen v27 rule equals the live store rule (src/store/density.ts) on the same inputs', () => {
        expect(COMPACT_BELOW).toBe(COMPACT_BELOW_V27);
        expect(COMFORTABLE_ABOVE).toBe(COMFORTABLE_ABOVE_V27);
        for (const width of [undefined, 'x', Number.NaN, 0, 9, 10, 40, 43.9, 44, 46, 52, 52.1, 80, 1000, 1001]) {
            expect(densityFromSidebarWidth(width), String(width)).toBe(densityFromSidebarWidthV27(width));
        }
    });
});

describe('v27: present v27 values, foreign values and backups', () => {
    it('keeps valid densities and true values as they are (no backup)', () => {
        const state = { ...v26(), density: 'comfortable', isPopupSmartPositioning: true };
        state.workspaces = state.workspaces.map((w: State) => {
            const ws = { ...w, density: 'compact' };
            if ('isPopupSmartPositioning' in ws) ws.isPopupSmartPositioning = true;
            return ws;
        });
        expect(migrate(state)).toStrictEqual(state);
    });

    it('replaces a foreign density after a raw backup', () => {
        const state = { ...v26(), density: 'cozy', isPopupSmartPositioning: true };
        state.workspaces[1].density = { x: 1 };
        const output = migrate(state);
        expect(output.density).toBe('compact');
        expect(byId(output, 'ws-wide').density).toBe('comfortable');
        const entry = output.legacyBackup[BACKUP_KEY_V27];
        expect(entry.top.values).toStrictEqual({ density: 'cozy' });
        expect(entry.workspaces[1]).toStrictEqual({ index: 1, id: 'ws-wide', values: { density: { x: 1 } } });
        expect(undoV27(output)).toStrictEqual(state);
    });

    it('uses the next free backup slot', () => {
        const state = { ...v26() };
        state.legacyBackup = { ...state.legacyBackup, [BACKUP_KEY_V27]: 'older', [`${BACKUP_KEY_V27}#2`]: 'older-2' };
        const output = migrate(state);
        expect(output.legacyBackup[`${BACKUP_KEY_V27}#3`].top).toStrictEqual({ values: { isPopupSmartPositioning: false } });
        expect(output.legacyBackup[BACKUP_KEY_V27]).toBe('older');
        expect(output.legacyBackup[`${BACKUP_KEY_V27}#2`]).toBe('older-2');
    });

    it('without a safe backup only the lossless additions happen (nothing replaced)', () => {
        const slots: Record<string, string> = {};
        for (let n = 1; n <= 10; n++) slots[n === 1 ? BACKUP_KEY_V27 : `${BACKUP_KEY_V27}#${n}`] = 'taken';
        const cases = [
            { ...v26(), legacyBackup: 'not-an-object', density: 'cozy' },
            { ...v26(), legacyBackup: slots, density: 'cozy' },
            { ...v26(), isPopupSmartPositioning: 'x'.repeat(MAX_BACKUP_CHARS_V27 + 1), density: 'cozy' },
        ];
        for (const state of cases) {
            const output = migrate(state);
            expect(output.legacyBackup).toStrictEqual(state.legacyBackup);
            expect(output.density).toBe('cozy');
            expect(output.isPopupSmartPositioning).toBe(state.isPopupSmartPositioning);
            expect(byId(output, 'ws-work')).toMatchObject({ density: 'compact', isPopupSmartPositioning: false });
            expect(byId(output, 'ws-garbage')).toMatchObject({ density: 'normal', isPopupSmartPositioning: 'yes' });
        }
    });

    it('a state without any v1 layout field only gets density normal', () => {
        expect(migrate({ notes: [] })).toStrictEqual({ notes: [], density: 'normal' });
    });
});

describe('v27: garbage, idempotency and version gating', () => {
    it('never throws on garbage states', () => {
        for (const garbage of [null, undefined, 1, 'x', [], {}, { workspaces: 'x' }, { workspaces: [null, 1, [], 'a'] }]) {
            expect(() => migrateToV27(structuredClone(garbage))).not.toThrow();
        }
        const odd = { workspaces: [null, 1, [], 'a', { id: 'x', sidebarWidth: 30 }], legacyBackup: null };
        migrateToV27(odd);
        expect(odd.workspaces.slice(0, 4)).toStrictEqual([null, 1, [], 'a']);
        expect(odd.workspaces[4]).toStrictEqual({ id: 'x', sidebarWidth: 30, density: 'compact' });
    });

    it('is idempotent: a second run changes nothing and writes no second backup', () => {
        const once = migrate(v26());
        const twice = structuredClone(once);
        migrateToV27(twice);
        expect(twice).toStrictEqual(once);
        expect(Object.keys(twice.legacyBackup).filter((k) => k.startsWith(BACKUP_KEY_V27))).toHaveLength(1);
    });

    it('a stored v27 state is not touched', () => {
        const state = v26();
        expect(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 27)))).toStrictEqual(state);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(27);
    });
});

describe('v27 on the backup restore path', () => {
    it('a v26 backup value is migrated to v27 like a stored state', () => {
        const res = validateCoreValue('app-store', JSON.stringify({ state: v26(), version: 26 }));
        if (!res.ok) throw new Error('restore rejected');
        const restored = JSON.parse(res.value);
        expect(restored.version).toBe(KOBAR_STORAGE_VERSION);
        expect(restored.state).toMatchObject({ density: 'compact', isPopupSmartPositioning: true, sidebarWidth: 40 });
        expect(restored.state.legacyBackup[BACKUP_KEY_V27].top.values).toStrictEqual({ isPopupSmartPositioning: false });
    });

    it('a value with nothing but the migration-added density is still rejected', () => {
        expect(validateCoreValue('app-store', JSON.stringify({ state: {}, version: 26 }))).toMatchObject({ ok: false });
    });
});

describe('v27: chain from every older fixture', () => {
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
    ];

    it.each(names)('%s: valid density everywhere, consistent with sidebarWidth; popups true; a rerun is a no-op', (name) => {
        const fixture = loadFixture(name);
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        expect(output.density).toBe(densityFromSidebarWidth(output.sidebarWidth));
        expect(output.isPopupSmartPositioning).toBe(true);
        for (const ws of output.workspaces ?? []) {
            expect(ws.density).toBe(densityFromSidebarWidth(ws.sidebarWidth));
            if ('isPopupSmartPositioning' in ws) expect(ws.isPopupSmartPositioning).toBe(true);
        }
        expect(migrateKobarStorage(structuredClone(output), 26)).toStrictEqual(output);
    });

    it('profile chain (v21 profile): reaches v27 with density and the popup flag backup', () => {
        const out = JSON.parse(migrateProfileToLatest(loadProfileFixture(21)).localStorage['kobar-storage']);
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
        expect(out.state.density).toBe('comfortable'); // sidebarWidth 64
        expect(out.state.isPopupSmartPositioning).toBe(true);
        expect(out.state.legacyBackup[BACKUP_KEY_V27].top.values).toStrictEqual({ isPopupSmartPositioning: false });
    });
});
