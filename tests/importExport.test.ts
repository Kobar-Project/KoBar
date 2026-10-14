import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { AppState, WorkspaceConfig } from '../src/store/useAppStore';
import {
    buildSettingsExport,
    buildDataExport,
    buildSettingsImport,
    mergeLegacyBackup,
    parseDataImport,
    ImportError,
    IMPORT_LIMITS,
    SETTINGS_KEYS,
    settingsSchema,
} from '../src/store/importExport';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';

// T-208/T-209. Synthetic data only.

const state = {
    theme: 'dark',
    language: 'en',
    legacyBackup: { a: '1' },
    notes: [
        { id: 1, title: 'Mine', content: 'x' },
        { id: 2, title: 'Settings', isSettings: true },
        { id: 3, title: 'Welcome to KoBar!' },
    ],
    workspaces: [
        {
            id: 'w1',
            name: 'Iso',
            isIsolated: true,
            isolatedData: { notes: [{ id: 9, content: 'secret' }], pluginData: { aiHub: { apiKey: 'sk-1' } } },
        },
        { id: 'w2', name: 'Shared', isIsolated: false },
    ],
};

const hostileText = readFileSync(fileURLToPath(new URL('./fixtures/import/hostile-settings.json', import.meta.url)), 'utf8');

const LOCAL_ISO = { notes: [{ id: 1, title: 'local', icon: 'note', emoji: null, content: 'local-iso-note' }], nextNoteId: 2 };

function localState(over: Record<string, unknown> = {}): AppState {
    return {
        theme: 'midnight',
        customThemeColor: '#f4a125',
        language: 'en',
        sidebarWidth: 46,
        iconScale: 0.8,
        glassOpacity: 60,
        toggleWidth: 22,
        featureSpacing: 8,
        featureOrder: ['calculator'],
        activeWorkspaceId: 'w1',
        legacyBackup: { todos: ['local'] },
        workspaces: [
            { id: 'w1', name: 'Local iso', isIsolated: true, theme: 'nord', isolatedData: structuredClone(LOCAL_ISO) },
            { id: 'w9', name: 'Local only', isIsolated: false, theme: 'coffee' },
        ],
        ...over,
    } as unknown as AppState;
}

const file = (obj: unknown) => JSON.stringify(obj);

describe('settings export', () => {
    it('has no isolatedData, keeps workspace config and carries the persist version', () => {
        const out = buildSettingsExport(state);
        expect(JSON.stringify(out)).not.toContain('isolatedData');
        expect(JSON.stringify(out)).not.toContain('sk-1');
        expect(out.workspaces.map((w: { id: string }) => w.id)).toEqual(['w1', 'w2']);
        expect(out.workspaces[0].name).toBe('Iso');
        expect(out.legacyBackup).toEqual({ a: '1' });
        expect(out.theme).toBe('dark');
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
    });

    it('does not mutate the source state', () => {
        buildSettingsExport(state);
        expect(state.workspaces[0].isolatedData).toBeDefined();
    });

    it('data export contains only non-system notes', () => {
        expect(buildDataExport(state).notes.map((n: { id: number }) => n.id)).toEqual([1]);
    });
});

describe('settings schema (T-156)', () => {
    it('has exactly one schema per whitelisted settings key', () => {
        expect(Object.keys(settingsSchema.shape).sort()).toEqual([...SETTINGS_KEYS].sort());
    });

    it('accepts every theme and language the store type allows', () => {
        // The compile-time binding to AppState lives in importExport.ts; this guards the runtime lists.
        for (const theme of [
            'ember',
            'ocean',
            'sakura',
            'emerald',
            'midnight',
            'amethyst',
            'crimson',
            'nord',
            'coffee',
            'lavender',
            'custom',
        ]) {
            expect(buildSettingsImport(file({ theme }), localState())).toMatchObject({ theme });
        }
        for (const language of ['de', 'ar', 'zh', 'fr', 'hi', 'en', 'es', 'ja', 'ru', 'tr']) {
            expect(buildSettingsImport(file({ language }), localState())).toMatchObject({ language });
        }
    });
});

