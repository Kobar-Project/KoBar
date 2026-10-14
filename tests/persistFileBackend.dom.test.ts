// T-405: the `kobar-storage` persist store on the file backend, end to end: the real store (fresh module graph per "app
// start"), the real storage client + preload bridge, and a real StorageService + storage IPC on a temp dir
// (tests/helpers/fileStoreHarness.ts). Synthetic fixtures only; never touches a real profile and never launches Electron.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';
import { FILE_NEWER_MARKER, PERSIST_META_KEY } from '../src/storage/fileBackedStorage';
import { KOBAR_STORAGE_VERSION } from './chain/runChain';
import { type FileStoreHarness, OTHER_WINDOW, createFileStoreHarness } from './helpers/fileStoreHarness';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

type PersistModule = typeof import('../src/store/persistStorage');
type StoreModule = typeof import('../src/store/useAppStore');

const KEY = 'kobar-storage';
const FIXTURES = [
    'v0.json',
    'v5.json',
    'v12.json',
    'v18.json',
    'v20.json',
    'v21.json',
    'v21-ws-duplicate-ids.json',
    'v21-no-active-workspace.json',
    'v22.json',
];

let harness: FileStoreHarness;
const loaded: PersistModule[] = [];

function fixture(name: string): { state: Record<string, unknown>; version: number } {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/kobar-storage', name), 'utf8'));
}

/** A current-version persist string (the v21 fixture migrated), optionally with an override. */
function currentValue(overrides: Record<string, unknown> = {}): string {
    const v21 = fixture('v21.json');
    const state = { ...(migrateKobarStorage(structuredClone(v21.state), v21.version) as Record<string, unknown>), ...overrides };
    return JSON.stringify({ state, version: KOBAR_STORAGE_VERSION });
}

/** One app start: the preload bridge reads its boot snapshot, then the store module hydrates. */
async function boot(sender?: number): Promise<{ store: StoreModule; persist: PersistModule }> {
    (globalThis as { __kobarStorage?: unknown }).__kobarStorage = harness.bridge(sender);
    vi.resetModules();
    const store = await import('../src/store/useAppStore');
    const persist = await import('../src/store/persistStorage');
    loaded.push(persist);
    return { store, persist };
}

/** Flush + wait until every file write is acked and renamed into place (what quit does). */
async function settle(persist: PersistModule): Promise<void> {
    persist.flushAppPersist();
    await persist.appPersistBackend.whenIdle();
    await harness.drain();
}

function persistedState(store: StoreModule): unknown {
    const partialize = store.useAppStore.persist.getOptions().partialize!;
    return JSON.parse(JSON.stringify(partialize(store.useAppStore.getState())));
}

beforeEach(() => {
    harness = createFileStoreHarness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    for (const persist of loaded.splice(0)) persist.appPersistStorage.lockWrites('test-teardown');
    delete (globalThis as { __kobarStorage?: unknown }).__kobarStorage;
    harness.cleanup();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('first start on the file backend (no file yet)', () => {
    it('hydrates from localStorage, writes nothing before hydration and creates the file with the byte-identical string', async () => {
        const data = fixture('v22.json');
        localStorage.setItem(KEY, JSON.stringify(data));
        const before = localStorage.getItem(KEY);

        const { store, persist } = await boot();
        expect(store.useAppStore.persist.hasHydrated()).toBe(true);
        expect(store.useAppStore.getState().isHydrated).toBe(true);
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'no-file' });
        // Nothing was written while the store was created and migrated (T-201 lock), neither to main nor to localStorage.
        expect(harness.writes).toHaveLength(0);
        expect(localStorage.getItem(KEY)).toBe(before);
        expect(fs.existsSync(harness.hostFile())).toBe(false);

        // The T-404 archive has not run yet: localStorage is written, the file write is held.
        persist.flushAppPersist();
        expect(JSON.parse(localStorage.getItem(KEY) as string).version).toBe(KOBAR_STORAGE_VERSION);
        expect(persist.appPersistBackend.fileWrites()).toBe('waiting');
        expect(harness.writes).toHaveLength(0);

        persist.releasePersistFileWrites();
        await settle(persist);
        const host = harness.readHost();
        expect(host?.value).toBe(localStorage.getItem(KEY));
        expect(harness.writes[0]).toMatchObject({ key: KEY, seq: 1, baseSeq: 0 });
    });

    it('the next start hydrates from the file (also when localStorage lost the value) with the same state', async () => {
        localStorage.setItem(KEY, currentValue({ notePanelWidth: 612 }));
        const first = await boot();
        first.persist.releasePersistFileWrites();
        first.store.useAppStore.setState({ notePanelHeight: 333 });
        await settle(first.persist);
        const expected = persistedState(first.store);

        harness.restart();
        const second = await boot();
        expect(second.persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'identical' });
        expect(persistedState(second.store)).toEqual(expected);

        harness.restart();
        localStorage.removeItem(KEY);
        const third = await boot();
        expect(third.persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'no-local' });
        expect(persistedState(third.store)).toEqual(expected);
        await settle(third.persist);
        // Dual-write puts localStorage back.
        expect(localStorage.getItem(KEY)).toBe(harness.readHost()?.value);
    });
});

