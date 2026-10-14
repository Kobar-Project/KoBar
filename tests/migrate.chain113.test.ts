import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KOBAR_STORAGE_VERSION, migrateKobarStorage } from '../src/store/migrations';

// T-629: chain check for the 1.1.3-era persisted state (kobar-storage v21) up to the current version.
// The fixture is the synthetic tests/fixtures/kobar-storage/v21.json; 1.1.3 also wrote Settings/Plugins pseudo-notes
// into the notes lists, so two are injected here (the shape v28 removes). Per-block details: tests/migrate.v2*.test.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type S = Record<string, any>;

function load(): S {
    const path = fileURLToPath(new URL('./fixtures/kobar-storage/v21.json', import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as S;
}

describe('1.1.3 (v21) -> current chain', () => {
    it('reaches the current version and keeps notes, settings, plugin data and workspaces', () => {
        const fixture = load();
        const before = structuredClone(fixture.state) as S;
        const input = structuredClone(fixture.state) as S;
        input.notes.push({ id: 3, title: 'Settings', icon: 'settings', emoji: null, content: '', isSettings: true });
        input.notes.push({ id: 4, title: 'Plugins', icon: 'extension', emoji: null, content: '', isPlugins: true });
        input.nextNoteId = 5;

        expect(KOBAR_STORAGE_VERSION).toBe(32);
        const out = migrateKobarStorage(input, fixture.version) as S;

        // Real notes survive unchanged, pseudo-notes are gone.
        expect(out.notes).toStrictEqual(before.notes);
        expect(out.globalNotes).toStrictEqual(before.globalNotes);
        // Settings and plugin data.
        expect(out.language).toBe(before.language);
        expect(out.featureOrder).toStrictEqual(before.featureOrder);
        expect(out.globalPluginData).toStrictEqual(before.globalPluginData);
        expect(out.currentExtensionsConfig).toStrictEqual(before.currentExtensionsConfig);
        expect(out.notePanelWidth).toBe(before.notePanelWidth);
        expect(out.launchAtStartup).toBe(before.launchAtStartup);
        // Workspaces: ids, names, isolation and isolated notes kept.
        expect(out.workspaces.map((w: S) => [w.id, w.name, w.isIsolated])).toStrictEqual(
            before.workspaces.map((w: S) => [w.id, w.name, w.isIsolated])
        );
        expect(out.workspaces[0].isolatedData.notes).toStrictEqual(before.workspaces[0].isolatedData.notes);
        expect(out.activeWorkspaceId).toBe(before.activeWorkspaceId);
        // Existing user: no first-run onboarding.
        expect(out.onboarding.status).toBe('completed');
        expect(out.legacyBackup).toBeTypeOf('object');
    });
});