describe('settings import: hostile fixture', () => {
    const local = localState();
    const patch = buildSettingsImport(hostileText, local) as Record<string, unknown>;

    it('does not pollute prototypes', () => {
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.getPrototypeOf(patch)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(patch.legacyBackup)).toBe(Object.prototype);
        for (const w of patch.workspaces as object[]) expect(Object.getPrototypeOf(w)).toBe(Object.prototype);
    });

    it('only whitelisted keys reach the patch', () => {
        const allowed = new Set<string>([...SETTINGS_KEYS, 'workspaces', 'legacyBackup']);
        for (const key of Object.keys(patch)) expect(allowed.has(key)).toBe(true);
        const text = JSON.stringify(patch);
        for (const evil of ['sk-evil', 'evil-root-note', 'evil-global-note', 'evil-plugin', 'stale-iso-note', 'not-a-function']) {
            expect(text).not.toContain(evil);
        }
        expect(patch).not.toHaveProperty('activeWorkspaceId');
    });

    it('keeps valid values and drops wrong types / out of range values', () => {
        expect(patch.language).toBe('tr');
        expect(patch.glassOpacity).toBe(50);
        // T-601: teleportShortcut is no longer a setting (dead feature, dropped in v26).
        expect(patch).not.toHaveProperty('teleportShortcut');
        for (const key of ['theme', 'sidebarWidth', 'iconScale', 'customThemeColor', 'showTooltips']) expect(patch).not.toHaveProperty(key);
    });

    it('merges legacyBackup per key, local wins', () => {
        expect(patch.legacyBackup).toEqual({ todos: ['local'], colorPalettes: ['from-file'] });
    });

    it('merges workspaces by id and never overwrites local isolatedData', () => {
        const ws = patch.workspaces as WorkspaceConfig[];
        expect(ws.map((w) => w.id)).toEqual(['w1', 'w9', 'new1', 'new2']);
        const [w1, w9, new1, new2] = ws;
        expect(w1.name).toBe('Renamed');
        expect(w1.theme).toBe('ocean');
        expect(w1.isIsolated).toBe(true);
        expect(w1.isolatedData).toEqual(LOCAL_ISO);
        expect(w9).toBe(local.workspaces[1]);
        // Unknown id: old-file isolatedData notes are kept (T-208) but pluginData is dropped (T-156); missing fields come from the live settings.
        expect(new1.isolatedData?.notes?.[0].content).toBe('old-file-note');
        expect(new1.isolatedData).not.toHaveProperty('pluginData');
        expect(new1.isIsolated).toBe(true);
        expect(new1.theme).toBe('midnight');
        expect(new1.toggleWidth).toBe(22);
        expect(new2.name).toBe('new2');
        expect(new2.theme).toBe('midnight');
        expect(new2.sidebarWidth).toBe(46);
        expect(new2.isIsolated).toBe(false);
        expect(new2).not.toHaveProperty('enabledExtensions');
        expect(new2).not.toHaveProperty('isolatedData');
    });

    it('does not mutate the local state', () => {
        expect(local.workspaces[0].name).toBe('Local iso');
        expect(local.legacyBackup).toEqual({ todos: ['local'] });
    });
});

describe('settings import: legacyBackup.conflicts deep merge (T-154)', () => {
    it('merges conflicts one level deep and the local entry wins', () => {
        const local = localState({
            legacyBackup: { todos: ['local'], conflicts: { todos: ['local-conflict'], currentColor: '#000000' } },
        });
        const text = file({
            version: KOBAR_STORAGE_VERSION,
            theme: 'dark',
            legacyBackup: {
                colorPalettes: ['from-file'],
                conflicts: { todos: ['file-conflict'], colorPalettes: ['file-conflict'] },
            },
        });
        const patch = buildSettingsImport(text, local) as { legacyBackup: Record<string, unknown> };
        expect(patch.legacyBackup).toEqual({
            todos: ['local'],
            colorPalettes: ['from-file'],
            conflicts: { todos: ['local-conflict'], currentColor: '#000000', colorPalettes: ['file-conflict'] },
        });
        expect(local.legacyBackup).toEqual({
            todos: ['local'],
            conflicts: { todos: ['local-conflict'], currentColor: '#000000' },
        });
    });
});

