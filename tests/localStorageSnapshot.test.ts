// T-404: one-time masked localStorage -> kobar-data/localstorage-snapshot/ copy. Real StorageService on a temp dir, fault
// injection through a wrapping fs, a fake ipcMain + the real registry, preload bridge and renderer client. Every secret below
// is a FAKE token built at runtime (marker FAKESECRET); no real secret, never the real userData, never Electron.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { InvokeResult, IpcLocalStorageSnapshotResult, IpcStorageSnapshot, IpcStorageWriteAck } from '../shared/ipc-contract';
import { type IpcMainLike, createIpcRegistry } from '../electron/main/ipc/registry.cjs';
import { createStorageBridge } from '../electron/lib/storageBridge.cjs';
import { MASKED_VALUE, maskSecrets } from '../electron/lib/storageBackup.cjs';
import type { StorageFs } from '../electron/main/services/storage/atomicWrite.cjs';
import {
    INTERNAL_STORAGE_ENTRIES,
    LOCALSTORAGE_SNAPSHOT_DIR_NAME,
    isInternalStorageEntry,
} from '../electron/main/services/storage/layout.cjs';
import {
    LOCALSTORAGE_SNAPSHOT_MAX_BYTES,
    createLocalStorageSnapshotWriter,
    maskLocalStorageEntries,
    validateLocalStorageRequest,
} from '../electron/main/services/storage/localStorageSnapshot.cjs';
import { type StorageIpc, createStorageIpc, registerStorageIpc } from '../electron/main/services/storage/storageIpc.cjs';
import { type StorageServiceOptions, createStorageService } from '../electron/main/services/storage/storageService.cjs';
import { createStorageClient } from '../src/storage/client';
import { migrateLocalStorageSnapshot } from '../src/storage/migrateFromLocalStorage';

const MARK = 'FAKESECRET';
const START = Date.UTC(2026, 9, 12, 10, 0, 0);
const MAIN_WINDOW = 1;
const OTHER_WINDOW = 2;

/** Fake token shapes (they match the mask's value patterns but are not real). */
const fakeSk = (tag: string) => `sk-${MARK}${tag}${'x'.repeat(12)}`;
/** A fake token-shaped property name (no secret-like word in it). */
const fakeKeyName = (letter: string) => `sk-proj-${letter.repeat(20)}`;
const fakeBearer = (tag: string) => `Bearer ${MARK}${tag}${'0'.repeat(16)}`;

let tmp: string;
let root: string;
let now: number;
let logs: unknown[][];

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-t404-'));
    root = path.join(tmp, 'kobar-data');
    now = START;
    logs = [];
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const snapshotDir = () => path.join(root, LOCALSTORAGE_SNAPSHOT_DIR_NAME);
const snapshotFile = () => path.join(snapshotDir(), 'snapshot.json');
const markerFile = () => path.join(snapshotDir(), '.done');
const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
const readSnapshot = () =>
    JSON.parse(fs.readFileSync(snapshotFile(), 'utf8')) as {
        schemaVersion: number;
        takenAt: number;
        appVersion: string;
        keyCount: number;
        omittedCount: number;
        keys: Record<string, string>;
        omitted: Record<string, { reason: string; bytes: number }>;
    };

function service(overrides: Partial<StorageServiceOptions> = {}) {
    return createStorageService({
        root,
        appVersion: '1.3.0-test',
        clock: () => now,
        random: () => 0.5,
        sleep: async () => {},
        sleepSync: () => {},
        log: () => {},
        ...overrides,
    });
}

function writer(svc = service(), fsOverride?: StorageFs) {
    return createLocalStorageSnapshotWriter({
        service: svc,
        appVersion: '1.3.0-test',
        clock: () => now,
        random: () => 0.5,
        sleepSync: () => {},
        fs: fsOverride,
        log: (...args) => {
            logs.push(args);
        },
    });
}

