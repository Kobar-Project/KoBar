import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FORCED_THEME_COLOR_KEY,
    KOBAR_STORAGE_VERSION,
    migrateKobarStorage,
    migratePersistedKobarStorage,
    readForcedThemeColor,
} from '../src/store/migrations';
import {
    BACKUP_KEY_V26,
    MAX_BACKUP_CHARS_V26,
    THEME_TO_ACCENT_V26,
    accentFromLegacyV26,
    materialFromLegacyV26,
    migrateToV26,
} from '../src/store/migrations/v26';
import { accentFromLegacy, materialFromLegacy } from '../src/store/appearance';
import { validateCoreValue } from '../src/backup/coreValues';
import { loadProfileFixture, migrateProfileToLatest } from './chain/runChain';
import { undoV26 } from './helpers/undoV26';
import { undoV27 } from './helpers/undoV27';
import { undoV28 } from './helpers/undoV28';
import { undoV29 } from './helpers/undoV29';

// T-601: the kobar-storage v25 -> v26 block (appearance model, UI-32). Synthetic fixtures only.

type State = ReturnType<typeof migrateKobarStorage>;
type Fixture = { version: number; state: State };

function loadFixture(name: string): Fixture {
    const path = fileURLToPath(new URL(`./fixtures/kobar-storage/${name}`, import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const v25 = (): State => loadFixture('v25-appearance.json').state;
// T-602/T-603: the v27 density changes and the v28 pseudo-note removal are undone (tests/migrate.v27/v28.test.ts), so the expectations stay v26's own.
const migrate = (state: State, forcedThemeColor?: unknown, version = 25): State =>
    undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), version, { forcedThemeColor }))));