describe('mergeLegacyBackup shapes (T-154)', () => {
    it('local conflicts that are not an object: local wins as a whole', () => {
        const merged = mergeLegacyBackup({ conflicts: { a: 1 }, x: 1 }, { conflicts: ['l'] });
        expect(merged).toEqual({ x: 1, conflicts: ['l'] });
    });

    it('imported conflicts present while local has none: imported ones are kept', () => {
        expect(mergeLegacyBackup({ conflicts: { a: 1 } }, { y: 2 })).toEqual({ conflicts: { a: 1 }, y: 2 });
    });

    it('imported conflicts that are not an object: local conflicts win', () => {
        expect(mergeLegacyBackup({ conflicts: ['i'] }, { conflicts: { a: 1 } })).toEqual({ conflicts: { a: 1 } });
    });
});

describe('settings import: workspace context safety (T-153 / T-209)', () => {
    const text = file({
        activeWorkspaceId: 'wNew',
        dataContextId: 99,
        workspaces: [
            { id: 'w1', name: 'Renamed', isIsolated: false },
            { id: 'wNew', name: 'New', isIsolated: true, isolatedData: { notes: [{ id: 1, content: 'x' }] } },
        ],
    });

    it('never carries activeWorkspaceId, so an import cannot point it at an unknown id', () => {
        const patch = buildSettingsImport(text, localState()) as Record<string, unknown>;
        expect(patch).not.toHaveProperty('activeWorkspaceId');
        expect(patch).not.toHaveProperty('dataContextId');
    });

    it('keeps every local workspace (the active one included) and its isolation flag and data', () => {
        const local = localState();
        const patch = buildSettingsImport(text, local) as { workspaces: WorkspaceConfig[] };
        const ids = patch.workspaces.map((w) => w.id);
        expect(ids).toContain(local.activeWorkspaceId);
        const active = patch.workspaces.find((w) => w.id === local.activeWorkspaceId)!;
        expect(active.isIsolated).toBe(true);
        expect(active.isolatedData).toEqual(LOCAL_ISO);
        expect(active.name).toBe('Renamed');
    });

    it('never imports isolatedData.pluginData, neither for unknown nor for known workspace ids (T-156)', () => {
        const withPlugins = file({
            workspaces: [
                { id: 'w1', name: 'Known', isolatedData: { pluginData: { aiHub: { apiKey: 'sk-crafted-1' } } } },
                {
                    id: 'wUnknown',
                    name: 'Unknown',
                    isIsolated: true,
                    isolatedData: {
                        notes: [{ id: 1, content: 'kept-note' }],
                        activeNoteId: 1,
                        pluginData: { aiHub: { apiKey: 'sk-crafted-2' } },
                    },
                },
            ],
        });
        const patch = buildSettingsImport(withPlugins, localState()) as { workspaces: WorkspaceConfig[] };
        expect(JSON.stringify(patch)).not.toContain('sk-crafted');
        const unknown = patch.workspaces.find((w) => w.id === 'wUnknown')!;
        expect(unknown.isolatedData?.notes?.[0].content).toBe('kept-note');
        expect(unknown.isolatedData?.activeNoteId).toBe(1);
        expect(unknown.isolatedData).not.toHaveProperty('pluginData');
        expect(patch.workspaces.find((w) => w.id === 'w1')!.isolatedData).toEqual(LOCAL_ISO);
    });

    it('an import without a workspaces block leaves workspaces out of the patch', () => {
        const patch = buildSettingsImport(file({ language: 'tr' }), localState()) as Record<string, unknown>;
        expect(patch).not.toHaveProperty('workspaces');
    });
});

