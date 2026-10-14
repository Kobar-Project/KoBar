// Main-process side of the full backup restore (T-213, PROD-14). The renderer validates the backup (src/backup/
// parseBackup.ts), writes the localStorage entries and then asks main to finish. Main only:
//   - stores the automatic pre-restore full backup (built by the renderer WITHOUT secrets) in userData/backups/,
//   - applies the backup's plugin enabled flags to extensions-config.json under a strict rule (see
//     restrictExtensionsConfig: installed plugins only, a restore may only keep or DISABLE, never enable),
//   - relaunches the app.
// A restore never installs, removes or enables a plugin. No Electron imports; fs is injectable for unit tests.

import * as nodeFs from 'fs';
import * as path from 'path';
import { validateFullBackupText } from './fullBackup.cjs';

/** Pre-restore backups kept in userData/backups/ (only files matching PRE_RESTORE_NAME_PATTERN are ever pruned). */
export const PRE_RESTORE_KEEP = 3;
/**
 * The relaunch is accepted only this long after a successful pre-restore backup (one use per backup). Short on
 * purpose: a restore that failed in the renderer after its backup leaves the gate open only briefly.
 */
export const PRE_RESTORE_GATE_MS = 2 * 60 * 1000;

/** Pre-delete backups kept: a workspace delete is more frequent than a restore, so more of them are kept. */
export const PRE_DELETE_KEEP = 10;

/**
 * Automatic full backups in userData/backups/. `pre-restore` is made before a restore (T-213) and opens the relaunch
 * gate; `pre-delete` is made before a workspace is deleted (T-214) and never touches the gate. Each kind has its own
 * file names and is pruned separately (PRE_RESTORE_KEEP / PRE_DELETE_KEEP newest of each kind are kept).
 * The `PreRestore` function names below are historical (T-213); they serve both kinds and are not renamed on purpose.
 */
export type AutomaticBackupKind = 'pre-restore' | 'pre-delete';

const KEEP_BY_KIND: Record<AutomaticBackupKind, number> = { 'pre-restore': PRE_RESTORE_KEEP, 'pre-delete': PRE_DELETE_KEEP };

const NAME_PATTERNS: Record<AutomaticBackupKind, RegExp> = {
    'pre-restore': /^kobar-full-backup\.pre-restore\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-(\d+))?\.json$/,
    'pre-delete': /^kobar-full-backup\.pre-delete\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-(\d+))?\.json$/,
};
/** Leftover temp files of an interrupted automatic backup write (our own naming only). */
const TEMP_PATTERNS: Record<AutomaticBackupKind, RegExp> = {
    'pre-restore': /^\.kobar-full-backup\.pre-restore\..*\.tmp$/,
    'pre-delete': /^\.kobar-full-backup\.pre-delete\..*\.tmp$/,
};
const PRE_RESTORE_NAME_PATTERN = NAME_PATTERNS['pre-restore'];

/** The subset of `fs` used here (injectable for tests). */
export interface RestoreFs {
    mkdirSync(p: string, options: { recursive: true }): unknown;
    readdirSync(p: string): string[];
    writeFileSync(p: string, data: string, options: { encoding: 'utf8'; flag: 'wx' }): void;
    renameSync(from: string, to: string): void;
    unlinkSync(p: string): void;
}

function realFs(): RestoreFs {
    return nodeFs as unknown as RestoreFs;
}

