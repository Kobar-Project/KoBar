// T-402: main-process StorageService for userData/kobar-data/. Real fs in a temp dir, fault
// injection through a wrapping fs, synthetic values only. Never touches the real userData.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    RENAME_MAX_ATTEMPTS,
    type StorageFs,
    renameRetryDelayMs,
    renameWithRetry,
    writeTempFile,
} from '../electron/main/services/storage/atomicWrite.cjs';
import {
    INTERNAL_STORAGE_ENTRIES,
    bakFileName,
    isInternalStorageEntry,
    isStorageKey,
    isValidStorageId,
    parseBakFileName,
    resolveStoragePath,
} from '../electron/main/services/storage/layout.cjs';
import {
    BAK_MIN_INTERVAL_MS,
    type BakEntry,
    planBakKeep,
    planBakPrune,
    shouldBackup,
} from '../electron/main/services/storage/rotation.cjs';
import {
    type StorageServiceOptions,
    createStorageService,
    parseEnvelope,
    persistVersionOf,
} from '../electron/main/services/storage/storageService.cjs';

const KEY = 'kobar-storage';
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 12, 10, 0, 0);

const fsError = (code: string) => Object.assign(new Error(code), { code });
const persistValue = (text: string, version = 22) => JSON.stringify({ state: { text }, version });

type Hook = (op: keyof StorageFs, args: unknown[]) => void;

/** Real fs with a hook that runs before every call (and may throw to inject a fault). */
function hookedFs(hook: Hook): StorageFs {
    const real = fs as unknown as Record<keyof StorageFs, (...args: unknown[]) => unknown>;
    const ops: (keyof StorageFs)[] = [
        'mkdirSync',
        'openSync',
        'writeSync',
        'fsyncSync',
        'closeSync',
        'renameSync',
        'copyFileSync',
        'unlinkSync',
        'readFileSync',
        'statSync',
        'readdirSync',
    ];
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const op of ops) {
        out[op] = (...args: unknown[]) => {
            hook(op, args);
            return real[op](...args);
        };
    }
    return out as unknown as StorageFs;
}

let tmpRoot: string;
let root: string;
let now: number;
let logs: unknown[][];
let sleeps: number[];

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-storage-test-'));
    root = path.join(tmpRoot, 'kobar-data');
    now = START;
    logs = [];
    sleeps = [];
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function service(overrides: Partial<StorageServiceOptions> = {}) {
    return createStorageService({
        root,
        appVersion: '1.3.0-test',
        clock: () => now,
        random: () => 0.5,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
        sleepSync: (ms) => {
            sleeps.push(ms);
        },
        log: (...args) => {
            logs.push(args);
        },
        ...overrides,
    });
}

const target = () => path.join(root, 'host', 'kobar-storage.json');
const readTarget = () => JSON.parse(fs.readFileSync(target(), 'utf8'));
const list = (dir: string) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).sort() : []);

describe('layout', () => {
    it('allows only enum keys, never a path', () => {
        expect(isStorageKey('kobar-storage')).toBe(true);
        for (const bad of ['host/kobar-storage', '../kobar-storage', 'KOBAR-STORAGE', '__proto__', 'chat', '', 1, null]) {
            expect(isStorageKey(bad)).toBe(false);
        }
    });

    it('validates ids as [a-z0-9-] single segments', () => {
        for (const ok of ['global', 'ws-1', 'a', '0f3c-9']) expect(isValidStorageId(ok)).toBe(true);
        for (const bad of ['', '..', 'a.b', 'A', 'a/b', 'a\\b', 'con', 'nul', 'x'.repeat(65), 'ws 1', 'é']) {
            expect(isValidStorageId(bad)).toBe(false);
        }
    });

    it('resolves storage paths inside the root only', () => {
        expect(resolveStoragePath(root, ['host', 'kobar-storage.json'])).toBe(path.join(root, 'host', 'kobar-storage.json'));
        expect(resolveStoragePath(root, ['..', 'outside.json'])).toBeNull();
        expect(resolveStoragePath(root, [])).toBeNull();
    });

    it('round-trips .bak names and ignores foreign names', () => {
        const info = { key: KEY, takenAt: START, seq: 42, schema: 1, version: 22 } as const;
        expect(parseBakFileName(bakFileName(info))).toEqual(info);
        expect(parseBakFileName(bakFileName({ ...info, version: null }))?.version).toBeNull();
        for (const bad of [
            'kobar-storage.json',
            '../kobar-storage.1760000000000.1.s1v1.json',
            'other.1760000000000.1.s1v1.json',
            'x.txt',
        ]) {
            expect(parseBakFileName(bad)).toBeNull();
        }
    });

    it('marks internal entries that bulk flows must skip', () => {
        expect(INTERNAL_STORAGE_ENTRIES).toEqual(expect.arrayContaining(['.tmp', '.bak', '.corrupt', 'localstorage-snapshot', 'secrets']));
        expect(isInternalStorageEntry('.bak/kobar-storage.1.json')).toBe(true);
        expect(isInternalStorageEntry('.tmp')).toBe(true);
        expect(isInternalStorageEntry('host\\kobar-storage.json')).toBe(false);
        expect(isInternalStorageEntry('manifest.json')).toBe(false);
    });
});

