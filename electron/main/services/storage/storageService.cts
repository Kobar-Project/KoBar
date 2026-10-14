// T-402: main-process StorageService for userData/kobar-data/.
// Pure Node (no Electron); fs, clock, sleep, randomness, the disabled flag and the path guard are injected so it is
// unit-tested against a temp dir or a fake fs. NOT wired into main.cts yet: T-403 adds the IPC channels and the writer
// authorization (main window top frame only); this module trusts nothing about its caller and validates every request.
//
// Guarantees:
//   - Only allowlisted keys map to files (fixed relative paths); `.bak/` names are parsed before they are read or deleted.
//   - A write is atomic (temp + fsync + rename with Windows retry). On failure the target is untouched and the ack is
//     `ok:false, retryable:true` so the renderer's debounce tries again.
//   - Per key, writes are serialized and coalesced (only the newest queued value is written); a `seq` that is not newer
//     than the last accepted one is rejected, so a late write never replaces a newer one.
//   - `readSnapshot` (hydration) reads the file, then `.bak/` newest first, else reports `source:'none'`; a corrupt file is
//     moved to `.corrupt/`, never deleted. Every hydration re-baselines `seq`, including fallbacks and 'none'.
//   - The first write after a hydration, a write over a NEWER file (writtenAt) and a version change always copy the old
//     file to `.bak/` first; otherwise at most one backup per 60 s (rotation.cts).
//   - A manifest or envelope with a newer storage schema puts the service in read-only mode: no writes, no `.bak/`
//     rotation, no `.tmp/` cleanup, no quarantine moves.
//   - "Disabled" is decided only by the injected `isDisabled` (its source is kobar-system.json); a `disabled`
//     field inside manifest.json is ignored. While disabled the service does not touch the disk at all.
//   - Values are never logged; logs carry the key, an error code and attempt counts only.
import * as nodePath from 'path';
import { isFsPathInside } from '../../../lib/fsGuards.cjs';
import {
    COPYFILE_EXCL,
    type RenameOutcome,
    type StorageFs,
    atomicWriteFileSync,
    RENAME_MAX_ATTEMPTS,
    blockingSleep,
    fsErrorCode,
    isRetryableRenameError,
    renameRetryDelayMs,
    fsyncDirQuietly,
    realStorageFs,
    removeQuietly,
    renameWithRetry,
    renameWithRetrySync,
    tempFilePath,
    timerSleep,
    writeTempFile,
} from './atomicWrite.cjs';
import {
    BAK_DIR_NAME,
    CORRUPT_DIR_NAME,
    MANIFEST_FILE_NAME,
    STORAGE_MAX_VALUE_BYTES,
    STORAGE_SCHEMA_VERSION,
    type StorageKey,
    TMP_DIR_NAME,
    bakFileName,
    corruptFileName,
    isStorageKey,
    isStorageTempName,
    maxFileBytesFor,
    parseBakFileName,
    resolveStoragePath,
    storageKeySegments,
} from './layout.cjs';
import { type BakEntry, planBakPrune, shouldBackup, sortBakNewestFirst } from './rotation.cjs';

const MAX_MANIFEST_BYTES = 64 * 1024;

// ---- envelope + manifest ------------------------------------------------------------------------------------------

/** What `host/<key>.json` holds: the persist string verbatim plus ordering metadata. */
export interface StorageEnvelope {
    schemaVersion: number;
    seq: number;
    /** Epoch ms of the write. */
    writtenAt: number;
    value: string;
}

export type EnvelopeParseResult =
    | { ok: true; envelope: StorageEnvelope }
    | { ok: false; reason: 'json' | 'shape' | 'too-large' }
    | { ok: false; reason: 'newer-schema'; schemaVersion: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an envelope file's text. `newer-schema` means a newer KoBar wrote it (read-only mode). */
export function parseEnvelope(
    text: string,
    supportedSchemaVersion: number = STORAGE_SCHEMA_VERSION,
    maxValueBytes: number = STORAGE_MAX_VALUE_BYTES
): EnvelopeParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'json' };
    }
    if (!isPlainObject(parsed)) return { ok: false, reason: 'shape' };
    const { schemaVersion, seq, writtenAt, value } = parsed;
    if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
        return { ok: false, reason: 'shape' };
    if (schemaVersion > supportedSchemaVersion) return { ok: false, reason: 'newer-schema', schemaVersion };
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return { ok: false, reason: 'shape' };
    if (typeof writtenAt !== 'number' || !Number.isFinite(writtenAt) || writtenAt < 0) return { ok: false, reason: 'shape' };
    if (typeof value !== 'string') return { ok: false, reason: 'shape' };
    if (Buffer.byteLength(value, 'utf8') > maxValueBytes) return { ok: false, reason: 'too-large' };
    return { ok: true, envelope: { schemaVersion, seq, writtenAt, value } };
}