describe('dual-write and the newer copy', () => {
    it('every write lands in localStorage and the file, byte-identical, with the side key describing it', async () => {
        harness.seedHost(currentValue());
        localStorage.setItem(KEY, currentValue());
        const { store, persist } = await boot();
        expect(persist.appPersistBackend.fileWrites()).toBe('on');
        for (const width of [301, 302, 303]) {
            store.useAppStore.setState({ notePanelWidth: width });
            await settle(persist);
            expect(harness.readHost()?.value).toBe(localStorage.getItem(KEY));
            expect(JSON.parse(localStorage.getItem(KEY) as string).state.notePanelWidth).toBe(width);
        }
        expect(JSON.parse(localStorage.getItem(PERSIST_META_KEY) as string)).toMatchObject({ length: localStorage.getItem(KEY)!.length });
        // Every write carried the hydration baseline, and the seq continued from the snapshot.
        const seqs = harness.writes.map((w) => w.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(harness.writes.map((w) => w.baseSeq)).size).toBe(1);
        expect(harness.writes[0].seq).toBeGreaterThan(harness.writes[0].baseSeq);
    });

    it('a failed localStorage write (quota): the file has the newer value and wins at the next start', async () => {
        harness.seedHost(currentValue());
        localStorage.setItem(KEY, currentValue());
        const { store, persist } = await boot();
        await settle(persist);
        const original = Storage.prototype.setItem;
        const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === KEY) throw new DOMException('full', 'QuotaExceededError');
            return original.call(this, key, value);
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        store.useAppStore.setState({ notePanelWidth: 777 });
        await settle(persist);
        quota.mockRestore();
        expect(JSON.parse(harness.readHost()!.value).state.notePanelWidth).toBe(777);
        expect(JSON.parse(localStorage.getItem(KEY) as string).state.notePanelWidth).not.toBe(777);

        harness.restart();
        const next = await boot();
        expect(next.persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'local-write-failed' });
        expect(next.store.useAppStore.getState().notePanelWidth).toBe(777);
        await settle(next.persist);
        expect(localStorage.getItem(KEY)).toBe(harness.readHost()?.value);
    });

    it('failed file writes (ok:false) lose nothing: localStorage is current and wins at the next start', async () => {
        harness.seedHost(currentValue());
        localStorage.setItem(KEY, currentValue());
        const { store, persist } = await boot();
        await settle(persist);
        const fileBefore = harness.readHost()!.value;
        harness.intercept = (request) => ({ key: KEY, seq: request.seq, ok: false, reason: 'io', retryable: true, code: 'EBUSY' });
        store.useAppStore.setState({ notePanelWidth: 888 });
        persist.flushAppPersist();
        await vi.waitFor(() => expect(persist.appPersistBackend.fileWrites()).toBe('on'));
        expect(harness.readHost()!.value).toBe(fileBefore);
        expect(JSON.parse(localStorage.getItem(KEY) as string).state.notePanelWidth).toBe(888);

        // Quit without the file ever catching up (the drain timeout case), then start again.
        harness.intercept = null;
        harness.restart();
        const next = await boot();
        expect(next.persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'local-current' });
        expect(next.store.useAppStore.getState().notePanelWidth).toBe(888);
        await settle(next.persist);
        expect(JSON.parse(harness.readHost()!.value).state.notePanelWidth).toBe(888);
        // The older file was copied to .bak before it was replaced.
        expect(harness.listDir('.bak').length).toBeGreaterThan(0);
    });

    it('a retryable failure is retried with the newest value', async () => {
        harness.seedHost(currentValue());
        localStorage.setItem(KEY, currentValue());
        const { store, persist } = await boot();
        let refused = 0;
        harness.intercept = (request) =>
            refused++ === 0 ? { key: KEY, seq: request.seq, ok: false, reason: 'io', retryable: true } : null;
        store.useAppStore.setState({ notePanelWidth: 404 });
        await settle(persist);
        expect(refused).toBeGreaterThanOrEqual(2);
        expect(JSON.parse(harness.readHost()!.value).state.notePanelWidth).toBe(404);
        expect(harness.readHost()!.value).toBe(localStorage.getItem(KEY));
    });

    it('localStorage changed outside KoBar (backup restore, 1.2.x): localStorage wins and the file is kept in .bak', async () => {
        harness.seedHost(currentValue());
        localStorage.setItem(KEY, currentValue());
        const first = await boot();
        await settle(first.persist);
        const oldFile = harness.readHost()!.value;
        const bakBefore = harness.listDir('.bak').length;

        // What restoreFullBackup does: write localStorage directly, then relaunch.
        const restored = currentValue({ notePanelWidth: 555 });
        localStorage.setItem(KEY, restored);
        harness.restart();
        const next = await boot();
        expect(next.persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'local-changed' });
        expect(next.store.useAppStore.getState().notePanelWidth).toBe(555);
        await settle(next.persist);
        expect(harness.readHost()!.value).toBe(localStorage.getItem(KEY));
        const baks = harness.listDir('.bak');
        expect(baks.length).toBeGreaterThan(bakBefore);
        const kept = baks.map((name) => JSON.parse(fs.readFileSync(path.join(harness.root, '.bak', name), 'utf8')).value as string);
        expect(kept).toContain(oldFile);
    });
});

