import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateFullBackupText } from '../../electron/lib/fullBackup.cjs';
import { buildBackup, serializeBackup } from '../../src/backup/buildBackup';
import { snapshotLocalStorage, withAppStoreValue } from '../../src/backup/exportBackup';
import { HOST_INTERNAL_KEYS } from '../../src/backup/keyPolicy';
import { parseBackup } from '../../src/backup/parseBackup';
import { migrateKobarStorage } from '../../src/store/migrations';
import { createStorageClient } from '../../src/storage/client';
import { createFileBackedStorage } from '../../src/storage/fileBackedStorage';
import { type FileStoreHarness, createFileStoreHarness } from '../helpers/fileStoreHarness';
import {
    BASE_PROFILE_VERSION,
    KOBAR_STORAGE_VERSION,
    LATEST_PROFILE_VERSION,
    MIGRATION_STEPS,
    type MigrationStep,
    loadProfileFixture,
    migrateProfileToLatest,
    type Profile,
} from './runChain';

// T-013: chain tests. Per-version migrate details live in tests/migrate.test.ts; here we only
// check the chain contract (latest state in one call, no data loss, contiguous steps).

// Persisted blob is untyped legacy state, so `state` is loose on purpose.
const persisted = (p: Profile) => JSON.parse(p.localStorage['kobar-storage']) as { state: Record<string, unknown>; version: number };