const byId = (state: State, id: string) => state.workspaces.find((w: State) => w.id === id);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('v26: an existing user (stored v25)', () => {
    it('gets scheme dark, the mapped accent and material, and keeps every v1 field', () => {
        const input = v25();
        const output = migrate(input);
        expect(output.scheme).toBe('dark');
        expect(output.accent).toBe('custom');
        expect(output.material).toBe('translucent');
        for (const key of ['theme', 'customThemeColor', 'design', 'glassOpacity']) expect(output[key], key).toStrictEqual(input[key]);
        expect(output.notes).toStrictEqual(input.notes);
        expect(output.globalNotes).toStrictEqual(input.globalNotes);
        expect(output.currentExtensionsConfig).toStrictEqual(input.currentExtensionsConfig);
        expect(output.defaultExtensionsConfig).toBeNull();
    });

    it('maps every workspace profile on its own (accent per workspace, material per workspace)', () => {
        const input = v25();
        const output = migrate(input);
        expect(byId(output, 'ws-work')).toMatchObject({ accent: 'custom', material: 'translucent', customThemeColor: '#aa22cc' });
        // lavender -> violet; style2 with glassOpacity 95 (>= 90) -> solid. The v1 values stay ('lavender', 95).
        expect(byId(output, 'ws-lavender')).toMatchObject({ accent: 'violet', material: 'solid', theme: 'lavender', glassOpacity: 95 });
        expect(byId(output, 'ws-nord')).toMatchObject({ accent: 'graphite', material: 'solid', customThemeColor: '#123456' });
        // custom with a preset hex (any case) -> the preset; style2 with 89 -> translucent.
        expect(byId(output, 'ws-custom-preset')).toMatchObject({ accent: 'amber', material: 'translucent', customThemeColor: '#F4A125' });
        // A record without any appearance field -> the defensive defaults: amber, solid.
        expect(byId(output, 'ws-old')).toStrictEqual({ ...byId(input, 'ws-old'), accent: 'amber', material: 'solid' });
        // Identity, isolation, isolated data and plugin sets never change.
        output.workspaces.forEach((ws: State, i: number) => {
            const before = input.workspaces[i];
            expect({
                id: ws.id,
                name: ws.name,
                isIsolated: ws.isIsolated,
                isolatedData: ws.isolatedData,
                enabledExtensions: ws.enabledExtensions,
            }).toStrictEqual({
                id: before.id,
                name: before.name,
                isIsolated: before.isIsolated,
                isolatedData: before.isolatedData,
                enabledExtensions: before.enabledExtensions,
            });
        });
    });

    it('drops teleportShortcut (T-144) after a raw backup; everything else in legacyBackup stays', () => {
        const input = v25();
        const output = migrate(input);
        expect(output).not.toHaveProperty('teleportShortcut');
        expect(output.legacyBackup[BACKUP_KEY_V26]).toStrictEqual({ top: { values: { teleportShortcut: 'CommandOrControl+Shift+K' } } });
        expect(output.legacyBackup.workspaceModelV24).toStrictEqual(input.legacyBackup.workspaceModelV24);
    });

    it('is reversible: the backup rebuilds the exact v25 state', () => {
        const input = v25();
        expect(undoV26(migrate(input))).toStrictEqual(input);
        expect(undoV26(migrate(input, '#00ff00'))).toStrictEqual(input);
    });

    it('applies the table for all 10 themes, unknown/missing -> amber', () => {
        const expected: Record<string, string> = {
            ember: 'amber',
            coffee: 'orange',
            crimson: 'red',
            sakura: 'pink',
            amethyst: 'violet',
            lavender: 'violet',
            midnight: 'blue',
            ocean: 'blue',
            emerald: 'green',
            nord: 'graphite',
        };
        expect(THEME_TO_ACCENT_V26).toStrictEqual(expected);
        for (const [theme, accent] of Object.entries(expected)) {
            expect(migrate({ theme }).accent, theme).toBe(accent);
        }
        for (const theme of [undefined, null, 'dark', 'light', 42, 'custom-ish']) {
            expect(migrate({ theme }).accent, String(theme)).toBe('amber');
        }
    });

    it('custom colours: valid non-preset -> custom; preset hex -> preset; invalid or missing -> amber', () => {
        expect(accentFromLegacyV26('custom', '#aa22cc')).toBe('custom');
        expect(accentFromLegacyV26('custom', 'aa22cc')).toBe('custom');
        expect(accentFromLegacyV26('custom', '#abc')).toBe('custom');
        expect(accentFromLegacyV26('custom', '#f4a125')).toBe('amber');
        expect(accentFromLegacyV26('custom', '#4CA8F5')).toBe('blue');
        expect(accentFromLegacyV26('custom', undefined)).toBe('amber'); // old default #f4a125
        for (const bad of ['#12', '#aabbccdd', 'red', null, 7]) expect(accentFromLegacyV26('custom', bad), String(bad)).toBe('amber');
    });

    it('material: style2 below 90 -> translucent; style1, other designs, 90+ -> solid; missing opacity = old default 60', () => {
        expect(materialFromLegacyV26('style2', 0)).toBe('translucent');
        expect(materialFromLegacyV26('style2', 89.9)).toBe('translucent');
        expect(materialFromLegacyV26('style2', 90)).toBe('solid');
        expect(materialFromLegacyV26('style2', 100)).toBe('solid');
        expect(materialFromLegacyV26('style2', undefined)).toBe('translucent');
        expect(materialFromLegacyV26('style2', 'x')).toBe('translucent');
        expect(materialFromLegacyV26('style1', 10)).toBe('solid');
        expect(materialFromLegacyV26('glass', 0.5)).toBe('solid');
        expect(materialFromLegacyV26(undefined, undefined)).toBe('solid');
    });

    it('the frozen v26 rules equal the live store rules (src/store/appearance.ts) on the same inputs', () => {
        const themes = [...Object.keys(THEME_TO_ACCENT_V26), 'custom', 'dark', undefined];
        const colors = ['#aa22cc', '#f4a125', '#ABC', 'bad', undefined];
        for (const theme of themes)
            for (const color of colors) expect(accentFromLegacy(theme, color)).toBe(accentFromLegacyV26(theme, color));
        for (const design of ['style1', 'style2', 'glass', undefined]) {
            for (const opacity of [0, 50, 89, 90, 100, undefined])
                expect(materialFromLegacy(design, opacity)).toBe(materialFromLegacyV26(design, opacity));
        }
    });
});