describe('settings import: plugin enables in workspace records (T-418)', () => {
    // Switching to a workspace lays its record over the current set (T-409), so an imported record could enable a
    // plugin the user disabled here. Same rule as a backup restore (T-415): only approved plugins keep a true entry.
    const approved = new Set(['on-here']);
    const text = file({
        workspaces: [
            { id: 'w1', name: 'Known', enabledExtensions: { 'on-here': true, 'off-here': true, ghost: true, 'kept-off': false } },
            { id: 'wNew', name: 'New', enabledExtensions: { 'on-here': true, 'off-here': true, 'kept-off': false } },
        ],
    });
    const local = localState({
        workspaces: [
            { id: 'w1', name: 'Local', isIsolated: false, enabledExtensions: { ghost: false, 'off-here': true } },
            { id: 'w9', name: 'Other', isIsolated: false, enabledExtensions: { 'off-here': true } },
        ],
    });

    it('drops true entries of plugins that are not approved; a known workspace keeps its own entry for them', () => {
        const patch = buildSettingsImport(text, local, approved);
        const byId = (id: string) => patch.workspaces!.find((w) => w.id === id)!;
        expect(byId('w1').enabledExtensions).toEqual({ 'on-here': true, 'off-here': true, ghost: false, 'kept-off': false });
        // Unknown id: the entry is left out (never forced to false; the current value stays on a switch).
        expect(byId('wNew').enabledExtensions).toEqual({ 'on-here': true, 'kept-off': false });
        // Workspaces the file does not carry are untouched.
        expect(byId('w9')).toBe(local.workspaces[1]);
    });

    it('fails closed without an approved set: no imported true entry survives', () => {
        const patch = buildSettingsImport(text, local);
        const byId = (id: string) => patch.workspaces!.find((w) => w.id === id)!;
        expect(byId('w1').enabledExtensions).toEqual({ 'off-here': true, ghost: false, 'kept-off': false });
        expect(byId('wNew').enabledExtensions).toEqual({ 'kept-off': false });
    });

    it('does not mutate the local state', () => {
        buildSettingsImport(text, local, approved);
        expect(local.workspaces[0].enabledExtensions).toEqual({ ghost: false, 'off-here': true });
    });
});

describe('settings import: limits and errors', () => {
    it('ignores oversized arrays and strings', () => {
        const big = Array.from({ length: IMPORT_LIMITS.maxListItems + 1 }, (_, i) => `id-${i}`);
        const patch = buildSettingsImport(
            file({
                version: 23,
                featureOrder: big,
                language: 'de',
                workspaces: [{ id: 'w1', name: 'x'.repeat(IMPORT_LIMITS.maxShortString + 1) }],
            }),
            localState()
        );
        expect(patch).not.toHaveProperty('featureOrder');
        expect(patch.workspaces?.[0].name).toBe('Local iso');
    });

    it('caps the number of workspaces', () => {
        const many = Array.from({ length: IMPORT_LIMITS.maxWorkspaces + 50 }, (_, i) => ({ id: `n${i}` }));
        const patch = buildSettingsImport(file({ workspaces: many }), localState({ workspaces: [] }));
        expect(patch.workspaces).toHaveLength(IMPORT_LIMITS.maxWorkspaces);
    });

    it.each([
        ['invalid JSON', '{not json'],
        ['array root', '[1,2]'],
        ['null root', 'null'],
        ['no known keys', file({ notes: [], foo: 1 })],
        ['only invalid values', file({ theme: 42, language: 'xx' })],
        ['bad version', file({ version: 'abc', language: 'tr' })],
        ['negative version', file({ version: -1, language: 'tr' })],
        ['version only (migration would add defaults)', file({ version: 0 })],
        ['invalid color forms', file({ customThemeColor: '#12345' })],
    ])('rejects %s', (_name, text) => {
        expect(() => buildSettingsImport(text, localState())).toThrow(ImportError);
    });
});