/** Real fs with a hook that runs before every call (and may throw to inject a fault). */
function hookedFs(hook: (op: keyof StorageFs, args: unknown[]) => void): StorageFs {
    const real = fs as unknown as Record<keyof StorageFs, (...args: unknown[]) => unknown>;
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const op of Object.keys(real).filter((name) => name.endsWith('Sync')) as (keyof StorageFs)[]) {
        out[op] = (...args: unknown[]) => {
            hook(op, args);
            return real[op](...args);
        };
    }
    return out as unknown as StorageFs;
}

const fsError = (code: string) => Object.assign(new Error(code), { code });

/** A synthetic localStorage with host, plugin, `_iso_` and secret-bearing keys. */
function sampleEntries(): Array<[string, string]> {
    const pluginSettings = JSON.stringify({
        provider: 'openai',
        model: 'gpt-x',
        theme: 'dark',
        count: 3,
        enabled: true,
        auth: { user: 'me', pass: `${MARK}-1` },
        apiKey: `${MARK}-2`,
        headers: { Authorization: fakeBearer('h') },
        nested: JSON.stringify({
            token: `${MARK}-3`,
            list: [{ apiKey: `${MARK}-4` }, [{ session: `${MARK}-5` }]],
        }),
        matrix: [[{ credentials: { a: `${MARK}-6` } }], [['plain', fakeSk('m')]]],
        note: `pasted ${fakeSk('n')} here`,
    });
    // Stringified JSON stringified twice more: only the strict mask enters it.
    const tripleEncoded = JSON.stringify(JSON.stringify(JSON.stringify({ apiKey: `${MARK}-7`, ok: 1 })));
    // JSON nested in JSON strings deeper than the mask walks: kept by name and size only.
    let deep: unknown = { apiKey: `${MARK}-8` };
    for (let i = 0; i < 6; i++) deep = { wrap: JSON.stringify(deep) };
    const hostStore = JSON.stringify({
        state: {
            theme: 'dark',
            apiKeys: { openai: `${MARK}-11` },
            notes: [{ id: 'n1', content: `my ${fakeBearer('note')} end` }],
            globalPluginData: { mail: JSON.stringify({ smtpPassword: `${MARK}-12`, user: 'me' }) },
        },
        version: 22,
    });
    return [
        ['kobar-storage', hostStore],
        ['kobar_language', 'tr'],
        ['ai-hub-settings', pluginSettings],
        ['ai-hub-settings_iso_ws-1', pluginSettings],
        ['plugin-double', tripleEncoded],
        ['plugin-deep_iso_ws-1', JSON.stringify(deep)],
        ['auth', `${MARK}-9`],
        ['myplugin_apiKey', `${MARK}-10`],
        ['token_iso_ws-1', `${MARK}-13`],
        ['empty_token', ''],
        [`cache-${fakeSk('k')}`, 'value'],
        ['legacy-config', `password=${MARK}-14;`],
        ['plugin-counter', '42'],
        ['__proto__', '{"a":1}'],
    ];
}