describe('atomic write helpers', () => {
    it('backs off 20..200 ms, growing, with bounded jitter', () => {
        const low = [1, 2, 3, 4].map((n) => renameRetryDelayMs(n, () => 0));
        const high = [1, 2, 3, 4, 9].map((n) => renameRetryDelayMs(n, () => 1));
        expect(low).toEqual([20, 40, 80, 160]);
        for (const d of high) expect(d).toBeLessThanOrEqual(200);
        expect(Math.min(...low, ...high)).toBeGreaterThanOrEqual(20);
    });

    function renameFs(failures: string[]): { fs: StorageFs; calls: () => number } {
        let calls = 0;
        const fake = {
            renameSync() {
                calls += 1;
                const code = failures.shift();
                if (code) throw fsError(code);
            },
        } as unknown as StorageFs;
        return { fs: fake, calls: () => calls };
    }

    it('retries EPERM/EBUSY/EACCES and succeeds', async () => {
        const fake = renameFs(['EBUSY', 'EPERM', 'EACCES']);
        const waits: number[] = [];
        const out = await renameWithRetry(fake.fs, 'a', 'b', { random: () => 0, sleep: async (ms) => void waits.push(ms) });
        expect(out).toEqual({ ok: true, attempts: 4 });
        expect(waits).toEqual([20, 40, 80]);
    });

    it(`gives up after ${RENAME_MAX_ATTEMPTS} attempts and does not retry other errors`, async () => {
        const busy = renameFs(Array(10).fill('EBUSY'));
        expect(await renameWithRetry(busy.fs, 'a', 'b', { random: () => 0, sleep: async () => {} })).toMatchObject({
            ok: false,
            code: 'EBUSY',
        });
        expect(busy.calls()).toBe(RENAME_MAX_ATTEMPTS);
        const missing = renameFs(['ENOENT']);
        expect(await renameWithRetry(missing.fs, 'a', 'b', { random: () => 0, sleep: async () => {} })).toMatchObject({
            ok: false,
            code: 'ENOENT',
        });
        expect(missing.calls()).toBe(1);
    });

    it('removes a partial temp file when fsync fails', () => {
        const tempPath = path.join(tmpRoot, 'x.tmp');
        const faulty = hookedFs((op) => {
            if (op === 'fsyncSync') throw fsError('EIO');
        });
        expect(() => writeTempFile(faulty, tempPath, 'data')).toThrow('EIO');
        expect(fs.existsSync(tempPath)).toBe(false);
    });
});