export function serializeEnvelope(envelope: StorageEnvelope): string {
    return JSON.stringify({
        schemaVersion: envelope.schemaVersion,
        seq: envelope.seq,
        writtenAt: envelope.writtenAt,
        value: envelope.value,
    });
}

/**
 * Persist `version` of a zustand persist string (`{"state":...,"version":N}`; `version` is serialized last), read from
 * the tail only so a 20 MB value is not parsed on every write. Used for backup tagging only; null when not found.
 */
export function persistVersionOf(value: string): number | null {
    const match = /"version":(\d{1,6})\}\s*$/.exec(value.slice(-64));
    return match ? Number(match[1]) : null;
}

export interface StorageManifest {
    schemaVersion: number;
    createdBy: string;
    appVersion: string;
    migratedFromLocalStorageAt: number | null;
    lastCleanShutdown: boolean;
    /** Unknown fields written by other versions are kept as they are. */
    [field: string]: unknown;
}

/** Parses manifest.json; null when it is not JSON, not an object or has no valid `schemaVersion`. */
export function parseManifest(text: string): StorageManifest | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isPlainObject(parsed)) return null;
    const schemaVersion = parsed.schemaVersion;
    if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) return null;
    const migratedAt = parsed.migratedFromLocalStorageAt;
    return {
        ...parsed,
        schemaVersion,
        createdBy: typeof parsed.createdBy === 'string' ? parsed.createdBy : 'unknown',
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
        migratedFromLocalStorageAt: typeof migratedAt === 'number' && Number.isFinite(migratedAt) ? migratedAt : null,
        lastCleanShutdown: parsed.lastCleanShutdown === true,
    };
}

// ---- public types -------------------------------------------------------------------------------------------------

export interface StorageServiceOptions {
    /** Absolute path of userData/kobar-data. */
    root: string;
    /** Running app version, recorded in manifest.json. */
    appVersion: string;
    fs?: StorageFs;
    clock?: () => number;
    random?: () => number;
    sleep?: (ms: number) => Promise<void>;
    sleepSync?: (ms: number) => void;
    pid?: number;
    /** The only authority for "file store disabled" (backed by kobar-system.json in the caller). Throwing counts as disabled. */
    isDisabled?: () => boolean;
    /** Link-aware containment check (default: fsGuards `isFsPathInside`). */
    isInside?: (base: string, target: string) => boolean;
    supportedSchemaVersion?: number;
    maxValueBytes?: number;
    log?: (event: string, details?: Record<string, string | number | boolean>) => void;
}

export interface StorageInitResult {
    /** The store can be read and written. */
    available: boolean;
    /** Data on disk was written by a newer storage schema: nothing is read or written. */
    readOnly: boolean;
    disabled: boolean;
    manifest: StorageManifest | null;
    /** `lastCleanShutdown` of the previous session, or null when there was no (valid) manifest. */
    previousCleanShutdown: boolean | null;
    /** A corrupt manifest.json was moved to `.corrupt/` and recreated. */
    manifestRecovered: boolean;
    code?: string;
}

export type SnapshotSource = 'file' | 'bak' | 'none';

export interface StorageSnapshot {
    /** False when reading failed unexpectedly (the caller falls back to localStorage, like 'none'). */
    ok: boolean;
    key: string;
    source: SnapshotSource;
    /** The new seq baseline: the renderer continues from here, main accepts only larger values. */
    seq: number;
    schemaVersion: number;
    value: string | null;
    writtenAt: number | null;
    readOnly: boolean;
    disabled: boolean;
    manifest: StorageManifest | null;
    /** The main file was corrupt (moved to `.corrupt/` when possible). */
    recoveredFromCorrupt: boolean;
    /**
     * The file (or a newer `.bak`) exists but could not be read even after retries (e.g. locked). Nothing older is
     * returned instead, the seq baseline is NOT lowered and writes for the key are rejected until a hydration succeeds.
     */
    unreadable: boolean;
}

export interface StorageWriteRequest {
    key: unknown;
    seq: unknown;
    value: unknown;
    /** Optional: the seq the writer received from its hydration snapshot. A mismatch means the writer is from an older hydration. */
    baseSeq?: unknown;
}

export type StorageWriteFailure =
    | 'invalid-request'
    | 'invalid-key'
    | 'invalid-seq'
    | 'invalid-value'
    | 'too-large'
    | 'stale'
    | 'stale-base'
    | 'read-only'
    | 'disabled'
    | 'unavailable'
    | 'io'
    | 'backup-failed'
    | 'rehydrated'
    | 'unreadable';

export interface StorageWriteAck {
    key: string;
    seq: number;
    ok: boolean;
    reason?: StorageWriteFailure;
    /** True when the same data may be sent again later (I/O trouble); false for rejections that will never succeed. */
    retryable?: boolean;
    code?: string;
    /** A newer seq for the same key was written instead of (or together with) this one. */
    superseded?: boolean;
}