describe('fallbacks', () => {
    it('a corrupt file is quarantined, the store opens from localStorage untouched and the next write recreates the file', async () => {
        harness.seedHost(currentValue());
        fs.writeFileSync(harness.hostFile(), '{"schemaVersion":1,"seq":');
        const local = currentValue({ notePanelWidth: 246 });
        localStorage.setItem(KEY, local);

        const { store, persist } = await boot();
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'no-file' });
        expect(store.useAppStore.getState().notePanelWidth).toBe(246);
        expect(localStorage.getItem(KEY)).toBe(local);
        expect(harness.listDir('.corrupt')).toHaveLength(1);

        persist.releasePersistFileWrites();
        await settle(persist);
        expect(harness.readHost()?.value).toBe(localStorage.getItem(KEY));
    });

    it('a stored value that cannot be hydrated keeps the write lock: neither the file nor localStorage is touched', async () => {
        harness.seedHost('not json at all');
        localStorage.setItem(KEY, 'not json at all');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { store, persist } = await boot();
        expect(persist.appPersistStorage.lockReason()).toBe('hydration-failed');
        store.useAppStore.setState({ notePanelWidth: 999 });
        await settle(persist);
        expect(harness.writes).toHaveLength(0);
        expect(harness.readHost()?.value).toBe('not json at all');
        expect(localStorage.getItem(KEY)).toBe('not json at all');
    });

    it('another window (not the main window top frame) never writes the file; main refuses it', async () => {
        harness.seedHost(currentValue({ notePanelWidth: 100 }));
        localStorage.setItem(KEY, currentValue({ notePanelWidth: 100 }));
        const fileBefore = harness.readHost();
        const { store, persist } = await boot(OTHER_WINDOW);
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'unavailable' });
        expect(persist.appPersistBackend.fileWrites()).toBe('off');
        store.useAppStore.setState({ notePanelWidth: 101 });
        await settle(persist);
        expect(harness.writes).toHaveLength(0);
        expect(harness.readHost()).toEqual(fileBefore);

        // Even a direct write from that window is refused in main.
        const bridge = harness.bridge(OTHER_WINDOW).claim()!;
        const ack = await bridge.write({ key: KEY, seq: 99, baseSeq: 0, value: currentValue() });
        expect(ack).toMatchObject({ ok: false, reason: 'denied' });
        expect(harness.readHost()).toEqual(fileBefore);
    });
});