describe('rotation policy', () => {
    const entry = (takenAt: number, seq: number, version: number | null = 22, schema = 1): BakEntry => ({
        key: KEY,
        takenAt,
        seq,
        schema,
        version,
        name: bakFileName({ key: KEY, takenAt, seq, schema, version }),
    });

    it('keeps the 3 newest, the first of each of the last 7 days and the newest per version', () => {
        const entries: BakEntry[] = [];
        let seq = 0;
        for (let day = 0; day < 10; day++) {
            for (let i = 0; i < 4; i++) entries.push(entry(START - day * DAY + i * 3_600_000, ++seq));
        }
        entries.push(entry(START - 20 * DAY, ++seq, 21));
        const keep = planBakKeep(entries, START + 4 * 3_600_000);
        const keptEntries = entries.filter((e) => keep.has(e.name));
        // 3 newest (today) + first of today and the 6 previous days + newest v21 (v22's newest is already kept).
        expect(keep.size).toBe(3 + 7 + 1);
        expect(keptEntries.some((e) => e.version === 21)).toBe(true);
        expect(keep.has(entry(START - 6 * DAY, 6 * 4 + 1).name)).toBe(true); // first backup of the 7th day back
        expect(keptEntries.some((e) => e.takenAt === START - 7 * DAY)).toBe(false);
        expect(planBakPrune(entries, START).length).toBe(entries.length - planBakKeep(entries, START).size);
    });

    it('caps version pins at 10 and ignores unknown versions', () => {
        const entries = Array.from({ length: 15 }, (_, i) => entry(START - 30 * DAY - i * 1000, i + 1, i));
        entries.push(entry(START - 31 * DAY, 99, null));
        const keep = planBakKeep(entries, START);
        const keptVersions = entries.filter((e) => keep.has(e.name)).map((e) => e.version);
        // 3 newest (v0-v2) + the 10 highest versions (v5-v14); v3, v4 and the unknown version are pruned.
        expect(keptVersions.sort((a, b) => (a ?? -1) - (b ?? -1))).toEqual([0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it('decides when to copy the file about to be replaced', () => {
        const base = {
            forced: false,
            now: START,
            lastBackupAt: START - 1000,
            existingWrittenAt: START - 1000,
            existingTag: '1/22',
            incomingTag: '1/22',
        };
        expect(shouldBackup(base)).toBe(false);
        expect(shouldBackup({ ...base, forced: true })).toBe(true);
        expect(shouldBackup({ ...base, existingWrittenAt: START + 1 })).toBe(true);
        expect(shouldBackup({ ...base, existingWrittenAt: null })).toBe(true);
        expect(shouldBackup({ ...base, incomingTag: '1/23' })).toBe(true);
        expect(shouldBackup({ ...base, lastBackupAt: START - BAK_MIN_INTERVAL_MS })).toBe(true);
        expect(shouldBackup({ ...base, lastBackupAt: null })).toBe(true);
    });
});

describe('envelope helpers', () => {
    it('validates the envelope and reports newer schemas', () => {
        const good = JSON.stringify({ schemaVersion: 1, seq: 3, writtenAt: START, value: 'v' });
        expect(parseEnvelope(good)).toEqual({ ok: true, envelope: { schemaVersion: 1, seq: 3, writtenAt: START, value: 'v' } });
        expect(parseEnvelope('{"schemaVersion":1,')).toEqual({ ok: false, reason: 'json' });
        expect(parseEnvelope(JSON.stringify({ schemaVersion: 1, seq: -1, writtenAt: START, value: 'v' }))).toEqual({
            ok: false,
            reason: 'shape',
        });
        expect(parseEnvelope(JSON.stringify({ schemaVersion: 1, seq: 1, writtenAt: START, value: {} }))).toEqual({
            ok: false,
            reason: 'shape',
        });
        expect(parseEnvelope(JSON.stringify({ schemaVersion: 2, seq: 1, writtenAt: START, value: 'v' }))).toEqual({
            ok: false,
            reason: 'newer-schema',
            schemaVersion: 2,
        });
        expect(parseEnvelope(JSON.stringify({ schemaVersion: 1, seq: 1, writtenAt: START, value: 'xxxx' }), 1, 3)).toEqual({
            ok: false,
            reason: 'too-large',
        });
    });

    it('reads the persist version from the tail', () => {
        expect(persistVersionOf(persistValue('a', 23))).toBe(23);
        expect(persistVersionOf('not json')).toBeNull();
    });
});

describe('StorageService: init and manifest', () => {
    it('creates the manifest, cleans only its own temp files and tracks clean shutdown', async () => {
        fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
        fs.writeFileSync(path.join(root, '.tmp', 'kobar-storage.json.1.abc.tmp'), 'half');
        fs.writeFileSync(path.join(root, '.tmp', 'keep-me.txt'), 'foreign');
        const first = service().init();
        expect(first).toMatchObject({ available: true, readOnly: false, previousCleanShutdown: null });
        expect(first.manifest).toMatchObject({ schemaVersion: 1, appVersion: '1.3.0-test', lastCleanShutdown: false });
        expect(list('.tmp')).toEqual(['keep-me.txt']);

        const second = service();
        expect(second.init().previousCleanShutdown).toBe(false);
        expect(second.markCleanShutdown()).toBe(true);
        expect(service().init().previousCleanShutdown).toBe(true);
        // A write after markCleanShutdown clears the flag again.
        const third = service();
        third.init();
        expect(third.markCleanShutdown()).toBe(true);
        expect((await third.write({ key: KEY, seq: 1, value: 'v' })).ok).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).lastCleanShutdown).toBe(false);
    });

    it('quarantines a corrupt manifest and keeps unknown fields of a valid one', () => {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'manifest.json'), '{broken');
        expect(service().init()).toMatchObject({ available: true, manifestRecovered: true });
        expect(list('.corrupt')).toHaveLength(1);

        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, futureField: { a: 1 }, disabled: true }));
        const svc = service();
        expect(svc.init().manifest).toMatchObject({ futureField: { a: 1 } });
        // `disabled` inside manifest.json is not the authority (kobar-system.json is, via isDisabled).
        expect(svc.readSnapshot(KEY).disabled).toBe(false);
    });
});