describe('settings import: migrate pass-through', () => {
    it('a file without version is treated as v21 (v23 dedupes featureOrder)', () => {
        const patch = buildSettingsImport(file({ featureOrder: ['a', 'a', 'b'] }), localState());
        expect(patch.featureOrder).toEqual(['a', 'b']);
    });

    it('a current-version file is not migrated again', () => {
        const patch = buildSettingsImport(file({ version: KOBAR_STORAGE_VERSION, featureOrder: ['a', 'a'] }), localState());
        expect(patch.featureOrder).toEqual(['a', 'a']);
    });

    it('a newer-version file is not migrated', () => {
        const patch = buildSettingsImport(file({ version: 99, featureOrder: ['a', 'a'] }), localState());
        expect(patch.featureOrder).toEqual(['a', 'a']);
    });

    it('an old file runs the legacy blocks; fields they add stay out of the patch', () => {
        const patch = buildSettingsImport(file({ version: 0, featureOrder: ['colorpicker'] }), localState()) as Record<string, unknown>;
        expect(patch.featureOrder).toContain('kobar-colorpicker-plugin-btn');
        expect(patch.featureOrder).not.toContain('colorpicker');
        for (const key of ['globalNotes', 'tutorialState', 'toggleWidth', 'isAiHubEnabled', 'snippets'])
            expect(patch).not.toHaveProperty(key);
        // Keys the file did not carry stay out even if a legacy block creates them (default featureOrder at v<=6).
        const onlyLanguage = buildSettingsImport(file({ version: 0, language: 'fr' }), localState());
        expect(onlyLanguage).toEqual({ language: 'fr' });
    });

    it('accepts 3, 4, 6 and 8 digit hex colors only', () => {
        for (const c of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
            expect(buildSettingsImport(file({ customThemeColor: c }), localState()).customThemeColor).toBe(c);
        }
        for (const c of ['#abcde', '#aabbccd', 'red']) {
            expect(buildSettingsImport(file({ customThemeColor: c, language: 'tr' }), localState())).not.toHaveProperty('customThemeColor');
        }
    });

    it('export -> import round trip keeps local isolated notes', () => {
        const local = localState();
        const patch = buildSettingsImport(JSON.stringify(buildSettingsExport(local)), local);
        expect(patch.workspaces?.[0].isolatedData).toEqual(LOCAL_ISO);
        expect(patch.workspaces?.map((w) => w.id)).toEqual(['w1', 'w9']);
    });
});

describe('settings import: v26 appearance (T-601)', () => {
    it('an older file (no v26 keys) derives accent/material from its v1 fields; scheme is not imported', () => {
        const patch = buildSettingsImport(file({ version: 25, theme: 'lavender', design: 'style2', glassOpacity: 40 }), localState());
        expect(patch).toMatchObject({ theme: 'lavender', accent: 'violet', design: 'style2', glassOpacity: 40, material: 'translucent' });
        expect(patch).not.toHaveProperty('scheme');
    });

    it('a half pair takes the other half from the local state; the local forced colour is never applied', () => {
        const patch = buildSettingsImport(file({ version: 25, theme: 'custom' }), localState({ customThemeColor: '#aa22cc' }));
        expect(patch).toMatchObject({ theme: 'custom', accent: 'custom' });
        expect(patch).not.toHaveProperty('customThemeColor');
        const glass = buildSettingsImport(file({ version: 25, glassOpacity: 95 }), localState({ design: 'style2' }));
        expect(glass).toMatchObject({ glassOpacity: 95, material: 'solid' });
    });

    it('a v26 file carries scheme/accent/material as they are; foreign values are dropped', () => {
        const patch = buildSettingsImport(
            file({ version: 26, scheme: 'light', accent: 'green', material: 'solid', theme: 'emerald' }),
            localState()
        );
        expect(patch).toMatchObject({ scheme: 'light', accent: 'green', material: 'solid', theme: 'emerald' });
        const bad = buildSettingsImport(file({ version: 26, scheme: 'sepia', accent: 'teal', material: 2, language: 'tr' }), localState());
        for (const key of ['scheme', 'accent', 'material']) expect(bad).not.toHaveProperty(key);
    });

    it('workspace records of an older file get accent/material from their own fields', () => {
        const patch = buildSettingsImport(
            file({ version: 25, workspaces: [{ id: 'imp', name: 'Imported', theme: 'nord', design: 'style2', glassOpacity: 50 }] }),
            localState({ workspaces: [] })
        );
        expect(patch.workspaces?.find((w) => w.id === 'imp')).toMatchObject({ accent: 'graphite', material: 'translucent', theme: 'nord' });
    });

    it('a v26 backup slot created by this import is not carried into the local legacyBackup; a slot from the file is', () => {
        const fresh = buildSettingsImport(
            file({ version: 25, language: 'tr', teleportShortcut: 'Alt+K', legacyBackup: { imported: 1 } }),
            localState({ legacyBackup: { todos: ['local'] } })
        );
        expect(fresh.legacyBackup).toStrictEqual({ imported: 1, todos: ['local'] });
        const carried = buildSettingsImport(
            file({ version: 26, language: 'tr', legacyBackup: { appearanceV26: { top: { values: { scheme: 'x' } } } } }),
            localState({ legacyBackup: {} })
        );
        expect(carried.legacyBackup).toStrictEqual({ appearanceV26: { top: { values: { scheme: 'x' } } } });
    });

    it('exports the v26 keys and no teleportShortcut', () => {
        const out = buildSettingsExport({ ...localState(), scheme: 'dark', accent: 'red', material: 'solid', teleportShortcut: 'Alt+K' });
        expect(out).toMatchObject({ scheme: 'dark', accent: 'red', material: 'solid' });
        expect(out).not.toHaveProperty('teleportShortcut');
    });
});