describe('masking (fake tokens)', () => {
    it('masks secret fields recursively: nested JSON, nested arrays, names like auth/token/apiKey', async () => {
        const masked = await maskLocalStorageEntries(sampleEntries());
        expect(JSON.stringify(masked)).not.toContain(MARK);

        const plugin = JSON.parse(masked.keys['ai-hub-settings_iso_ws-1']);
        expect(plugin).toMatchObject({ provider: 'openai', model: 'gpt-x', theme: 'dark', count: 3, enabled: true });
        expect(plugin.auth).toBe(MASKED_VALUE);
        expect(plugin.apiKey).toBe(MASKED_VALUE);
        expect(plugin.headers.Authorization).toBe(MASKED_VALUE);
        const nested = JSON.parse(plugin.nested);
        expect(nested.token).toBe(MASKED_VALUE);
        expect(nested.list[0].apiKey).toBe(MASKED_VALUE);
        expect(nested.list[1][0].session).toBe(MASKED_VALUE);
        expect(plugin.matrix[0][0].credentials).toBe(MASKED_VALUE);
        expect(plugin.matrix[1][0]).toEqual(['plain', MASKED_VALUE]);
        expect(plugin.note).toBe(`pasted ${MASKED_VALUE} here`);
        // The non-isolated copy of the same plugin is masked the same way.
        expect(masked.keys['ai-hub-settings']).toBe(masked.keys['ai-hub-settings_iso_ws-1']);

        const host = JSON.parse(masked.keys['kobar-storage']);
        expect(host.version).toBe(22);
        expect(host.state.theme).toBe('dark');
        expect(host.state.apiKeys).toBe(MASKED_VALUE);
        expect(host.state.notes[0]).toEqual({ id: 'n1', content: `my ${MASKED_VALUE} end` });
        expect(JSON.parse(host.state.globalPluginData.mail)).toEqual({ smtpPassword: MASKED_VALUE, user: 'me' });
    });

    it('enters JSON encoded several times; gives up (name + size only) on JSON nested too deep', async () => {
        const masked = await maskLocalStorageEntries(sampleEntries());
        const inner = JSON.parse(JSON.parse(JSON.parse(masked.keys['plugin-double'])));
        expect(inner).toEqual({ apiKey: MASKED_VALUE, ok: 1 });
        expect(masked.keys['plugin-deep_iso_ws-1']).toBeUndefined();
        expect(masked.omitted['plugin-deep_iso_ws-1']).toMatchObject({ reason: 'mask-failed' });
        expect(masked.omitted['plugin-deep_iso_ws-1'].bytes).toBeGreaterThan(0);
    });

    it('secret-named keys keep their name, not their value; tokens in key names are masked in the name too', async () => {
        const masked = await maskLocalStorageEntries(sampleEntries());
        expect(masked.keys.auth).toBe(MASKED_VALUE);
        expect(masked.keys.myplugin_apiKey).toBe(MASKED_VALUE);
        expect(masked.keys['token_iso_ws-1']).toBe(MASKED_VALUE);
        expect(masked.keys.empty_token).toBe('');
        const tokenName = Object.keys(masked.omitted).find((name) => name.startsWith('cache-'));
        expect(tokenName).toBe(`cache-${MASKED_VALUE}`);
        expect(masked.omitted[tokenName!].reason).toBe('secret-in-key-name');
        // Unparsable text that looks secret is never stored by value.
        expect(masked.omitted['legacy-config']).toMatchObject({ reason: 'unparsable-may-contain-secrets' });
    });

    it('keeps harmless values verbatim and any key name as an own property', async () => {
        const masked = await maskLocalStorageEntries(sampleEntries());
        expect(masked.keys.kobar_language).toBe('tr');
        expect(masked.keys['plugin-counter']).toBe('42');
        expect(Object.prototype.hasOwnProperty.call(masked.keys, '__proto__')).toBe(true);
        expect(masked.keys['__proto__']).toBe('{"a":1}');
        expect(masked.keyCount + masked.omittedCount).toBe(sampleEntries().length);
    });

    it('masks token-shaped NESTED key names (top level, nested JSON, double-encoded JSON); collisions stay distinct', async () => {
        // Token-shaped names without a secret-like word, so only the name masking (not the value masking) applies.
        const usage = { [fakeKeyName('A')]: { n: 1 }, [fakeKeyName('B')]: { n: 2 }, plain: { n: 3 } };
        const masked = await maskLocalStorageEntries([
            ['usage-top', JSON.stringify({ usage })],
            ['usage-nested', JSON.stringify({ wrap: JSON.stringify({ usage }) })],
            ['usage-double', JSON.stringify(JSON.stringify({ usage }))],
        ]);
        expect(JSON.stringify(masked)).not.toMatch(/AAAAAAAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBBBBBB/);
        const expected = { [MASKED_VALUE]: { n: 1 }, [`${MASKED_VALUE}#2`]: { n: 2 }, plain: { n: 3 } };
        expect(JSON.parse(masked.keys['usage-top']).usage).toEqual(expected);
        expect(JSON.parse(JSON.parse(masked.keys['usage-nested']).wrap).usage).toEqual(expected);
        expect(JSON.parse(JSON.parse(masked.keys['usage-double'])).usage).toEqual(expected);
    });

    it('the non-strict (pre-migration backup) mask masks nested key names too; only too-deep JSON is handled per value (T-414)', () => {
        const raw = JSON.stringify({ usage: { [fakeKeyName('C')]: 1 } });
        const backup = maskSecrets(raw);
        expect(backup.kind === 'json' && JSON.parse(backup.text).usage).toEqual({ [MASKED_VALUE]: 1 });
        const strict = maskSecrets(raw, { strict: true });
        expect(strict.kind === 'json' && JSON.parse(strict.text).usage).toEqual({ [MASKED_VALUE]: 1 });
        let deep: unknown = { a: 1 };
        for (let i = 0; i < 6; i++) deep = { wrap: JSON.stringify(deep) };
        expect(maskSecrets(JSON.stringify(deep)).kind).toBe('json');
        expect(maskSecrets(JSON.stringify(deep), { strict: true })).toEqual({ kind: 'skipped', reason: 'mask-failed' });
    });
});