describe('recovery, export and restore read the hydrated value (T-405 review)', () => {
    it('a failed hydration from the file: "start fresh" keeps the file value (and the different localStorage value)', async () => {
        harness.seedHost('broken file value');
        // The marker says the file is newer, so the store hydrates from the file.
        localStorage.setItem(KEY, 'older broken local value');
        localStorage.setItem(PERSIST_META_KEY, FILE_NEWER_MARKER);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { persist } = await boot();
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'local-write-failed' });
        expect(persist.appPersistStorage.lockReason()).toBe('hydration-failed');

        const recovery = await import('../src/store/hydrationRecovery');
        const result = recovery.startFreshAfterHydrationFailure();
        expect(result).toMatchObject({ success: true });
        const copies = Object.keys(localStorage)
            .filter((key) => key.startsWith('kobar-storage.unreadable.'))
            .map((key) => localStorage.getItem(key));
        expect(copies).toContain('broken file value');
        expect(copies).toContain('older broken local value');
        expect(localStorage.getItem((result as { copyKey: string }).copyKey)).toBe('broken file value');
    });

    it('a failed hydration with an empty localStorage still keeps the file value', async () => {
        harness.seedHost('broken file value');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await boot();
        const recovery = await import('../src/store/hydrationRecovery');
        const kept = recovery.preserveHydratedStore();
        expect(kept.ok).toBe(true);
        expect(localStorage.getItem((kept as { key: string }).key)).toBe('broken file value');
    });

    it('export and the pre-restore backup take kobar-storage from the persist storage; the side key is never in a backup', async () => {
        const fileValue = currentValue({ notePanelWidth: 777 });
        harness.seedHost(fileValue);
        localStorage.setItem(KEY, currentValue({ notePanelWidth: 1 }));
        localStorage.setItem(PERSIST_META_KEY, FILE_NEWER_MARKER);
        const { persist } = await boot();
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'file' });
        const exportModule = await import('../src/backup/exportBackup');
        // localStorage is behind (as after a failed localStorage write); nothing flushed yet.
        persist.appPersistStorage.lockWrites('test');
        localStorage.setItem(PERSIST_META_KEY, 'x');

        let saved = '';
        const result = await exportModule.exportFullBackup(
            { includeSecrets: true },
            {
                api: {
                    getBackupSources: async () => ({ extensionsConfig: {}, plugins: [] }),
                    getAppVersion: async () => '1.3.0',
                    saveFullBackup: async (json: string) => ((saved = json), { success: true }),
                } as never,
                storage: localStorage,
                flush: () => {},
                now: () => new Date(0),
                readAppStore: exportModule.readAppStoreValue,
            }
        );
        expect(result.success).toBe(true);
        const backup = JSON.parse(saved) as { localStorage: Record<string, string> };
        expect(backup.localStorage[KEY]).toBe(fileValue);
        expect(backup.localStorage).not.toHaveProperty(PERSIST_META_KEY);
    });

    it('a restore marks the restored value, so it wins over the older file at the relaunch even after a marker', async () => {
        harness.seedHost(currentValue({ notePanelWidth: 777 }));
        localStorage.setItem(KEY, currentValue({ notePanelWidth: 1 }));
        localStorage.setItem(PERSIST_META_KEY, FILE_NEWER_MARKER);
        const { persist } = await boot();
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'local-write-failed' });
        const { restoreFullBackup } = await import('../src/backup/restoreBackup');
        const { readAppStoreValue } = await import('../src/backup/exportBackup');
        const restored = currentValue({ notePanelWidth: 4321 });
        let preRestore = '';
        const result = await restoreFullBackup(
            { entries: [{ key: KEY, value: restored, category: 'core' }], keepLocalFields: [], keepLocalKeys: [], extensionsConfig: {} },
            {
                api: {
                    getBackupSources: async () => ({ extensionsConfig: {}, plugins: [] }),
                    getAppVersion: async () => '1.3.0',
                    createPreRestoreBackup: async (json: string) => ((preRestore = json), { success: true }),
                    applyRestoreAndRelaunch: async () => ({ success: true }),
                } as never,
                storage: localStorage,
                persist: persist.appPersistStorage,
                pauseChatPersist: () => () => {},
                rewritePersist: () => {},
                now: () => new Date(),
                readAppStore: readAppStoreValue,
            }
        );
        expect(result).toEqual({ success: true });
        // The automatic pre-restore backup holds the current (file) value, not the older localStorage one.
        expect(JSON.parse(JSON.parse(preRestore).localStorage[KEY]).state.notePanelWidth).toBe(777);
        expect(localStorage.getItem(KEY)).toBe(restored);

        harness.restart();
        const next = await boot();
        expect(next.persist.appPersistBackend.hydration()).toMatchObject({ source: 'local', reason: 'local-current' });
        expect(next.store.useAppStore.getState().notePanelWidth).toBe(4321);
    });
});