describe('settings import: v27 density (T-602)', () => {
    it('an older file derives the density from its sidebarWidth; without a width no density is imported', () => {
        expect(buildSettingsImport(file({ version: 26, sidebarWidth: 40 }), localState())).toMatchObject({
            sidebarWidth: 40,
            density: 'compact',
        });
        expect(buildSettingsImport(file({ version: 26, sidebarWidth: 46 }), localState())).toMatchObject({ density: 'normal' });
        expect(buildSettingsImport(file({ version: 21, sidebarWidth: 64 }), localState())).toMatchObject({ density: 'comfortable' });
        expect(buildSettingsImport(file({ version: 26, language: 'tr' }), localState())).not.toHaveProperty('density');
    });

    it('a v27 file carries a density that matches the width; a disagreeing density follows the width; a foreign one is dropped', () => {
        const ok = buildSettingsImport(file({ version: 27, density: 'comfortable', sidebarWidth: 60 }), localState());
        expect(ok).toMatchObject({ density: 'comfortable', sidebarWidth: 60 });
        const patch = buildSettingsImport(file({ version: 27, density: 'comfortable', sidebarWidth: 46 }), localState());
        expect(patch).toMatchObject({ density: 'normal', sidebarWidth: 46 });
        // Only a density in the file: checked against the local width.
        expect(buildSettingsImport(file({ version: 27, density: 'compact' }), localState())).toMatchObject({ density: 'normal' });
        const local40 = localState({ sidebarWidth: 40 });
        expect(buildSettingsImport(file({ version: 27, density: 'compact' }), local40)).toMatchObject({ density: 'compact' });
        const bad = buildSettingsImport(file({ version: 27, density: 'cozy', language: 'tr' }), localState());
        expect(bad).not.toHaveProperty('density');
    });

    it('workspace records of an older file get their own density and read isPopupSmartPositioning as true', () => {
        const patch = buildSettingsImport(
            file({ version: 26, workspaces: [{ id: 'imp', name: 'Imported', sidebarWidth: 80, isPopupSmartPositioning: false }] }),
            localState({ workspaces: [] })
        );
        expect(patch.workspaces?.find((w) => w.id === 'imp')).toMatchObject({ density: 'comfortable', isPopupSmartPositioning: true });
    });

    it('a v27 backup slot created by this import is not carried into the local legacyBackup; a slot from the file is', () => {
        const fresh = buildSettingsImport(
            file({ version: 26, workspaces: [{ id: 'imp', name: 'I', isPopupSmartPositioning: false }], legacyBackup: { imported: 1 } }),
            localState({ legacyBackup: { todos: ['local'] }, workspaces: [] })
        );
        expect(fresh.legacyBackup).toStrictEqual({ imported: 1, todos: ['local'] });
        const carried = buildSettingsImport(
            file({ version: 27, language: 'tr', legacyBackup: { densityV27: { top: { values: { density: 'x' } } } } }),
            localState({ legacyBackup: {} })
        );
        expect(carried.legacyBackup).toStrictEqual({ densityV27: { top: { values: { density: 'x' } } } });
    });

    it('exports the density', () => {
        expect(buildSettingsExport({ ...localState(), density: 'compact' })).toMatchObject({ density: 'compact' });
    });
});