describe('request validation', () => {
    it('accepts only { entries: [string, string][] } within the 20 MB cap', () => {
        expect(LOCALSTORAGE_SNAPSHOT_MAX_BYTES).toBe(20 * 1024 * 1024);
        expect(validateLocalStorageRequest({ entries: [['a', 'b']] })).toMatchObject({ ok: true });
        for (const bad of [null, [], 'x', {}, { entries: 'x' }, { entries: [['a']] }, { entries: [['a', 1]] }, { entries: [[1, 'b']] }]) {
            expect(validateLocalStorageRequest(bad)).toEqual({ ok: false, status: 'invalid-request' });
        }
        expect(validateLocalStorageRequest({ entries: [['a', 'x'.repeat(11)]] }, 10)).toEqual({ ok: false, status: 'too-large' });
        // Exact UTF-8 size: 4 chars of 3 bytes each = 12 bytes.
        expect(validateLocalStorageRequest({ entries: [['', '€'.repeat(4)]] }, 11)).toEqual({ ok: false, status: 'too-large' });
        expect(validateLocalStorageRequest({ entries: [['', '€'.repeat(4)]] }, 12)).toMatchObject({ ok: true });
    });
});

describe('writer: snapshot, marker, manifest', () => {
    it('writes snapshot.json, then .done, then manifest.migratedFromLocalStorageAt; nothing secret on disk or in logs', async () => {
        const result = await writer().run({ entries: sampleEntries() });
        expect(result).toMatchObject({ ok: true, status: 'written', migratedFromLocalStorageAt: START });
        expect(result.keyCount! + result.omittedCount!).toBe(sampleEntries().length);

        const snap = readSnapshot();
        expect(snap).toMatchObject({ schemaVersion: 1, takenAt: START, appVersion: '1.3.0-test' });
        expect(Object.keys(snap.keys)).toEqual(expect.arrayContaining(['kobar-storage', 'ai-hub-settings_iso_ws-1', 'plugin-counter']));
        expect(JSON.parse(fs.readFileSync(markerFile(), 'utf8'))).toMatchObject({ takenAt: START });
        expect(readManifest().migratedFromLocalStorageAt).toBe(START);

        for (const file of [snapshotFile(), markerFile(), path.join(root, 'manifest.json')]) {
            expect(fs.readFileSync(file, 'utf8')).not.toContain(MARK);
        }
        const logged = JSON.stringify(logs);
        expect(logged).not.toContain(MARK);
        expect(logged).not.toContain('ai-hub');
        expect(fs.readdirSync(path.join(root, '.tmp'))).toEqual([]);
    });

    it('is idempotent: a second run (same session or after a restart) writes nothing', async () => {
        await writer().run({ entries: sampleEntries() });
        const before = [snapshotFile(), markerFile(), path.join(root, 'manifest.json')].map((f) => fs.readFileSync(f));
        now += 60_000;

        const svc = service();
        const again = writer(svc);
        expect(await again.run({ entries: [['changed', 'value']] })).toEqual({
            ok: true,
            status: 'already-done',
            migratedFromLocalStorageAt: START,
        });
        expect(await again.run({ entries: sampleEntries() })).toMatchObject({ status: 'already-done' });
        // The restart rewrote manifest.json (appVersion / clean-shutdown flag), but kept the migration time.
        expect(readManifest().migratedFromLocalStorageAt).toBe(START);
        expect(fs.readFileSync(snapshotFile())).toEqual(before[0]);
        expect(fs.readFileSync(markerFile())).toEqual(before[1]);
    });

    it('a marker without the manifest field (lost manifest update) repairs the manifest instead of re-taking the snapshot', async () => {
        await writer().run({ entries: sampleEntries() });
        const snapBytes = fs.readFileSync(snapshotFile());
        const manifest = readManifest();
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, migratedFromLocalStorageAt: null }));
        now += 1000;

        const result = await writer(service()).run({ entries: [['other', 'x']] });
        expect(result).toMatchObject({ ok: true, status: 'already-done', migratedFromLocalStorageAt: START });
        expect(readManifest().migratedFromLocalStorageAt).toBe(START);
        expect(fs.readFileSync(snapshotFile())).toEqual(snapBytes);
    });

    it('concurrent calls share one run', async () => {
        const w = writer();
        const [a, b] = await Promise.all([w.run({ entries: sampleEntries() }), w.run({ entries: [['x', 'y']] })]);
        expect(a).toEqual(b);
        expect(readSnapshot().keys.kobar_language).toBe('tr');
    });

    it('refuses invalid or too large requests without writing anything', async () => {
        expect(await writer().run({ entries: [['a', 5]] })).toMatchObject({ ok: false, status: 'invalid-request' });
        const small = createLocalStorageSnapshotWriter({ service: service(), appVersion: 't', maxBytes: 8, log: () => {} });
        expect(await small.run({ entries: [['a', 'x'.repeat(20)]] })).toMatchObject({ ok: false, status: 'too-large' });
        expect(fs.existsSync(snapshotDir())).toBe(false);
        expect(readManifest().migratedFromLocalStorageAt).toBeNull();
    });

    it('respects the disabled flag and read-only mode (newer storage schema)', async () => {
        const disabled = writer(service({ isDisabled: () => true }));
        expect(await disabled.run({ entries: sampleEntries() })).toMatchObject({ ok: false, status: 'disabled' });
        expect(fs.existsSync(root)).toBe(false);

        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 99, migratedFromLocalStorageAt: null }));
        expect(await writer(service()).run({ entries: sampleEntries() })).toMatchObject({ ok: false, status: 'read-only' });
        expect(fs.existsSync(snapshotDir())).toBe(false);
    });
});