describe('profile fixture chain', () => {
    const v21 = loadProfileFixture(21);

    it('v21 fixture has the expected synthetic shape', () => {
        expect(persisted(v21).version).toBe(21);
        expect(Object.keys(v21.localStorage).some((k) => k.includes('_iso_'))).toBe(true);
        expect(Object.keys(v21.userData)).toEqual(
            expect.arrayContaining([
                'kobar-system.json',
                'window-state.json',
                'extensions-config.json',
                'extensions/fake-plugin/manifest.json',
                'KoBox/example.txt',
            ]),
        );
    });

    it('v21 reaches the latest state in one call', () => {
        const out = migrateProfileToLatest(v21);
        expect(out.version).toBe(LATEST_PROFILE_VERSION);
        expect(persisted(out).version).toBe(KOBAR_STORAGE_VERSION);
    });

    it('v21 -> v22/v23/v24/v25/v26/v27/v28/v29 (T-205, T-027, T-408, T-409, T-601, T-602, T-603, T-604): adds the three layout settings (active workspace has none -> defaults), keeps notes', () => {
        const out = persisted(migrateProfileToLatest(v21));
        const before = persisted(v21);
        expect(out.version).toBe(KOBAR_STORAGE_VERSION);
        expect(out.version).toBe(32);
        expect(out.state.toggleWidth).toBe(22);
        expect(out.state.featureSpacing).toBe(8);
        // v27 (T-602): readable as true; the v22 default false is backed up (top level and the active record).
        expect(out.state.isPopupSmartPositioning).toBe(true);
        expect(out.state.notes).toStrictEqual(before.state.notes);
        expect(out.state.globalNotes).toStrictEqual(before.state.globalNotes);
        // v24: only the active workspace record's profile copy changes; ids, names, isolation and isolated data stay.
        type Ws = Record<string, unknown>;
        const keep = (list: Ws[]) => list.map((w) => ({ id: w.id, name: w.name, isIsolated: w.isIsolated, isolatedData: w.isolatedData }));
        expect(keep(out.state.workspaces as Ws[])).toStrictEqual(keep(before.state.workspaces as Ws[]));
        // v26: every record gets accent/material (ws-shared has no v1 appearance fields -> the defaults amber/solid).
        // v27: every record gets density (sidebarWidth 64 > 52 -> comfortable); ws-shared has no isPopupSmartPositioning
        // and none is added.
        expect((out.state.workspaces as Ws[])[1]).toStrictEqual({
            ...(before.state.workspaces as Ws[])[1],
            accent: 'amber',
            material: 'solid',
            density: 'comfortable',
        });
        expect((out.state.workspaces as Ws[])[0]).toMatchObject({
            theme: before.state.theme,
            toggleWidth: 22,
            featureSpacing: 8,
            density: 'comfortable',
            isPopupSmartPositioning: true,
        });
        const { workspaces: outWs, legacyBackup, ...outRest } = out.state;
        const { workspaces: beforeWs, ...beforeRest } = before.state;
        expect(outWs).toHaveLength((beforeWs as Ws[]).length);
        expect(legacyBackup).toHaveProperty('workspaceModelV24');
        // v26 (T-601): existing user -> dark; custom #aa22cc -> custom accent; design 'glass' (not style2) -> solid;
        // the dead teleportShortcut is dropped and its raw value kept in the backup.
        const { teleportShortcut, settingsWorkspaceViewMode: viewModeV30, ...beforeKept } = beforeRest;
        // v30 (T-615d): the dead settingsWorkspaceViewMode is deleted and its raw value kept in the backup.
        expect(legacyBackup).toHaveProperty('cleanupV30', { settingsWorkspaceViewMode: viewModeV30 });
        expect(teleportShortcut).toBe('Alt+K');
        expect(legacyBackup).toHaveProperty('appearanceV26', { top: { values: { teleportShortcut: 'Alt+K' } } });
        expect(legacyBackup).toHaveProperty('densityV27', {
            top: { values: { isPopupSmartPositioning: false } },
            workspaces: [{ index: 0, id: 'ws-focus', values: { isPopupSmartPositioning: false } }],
        });
        // v29 (T-604): an existing user (tutorial snoozed) is onboarded; tutorialState stays and is copied into the backup.
        expect(legacyBackup).toHaveProperty('onboardingV29', { added: true, tutorialState: before.state.tutorialState });
        expect(outRest).toStrictEqual({
            ...beforeKept,
            toggleWidth: 22,
            featureSpacing: 8,
            isPopupSmartPositioning: true,
            scheme: 'dark',
            accent: 'custom',
            material: 'solid',
            density: 'comfortable',
            onboarding: { status: 'completed', version: 1, migrated: true },
        });
        expect((out.state.workspaces as Ws[])[0]).toMatchObject({ accent: 'custom', material: 'solid', customThemeColor: '#aa22cc' });
    });

    it('v22 fixture through the chain (T-027): legacyBackup holds the values, duplicates are gone, version is latest', () => {
        const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/kobar-storage/v22.json', import.meta.url)), 'utf8'));
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const { state, version } = persisted(migrateProfileToLatest(old));
        expect(version).toBe(KOBAR_STORAGE_VERSION);
        const { workspaceModelV24, appearanceV26, densityV27, onboardingV29, cleanupV30, ...legacyBackup } = state.legacyBackup as Record<string, unknown>;
        expect(workspaceModelV24).toBeDefined(); // T-408 slot, see tests/migrate.v24.test.ts
        expect(appearanceV26).toBeDefined(); // T-601 slot (teleportShortcut), see tests/migrate.v26.test.ts
        expect(densityV27).toBeDefined(); // T-602 slot (isPopupSmartPositioning), see tests/migrate.v27.test.ts
        expect(onboardingV29).toBeDefined(); // T-604 slot (tutorialState copy), see tests/migrate.v29.test.ts
        expect(cleanupV30).toStrictEqual({ settingsWorkspaceViewMode: raw.state.settingsWorkspaceViewMode }); // T-615d, see tests/migrate.v30.test.ts
        expect(legacyBackup).toStrictEqual({
            todos: raw.state.todos, isTodoListEnabled: true, isColorPickerEnabled: false,
            colorPalettes: raw.state.colorPalettes, currentColor: '#336699',
        });
        expect(state).not.toHaveProperty('todos');
        expect(state.featureOrder).toEqual(['com.kobar.aihub.btn', 'copypaste', 'kobox', 'fixture.plugin-btn']);
        expect((state.workspaces as { featureOrder: string[] }[])[1].featureOrder).toEqual(['calculator', 'kobox']);
    });

    it('v27 fake-notes fixture through the chain (T-603): pseudo-notes leave every note list, real notes and the backup stay', () => {
        const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/kobar-storage/v27-fake-notes.json', import.meta.url)), 'utf8'));
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const out = migrateProfileToLatest(old);
        const { state, version } = persisted(out);
        expect(version).toBe(KOBAR_STORAGE_VERSION);
        type Note = { id: unknown; isSettings?: unknown; isPlugins?: unknown } | null;
        type Ws = { id: string; isolatedData?: { notes?: Note[]; activeNoteId?: unknown } };
        const ids = (notes: unknown) => (notes as Note[]).map((n) => (n === null ? null : n.id));
        expect(ids(state.notes)).toStrictEqual([1, 3, 5, null]);
        expect(state.activeNoteId).toBe(1);
        expect(ids(state.globalNotes)).toStrictEqual([1]);
        const workspaces = state.workspaces as Ws[];
        expect(ids(workspaces[0].isolatedData?.notes)).toStrictEqual([2]);
        expect(workspaces[0].isolatedData?.activeNoteId).toBe(2);
        expect(workspaces[2].isolatedData?.notes).toStrictEqual([]);
        expect(workspaces[3].isolatedData).toStrictEqual(raw.state.workspaces[3].isolatedData);
        const backup = (state.legacyBackup as Record<string, { top: { removed: unknown[] } }>).fakeNotesV28;
        expect(backup.top.removed).toHaveLength(2);
        expect((state.legacyBackup as Record<string, unknown>).densityV27).toStrictEqual(raw.state.legacyBackup.densityV27);
        // Everything but the note lists, their activeNoteId, the new backup slots and the v29 `onboarding` is unchanged.
        const omit = (s: Record<string, unknown>) =>
            Object.fromEntries(
                Object.entries(s).filter(([k]) => !['notes', 'globalNotes', 'activeNoteId', 'legacyBackup', 'workspaces', 'onboarding', 'settingsWorkspaceViewMode'].includes(k))
            );
        expect(omit(state)).toStrictEqual(omit(raw.state));
        expect(migrateProfileToLatest(out)).toStrictEqual(out);
    });

    it('v28 onboarding fixture through the chain (T-604): an existing user is onboarded, tutorialState and everything else stay', () => {
        const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/kobar-storage/v28-onboarding.json', import.meta.url)), 'utf8'));
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const out = migrateProfileToLatest(old);
        const { state, version } = persisted(out);
        expect(version).toBe(KOBAR_STORAGE_VERSION);
        expect(state.onboarding).toStrictEqual({ status: 'completed', version: 1, migrated: true });
        expect(state.tutorialState).toStrictEqual(raw.state.tutorialState);
        const { onboardingV29, cleanupV30, ...olderSlots } = state.legacyBackup as Record<string, unknown>;
        expect(onboardingV29).toStrictEqual({ added: true, tutorialState: raw.state.tutorialState });
        expect(cleanupV30).toStrictEqual({ settingsWorkspaceViewMode: raw.state.settingsWorkspaceViewMode });
        expect(olderSlots).toStrictEqual(raw.state.legacyBackup);
        const omit = (s: Record<string, unknown>) =>
            Object.fromEntries(Object.entries(s).filter(([k]) => !['onboarding', 'legacyBackup', 'settingsWorkspaceViewMode'].includes(k)));
        expect(omit(state)).toStrictEqual(omit(raw.state));
        expect(migrateProfileToLatest(out)).toStrictEqual(out);
    });

    it('v21 end state matches the expected snapshot', () => {
        expect(persisted(migrateProfileToLatest(v21))).toMatchSnapshot();
    });

    it.each([
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
    ])('kobar-storage fixture %s migrates through the chain to the latest version with the v22 keys', (name) => {
        const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kobar-storage/${name}`, import.meta.url)), 'utf8'));
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const out = migrateProfileToLatest(old);
        const { state, version } = persisted(out);
        expect(version).toBe(KOBAR_STORAGE_VERSION);
        expect(state).toStrictEqual(JSON.parse(JSON.stringify(migrateKobarStorage(structuredClone(raw.state), raw.version))));
        expect(typeof state.toggleWidth).toBe('number');
        expect(typeof state.featureSpacing).toBe('number');
        expect(typeof state.isPopupSmartPositioning).toBe('boolean');
        expect(migrateProfileToLatest(out)).toStrictEqual(out);
    });

    it('an old kobar-storage (v5) also reaches the latest state in one call', () => {
        const raw = JSON.parse(
            readFileSync(fileURLToPath(new URL('../fixtures/kobar-storage/v5.json', import.meta.url)), 'utf8'),
        );
        // Profile version stays at the baseline: the chain counter starts at 21 for every user,
        // only the kobar-storage blob is old.
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const out = migrateProfileToLatest(old);
        expect(out.version).toBe(LATEST_PROFILE_VERSION);
        expect(persisted(out).version).toBe(KOBAR_STORAGE_VERSION);
        expect(persisted(out).state.globalNotes).toBeDefined();
        expect(migrateProfileToLatest(out)).toStrictEqual(out);
    });

    it('never deletes localStorage keys and keeps non-persist values byte-identical', () => {
        const out = migrateProfileToLatest(v21);
        for (const key of Object.keys(v21.localStorage)) {
            expect(out.localStorage).toHaveProperty(key);
            if (key !== 'kobar-storage') expect(out.localStorage[key]).toBe(v21.localStorage[key]);
        }
    });

    it('leaves userData files and KoBox untouched today', () => {
        expect(migrateProfileToLatest(v21).userData).toStrictEqual(v21.userData);
    });

    it('does not mutate its input and is idempotent', () => {
        const snapshot = structuredClone(v21);
        const once = migrateProfileToLatest(v21);
        expect(v21).toStrictEqual(snapshot);
        expect(migrateProfileToLatest(once)).toStrictEqual(once);
    });

    it('step list is contiguous, starts at BASE and ends at LATEST_PROFILE_VERSION (may be empty)', () => {
        for (const [i, step] of MIGRATION_STEPS.entries()) {
            expect(step.to).toBeGreaterThan(step.from);
            if (i > 0) expect(step.from).toBe(MIGRATION_STEPS[i - 1].to);
        }
        if (MIGRATION_STEPS.length === 0) {
            expect(LATEST_PROFILE_VERSION).toBe(BASE_PROFILE_VERSION);
        } else {
            expect(MIGRATION_STEPS[0].from).toBe(BASE_PROFILE_VERSION);
            expect(MIGRATION_STEPS[MIGRATION_STEPS.length - 1].to).toBe(LATEST_PROFILE_VERSION);
        }
        expect(v21.version).toBe(BASE_PROFILE_VERSION);
    });
});

// Executable version of the README procedure: a simulated future release that ships BOTH a
// kobar-storage bump (21 -> 22) and a userData-only step (profile 21 -> 22), injected via options.
describe('profile fixture chain: simulated future migrations', () => {
    const v21 = loadProfileFixture(21);

    // kobar-storage-only change: new migrate branch + bumped version, no step.
    const NEXT_STORAGE_VERSION = KOBAR_STORAGE_VERSION + 1;
    const nextMigrate = (state: unknown, version: number) => {
        const s = migrateKobarStorage(state, version) as Record<string, unknown>;
        if (version <= KOBAR_STORAGE_VERSION) s.simulatedField = 'added-in-next';
        return s;
    };

    // userData-only step: backs up window-state.json, then rewrites it. Touches no localStorage.
    const windowStateStep: MigrationStep = {
        from: BASE_PROFILE_VERSION,
        to: BASE_PROFILE_VERSION + 1,
        name: 'simulated window-state rewrite',
        apply(profile) {
            const current = profile.userData['window-state.json'];
            const parsed = JSON.parse(current) as Record<string, unknown>;
            return {
                ...profile,
                userData: {
                    ...profile.userData,
                    'window-state.json.bak': current,
                    'window-state.json': JSON.stringify({ ...parsed, simulated: true }),
                },
            };
        },
    };

    it('a kobar-storage-only bump is picked up for a v21 profile without any step', () => {
        const out = migrateProfileToLatest(v21, { kobarStorageVersion: NEXT_STORAGE_VERSION, migrate: nextMigrate });
        expect(out.version).toBe(BASE_PROFILE_VERSION);
        expect(persisted(out).version).toBe(NEXT_STORAGE_VERSION);
        expect(persisted(out).state.simulatedField).toBe('added-in-next');
        expect(persisted(out).state.notes).toStrictEqual(persisted(v21).state.notes);
        expect(out.userData).toStrictEqual(v21.userData);
    });

    it('a userData-only step runs and bumps only the profile version', () => {
        const out = migrateProfileToLatest(v21, { steps: [windowStateStep] });
        expect(out.version).toBe(BASE_PROFILE_VERSION + 1);
        // The step touches no localStorage: only the always-on kobar-storage migration (v21 -> v22 since T-205) differs.
        expect(out.localStorage).toStrictEqual(migrateProfileToLatest(v21).localStorage);
        expect(out.userData['window-state.json.bak']).toBe(v21.userData['window-state.json']);
        expect(JSON.parse(out.userData['window-state.json'])).toMatchObject({ simulated: true });
    });

    it('both together: v21 and an old v5 blob reach the simulated latest in one call, idempotently', () => {
        const options = { steps: [windowStateStep], kobarStorageVersion: NEXT_STORAGE_VERSION, migrate: nextMigrate };
        const raw = JSON.parse(
            readFileSync(fileURLToPath(new URL('../fixtures/kobar-storage/v5.json', import.meta.url)), 'utf8'),
        );
        const v5blob: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        for (const input of [v21, v5blob]) {
            const snapshot = structuredClone(input);
            const out = migrateProfileToLatest(input, options);
            expect(input).toStrictEqual(snapshot);
            expect(out.version).toBe(BASE_PROFILE_VERSION + 1);
            expect(persisted(out).version).toBe(NEXT_STORAGE_VERSION);
            expect(persisted(out).state.simulatedField).toBe('added-in-next');
            expect(persisted(out).state.globalNotes).toBeDefined();
            expect(out.userData['window-state.json.bak']).toBe(v21.userData['window-state.json']);
            expect(migrateProfileToLatest(out, options)).toStrictEqual(out);
        }
    });
});

// T-405: the chain end state through the file backend. Each fixture is carried to the latest version by the chain, written by
// the persist base (src/storage/fileBackedStorage.ts) through the real client, preload bridge, storage IPC and StorageService
// (temp dir), and read back after a simulated restart: the file holds the byte-identical string and localStorage (dual-write)
// holds the same bytes.
describe('profile fixture chain: through the file backend (T-405)', () => {
    const v21 = loadProfileFixture(21);
    let harness: FileStoreHarness;

    beforeEach(() => {
        harness = createFileStoreHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    function backendFor(local: Map<string, string>) {
        const client = createStorageClient(harness.bridge().claim());
        return createFileBackedStorage({
            client,
            getLocal: () => ({
                getItem: (k: string) => local.get(k) ?? null,
                setItem: (k: string, v: string) => void local.set(k, v),
                removeItem: (k: string) => void local.delete(k),
            }),
            log: () => {},
        });
    }

    it.each([
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
    ])('%s: chain end state written to the file and read back byte-identically', async (name) => {
        const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/kobar-storage/${name}`, import.meta.url)), 'utf8'));
        const old: Profile = { ...v21, localStorage: { ...v21.localStorage, 'kobar-storage': JSON.stringify(raw) } };
        const latest = migrateProfileToLatest(old).localStorage['kobar-storage'];

        // First start: no file yet, the old blob comes from localStorage; the migrated string is written to both.
        const local = new Map(Object.entries(old.localStorage));
        const first = backendFor(local);
        expect(first.getItem('kobar-storage')).toBe(JSON.stringify(raw));
        first.releaseFileWrites();
        first.setItem('kobar-storage', latest);
        await first.whenIdle();
        await harness.drain();
        expect(harness.readHost()?.value).toBe(latest);
        expect(local.get('kobar-storage')).toBe(latest);
        // Non-persist keys are never touched.
        for (const key of Object.keys(old.localStorage)) if (key !== 'kobar-storage') expect(local.get(key)).toBe(old.localStorage[key]);

        // Restart without the localStorage copy: the file alone carries the latest state, and the chain is a no-op on it.
        harness.restart();
        local.delete('kobar-storage');
        const second = backendFor(local);
        const reread = second.getItem('kobar-storage');
        expect(second.hydration()).toMatchObject({ source: 'file' });
        expect(reread).toBe(latest);
        const again = migrateProfileToLatest({ ...old, localStorage: { ...old.localStorage, 'kobar-storage': reread as string } });
        expect(again.localStorage['kobar-storage']).toBe(latest);
    });
});