describe('settings import: v28 pseudo-notes (T-603)', () => {
    const fake = { id: 1, title: 'Settings', icon: 'settings', emoji: null, content: '', isSettings: true };
    const real = { id: 2, title: 'Plugins', icon: 'extension', emoji: null, content: '<p>real</p>' };
    const isoFile = (version: number, extra: Record<string, unknown> = {}) =>
        file({
            version,
            ...extra,
            workspaces: [{ id: 'imp', name: 'I', isolatedData: { notes: [fake, real], activeNoteId: 1, nextNoteId: 3 } }],
        });

    it('an older file loses the pseudo-notes of a new workspace; real notes (even look-alikes) stay', () => {
        const patch = buildSettingsImport(isoFile(27), localState({ workspaces: [] }));
        expect(patch.workspaces?.find((w) => w.id === 'imp')?.isolatedData).toStrictEqual({
            notes: [real],
            activeNoteId: 2,
            nextNoteId: 3,
        });
    });

    it('a v28 backup slot created by this import is not carried into the local legacyBackup; a slot from the file is', () => {
        const fresh = buildSettingsImport(
            isoFile(27, { legacyBackup: { imported: 1 } }),
            localState({ legacyBackup: { todos: ['local'] }, workspaces: [] })
        );
        expect(fresh.legacyBackup).toStrictEqual({ imported: 1, todos: ['local'] });
        const carried = buildSettingsImport(
            file({ version: 28, language: 'tr', legacyBackup: { fakeNotesV28: { top: { removed: [] } } } }),
            localState({ legacyBackup: {} })
        );
        expect(carried.legacyBackup).toStrictEqual({ fakeNotesV28: { top: { removed: [] } } });
    });
});

describe('settings import/export: v29 onboarding is device-level (T-604)', () => {
    const pending = { status: 'pending', version: 1 };
    const tutorial = { version: '1.0.0', status: 'snoozed', snoozeUntil: 1 };

    it('an export never carries onboarding or tutorialState', () => {
        const out = buildSettingsExport({ ...localState(), onboarding: { status: 'completed', version: 1 }, tutorialState: tutorial });
        expect(out).not.toHaveProperty('onboarding');
        expect(out).not.toHaveProperty('tutorialState');
        expect(SETTINGS_KEYS).not.toContain('onboarding');
    });

    it('an import (older or current file) never sets onboarding or tutorialState and adds no v29 backup slot', () => {
        for (const version of [21, 28, KOBAR_STORAGE_VERSION]) {
            const patch = buildSettingsImport(
                file({ version, language: 'tr', onboarding: pending, tutorialState: tutorial, legacyBackup: { imported: 1 } }),
                localState({ legacyBackup: { todos: ['local'] } })
            );
            expect(patch).not.toHaveProperty('onboarding');
            expect(patch).not.toHaveProperty('tutorialState');
            expect(patch.legacyBackup).toStrictEqual({ imported: 1, todos: ['local'] });
            expect(patch.language).toBe('tr');
        }
    });

    it('a v29 backup slot the file already had is carried', () => {
        const slot = { added: true, tutorialState: tutorial };
        const patch = buildSettingsImport(
            file({ version: 29, language: 'tr', legacyBackup: { onboardingV29: slot } }),
            localState({ legacyBackup: {} })
        );
        expect(patch.legacyBackup).toStrictEqual({ onboardingV29: slot });
    });
});

describe('data import parsing', () => {
    it('keeps valid notes, strips ids/flags/extra fields, drops system tabs and invalid entries', () => {
        const notes = parseDataImport(
            file({
                notes: [
                    { id: 7, title: 'A', icon: 'note', emoji: null, content: '<p>a</p>', isSettings: false, onclick: 'x' },
                    { id: 8, title: 'Settings', isSettings: true, content: '' },
                    { id: 9, title: 'Plugins', isPlugins: true, content: '' },
                    { id: 10, title: 'Welcome to KoBar!', content: '' },
                    { title: 'wrong content', content: 42 },
                    { title: 'too big', content: 'x'.repeat(IMPORT_LIMITS.maxNoteContent + 1) },
                    { content: 'no title', icon: 12 },
                    'garbage',
                    null,
                ],
            })
        );
        expect(notes).toEqual([
            { title: 'A', icon: 'note', emoji: null, content: '<p>a</p>' },
            { title: '', icon: 'note', emoji: null, content: 'no title' },
        ]);
    });

    it.each([
        ['no notes array', file({ foo: [] })],
        ['too many notes', file({ notes: Array.from({ length: IMPORT_LIMITS.maxNotes + 1 }, () => ({ content: '' })) })],
        ['invalid JSON', '{'],
        ['notes but none valid', file({ notes: [{ content: 42 }, 'garbage'] })],
    ])('rejects %s', (_name, text) => {
        expect(() => parseDataImport(text)).toThrow(ImportError);
    });
});