describe('writer: partial failure', () => {
    it('a failed snapshot write leaves no marker and no manifest field; the next run succeeds', async () => {
        const failing = hookedFs((op, args) => {
            if (op === 'openSync' && path.basename(String(args[0])).startsWith('snapshot.json')) throw fsError('ENOSPC');
        });
        const svc = service();
        expect(await writer(svc, failing).run({ entries: sampleEntries() })).toMatchObject({ ok: false, status: 'io' });
        expect(fs.existsSync(snapshotFile())).toBe(false);
        expect(fs.existsSync(markerFile())).toBe(false);
        expect(readManifest().migratedFromLocalStorageAt).toBeNull();
        expect(JSON.stringify(logs)).toContain('ENOSPC');

        expect(await writer(svc).run({ entries: sampleEntries() })).toMatchObject({ ok: true, status: 'written' });
        expect(fs.existsSync(markerFile())).toBe(true);
    });

    it('a failed marker write keeps the snapshot, records nothing and is repeated next time', async () => {
        const failing = hookedFs((op, args) => {
            if (op === 'renameSync' && path.basename(String(args[1])) === '.done') throw fsError('EIO');
        });
        const svc = service();
        expect(await writer(svc, failing).run({ entries: sampleEntries() })).toMatchObject({ ok: false, status: 'io' });
        expect(fs.existsSync(snapshotFile())).toBe(true);
        expect(fs.existsSync(markerFile())).toBe(false);
        expect(readManifest().migratedFromLocalStorageAt).toBeNull();
        expect(fs.readdirSync(path.join(root, '.tmp'))).toEqual([]);

        now += 5000;
        expect(await writer(svc).run({ entries: sampleEntries() })).toMatchObject({ ok: true, migratedFromLocalStorageAt: START + 5000 });
        expect(readManifest().migratedFromLocalStorageAt).toBe(START + 5000);
    });

    it('a failed manifest update still completes (the marker repairs the manifest on the next startup)', async () => {
        const svc = service();
        svc.init();
        const spy = vi.spyOn(svc, 'recordLocalStorageMigration').mockReturnValue(false);
        const result = await writer(svc).run({ entries: sampleEntries() });
        expect(result).toMatchObject({ ok: true, status: 'written', migratedFromLocalStorageAt: START });
        expect(spy).toHaveBeenCalledWith(START);
        spy.mockRestore();
        expect(readManifest().migratedFromLocalStorageAt).toBeNull();
        expect(await writer(service()).run({ entries: [] })).toMatchObject({ status: 'already-done', migratedFromLocalStorageAt: START });
        expect(readManifest().migratedFromLocalStorageAt).toBe(START);
    });

    it('a failed manifest repair from the marker is logged (counts only) and still reports already-done', async () => {
        await writer().run({ entries: sampleEntries() });
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...readManifest(), migratedFromLocalStorageAt: null }));
        const svc = service();
        svc.init();
        vi.spyOn(svc, 'recordLocalStorageMigration').mockReturnValue(false);
        logs = [];
        expect(await writer(svc).run({ entries: [] })).toMatchObject({
            ok: true,
            status: 'already-done',
            migratedFromLocalStorageAt: START,
        });
        expect(logs).toContainEqual(['manifest-repair-failed', { manifest: false }]);
    });
});