describe('v26: kobar_force_theme_color', () => {
    it('a valid forced hex that differs replaces customThemeColor on the top level and the active record (raw values backed up)', () => {
        const input = v25();
        const output = migrate(input, '#00FF00');
        expect(output.customThemeColor).toBe('#00ff00');
        expect(output.accent).toBe('custom');
        expect(byId(output, 'ws-work')).toMatchObject({ customThemeColor: '#00ff00', accent: 'custom' });
        // Inactive records keep their own colour (<= v25 rewrote the forced key from the record on every switch).
        expect(byId(output, 'ws-nord').customThemeColor).toBe('#123456');
        expect(output.legacyBackup[BACKUP_KEY_V26]).toStrictEqual({
            forcedThemeColor: '#00FF00',
            top: { values: { customThemeColor: '#aa22cc', teleportShortcut: 'CommandOrControl+Shift+K' } },
            workspaces: [{ index: 0, id: 'ws-work', values: { customThemeColor: '#aa22cc' } }],
        });
    });

    it('a forced preset hex makes the accent that preset', () => {
        const output = migrate(v25(), '#f4a125');
        expect(output.accent).toBe('amber');
        expect(output.customThemeColor).toBe('#f4a125');
    });

    it('is ignored when equal, invalid, missing or when the theme is not custom', () => {
        for (const forced of ['#AA22CC', 'aa22cc', 'javascript:alert(1)', '', null, undefined, 42]) {
            const output = migrate(v25(), forced);
            expect(output.customThemeColor, String(forced)).toBe('#aa22cc');
            expect(output.legacyBackup[BACKUP_KEY_V26], String(forced)).not.toHaveProperty('forcedThemeColor');
        }
        const ocean = { ...v25(), theme: 'ocean' };
        const output = migrate(ocean, '#00ff00');
        expect(output.customThemeColor).toBe('#aa22cc');
        expect(output.accent).toBe('blue');
    });

    it("migratePersistedKobarStorage reads this machine's key; a missing localStorage reads as null", () => {
        expect(readForcedThemeColor()).toBeNull();
        const values = new Map([[FORCED_THEME_COLOR_KEY, '#00ff00']]);
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
        expect(readForcedThemeColor()).toBe('#00ff00');
        const output = migratePersistedKobarStorage(structuredClone(v25()), 25);
        expect(output.customThemeColor).toBe('#00ff00');
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('denied');
            },
        });
        expect(readForcedThemeColor()).toBeNull();
    });

    it('a settings import path (no options) never applies a forced colour', () => {
        const output = migrateKobarStorage(structuredClone(v25()), 25);
        expect(output.customThemeColor).toBe('#aa22cc');
    });
});

describe('v26 on the backup restore path', () => {
    const backupValue = () => JSON.stringify({ state: v25(), version: 25 });
    const restored = (forced?: unknown) => {
        const res = validateCoreValue('app-store', backupValue(), undefined, forced);
        if (!res.ok) throw new Error('restore rejected');
        return JSON.parse(res.value).state;
    };

    it("the backup's own valid kobar_force_theme_color feeds v26", () => {
        expect(restored('#00ff00')).toMatchObject({ customThemeColor: '#00ff00', accent: 'custom', scheme: 'dark' });
    });

    it('an invalid or missing forced value is ignored', () => {
        for (const forced of [undefined, 'javascript:alert(1)', 42, '#12']) {
            expect(restored(forced).customThemeColor, String(forced)).toBe('#aa22cc');
        }
    });
});

describe('v26: present v26 values, foreign values and backups', () => {
    it('keeps valid v26 values as they are (no backup for them)', () => {
        const state = { ...v25(), scheme: 'light', accent: 'green', material: 'solid' };
        delete state.teleportShortcut;
        state.workspaces = state.workspaces.map((w: State) => ({ ...w, accent: 'pink', material: 'translucent' }));
        const output = migrate(state, '#00ff00');
        expect(output).toStrictEqual(state);
    });

    it('replaces foreign values of the new keys after a raw backup', () => {
        const state = { ...v25(), scheme: 'sepia', accent: { x: 1 }, material: 3 };
        state.workspaces[2].accent = 'teal';
        const output = migrate(state);
        expect(output.scheme).toBe('dark');
        expect(output.accent).toBe('custom');
        expect(output.material).toBe('translucent');
        expect(byId(output, 'ws-nord').accent).toBe('graphite');
        const entry = output.legacyBackup[BACKUP_KEY_V26];
        expect(entry.top.values).toStrictEqual({
            scheme: 'sepia',
            accent: { x: 1 },
            material: 3,
            teleportShortcut: 'CommandOrControl+Shift+K',
        });
        expect(entry.workspaces).toStrictEqual([{ index: 2, id: 'ws-nord', values: { accent: 'teal' } }]);
        expect(undoV26(output)).toStrictEqual(state);
    });

    it('uses the next free backup slot', () => {
        const state = { ...v25(), legacyBackup: { [BACKUP_KEY_V26]: 'older', [`${BACKUP_KEY_V26}#2`]: 'older-2' } };
        const output = migrate(state);
        expect(output.legacyBackup[`${BACKUP_KEY_V26}#3`]).toStrictEqual({
            top: { values: { teleportShortcut: 'CommandOrControl+Shift+K' } },
        });
        expect(output.legacyBackup[BACKUP_KEY_V26]).toBe('older');
    });

    it('without a safe backup only the lossless additions happen (nothing replaced or removed)', () => {
        const slots: Record<string, string> = {};
        for (let n = 1; n <= 10; n++) slots[n === 1 ? BACKUP_KEY_V26 : `${BACKUP_KEY_V26}#${n}`] = 'taken';
        const cases = [
            { ...v25(), legacyBackup: 'not-an-object', scheme: 'sepia' },
            { ...v25(), legacyBackup: slots, scheme: 'sepia' },
            { ...v25(), teleportShortcut: 'x'.repeat(MAX_BACKUP_CHARS_V26 + 1), scheme: 'sepia' },
        ];
        for (const state of cases) {
            const output = migrate(state, '#00ff00');
            expect(output.legacyBackup).toStrictEqual(state.legacyBackup);
            expect(output.teleportShortcut).toBe(state.teleportShortcut);
            expect(output.scheme).toBe('sepia');
            // The forced colour needs a backup, so the accent comes from the stored colour.
            expect(output.customThemeColor).toBe('#aa22cc');
            expect(output.accent).toBe('custom');
            expect(output.material).toBe('translucent');
            expect(byId(output, 'ws-lavender')).toMatchObject({ accent: 'violet', material: 'solid' });
        }
    });
});