describe('StorageService: write and hydrate', () => {
    it('writes an envelope atomically and hydrates it byte-identically', async () => {
        const value = persistValue('héllo "quoted" \\ line\nbreak');
        const svc = service();
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, source: 'none', seq: 0, value: null });
        expect(await svc.write({ key: KEY, seq: 1, value, baseSeq: 0 })).toEqual({ key: KEY, seq: 1, ok: true });
        expect(readTarget()).toEqual({ schemaVersion: 1, seq: 1, writtenAt: START, value });
        expect(list('.tmp')).toEqual([]);

        const snap = service().readSnapshot(KEY);
        expect(snap).toMatchObject({ ok: true, source: 'file', seq: 1, schemaVersion: 1, writtenAt: START, recoveredFromCorrupt: false });
        expect(snap.value).toBe(value);
    });

    it('rejects invalid requests, unknown keys and oversized values without touching the disk', async () => {
        const svc = service({ maxValueBytes: 16 });
        expect(await svc.write({ key: '../evil', seq: 1, value: 'v' })).toMatchObject({
            ok: false,
            reason: 'invalid-key',
            retryable: false,
        });
        expect(await svc.write({ key: KEY, seq: 0, value: 'v' })).toMatchObject({ ok: false, reason: 'invalid-seq' });
        expect(await svc.write({ key: KEY, seq: 1.5, value: 'v' })).toMatchObject({ ok: false, reason: 'invalid-seq' });
        expect(await svc.write({ key: KEY, seq: 1, value: 42 })).toMatchObject({ ok: false, reason: 'invalid-value' });
        expect(await svc.write(null as never)).toMatchObject({ ok: false, reason: 'invalid-request' });
        expect(await svc.write({ key: KEY, seq: 1, value: 'x'.repeat(17) })).toMatchObject({
            ok: false,
            reason: 'too-large',
            retryable: false,
        });
        expect(svc.writeSync({ key: KEY, seq: 1, value: 'ü'.repeat(9) })).toMatchObject({ ok: false, reason: 'too-large' });
        expect(svc.readSnapshot('host/kobar-storage')).toMatchObject({ ok: false, source: 'none' });
        expect(fs.existsSync(target())).toBe(false);
    });

    it('rejects a seq that is not newer and a writer from an older hydration', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        expect((await svc.write({ key: KEY, seq: 5, value: 'five' })).ok).toBe(true);
        expect(await svc.write({ key: KEY, seq: 5, value: 'again' })).toMatchObject({ ok: false, reason: 'stale', retryable: false });
        expect(svc.writeSync({ key: KEY, seq: 4, value: 'old' })).toMatchObject({ ok: false, reason: 'stale' });
        expect(await svc.write({ key: KEY, seq: 6, value: 'x', baseSeq: 3 })).toMatchObject({ ok: false, reason: 'stale-base' });
        expect(readTarget().value).toBe('five');
    });

    it('serializes and coalesces writes per key: only the newest queued value is written', async () => {
        let targetRenames = 0;
        const svc = service({
            fs: hookedFs((op, args) => {
                if (op === 'renameSync' && args[1] === target()) targetRenames += 1;
            }),
        });
        svc.readSnapshot(KEY);
        const acks = await Promise.all([1, 2, 3].map((seq) => svc.write({ key: KEY, seq, value: `v${seq}` })));
        expect(acks).toEqual([
            { key: KEY, seq: 1, ok: true, superseded: true },
            { key: KEY, seq: 2, ok: true, superseded: true },
            { key: KEY, seq: 3, ok: true },
        ]);
        expect(targetRenames).toBe(1);
        expect(readTarget()).toMatchObject({ seq: 3, value: 'v3' });
        // Out-of-order arrival: a late older seq is rejected while a newer one is queued.
        const newer = svc.write({ key: KEY, seq: 10, value: 'v10' });
        expect(await svc.write({ key: KEY, seq: 9, value: 'v9' })).toMatchObject({ ok: false, reason: 'stale' });
        await newer;
        await svc.flush();
        expect(readTarget().value).toBe('v10');
        expect(svc.lastAcceptedSeq(KEY)).toBe(10);
    });

    it('re-baselines seq on every hydration, including bak and none', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 7, value: 'seven' });
        expect(svc.readSnapshot(KEY).seq).toBe(7);
        expect(await svc.write({ key: KEY, seq: 7, value: 'x' })).toMatchObject({ reason: 'stale' });
        expect((await svc.write({ key: KEY, seq: 8, value: 'eight', baseSeq: 7 })).ok).toBe(true);

        fs.rmSync(path.join(root, 'host'), { recursive: true });
        fs.rmSync(path.join(root, '.bak'), { recursive: true, force: true });
        expect(svc.readSnapshot(KEY)).toMatchObject({ source: 'none', seq: 0 });
        expect((await svc.write({ key: KEY, seq: 1, value: 'fresh', baseSeq: 0 })).ok).toBe(true);
    });

    it('commits an outstanding write before a hydration read', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: 'one' });
        const pending = svc.write({ key: KEY, seq: 2, value: 'two' });
        const snap = svc.readSnapshot(KEY);
        expect(snap).toMatchObject({ source: 'file', seq: 2, value: 'two' });
        expect(await pending).toMatchObject({ ok: true, superseded: true });
    });

    it('never logs values', async () => {
        const secretish = persistValue('sk-test-NOT-A-REAL-SECRET-123');
        const svc = service({
            fs: hookedFs((op, args) => {
                if (op === 'renameSync' && args[1] === target()) throw fsError('EPERM');
            }),
        });
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: secretish });
        expect(logs.length).toBeGreaterThan(0);
        expect(JSON.stringify(logs)).not.toContain('NOT-A-REAL-SECRET');
    });
});