describe('backup exclusion', () => {
    it('the snapshot directory is an internal storage entry', () => {
        expect(INTERNAL_STORAGE_ENTRIES).toContain(LOCALSTORAGE_SNAPSHOT_DIR_NAME);
        expect(isInternalStorageEntry(`${LOCALSTORAGE_SNAPSHOT_DIR_NAME}/snapshot.json`)).toBe(true);
    });
});

// ---- end to end: renderer migrate -> client -> preload bridge -> fake ipcMain -> storageIpc -> writer ------------------

type Listener = (event: never, ...args: unknown[]) => unknown;

function ipcSetup(options: { withWriter?: boolean } = {}) {
    const svc = service();
    const storage: StorageIpc = createStorageIpc({
        service: svc,
        localStorageSnapshot: options.withWriter === false ? undefined : writer(svc),
        isWriter: (event) => (event as unknown as { sender: { id: number } }).sender.id === MAIN_WINDOW,
        log: () => {},
    });
    const handlers = new Map<string, Listener>();
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => void handlers.set(channel, listener as Listener),
        on: (channel, listener) => void listeners.set(channel, listener as Listener),
    };
    registerStorageIpc({ ipcMain, registry: createIpcRegistry({ ipcMain, logger: { warn: () => {}, error: () => {} } }), storage });
    const sendSync = (channel: string, sender: number, ...args: unknown[]) => {
        const event: { sender: { id: number }; returnValue?: unknown } = { sender: { id: sender } };
        listeners.get(channel)!(event as never, ...args);
        return event.returnValue;
    };
    const invoke = async (channel: string, sender: number, ...args: unknown[]) =>
        handlers.get(channel)!({ sender: { id: sender } } as never, ...args);
    const transportFor = (sender: number) => ({
        readSnapshot: () => sendSync('storage-snapshot', sender, 'kobar-storage') as IpcStorageSnapshot,
        write: (request: unknown) => invoke('storage-write', sender, request) as Promise<IpcStorageWriteAck>,
        writeSync: (request: unknown) => sendSync('storage-write-sync', sender, request) as IpcStorageWriteAck,
        archiveLocalStorage: (request: unknown) =>
            invoke('storage-localstorage-snapshot', sender, request) as Promise<IpcLocalStorageSnapshotResult>,
    });
    return { invoke, transportFor, handlers };
}