describe('v26: garbage, idempotency and version gating', () => {
    it('never throws on garbage states', () => {
        for (const garbage of [null, undefined, 1, 'x', [], {}, { workspaces: 'x' }, { workspaces: [null, 1, [], 'a'] }]) {
            expect(() => migrateToV26(structuredClone(garbage), '#00ff00')).not.toThrow();
        }
        const odd = migrate({ workspaces: [null, 1, [], 'a', { id: 'x' }] });
        expect(odd.workspaces.slice(0, 4)).toStrictEqual([null, 1, [], 'a']);
        expect(odd.workspaces[4]).toStrictEqual({ id: 'x', accent: 'amber', material: 'solid' });
    });

    it('is idempotent: a second run changes nothing and writes no second backup', () => {
        const once = migrate(v25(), '#00ff00');
        const twice = structuredClone(once);
        migrateToV26(twice, '#123123');
        expect(twice).toStrictEqual(once);
        expect(Object.keys(twice.legacyBackup).filter((k) => k.startsWith(BACKUP_KEY_V26))).toHaveLength(1);
    });

    it('a stored v26 state is not touched', () => {
        const state = v25();
        expect(undoV27(undoV28(undoV29(migrateKobarStorage(structuredClone(state), 26, { forcedThemeColor: '#00ff00' }))))).toStrictEqual(
            state
        );
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(26);
    });
});

describe('v26: chain from every older fixture', () => {
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
    ];

    it.each(names)('%s: valid v26 fields everywhere, consistent with the v1 fields; a rerun is a no-op', (name) => {
        const fixture = loadFixture(name);
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        expect(output.scheme).toBe('dark');
        expect(output.accent).toBe(accentFromLegacy(output.theme, output.customThemeColor));
        expect(output.material).toBe(materialFromLegacy(output.design, output.glassOpacity));
        expect(output).not.toHaveProperty('teleportShortcut');
        for (const ws of output.workspaces ?? []) {
            expect(ws.accent).toBe(accentFromLegacy(ws.theme, ws.customThemeColor));
            expect(ws.material).toBe(materialFromLegacy(ws.design, ws.glassOpacity));
        }
        expect(migrateKobarStorage(structuredClone(output), 25)).toStrictEqual(output);
    });

    it('v23 fixture (existing user, active isolated workspace): ocean/style2 70 -> blue/translucent; the records follow their own fields', () => {
        const fixture = loadFixture('v23-workspaces.json');
        const output = migrateKobarStorage(structuredClone(fixture.state), fixture.version);
        expect({ scheme: output.scheme, accent: output.accent, material: output.material }).toStrictEqual({
            scheme: 'dark',
            accent: 'blue',
            material: 'translucent',
        });
        expect(output.workspaces.map((w: State) => [w.id, w.accent, w.material])).toStrictEqual([
            ['ws-iso', 'blue', 'translucent'],
            ['ws-shared', 'amber', 'solid'],
            ['ws-legacy', 'amber', 'solid'],
        ]);
    });

    it("profile chain (v21 profile) with a forced colour in localStorage: the profile's own key feeds v26", () => {
        const profile = loadProfileFixture(21);
        profile.localStorage[FORCED_THEME_COLOR_KEY] = '#00ff00';
        const out = JSON.parse(migrateProfileToLatest(profile).localStorage['kobar-storage']);
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
        expect(out.state.customThemeColor).toBe('#00ff00');
        expect(out.state.accent).toBe('custom');
        expect(out.state.legacyBackup[BACKUP_KEY_V26].forcedThemeColor).toBe('#00ff00');
        // The localStorage key itself is left in place (1.2.x still reads it after a downgrade).
        expect(migrateProfileToLatest(profile).localStorage[FORCED_THEME_COLOR_KEY]).toBe('#00ff00');
    });
});