describe('StorageService: failures', () => {
    it('returns ok:false retryable when the rename keeps failing; the target and seq stay unchanged', async () => {
        let locked = false;
        const svc = service({
            fs: hookedFs((op, args) => {
                if (locked && op === 'renameSync' && args[1] === target()) throw fsError('EPERM');
            }),
        });
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: 'old' });
        locked = true;
        sleeps = [];
        expect(await svc.write({ key: KEY, seq: 2, value: 'new' })).toEqual({
            key: KEY,
            seq: 2,
            ok: false,
            reason: 'io',
            retryable: true,
            code: 'EPERM',
        });
        expect(sleeps).toHaveLength(RENAME_MAX_ATTEMPTS - 1);
        expect(readTarget().value).toBe('old');
        expect(list('.tmp')).toEqual([]);
        expect(svc.lastAcceptedSeq(KEY)).toBe(1);
        locked = false;
        expect((await svc.write({ key: KEY, seq: 2, value: 'new' })).ok).toBe(true);
        expect(readTarget().value).toBe('new');
    });

    it('rides out a transient EBUSY', async () => {
        let busy = 2;
        const svc = service({
            fs: hookedFs((op, args) => {
                if (op === 'renameSync' && args[1] === target() && busy > 0) {
                    busy -= 1;
                    throw fsError('EBUSY');
                }
            }),
        });
        svc.readSnapshot(KEY);
        expect((await svc.write({ key: KEY, seq: 1, value: 'v' })).ok).toBe(true);
        expect(sleeps.length).toBe(2);
    });

    it('reports ENOSPC as a retryable failure and keeps the old file', async () => {
        let full = false;
        const svc = service({
            fs: hookedFs((op) => {
                if (full && op === 'writeSync') throw fsError('ENOSPC');
            }),
        });
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: 'kept' });
        full = true;
        expect(await svc.write({ key: KEY, seq: 2, value: 'lost' })).toMatchObject({
            ok: false,
            reason: 'io',
            retryable: true,
            code: 'ENOSPC',
        });
        expect(svc.writeSync({ key: KEY, seq: 2, value: 'lost' })).toMatchObject({ ok: false, code: 'ENOSPC' });
        expect(readTarget().value).toBe('kept');
        expect(list('.tmp')).toEqual([]);
    });

    it('a synchronous write that lands during a retry wait wins; the older async write is dropped', async () => {
        let busy = 1;
        let releaseSleep!: () => void;
        const svc = service({
            sleep: () =>
                new Promise<void>((resolve) => {
                    releaseSleep = resolve;
                }),
            fs: hookedFs((op, args) => {
                if (op === 'renameSync' && args[1] === target() && busy > 0) {
                    busy -= 1;
                    throw fsError('EBUSY');
                }
            }),
        });
        svc.readSnapshot(KEY);
        const asyncWrite = svc.write({ key: KEY, seq: 1, value: 'async' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(svc.writeSync({ key: KEY, seq: 2, value: 'sync' })).toEqual({ key: KEY, seq: 2, ok: true });
        releaseSleep();
        expect(await asyncWrite).toMatchObject({ ok: true, superseded: true });
        expect(readTarget().value).toBe('sync');
        expect(list('.tmp')).toEqual([]);
    });

    it('crash at any fs step leaves either the old or the new file, never a partial one', async () => {
        const steps = ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'copyFileSync', 'renameSync'] as const;
        for (const step of steps) {
            fs.rmSync(root, { recursive: true, force: true });
            let armed = false;
            const svc = service({
                fs: hookedFs((op, args) => {
                    if (!armed || op !== step) return;
                    if (op === 'closeSync') fs.closeSync(args[0] as number); // do not leak the handle
                    throw fsError('EIO');
                }),
            });
            svc.readSnapshot(KEY);
            await svc.write({ key: KEY, seq: 1, value: 'old' });
            svc.readSnapshot(KEY); // forces a backup copy on the next write
            armed = true;
            const ack = await svc.write({ key: KEY, seq: 2, value: 'new' });
            armed = false;
            expect(ack.ok, step).toBe(false);
            expect(readTarget().value, step).toBe('old');
        }
    });

    it('refuses to write through a path outside the root', async () => {
        const svc = service({ isInside: () => false });
        expect(svc.init()).toMatchObject({ available: false, code: 'PATH_GUARD' });
        expect(await svc.write({ key: KEY, seq: 1, value: 'v' })).toMatchObject({ ok: false, reason: 'unavailable' });
        expect(fs.existsSync(root)).toBe(false);
    });

    it('rejects a write whose envelope would exceed the file limit the reader enforces', async () => {
        // 1 MiB of U+0001 passes the value limit, but JSON escapes each char to 6 bytes (> 2 x 1 MiB + 1 MiB).
        const svc = service({ maxValueBytes: 1024 * 1024 });
        svc.readSnapshot(KEY);
        const value = String.fromCharCode(1).repeat(1024 * 1024);
        expect(await svc.write({ key: KEY, seq: 1, value })).toMatchObject({ ok: false, reason: 'too-large', retryable: false });
        expect(svc.writeSync({ key: KEY, seq: 1, value })).toMatchObject({ ok: false, reason: 'too-large' });
        expect(fs.existsSync(target())).toBe(false);
        expect(list('.tmp')).toEqual([]);
    });
});