/** A read-only Storage look-alike over a fixed map. */
function reader(entries: Array<[string, string]>) {
    const data = new Map(entries);
    const keys = [...data.keys()];
    return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (key: string) => data.get(key) ?? null };
}

describe('storage-localstorage-snapshot channel (host-internal)', () => {
    it('matches the contract type', () => {
        expectTypeOf<ReturnType<StorageIpc['archiveLocalStorage']>>().toEqualTypeOf<
            Promise<InvokeResult<'storage-localstorage-snapshot'>>
        >();
    });

    it('refuses other windows and a renderer that did not read the snapshot, without touching the disk', async () => {
        const main = ipcSetup();
        const request = { entries: sampleEntries() };
        expect(await main.invoke('storage-localstorage-snapshot', OTHER_WINDOW, request)).toMatchObject({ ok: false, status: 'denied' });
        expect(await main.invoke('storage-localstorage-snapshot', MAIN_WINDOW, request)).toMatchObject({
            ok: false,
            status: 'not-hydrated',
        });
        expect(fs.existsSync(root)).toBe(false);
    });

    it('renderer -> main: written once, then skipped by the snapshot field; the next boot snapshot reports it', async () => {
        const main = ipcSetup();
        const transport = main.transportFor(MAIN_WINDOW);
        const archive = vi.spyOn(transport, 'archiveLocalStorage');
        const client = createStorageClient(createStorageBridge(transport).claim());
        expect(client.storeStatus()).toMatchObject({ ok: true, migratedFromLocalStorageAt: null });

        const storage = reader(sampleEntries());
        const first = await migrateLocalStorageSnapshot({ client, storage, log: () => {} });
        expect(first).toMatchObject({ ok: true, status: 'written', migratedFromLocalStorageAt: START });
        expect(archive).toHaveBeenCalledTimes(1);
        expect((archive.mock.calls[0][0] as { entries: unknown[] }).entries).toHaveLength(sampleEntries().length);
        expect(client.storeStatus()?.migratedFromLocalStorageAt).toBe(START);
        expect(fs.readFileSync(snapshotFile(), 'utf8')).not.toContain(MARK);

        // Same session: decided by the field, nothing is read or sent again.
        const getItem = vi.spyOn(storage, 'getItem');
        expect(await migrateLocalStorageSnapshot({ client, storage, log: () => {} })).toEqual({
            ok: false,
            status: 'skipped',
            reason: 'already-done',
        });
        expect(archive).toHaveBeenCalledTimes(1);
        expect(getItem).not.toHaveBeenCalled();

        // Next startup: the boot snapshot carries manifest.migratedFromLocalStorageAt.
        const next = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        expect(next.storeStatus()?.migratedFromLocalStorageAt).toBe(START);
    });

    it('without a writer the channel answers unavailable', async () => {
        const main = ipcSetup({ withWriter: false });
        const client = createStorageClient(createStorageBridge(main.transportFor(MAIN_WINDOW)).claim());
        expect(await client.archiveLocalStorage({ entries: [] })).toMatchObject({ ok: false, status: 'unavailable' });
    });

    it('a transport without the archive call answers unavailable (never throws)', async () => {
        const main = ipcSetup();
        const { archiveLocalStorage: _unused, ...legacy } = main.transportFor(MAIN_WINDOW);
        void _unused;
        const client = createStorageClient(createStorageBridge(legacy).claim());
        expect(await client.archiveLocalStorage({ entries: [] })).toMatchObject({ ok: false, status: 'unavailable' });
    });
});