export interface StorageService {
    readonly root: string;
    /** Reads/creates manifest.json, detects read-only mode, cleans `.tmp/`. Idempotent; retried only while unavailable. */
    init(): StorageInitResult;
    /** Synchronous hydration read. Never throws. */
    readSnapshot(key: unknown): StorageSnapshot;
    /** Queued, coalesced asynchronous write. Never rejects. */
    write(request: StorageWriteRequest): Promise<StorageWriteAck>;
    /** Synchronous write for the one-shot unload path (`storage-write-sync`). Never throws. */
    writeSync(request: StorageWriteRequest): StorageWriteAck;
    /** Resolves when every queued write has finished. */
    flush(): Promise<void>;
    /** Records a clean shutdown in manifest.json (call after `flush`). False when writes are still outstanding or it failed. */
    markCleanShutdown(): boolean;
    /**
     * T-404: records `manifest.migratedFromLocalStorageAt` (epoch ms) once the localStorage snapshot is complete. The first
     * recorded time is kept (true without a write when it is already set). False when the store is unavailable or the write failed.
     */
    recordLocalStorageMigration(at: number): boolean;
    /** Highest accepted seq for a key (diagnostics/tests). */
    lastAcceptedSeq(key: StorageKey): number;
}

// ---- internals ----------------------------------------------------------------------------------------------------

interface Waiter {
    seq: number;
    resolve: (ack: StorageWriteAck) => void;
}

interface Job {
    seq: number;
    value: string;
    waiters: Waiter[];
    cancelled: boolean;
}

interface FileMeta {
    seq: number;
    schema: number;
    version: number | null;
    writtenAt: number | null;
}

interface KeyState {
    key: StorageKey;
    lastAccepted: number;
    baseSeq: number | null;
    forceBackup: boolean;
    lastBackupAt: number | null;
    /** The current target file: undefined = not known yet, null = no file. Only main writes it, so the cache stays valid. */
    current: FileMeta | null | undefined;
    pending: Job | null;
    running: Job | null;
    drain: Promise<void> | null;
    /** The last hydration could not read the file: writes are refused until a hydration succeeds. */
    unreadable: boolean;
}

type AckTemplate = Omit<StorageWriteAck, 'key' | 'seq'>;

type FileRead<T> =
    { kind: 'missing' } | { kind: 'ok'; value: T } | { kind: 'corrupt' } | { kind: 'newer' } | { kind: 'error'; code: string };

const COVERED: AckTemplate = { ok: true, superseded: true };
const REHYDRATED: AckTemplate = { ok: false, reason: 'rehydrated', retryable: false };

function fail(reason: StorageWriteFailure, retryable: boolean, code?: string): AckTemplate {
    return code === undefined ? { ok: false, reason, retryable } : { ok: false, reason, retryable, code };
}

function metaOf(envelope: StorageEnvelope): FileMeta {
    return { seq: envelope.seq, schema: envelope.schemaVersion, version: persistVersionOf(envelope.value), writtenAt: envelope.writtenAt };
}

function versionTag(schema: number, version: number | null): string | null {
    return schema > 0 && version !== null ? `${schema}/${version}` : null;
}