describe('StorageService: unreadable file', () => {
    async function seeded() {
        let lockReads = 0; // > 0: that many reads of the target fail with EBUSY; Infinity: always
        const svc = service({
            fs: hookedFs((op, args) => {
                if (op === 'readFileSync' && args[0] === target() && lockReads > 0) {
                    lockReads -= 1;
                    throw fsError('EBUSY');
                }
            }),
        });
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 4, value: 'four' });
        now += 1000;
        await svc.write({ key: KEY, seq: 5, value: 'five' }); // .bak holds seq 4
        return { svc, lock: (n: number) => void (lockReads = n) };
    }

    it('retries a transient read error with the rename back-off and then hydrates from the file', async () => {
        const { svc, lock } = await seeded();
        lock(2);
        sleeps = [];
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, source: 'file', seq: 5, value: 'five', unreadable: false });
        expect(sleeps).toEqual([23, 45]); // 20 and 40 ms plus 12.5% jitter (random() = 0.5), rounded
        expect((await svc.write({ key: KEY, seq: 6, value: 'six', baseSeq: 5 })).ok).toBe(true);
    });

    it('a persistent read error never falls back to an older .bak, keeps the baseline and blocks writes', async () => {
        const { svc, lock } = await seeded();
        const before = fs.readFileSync(target(), 'utf8');
        lock(Infinity);
        const snap = svc.readSnapshot(KEY);
        expect(snap).toMatchObject({ ok: false, source: 'none', value: null, unreadable: true, seq: 5 });
        expect(svc.lastAcceptedSeq(KEY)).toBe(5);
        expect(await svc.write({ key: KEY, seq: 6, value: 'blind' })).toMatchObject({ ok: false, reason: 'unreadable', retryable: false });
        expect(svc.writeSync({ key: KEY, seq: 7, value: 'blind' })).toMatchObject({ ok: false, reason: 'unreadable' });
        expect(fs.readFileSync(target(), 'utf8')).toBe(before);
        expect(list('.corrupt')).toEqual([]);

        // A fresh process (no earlier baseline) is blocked the same way.
        const fresh = service({
            fs: hookedFs((op, args) => {
                if (op === 'readFileSync' && args[0] === target()) throw fsError('EPERM');
            }),
        });
        expect(fresh.readSnapshot(KEY)).toMatchObject({ ok: false, unreadable: true, value: null });
        expect(await fresh.write({ key: KEY, seq: 1, value: 'blind' })).toMatchObject({ ok: false, reason: 'unreadable' });
        expect(fs.readFileSync(target(), 'utf8')).toBe(before);

        // Once the file can be read again, a hydration clears the block.
        lock(0);
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, source: 'file', seq: 5, unreadable: false });
        expect((await svc.write({ key: KEY, seq: 6, value: 'six', baseSeq: 5 })).ok).toBe(true);
    });
});