// T-412: 1.1.3 -> 1.3.0 end to end with a full backup. A 1.1.3 profile (v21) is carried to the latest state, written to the
// file store, and the next start finds the value only in the file (localStorage lost it). The full backup must carry the file
// value (not the localStorage one), never the host-internal side key, keep the schema v1 envelope, and a restore of it must
// land on the latest version without another migration.
describe('profile fixture chain: 1.1.3 -> 1.3.0 with a full backup (T-412)', () => {
    const v21 = loadProfileFixture(21);
    let harness: FileStoreHarness;

    beforeEach(() => {
        harness = createFileStoreHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    it('backs up the file store value, restores it to the latest version and keeps localStorage and userData intact', async () => {
        const latest = migrateProfileToLatest(v21).localStorage['kobar-storage'];
        const local = new Map(Object.entries(v21.localStorage));
        const localStore = {
            getItem: (k: string) => local.get(k) ?? null,
            setItem: (k: string, v: string) => void local.set(k, v),
            removeItem: (k: string) => void local.delete(k),
        };
        const first = createFileBackedStorage({
            client: createStorageClient(harness.bridge().claim()),
            getLocal: () => localStore,
            log: () => {},
        });
        first.releaseFileWrites();
        first.setItem('kobar-storage', latest);
        await first.whenIdle();
        await harness.drain();

        // Next start (1.3.0): localStorage lost the value, the file alone has it; a stale side key is present.
        harness.restart();
        local.delete('kobar-storage');
        local.set(HOST_INTERNAL_KEYS[0], 'stale-side-key');
        const second = createFileBackedStorage({
            client: createStorageClient(harness.bridge().claim()),
            getLocal: () => localStore,
            log: () => {},
        });
        const appStore = second.getItem('kobar-storage');
        expect(second.hydration()).toMatchObject({ source: 'file' });
        const reader = {
            get length() {
                return local.size;
            },
            key: (i: number) => [...local.keys()][i] ?? null,
            getItem: localStore.getItem,
        };
        const snapshot = withAppStoreValue(snapshotLocalStorage(reader), appStore);
        const backup = buildBackup({
            localStorage: snapshot,
            extensionsConfig: JSON.parse(v21.userData['extensions-config.json']),
            plugins: [{ id: 'fake-plugin', folder: 'fake-plugin', name: 'Fake Plugin', version: '0.0.0', enabled: true, githubRepo: '' }],
            appVersion: '1.3.0',
            now: new Date('2026-10-12T00:00:00.000Z'),
        });
        const text = serializeBackup(backup);
        expect(backup.schemaVersion).toBe(1);
        expect(backup.localStorage['kobar-storage']).toBe(latest);
        expect(backup.localStorage).not.toHaveProperty(HOST_INTERNAL_KEYS[0]);
        expect(validateFullBackupText(text)).toEqual({ ok: true });

        const parsed = parseBackup(text, { installedPluginIds: ['fake-plugin'], currentAppVersion: '1.3.0' });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const keys = parsed.plan.entries.map((e) => e.key).sort();
        expect(keys).toEqual(['fake-plugin-data', 'fake-plugin-data_iso_ws-focus', 'kobar-chat-storage', 'kobar-storage']);
        const restoredStore = parsed.plan.entries.find((e) => e.key === 'kobar-storage')!.value;
        const restored = JSON.parse(restoredStore) as { state: Record<string, unknown>; version: number };
        const expected = JSON.parse(latest) as { state: Record<string, unknown>; version: number };
        expect(restored.version).toBe(KOBAR_STORAGE_VERSION);
        expect(restored.state.notes).toStrictEqual(expected.state.notes);
        expect(restored.state.globalNotes).toStrictEqual(expected.state.globalNotes);
        // Workspace identity, isolation and isolated data survive; invalid profile values of the synthetic fixture (and the
        // plugin flags, T-213) are dropped by the restore validation and reported, as in 1.2.0.
        type Ws = Record<string, unknown>;
        const identity = (list: unknown) => (list as Ws[]).map((w) => [w.id, w.name, w.isIsolated, w.isolatedData]);
        expect(identity(restored.state.workspaces)).toStrictEqual(identity(expected.state.workspaces));
        expect(parsed.preview.counts.droppedNotes).toBe(0);

        // A restored profile is already at the latest version: the chain is a no-op on it.
        const restoredProfile: Profile = {
            ...v21,
            localStorage: { ...v21.localStorage, ...Object.fromEntries(parsed.plan.entries.map((e) => [e.key, e.value])) },
        };
        expect(migrateProfileToLatest(restoredProfile)).toStrictEqual(restoredProfile);
        expect(restoredProfile.userData).toStrictEqual(v21.userData);
        // Backing up never changed the file or the other localStorage keys.
        expect(harness.readHost()?.value).toBe(latest);
        for (const key of Object.keys(v21.localStorage)) if (key !== 'kobar-storage') expect(local.get(key)).toBe(v21.localStorage[key]);
    });
});