function tempSuffix(): string {
    return `${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}

/** `kobar-full-backup.<kind>.<UTC timestamp>.json` (kind defaults to `pre-restore`). */
export function preRestoreBackupFileName(now: Date, kind: AutomaticBackupKind = 'pre-restore'): string {
    const time = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
    return `kobar-full-backup.${kind}.${time.toISOString().replace(/[:.]/g, '-')}.json`;
}

export function isPreRestoreBackupName(name: string): boolean {
    return PRE_RESTORE_NAME_PATTERN.test(name);
}

export function isPreDeleteBackupName(name: string): boolean {
    return NAME_PATTERNS['pre-delete'].test(name);
}

/** Automatic backup names of `kind` to delete: everything but the newest `keep`. Foreign names are never listed. */
export function planPreRestorePrune(names: readonly string[], keepCount?: number, kind: AutomaticBackupKind = 'pre-restore'): string[] {
    const keep = keepCount ?? KEEP_BY_KIND[kind];
    const own: { name: string; stamp: string; counter: number }[] = [];
    for (const name of names) {
        const match = NAME_PATTERNS[kind].exec(name);
        if (match) own.push({ name, stamp: match[1], counter: match[2] ? Number(match[2]) : 0 });
    }
    // Newest first: by timestamp, then by the `-<n>` counter of same-millisecond names (`Z-1` is newer than `Z`).
    own.sort((a, b) => (a.stamp !== b.stamp ? (a.stamp < b.stamp ? 1 : -1) : b.counter - a.counter));
    return own.slice(Math.max(1, Math.floor(keep))).map((entry) => entry.name);
}

/**
 * Writes `text` (a `kobar-backup` envelope, checked with validateFullBackupText) atomically into `backupsDir` and
 * prunes older automatic backups of the same kind. Never throws. The path is never returned to the renderer by the
 * IPC handler.
 */
export function writePreRestoreBackup(options: {
    backupsDir: string;
    text: unknown;
    now?: Date;
    fs?: RestoreFs;
    keep?: number;
    kind?: AutomaticBackupKind;
}): {
    created: boolean;
    path?: string;
    reason?: string;
} {
    const fs = options.fs ?? realFs();
    const kind: AutomaticBackupKind = options.kind === 'pre-delete' ? 'pre-delete' : 'pre-restore';
    const check = validateFullBackupText(options.text);
    if (!check.ok) return { created: false, reason: check.reason };
    // Main-side enforcement: an automatic backup in userData must never hold secrets.
    try {
        if ((JSON.parse(options.text as string) as { includesSecrets?: unknown }).includesSecrets !== false) {
            return { created: false, reason: 'includes-secrets' };
        }
    } catch {
        return { created: false, reason: 'not-json' };
    }
    let tempPath: string | null = null;
    try {
        fs.mkdirSync(options.backupsDir, { recursive: true });
        const names: string[] = [];
        for (const entry of fs.readdirSync(options.backupsDir)) {
            if (!TEMP_PATTERNS[kind].test(entry)) {
                names.push(entry);
                continue;
            }
            try {
                fs.unlinkSync(path.join(options.backupsDir, entry));
            } catch {
                /* retried next time */
            }
        }
        let name = preRestoreBackupFileName(options.now ?? new Date(), kind);
        for (let i = 1; names.includes(name) && i < 1000; i++) name = name.replace(/(?:-\d+)?\.json$/, `-${i}.json`);
        const finalPath = path.join(options.backupsDir, name);
        tempPath = path.join(options.backupsDir, `.${name}.${tempSuffix()}`);
        fs.writeFileSync(tempPath, options.text as string, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, finalPath);
        tempPath = null;
        for (const stale of planPreRestorePrune([...names, name], options.keep, kind)) {
            try {
                fs.unlinkSync(path.join(options.backupsDir, stale));
            } catch {
                /* pruned next time */
            }
        }
        return { created: true, path: finalPath };
    } catch {
        if (tempPath) {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                /* ignore */
            }
        }
        return { created: false, reason: 'write-failed' };
    }
}

/**
 * The extensions-config.json a restore writes. Starts from the CURRENT config (every existing entry is kept as it is)
 * and applies only `false` flags of the backup for plugins that are installed now. Default decision (T-213): a
 * restore may keep or disable a plugin, never enable one that is currently disabled; entries of plugins that are not
 * installed are ignored (restore installs nothing). `changed` is false when the file does not need a write.
 */
export function restrictExtensionsConfig(
    current: unknown,
    incoming: unknown,
    installedIds: Iterable<string>
): { config: Record<string, unknown>; changed: boolean } {
    const config: Record<string, unknown> = {};
    const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
    for (const key of Object.keys(base)) {
        Object.defineProperty(config, key, { value: base[key], enumerable: true, writable: true, configurable: true });
    }
    let changed = false;
    if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return { config, changed };
    const installed = new Set(installedIds);
    for (const id of Object.keys(incoming)) {
        if ((incoming as Record<string, unknown>)[id] !== false || !installed.has(id)) continue;
        if (Object.prototype.hasOwnProperty.call(config, id) && config[id] === false) continue;
        Object.defineProperty(config, id, { value: false, enumerable: true, writable: true, configurable: true });
        changed = true;
    }
    return { config, changed };
}

/** Writes `config` as JSON next to `filePath` and renames it over the file (the old file is never half-written). */
export function writeJsonFileAtomic(filePath: string, config: unknown, fs: RestoreFs = realFs()): void {
    const tempPath = `${filePath}.${tempSuffix()}`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, filePath);
    } catch (err) {
        try {
            fs.unlinkSync(tempPath);
        } catch {
            /* ignore */
        }
        throw err;
    }
}

/** One-shot gate: the relaunch step is accepted only after a recent successful pre-restore backup. */
export function createRestoreGate(ttlMs: number = PRE_RESTORE_GATE_MS, clock: () => number = Date.now) {
    let backupAt: number | null = null;
    return {
        markBackup(): void {
            backupAt = clock();
        },
        /** True (and closes the gate) when a backup was made within `ttlMs`. */
        consume(): boolean {
            const ok = backupAt !== null && clock() - backupAt <= ttlMs;
            backupAt = null;
            return ok;
        },
    };
}