describe('StorageService: backups and recovery', () => {
    it('backs up on the first write after hydration, then at most once per 60 s', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: persistValue('a') });
        expect(list('.bak')).toEqual([]); // nothing to preserve yet
        now += 1000;
        await svc.write({ key: KEY, seq: 2, value: persistValue('b') });
        expect(list('.bak')).toHaveLength(1); // first overwrite in this session
        now += 1000;
        await svc.write({ key: KEY, seq: 3, value: persistValue('c') });
        expect(list('.bak')).toHaveLength(1); // throttled
        now += BAK_MIN_INTERVAL_MS;
        await svc.write({ key: KEY, seq: 4, value: persistValue('d') });
        expect(list('.bak')).toHaveLength(2);
        now += 1000;
        await svc.write({ key: KEY, seq: 5, value: persistValue('e', 23) });
        expect(list('.bak')).toHaveLength(3); // version change = upgrade moment
        const newest = list('.bak')
            .map((n) => parseBakFileName(n)!)
            .sort((a, b) => b.takenAt - a.takenAt)[0];
        expect(newest).toMatchObject({ seq: 4, schema: 1, version: 22 });
    });

    it('never overwrites a newer file without a backup (clock went back)', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: persistValue('a') });
        now += 1000;
        await svc.write({ key: KEY, seq: 2, value: persistValue('b') });
        const before = list('.bak').length;
        now -= 10 * 60 * 1000;
        await svc.write({ key: KEY, seq: 3, value: persistValue('c') });
        expect(list('.bak').length).toBe(before + 1);
    });

    it('keeps .bak bounded over many days of writes', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        let seq = 0;
        for (let day = 0; day < 20; day++) {
            for (let i = 0; i < 5; i++) {
                now += 2 * BAK_MIN_INTERVAL_MS;
                await svc.write({ key: KEY, seq: ++seq, value: persistValue(`d${day}i${i}`) });
            }
            now += DAY;
        }
        expect(list('.bak').length).toBeLessThanOrEqual(3 + 7 + 10);
        expect(list('.bak').length).toBeGreaterThanOrEqual(3);
    });

    it('falls back to the newest valid .bak when the file is corrupt and quarantines it', async () => {
        const svc = service();
        svc.readSnapshot(KEY);
        await svc.write({ key: KEY, seq: 1, value: 'one' });
        now += 1000;
        await svc.write({ key: KEY, seq: 2, value: 'two' }); // .bak = seq 1
        now += BAK_MIN_INTERVAL_MS;
        await svc.write({ key: KEY, seq: 3, value: 'three' }); // .bak = seq 2
        // Newest .bak entry is corrupt too: it must be skipped.
        fs.writeFileSync(path.join(root, '.bak', bakFileName({ key: KEY, takenAt: now + 5, seq: 9, schema: 1, version: null })), '{oops');
        fs.writeFileSync(target(), '{"schemaVersion":1,"seq":3,"wri');

        const fresh = service();
        const snap = fresh.readSnapshot(KEY);
        expect(snap).toMatchObject({ ok: true, source: 'bak', seq: 2, value: 'two', recoveredFromCorrupt: true });
        expect(fs.existsSync(target())).toBe(false);
        expect(list('.corrupt')).toHaveLength(1);
        expect(await fresh.write({ key: KEY, seq: 2, value: 'x' })).toMatchObject({ reason: 'stale' });
        expect((await fresh.write({ key: KEY, seq: 3, value: 'recovered', baseSeq: 2 })).ok).toBe(true);
        expect(readTarget().value).toBe('recovered');
    });

    it("reports 'none' with seq 0 when the file and every .bak are unusable", async () => {
        fs.mkdirSync(path.join(root, 'host'), { recursive: true });
        fs.mkdirSync(path.join(root, '.bak'), { recursive: true });
        fs.writeFileSync(target(), 'not json');
        fs.writeFileSync(path.join(root, '.bak', bakFileName({ key: KEY, takenAt: START, seq: 4, schema: 1, version: 22 })), '[]');
        const svc = service();
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, source: 'none', seq: 0, value: null, recoveredFromCorrupt: true });
        expect((await svc.write({ key: KEY, seq: 1, value: 'v' })).ok).toBe(true);
    });
});