describe('fixtures through the file backend (v0 ... v22)', () => {
    it.each(FIXTURES)('%s from localStorage: migrated, written to the file byte-identically, re-hydrated from the file', async (name) => {
        const data = fixture(name);
        localStorage.setItem(KEY, JSON.stringify(data));
        const first = await boot();
        first.persist.releasePersistFileWrites();
        await settle(first.persist);
        const host = harness.readHost();
        expect(host?.value).toBe(localStorage.getItem(KEY));
        const disk = JSON.parse(host!.value);
        expect(disk.version).toBe(KOBAR_STORAGE_VERSION);
        const expected = migrateKobarStorage(structuredClone(data.state), data.version) as Record<string, unknown>;
        for (const key of Object.keys(disk.state)) if (key in expected) expect(disk.state[key], key).toEqual(expected[key]);
        const state = persistedState(first.store);

        harness.restart();
        localStorage.removeItem(KEY);
        const second = await boot();
        expect(second.persist.appPersistBackend.hydration()).toMatchObject({ source: 'file' });
        expect(persistedState(second.store)).toEqual(state);
    });

    it.each(FIXTURES)('%s only in the file: migrated from the file, then both copies hold the current string', async (name) => {
        const data = fixture(name);
        harness.seedHost(JSON.stringify(data));
        const { store, persist } = await boot();
        expect(persist.appPersistBackend.hydration()).toMatchObject({ source: 'file', reason: 'no-local' });
        expect(store.useAppStore.persist.hasHydrated()).toBe(true);
        await settle(persist);
        const host = harness.readHost()!;
        expect(host.value).toBe(localStorage.getItem(KEY));
        expect(JSON.parse(host.value).version).toBe(KOBAR_STORAGE_VERSION);
        // The pre-migration file is kept in .bak (forced backup on the first write after a hydration).
        const kept = harness
            .listDir('.bak')
            .map((file) => JSON.parse(fs.readFileSync(path.join(harness.root, '.bak', file), 'utf8')).value as string);
        expect(kept).toContain(JSON.stringify(data));
    });
});