export function createStorageService(options: StorageServiceOptions): StorageService {
    if (typeof options.root !== 'string' || !nodePath.isAbsolute(options.root))
        throw new Error('StorageService root must be an absolute path');
    const fs = options.fs ?? realStorageFs;
    const clock = options.clock ?? Date.now;
    const random = options.random ?? Math.random;
    const sleep = options.sleep ?? timerSleep;
    const sleepSync = options.sleepSync ?? blockingSleep;
    const pid = options.pid ?? process.pid;
    const supported = options.supportedSchemaVersion ?? STORAGE_SCHEMA_VERSION;
    const maxValueBytes = options.maxValueBytes ?? STORAGE_MAX_VALUE_BYTES;
    const maxFileBytes = maxFileBytesFor(maxValueBytes);
    const isInside = options.isInside ?? isFsPathInside;
    const log = options.log ?? ((event, details) => console.warn('[KoBar] storage:', event, details ?? {}));
    const root = nodePath.resolve(options.root);
    const tmpDir = nodePath.join(root, TMP_DIR_NAME);
    const bakDir = nodePath.join(root, BAK_DIR_NAME);
    const corruptDir = nodePath.join(root, CORRUPT_DIR_NAME);
    const manifestPath = nodePath.join(root, MANIFEST_FILE_NAME);
    const retryTiming = { random, sleepSync, pid };

    const states = new Map<StorageKey, KeyState>();
    let initResult: StorageInitResult | null = null;

    function disabledNow(): boolean {
        try {
            return options.isDisabled ? options.isDisabled() === true : false;
        } catch {
            return true;
        }
    }

    function guard(p: string): string {
        if (!isInside(root, p)) throw Object.assign(new Error('storage path guard'), { code: 'PATH_GUARD' });
        return p;
    }

    function keyPath(key: StorageKey): string {
        const resolved = resolveStoragePath(root, storageKeySegments(key));
        if (resolved === null) throw Object.assign(new Error('storage path guard'), { code: 'PATH_GUARD' });
        return guard(resolved);
    }

    function stateOf(key: StorageKey): KeyState {
        let st = states.get(key);
        if (!st) {
            st = {
                key,
                // Without a hydration the baseline is 0 and any seq >= 1 is accepted. The IPC layer (T-403) must call
                // readSnapshot before the first write and always send `baseSeq`; this service does not enforce either.
                lastAccepted: 0,
                baseSeq: null,
                forceBackup: true,
                lastBackupAt: null,
                current: undefined,
                pending: null,
                running: null,
                drain: null,
                unreadable: false,
            };
            states.set(key, st);
        }
        return st;
    }

    /**
     * Reads a text file. Transient errors (EPERM/EBUSY/EACCES: a scanner or indexer holding the file) are retried with the
     * same back-off as a rename; a persistent one is reported as `error`, which is never treated like `missing`.
     */
    function readTextFile(p: string, maxBytes: number): FileRead<string> {
        for (let attempt = 1; ; attempt++) {
            try {
                const stat = fs.statSync(p);
                if (!stat.isFile() || stat.size > maxBytes) return { kind: 'corrupt' };
                return { kind: 'ok', value: fs.readFileSync(p, 'utf8') };
            } catch (err) {
                const code = fsErrorCode(err);
                if (code === 'ENOENT') return { kind: 'missing' };
                if (!isRetryableRenameError(err) || attempt >= RENAME_MAX_ATTEMPTS) return { kind: 'error', code };
            }
            sleepSync(renameRetryDelayMs(attempt, random));
        }
    }

    function fileExists(p: string): boolean {
        try {
            fs.statSync(p);
            return true;
        } catch (err) {
            return fsErrorCode(err) !== 'ENOENT';
        }
    }

    function readEnvelopeAt(p: string): FileRead<StorageEnvelope> {
        const read = readTextFile(guard(p), maxFileBytes);
        if (read.kind !== 'ok') return read;
        const parsed = parseEnvelope(read.value, supported, maxValueBytes);
        if (parsed.ok) return { kind: 'ok', value: parsed.envelope };
        return parsed.reason === 'newer-schema' ? { kind: 'newer' } : { kind: 'corrupt' };
    }

    /** Moves a corrupt file into `.corrupt/` (never deletes it). Not allowed in read-only mode. */
    function quarantine(p: string): boolean {
        if (initResult?.readOnly) return false;
        try {
            guard(corruptDir);
            fs.mkdirSync(corruptDir, { recursive: true });
            const baseName = corruptFileName(nodePath.basename(p), clock());
            // Never replace an earlier quarantined file (rename would overwrite it).
            let dest = guard(nodePath.join(corruptDir, baseName));
            for (let n = 1; fileExists(dest); n++) dest = guard(nodePath.join(corruptDir, `${baseName}-${n}`));
            const moved = renameWithRetrySync(fs, p, dest, retryTiming);
            if (!moved.ok) log('quarantine-failed', { file: nodePath.basename(p), code: moved.code });
            return moved.ok;
        } catch (err) {
            log('quarantine-failed', { file: nodePath.basename(p), code: fsErrorCode(err) });
            return false;
        }
    }

    function listBak(key: StorageKey): BakEntry[] {
        let names: string[];
        try {
            names = fs.readdirSync(guard(bakDir));
        } catch {
            return [];
        }
        const entries: BakEntry[] = [];
        for (const name of names) {
            const info = parseBakFileName(name);
            if (info && info.key === key) entries.push({ ...info, name });
        }
        return entries;
    }

    function cleanTmp(): void {
        if (initResult?.readOnly) return;
        let names: string[];
        try {
            names = fs.readdirSync(guard(tmpDir));
        } catch {
            return;
        }
        for (const name of names) if (isStorageTempName(name)) removeQuietly(fs, nodePath.join(tmpDir, name));
    }

    function unavailable(code: string): StorageInitResult {
        log('unavailable', { code });
        return {
            available: false,
            readOnly: false,
            disabled: false,
            manifest: null,
            previousCleanShutdown: null,
            manifestRecovered: false,
            code,
        };
    }

    function doInit(): StorageInitResult {
        try {
            const read = readTextFile(guard(manifestPath), MAX_MANIFEST_BYTES);
            if (read.kind === 'error') return unavailable(read.code);
            const parsed = read.kind === 'ok' ? parseManifest(read.value) : null;
            if (parsed && parsed.schemaVersion > supported) {
                log('read-only', { schemaVersion: parsed.schemaVersion });
                return {
                    available: false,
                    readOnly: true,
                    disabled: false,
                    manifest: parsed,
                    previousCleanShutdown: null,
                    manifestRecovered: false,
                };
            }
            fs.mkdirSync(root, { recursive: true });
            let manifestRecovered = false;
            if ((read.kind === 'ok' && !parsed) || read.kind === 'corrupt') {
                manifestRecovered = true;
                if (!quarantine(manifestPath)) return unavailable('MANIFEST_CORRUPT');
            }
            const appVersion = options.appVersion;
            const base: StorageManifest = parsed ?? {
                schemaVersion: supported,
                createdBy: `KoBar ${appVersion}`,
                appVersion,
                migratedFromLocalStorageAt: null,
                lastCleanShutdown: false,
            };
            const manifest: StorageManifest = { ...base, appVersion, lastCleanShutdown: false };
            fs.mkdirSync(guard(tmpDir), { recursive: true });
            const written = atomicWriteFileSync(fs, manifestPath, tmpDir, JSON.stringify(manifest, null, 2), retryTiming);
            if (!written.ok) return unavailable(written.code);
            const result: StorageInitResult = {
                available: true,
                readOnly: false,
                disabled: false,
                manifest,
                previousCleanShutdown: parsed ? parsed.lastCleanShutdown : null,
                manifestRecovered,
            };
            initResult = result;
            cleanTmp();
            return result;
        } catch (err) {
            return unavailable(fsErrorCode(err));
        }
    }

    function init(): StorageInitResult {
        if (disabledNow()) {
            return {
                available: false,
                readOnly: false,
                disabled: true,
                manifest: null,
                previousCleanShutdown: null,
                manifestRecovered: false,
            };
        }
        if (initResult && (initResult.available || initResult.readOnly)) return initResult;
        initResult = doInit();
        return initResult;
    }

    /** An envelope with a newer storage schema was found although the manifest looked supported: stop writing for this session. */
    function enterReadOnly(): void {
        log('read-only', { source: 'envelope' });
        const manifest = initResult?.manifest ?? null;
        initResult = { available: false, readOnly: true, disabled: false, manifest, previousCleanShutdown: null, manifestRecovered: false };
    }

    /** Atomically rewrites manifest.json. Never throws. */
    function writeManifest(manifest: StorageManifest): boolean {
        try {
            const written = atomicWriteFileSync(fs, manifestPath, guard(tmpDir), JSON.stringify(manifest, null, 2), retryTiming);
            if (written.ok && initResult) initResult = { ...initResult, manifest };
            return written.ok;
        } catch {
            return false;
        }
    }

    // ---- write path -------------------------------------------------------------------------------------------------

    /** Copies the file about to be replaced into `.bak/` when the policy asks for it, then prunes `.bak/`. */
    function preserveExisting(st: KeyState, target: string, value: string, now: number): { ok: true } | { ok: false; code: string } {
        let current = st.current;
        if (current === undefined) {
            const read = readEnvelopeAt(target);
            if (read.kind === 'ok') current = metaOf(read.value);
            else if (read.kind === 'missing') current = null;
            else if (read.kind === 'corrupt') {
                if (!quarantine(target)) return { ok: false, code: 'CORRUPT_MOVE' };
                current = null;
            } else if (read.kind === 'newer') {
                enterReadOnly();
                return { ok: false, code: 'NEWER_SCHEMA' };
            } else return { ok: false, code: read.code }; // exists but unreadable: never overwrite what cannot be preserved
            st.current = current;
        }
        if (current === null) return { ok: true };
        const backup = shouldBackup({
            forced: st.forceBackup,
            now,
            lastBackupAt: st.lastBackupAt,
            existingWrittenAt: current.writtenAt,
            existingTag: versionTag(current.schema, current.version),
            incomingTag: versionTag(supported, persistVersionOf(value)),
        });
        if (!backup) return { ok: true };

        const name = bakFileName({ key: st.key, takenAt: now, seq: current.seq, schema: current.schema, version: current.version });
        const bakTemp = tempFilePath(tmpDir, `${nodePath.basename(target)}.bak`, pid, random);
        try {
            guard(bakDir);
            fs.mkdirSync(bakDir, { recursive: true });
            fs.copyFileSync(target, bakTemp, COPYFILE_EXCL);
            const moved = renameWithRetrySync(fs, bakTemp, guard(nodePath.join(bakDir, name)), retryTiming);
            if (!moved.ok) {
                removeQuietly(fs, bakTemp);
                return { ok: false, code: moved.code };
            }
        } catch (err) {
            removeQuietly(fs, bakTemp);
            if (fsErrorCode(err) === 'ENOENT' && !fileExists(target)) {
                // The file disappeared outside KoBar: there is nothing left to preserve.
                st.current = null;
                return { ok: true };
            }
            return { ok: false, code: fsErrorCode(err) };
        }
        st.lastBackupAt = now;
        st.forceBackup = false;
        try {
            for (const stale of planBakPrune(listBak(st.key), now)) removeQuietly(fs, guard(nodePath.join(bakDir, stale)));
        } catch {
            /* pruning is best effort; a failed prune only keeps extra backups */
        }
        return { ok: true };
    }

    type Prepared = { ok: true; tempPath: string; target: string; meta: FileMeta } | { ok: false; ack: AckTemplate };

    /**
     * Writes the temp file and preserves the current file. Synchronous; the caller renames.
     * Known limit: writeSync/fsyncSync/copyFileSync (and the sync back-off of reads and the backup rename) run on the
     * main thread, so a large value blocks it for the duration of the write; T-403 measures this before wiring it in.
     */
    function prepare(st: KeyState, seq: number, value: string): Prepared {
        let target: string;
        try {
            target = keyPath(st.key);
            guard(tmpDir);
            fs.mkdirSync(nodePath.dirname(target), { recursive: true });
            fs.mkdirSync(tmpDir, { recursive: true });
        } catch (err) {
            const code = fsErrorCode(err);
            log('write-failed', { key: st.key, code });
            return { ok: false, ack: code === 'PATH_GUARD' ? fail('unavailable', false, code) : fail('io', true, code) };
        }
        const now = clock();
        const envelope: StorageEnvelope = { schemaVersion: supported, seq, writtenAt: now, value };
        const serialized = serializeEnvelope(envelope);
        if (Buffer.byteLength(serialized, 'utf8') > maxFileBytes) {
            // The reader would treat a file this large as corrupt, so it is never written.
            log('rejected', { key: st.key, reason: 'too-large' });
            return { ok: false, ack: fail('too-large', false) };
        }
        const tempPath = tempFilePath(tmpDir, nodePath.basename(target), pid, random);
        try {
            writeTempFile(fs, tempPath, serialized);
        } catch (err) {
            const code = fsErrorCode(err);
            log('write-failed', { key: st.key, code });
            return { ok: false, ack: fail('io', true, code) };
        }
        const kept = preserveExisting(st, target, value, now);
        if (!kept.ok) {
            removeQuietly(fs, tempPath);
            log('backup-failed', { key: st.key, code: kept.code });
            return { ok: false, ack: kept.code === 'NEWER_SCHEMA' ? fail('read-only', false) : fail('backup-failed', true, kept.code) };
        }
        return { ok: true, tempPath, target, meta: metaOf(envelope) };
    }

    function finish(st: KeyState, seq: number, prepared: Extract<Prepared, { ok: true }>, outcome: RenameOutcome): AckTemplate {
        if (!outcome.ok) {
            removeQuietly(fs, prepared.tempPath);
            log('write-failed', { key: st.key, code: outcome.code, attempts: outcome.attempts });
            return fail('io', true, outcome.code);
        }
        fsyncDirQuietly(fs, nodePath.dirname(prepared.target));
        st.lastAccepted = seq;
        st.current = prepared.meta;
        // A write after markCleanShutdown means the session did not end there after all.
        if (initResult?.manifest?.lastCleanShutdown) writeManifest({ ...initResult.manifest, lastCleanShutdown: false });
        return { ok: true };
    }

    /** Gate shared by every write: disabled, read-only, availability. */
    function gateState(): AckTemplate | null {
        if (disabledNow()) return fail('disabled', false);
        const status = init();
        if (status.readOnly) return fail('read-only', false);
        if (!status.available) return fail('unavailable', true, status.code);
        return null;
    }

    function highestKnown(st: KeyState): number {
        let max = st.lastAccepted;
        if (st.running && !st.running.cancelled) max = Math.max(max, st.running.seq);
        if (st.pending) max = Math.max(max, st.pending.seq);
        return max;
    }

    type Validated =
        { ok: true; key: StorageKey; seq: number; value: string; baseSeq: number | undefined } | { ok: false; ack: StorageWriteAck };

    function validate(request: unknown): Validated {
        if (!isPlainObject(request)) return { ok: false, ack: { key: '', seq: 0, ...fail('invalid-request', false) } };
        const { key, seq, value, baseSeq } = request;
        const ackKey = typeof key === 'string' ? key.slice(0, 64) : '';
        const ackSeq = typeof seq === 'number' && Number.isFinite(seq) ? seq : 0;
        if (!isStorageKey(key)) return { ok: false, ack: { key: ackKey, seq: ackSeq, ...fail('invalid-key', false) } };
        if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1)
            return { ok: false, ack: { key, seq: ackSeq, ...fail('invalid-seq', false) } };
        if (baseSeq !== undefined && (typeof baseSeq !== 'number' || !Number.isSafeInteger(baseSeq) || baseSeq < 0)) {
            return { ok: false, ack: { key, seq, ...fail('invalid-seq', false) } };
        }
        if (typeof value !== 'string') return { ok: false, ack: { key, seq, ...fail('invalid-value', false) } };
        if (Buffer.byteLength(value, 'utf8') > maxValueBytes) {
            log('rejected', { key, reason: 'too-large' });
            return { ok: false, ack: { key, seq, ...fail('too-large', false) } };
        }
        return { ok: true, key, seq, value, baseSeq: baseSeq as number | undefined };
    }

    /** Rejections that depend on the current state (call right before queueing / writing). */
    function admit(st: KeyState, v: Extract<Validated, { ok: true }>): AckTemplate | null {
        const gated = gateState();
        if (gated) return gated;
        if (st.unreadable) return fail('unreadable', false);
        if (v.seq <= highestKnown(st)) return fail('stale', false);
        if (v.baseSeq !== undefined && st.baseSeq !== null && v.baseSeq !== st.baseSeq) return fail('stale-base', false);
        return null;
    }

    function settle(job: Job, template: AckTemplate): void {
        for (const waiter of job.waiters) {
            const ack: StorageWriteAck = { key: '', seq: waiter.seq, ...template };
            if (waiter.seq !== job.seq) ack.superseded = true;
            waiter.resolve(ack);
        }
    }

    /** Synchronous commit (unload path and draining outstanding writes before a hydration read). */
    function commitSync(st: KeyState, seq: number, value: string): AckTemplate {
        try {
            const prepared = prepare(st, seq, value);
            if (!prepared.ok) return prepared.ack;
            return finish(st, seq, prepared, renameWithRetrySync(fs, prepared.tempPath, prepared.target, retryTiming));
        } catch (err) {
            return fail('io', true, fsErrorCode(err));
        }
    }

    function abandoned(st: KeyState, job: Job): AckTemplate {
        if (job.cancelled) return REHYDRATED;
        if (job.seq <= st.lastAccepted) return COVERED;
        return gateState() ?? fail('io', true, 'ABORTED');
    }

    async function runJob(st: KeyState, job: Job): Promise<AckTemplate> {
        if (job.cancelled || job.seq <= st.lastAccepted) return abandoned(st, job);
        const gated = gateState();
        if (gated) return gated;
        const prepared = prepare(st, job.seq, job.value);
        if (!prepared.ok) return prepared.ack;
        const outcome = await renameWithRetry(fs, prepared.tempPath, prepared.target, {
            random,
            sleep,
            shouldContinue: () => !job.cancelled && job.seq > st.lastAccepted && !disabledNow(),
        });
        if (!outcome.ok && outcome.aborted) {
            removeQuietly(fs, prepared.tempPath);
            return abandoned(st, job);
        }
        return finish(st, job.seq, prepared, outcome);
    }

    function scheduleDrain(st: KeyState): void {
        if (st.drain) return;
        st.drain = (async () => {
            // Yield once so `st.drain` is assigned before the loop can finish (and so same-tick writes coalesce).
            await Promise.resolve();
            try {
                while (st.pending) {
                    const job = st.pending;
                    st.pending = null;
                    st.running = job;
                    let template: AckTemplate;
                    try {
                        template = await runJob(st, job);
                    } catch (err) {
                        template = fail('io', true, fsErrorCode(err));
                    }
                    st.running = null;
                    settle(job, template);
                }
            } finally {
                st.drain = null;
            }
        })();
    }

    /**
     * Before a hydration read: commit the newest outstanding write synchronously so the snapshot (and the new seq
     * baseline) include it. If that fails, outstanding writes are cancelled so they can never land after the baseline.
     */
    function settleOutstanding(st: KeyState): void {
        const jobs = [st.running, st.pending].filter((job): job is Job => job !== null && !job.cancelled);
        if (jobs.length === 0) return;
        const newest = jobs.reduce((a, b) => (b.seq > a.seq ? b : a));
        const committed = newest.seq <= st.lastAccepted || commitSync(st, newest.seq, newest.value).ok;
        if (!committed) for (const job of jobs) job.cancelled = true;
        if (st.pending) {
            const pending = st.pending;
            st.pending = null;
            settle(pending, committed ? COVERED : REHYDRATED);
        }
    }

    // ---- public API -------------------------------------------------------------------------------------------------

    function readSnapshot(keyInput: unknown): StorageSnapshot {
        const empty: StorageSnapshot = {
            ok: true,
            key: typeof keyInput === 'string' ? keyInput.slice(0, 64) : '',
            source: 'none',
            seq: 0,
            schemaVersion: supported,
            value: null,
            writtenAt: null,
            readOnly: false,
            disabled: false,
            manifest: null,
            recoveredFromCorrupt: false,
            unreadable: false,
        };
        if (!isStorageKey(keyInput)) return { ...empty, ok: false };
        const st = stateOf(keyInput);
        const rebaseline = (seq: number, current: FileMeta | null | undefined) => {
            st.lastAccepted = seq;
            st.baseSeq = seq;
            st.forceBackup = true;
            st.current = current;
            st.unreadable = false;
        };
        const status = init();
        /** Data exists but cannot be read: keep the current baseline (never lower it) and refuse writes until a hydration succeeds. */
        const unreadable = (code: string): StorageSnapshot => {
            log('read-failed', { key: keyInput, code });
            st.unreadable = true;
            st.current = undefined;
            return { ...empty, ok: false, seq: st.lastAccepted, manifest: status.manifest, unreadable: true };
        };
        if (status.disabled) {
            rebaseline(0, undefined);
            return { ...empty, disabled: true };
        }
        if (status.readOnly || !status.available) {
            rebaseline(0, undefined);
            return { ...empty, ok: status.readOnly, readOnly: status.readOnly, manifest: status.manifest };
        }
        try {
            settleOutstanding(st);
            const target = keyPath(keyInput);
            const main = readEnvelopeAt(target);
            if (main.kind === 'error') return unreadable(main.code);
            if (main.kind === 'newer') {
                enterReadOnly();
                rebaseline(0, undefined);
                return { ...empty, readOnly: true, manifest: status.manifest };
            }
            if (main.kind === 'ok') {
                rebaseline(main.value.seq, metaOf(main.value));
                return {
                    ...empty,
                    source: 'file',
                    seq: main.value.seq,
                    schemaVersion: main.value.schemaVersion,
                    value: main.value.value,
                    writtenAt: main.value.writtenAt,
                    manifest: status.manifest,
                };
            }
            let current: FileMeta | null | undefined = main.kind === 'missing' ? null : undefined;
            const recoveredFromCorrupt = main.kind === 'corrupt';
            if (recoveredFromCorrupt) {
                log('corrupt', { key: keyInput });
                if (quarantine(target)) current = null;
            }
            for (const entry of sortBakNewestFirst(listBak(keyInput))) {
                const bak = readEnvelopeAt(nodePath.join(bakDir, entry.name));
                // A newer backup that cannot be read must not be skipped in favour of an older one.
                if (bak.kind === 'error') return unreadable(bak.code);
                if (bak.kind !== 'ok') continue;
                rebaseline(bak.value.seq, current);
                return {
                    ...empty,
                    source: 'bak',
                    seq: bak.value.seq,
                    schemaVersion: bak.value.schemaVersion,
                    value: bak.value.value,
                    writtenAt: bak.value.writtenAt,
                    manifest: status.manifest,
                    recoveredFromCorrupt,
                };
            }
            rebaseline(0, current);
            return { ...empty, manifest: status.manifest, recoveredFromCorrupt };
        } catch (err) {
            return unreadable(fsErrorCode(err));
        }
    }

    function write(request: StorageWriteRequest): Promise<StorageWriteAck> {
        const v = validate(request);
        if (!v.ok) return Promise.resolve(v.ack);
        const st = stateOf(v.key);
        const rejected = admit(st, v);
        if (rejected) return Promise.resolve({ key: v.key, seq: v.seq, ...rejected });
        return new Promise<StorageWriteAck>((resolve) => {
            const waiter: Waiter = { seq: v.seq, resolve: (ack) => resolve({ ...ack, key: v.key }) };
            if (st.pending) {
                // Coalesce: only the newest queued value is written; earlier callers get its outcome (superseded).
                st.pending.seq = v.seq;
                st.pending.value = v.value;
                st.pending.waiters.push(waiter);
            } else {
                st.pending = { seq: v.seq, value: v.value, waiters: [waiter], cancelled: false };
            }
            scheduleDrain(st);
        });
    }

    function writeSync(request: StorageWriteRequest): StorageWriteAck {
        const v = validate(request);
        if (!v.ok) return v.ack;
        const st = stateOf(v.key);
        const rejected = admit(st, v);
        if (rejected) return { key: v.key, seq: v.seq, ...rejected };
        return { key: v.key, seq: v.seq, ...commitSync(st, v.seq, v.value) };
    }

    async function flush(): Promise<void> {
        for (;;) {
            const drains = [...states.values()].map((st) => st.drain).filter((d): d is Promise<void> => d !== null);
            if (drains.length === 0) return;
            await Promise.all(drains);
        }
    }

    function markCleanShutdown(): boolean {
        if (disabledNow() || !initResult?.available || !initResult.manifest) return false;
        for (const st of states.values()) if (st.pending || st.running) return false;
        return writeManifest({ ...initResult.manifest, lastCleanShutdown: true });
    }

    function recordLocalStorageMigration(at: number): boolean {
        if (disabledNow() || !initResult?.available || !initResult.manifest) return false;
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return false;
        if (initResult.manifest.migratedFromLocalStorageAt !== null) return true;
        return writeManifest({ ...initResult.manifest, migratedFromLocalStorageAt: Math.trunc(at) });
    }

    return {
        root,
        init,
        readSnapshot,
        write,
        writeSync,
        flush,
        markCleanShutdown,
        recordLocalStorageMigration,
        lastAcceptedSeq: (key) => stateOf(key).lastAccepted,
    };
}