describe('StorageService: read-only and disabled modes', () => {
    it('newer manifest schema: no reads, no writes, no .bak rotation, no .tmp cleanup', async () => {
        fs.mkdirSync(path.join(root, 'host'), { recursive: true });
        fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
        const manifest = JSON.stringify({ schemaVersion: 2, createdBy: 'future', appVersion: '9.0.0', lastCleanShutdown: true });
        fs.writeFileSync(path.join(root, 'manifest.json'), manifest);
        fs.writeFileSync(path.join(root, '.tmp', 'kobar-storage.json.1.abc.tmp'), 'leftover');
        const envelope = JSON.stringify({ schemaVersion: 2, seq: 50, writtenAt: START, value: 'future' });
        fs.writeFileSync(target(), envelope);

        const svc = service();
        expect(svc.init()).toMatchObject({ available: false, readOnly: true });
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, readOnly: true, source: 'none', seq: 0, value: null });
        expect(await svc.write({ key: KEY, seq: 51, value: 'old app' })).toMatchObject({
            ok: false,
            reason: 'read-only',
            retryable: false,
        });
        expect(svc.writeSync({ key: KEY, seq: 52, value: 'old app' })).toMatchObject({ ok: false, reason: 'read-only' });
        expect(svc.markCleanShutdown()).toBe(false);
        expect(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).toBe(manifest);
        expect(fs.readFileSync(target(), 'utf8')).toBe(envelope);
        expect(list('.tmp')).toEqual(['kobar-storage.json.1.abc.tmp']);
        expect(list('.bak')).toEqual([]);
        expect(list('.corrupt')).toEqual([]);
    });

    it('newer envelope schema under a supported manifest also switches to read-only', async () => {
        const svc = service();
        svc.init();
        fs.mkdirSync(path.join(root, 'host'), { recursive: true });
        const envelope = JSON.stringify({ schemaVersion: 3, seq: 9, writtenAt: START, value: 'future' });
        fs.writeFileSync(target(), envelope);
        expect(svc.readSnapshot(KEY)).toMatchObject({ readOnly: true, source: 'none', seq: 0 });
        expect(await svc.write({ key: KEY, seq: 1, value: 'v' })).toMatchObject({ ok: false, reason: 'read-only' });
        expect(fs.readFileSync(target(), 'utf8')).toBe(envelope);
    });

    it('disabled (kobar-system.json authority): the disk is not touched at all', async () => {
        let disabled = true;
        const svc = service({ isDisabled: () => disabled });
        expect(svc.init()).toMatchObject({ available: false, disabled: true });
        expect(svc.readSnapshot(KEY)).toMatchObject({ ok: true, disabled: true, source: 'none', seq: 0 });
        expect(await svc.write({ key: KEY, seq: 1, value: 'v' })).toMatchObject({ ok: false, reason: 'disabled', retryable: false });
        expect(fs.existsSync(root)).toBe(false);
        disabled = false;
        expect((await svc.write({ key: KEY, seq: 1, value: 'v' })).ok).toBe(true);
        const throwing = service({
            isDisabled: () => {
                throw new Error('unreadable kobar-system.json');
            },
        });
        expect(await throwing.write({ key: KEY, seq: 2, value: 'v' })).toMatchObject({ reason: 'disabled' });
    });
});
