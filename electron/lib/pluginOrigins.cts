// Install origins of plugins, kept by the main process in userData/extension-origins.json (never inside
// the plugin folder, so a plugin cannot rewrite where its updates come from). Pure logic plus two small
// file helpers (read tolerant, write atomic); no Electron access, so everything here is unit tested.
import * as fs from 'fs';
import * as nodePath from 'path';
import { isOfficialPluginId } from './officialPlugins.cjs';
import { isOfficialRepo } from './pluginConfirm.cjs';
import { parseGithubRepo } from './pluginInstall.cjs';
import { compareVersions, isNewerVersion, parseVersion } from './semver.cjs';

export const ORIGINS_FILE_NAME = 'extension-origins.json';

/**
 * registry: GitHub release of an official Kobar-Project repository (also an official plugin installed
 *           before origin tracking whose manifest names a Kobar-Project repository).
 * github:   GitHub release of any other repository.
 * zip:      local ZIP (file dialog / drag & drop); no update repository (its manifest is unverified).
 * bundled:  legacy value written by the removed `install-extension` path (T-133); kept so existing records still parse.
 * legacy:   installed before origin tracking; `repo` is a snapshot of the manifest, so it is unverified.
 */
export type OriginSource = 'registry' | 'github' | 'zip' | 'bundled' | 'legacy';

export interface OriginRecord {
    /** Strict GitHub "owner/name", or null when the plugin has no update source. */
    repo: string | null;
    source: OriginSource;
    /** ISO timestamp of the install (for legacy records: when the snapshot was taken). */
    installedAt: string;
    /** Version the main process installed (or saw, for legacy snapshots). */
    version?: string;
}

/** Plugin folder name -> origin. Always created without a prototype. */
export type OriginsMap = Record<string, OriginRecord>;

const SOURCES: ReadonlySet<string> = new Set(['registry', 'github', 'zip', 'bundled', 'legacy']);
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_KEY_LENGTH = 256;
const MAX_TEXT_LENGTH = 64;
/** The file only holds a few short records; anything far bigger is not ours. */
export const MAX_ORIGINS_FILE_BYTES = 1024 * 1024;

export function emptyOrigins(): OriginsMap {
    return Object.create(null) as OriginsMap;
}

function isValidKey(key: string): boolean {
    return key.length > 0 && key.length <= MAX_KEY_LENGTH && !RESERVED_KEYS.has(key);
}

/** Validates one record; returns a clean copy or null. */
export function normalizeOriginRecord(value: unknown): OriginRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.source !== 'string' || !SOURCES.has(v.source)) return null;
    if (v.repo !== null && !parseGithubRepo(v.repo)) return null;
    if (typeof v.installedAt !== 'string' || v.installedAt.length > MAX_TEXT_LENGTH) return null;
    const record: OriginRecord = { repo: v.repo as string | null, source: v.source as OriginSource, installedAt: v.installedAt };
    if (typeof v.version === 'string' && v.version.length <= MAX_TEXT_LENGTH) record.version = v.version;
    return record;
}

/** Parses the file content; invalid entries are dropped, anything unreadable gives an empty map. */
export function parseOrigins(raw: unknown): OriginsMap {
    const result = emptyOrigins();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    for (const key of Object.keys(raw)) {
        if (!isValidKey(key)) continue;
        const record = normalizeOriginRecord((raw as Record<string, unknown>)[key]);
        if (record) result[key] = record;
    }
    return result;
}

/** Returns a copy of `map` with `key` set to `record` (invalid keys/records leave it unchanged). */
export function withOrigin(map: OriginsMap, key: string, record: OriginRecord): OriginsMap {
    const next = parseOrigins(map);
    const clean = normalizeOriginRecord(record);
    if (typeof key === 'string' && isValidKey(key) && clean) next[key] = clean;
    return next;
}

/** Returns a copy of `map` without `key`. */
export function withoutOrigin(map: OriginsMap, key: string): OriginsMap {
    const next = parseOrigins(map);
    if (typeof key === 'string') delete next[key];
    return next;
}

/** Reads the origins file. Missing, oversized or corrupt files give an empty map (never throws). */
export function readOriginsFile(filePath: string): OriginsMap {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_ORIGINS_FILE_BYTES) return emptyOrigins();
        return parseOrigins(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return emptyOrigins();
    }
}

/** Writes the origins file atomically (temp file in the same folder + rename). Throws on failure. */
export function writeOriginsFileAtomic(filePath: string, map: OriginsMap): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    const sorted: Record<string, OriginRecord> = {};
    for (const key of Object.keys(map).sort()) sorted[key] = map[key];
    try {
        fs.writeFileSync(tempPath, JSON.stringify(sorted, null, 2), { encoding: 'utf8', flag: 'wx' });
        try {
            fs.renameSync(tempPath, filePath);
        } catch {
            // Windows: a scanner or indexer may hold the target briefly (EPERM/EBUSY). Retry once.
            fs.renameSync(tempPath, filePath);
        }
    } catch (err) {
        try {
            fs.rmSync(tempPath, { force: true });
        } catch {
            /* ignore */
        }
        throw err;
    }
}

export type OriginsFileState = 'missing' | 'ok' | 'corrupt';

/**
 * Classifies the origins file without changing it. `corrupt` means it exists but would lose data when
 * rewritten: not a regular file, oversized, unreadable, not JSON, not a plain object, or with entries
 * that `parseOrigins` drops.
 */
export function inspectOriginsFile(filePath: string): OriginsFileState {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch (err) {
        return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? 'missing' : 'corrupt';
    }
    if (!stat.isFile() || stat.size > MAX_ORIGINS_FILE_BYTES) return 'corrupt';
    try {
        const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'corrupt';
        return Object.keys(parseOrigins(raw)).length === Object.keys(raw).length ? 'ok' : 'corrupt';
    } catch {
        return 'corrupt';
    }
}

/** Corrupt copies kept next to the origins file: `<file>.corrupt` plus the newest timestamped ones. */
export const MAX_CORRUPT_BACKUPS = 3;

/**
 * Copies a corrupt origins file to `<file>.corrupt` (or `<file>.corrupt-<timestamp>` when that exists)
 * and keeps at most MAX_CORRUPT_BACKUPS copies: the plain `.corrupt` copy (the first evidence) is never
 * removed, older timestamped copies are. Throws when the copy fails. Returns the copy and the pruned paths.
 */
export function backupCorruptOriginsFile(filePath: string, now: Date = new Date()): { backupPath: string; pruned: string[] } {
    const base = `${filePath}.corrupt`;
    let target = base;
    if (fs.existsSync(base)) {
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        target = `${base}-${stamp}`;
        for (let n = 1; fs.existsSync(target); n++) target = `${base}-${stamp}-${n}`;
    }
    fs.copyFileSync(filePath, target, fs.constants.COPYFILE_EXCL);

    const pruned: string[] = [];
    try {
        const dir = nodePath.dirname(filePath);
        const stampedPrefix = nodePath.basename(base) + '-';
        const stamped = fs
            .readdirSync(dir)
            .filter((name) => name.startsWith(stampedPrefix))
            .map((name) => nodePath.join(dir, name))
            .filter((full) => {
                try {
                    return fs.lstatSync(full).isFile();
                } catch {
                    return false;
                }
            })
            .sort();
        const keepStamped = MAX_CORRUPT_BACKUPS - (fs.existsSync(base) ? 1 : 0);
        // Oldest first (ISO timestamps sort by name); the copy just made always stays.
        const excess = stamped.filter((full) => full !== target).slice(0, Math.max(0, stamped.length - keepStamped));
        for (const full of excess) {
            try {
                fs.rmSync(full, { force: true });
                pruned.push(full);
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* pruning is best effort */
    }
    return { backupPath: target, pruned };
}

/**
 * Writes the origins file like `writeOriginsFileAtomic`, but first copies a corrupt file aside
 * (`backupCorruptOriginsFile`). When that copy fails nothing is written and the error is thrown, so a
 * corrupt file is never replaced without a copy. Returns the backup result, or null when none was needed.
 */
export function writeOriginsFileWithBackup(
    filePath: string,
    map: OriginsMap,
    now: Date = new Date()
): { backupPath: string; pruned: string[] } | null {
    const backup = inspectOriginsFile(filePath) === 'corrupt' ? backupCorruptOriginsFile(filePath, now) : null;
    writeOriginsFileAtomic(filePath, map);
    return backup;
}

/**
 * Best-effort removal of temp files left by an interrupted `writeOriginsFileAtomic`
 * (`<file>.<pid>.<time>.<rand>.tmp` in the same folder). Never throws; returns how many were removed.
 */
export function cleanupStaleTempFiles(filePath: string): number {
    let removed = 0;
    try {
        const dir = nodePath.dirname(filePath);
        const prefix = nodePath.basename(filePath) + '.';
        for (const name of fs.readdirSync(dir)) {
            if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
            try {
                const full = nodePath.join(dir, name);
                if (!fs.lstatSync(full).isFile()) continue;
                fs.rmSync(full, { force: true });
                removed++;
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
    return removed;
}

/**
 * In-memory changes of this session: a record, or null for a removed one. Applied on top of what the
 * file holds, so a failed write cannot let a later read fall back to an older (or missing) record.
 */
export type OriginsOverlay = Map<string, OriginRecord | null>;

/** Applies `overlay` on top of `fileMap` (overlay wins; null deletes). Returns a new map. */
export function applyOriginsOverlay(fileMap: OriginsMap, overlay: OriginsOverlay): OriginsMap {
    let result = parseOrigins(fileMap);
    for (const [key, record] of overlay) {
        result = record ? withOrigin(result, key, record) : withoutOrigin(result, key);
    }
    return result;
}

/**
 * Finds the key of `name` in `origins`: exact match first, then (when `caseInsensitive`, i.e. on
 * Windows where folder names ignore case) a case-insensitive match. Returns null when there is none.
 */
export function findOriginKey(origins: OriginsMap, name: string, caseInsensitive: boolean): string | null {
    if (typeof name !== 'string' || name === '') return null;
    if (Object.prototype.hasOwnProperty.call(origins, name)) return name;
    if (!caseInsensitive) return null;
    const lower = name.toLowerCase();
    for (const key of Object.keys(origins)) {
        if (key.toLowerCase() === lower) return key;
    }
    return null;
}

/** Case-insensitive comparison of two strict "owner/name" repos (GitHub names are case-insensitive). */
export function reposEqual(a: unknown, b: unknown): boolean {
    const pa = parseGithubRepo(a);
    const pb = parseGithubRepo(b);
    return !!pa && !!pb && pa.owner.toLowerCase() === pb.owner.toLowerCase() && pa.name.toLowerCase() === pb.name.toLowerCase();
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i;

/** Accepts "owner/name" or "https://github.com/owner/name[.git]" and returns a strict "owner/name". */
export function normalizeRepoRef(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (parseGithubRepo(text)) return text;
    const match = GITHUB_URL_RE.exec(text);
    if (!match) return null;
    const repo = `${match[1]}/${match[2]}`;
    return parseGithubRepo(repo) ? repo : null;
}

/** The repository a manifest names (githubRepo first, then githubLink), or null. */
export function repoFromManifest(manifest: unknown): string | null {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
    const m = manifest as Record<string, unknown>;
    return normalizeRepoRef(m.githubRepo) ?? normalizeRepoRef(m.githubLink);
}

/** Source for a GitHub install: official organisation = registry, anything else = github. */
export function sourceForRepo(repo: string): 'registry' | 'github' {
    return isOfficialRepo(repo) ? 'registry' : 'github';
}

/**
 * Origin of a plugin installed before origin tracking. Official ids may only come from the official
 * organisation (install validation enforced that), so an official id whose manifest names a
 * Kobar-Project repo gets the registry origin; a manifest pointing elsewhere is ignored for them
 * (legacy, no update source). Other plugins get the repository their manifest names, marked as legacy
 * (= unverified).
 */
export function legacyOrigin(id: string, manifest: unknown, now: string): OriginRecord {
    const manifestRepo = repoFromManifest(manifest);
    const official = isOfficialPluginId(id) || isOfficialPluginId((manifest as Record<string, unknown> | null)?.id);
    let record: OriginRecord;
    if (official) {
        record =
            manifestRepo && isOfficialRepo(manifestRepo)
                ? { repo: manifestRepo, source: 'registry', installedAt: now }
                : { repo: null, source: 'legacy', installedAt: now };
    } else {
        record = { repo: manifestRepo, source: 'legacy', installedAt: now };
    }
    const version = (manifest as Record<string, unknown> | null)?.version;
    if (typeof version === 'string' && version.length <= MAX_TEXT_LENGTH) record.version = version;
    return record;
}

/**
 * Adds a legacy snapshot for every installed plugin folder without a record (looked up with
 * `findOriginKey`). Returns the new map and the folder names that were added.
 */
export function snapshotMissingOrigins(
    origins: OriginsMap,
    installed: ReadonlyArray<{ name: string; manifest: unknown }>,
    now: string,
    caseInsensitive: boolean
): { origins: OriginsMap; added: string[] } {
    let result = parseOrigins(origins);
    const added: string[] = [];
    for (const { name, manifest } of installed) {
        if (findOriginKey(result, name, caseInsensitive) !== null) continue;
        const next = withOrigin(result, name, legacyOrigin(name, manifest, now));
        if (Object.prototype.hasOwnProperty.call(next, name)) {
            result = next;
            added.push(name);
        }
    }
    return { origins: result, added };
}

/** The installed version to compare against: the recorded one when valid, else the manifest's. */
export function installedVersionOf(record: OriginRecord | undefined, manifest: unknown): string | null {
    if (record?.version && parseVersion(record.version)) return record.version;
    const version = (manifest as Record<string, unknown> | null)?.version;
    return typeof version === 'string' ? version : null;
}

/**
 * The installed version an update check compares against, or null when it is not a valid version.
 * Null means "offer no update": `decideGithubReplace` would refuse to install it anyway.
 */
export function updateCheckVersion(record: OriginRecord | undefined, manifest: unknown): string | null {
    const version = installedVersionOf(record, manifest);
    return version !== null && parseVersion(version) ? version : null;
}

export type UpdateDecision = { ok: true } | { ok: false; reason: string };

/**
 * Decides whether a GitHub release may replace an already installed plugin (the update path).
 * The release must come from the recorded repository and be strictly newer by semver.
 */
export function decideGithubReplace(input: {
    origin: OriginRecord;
    sourceRepo: string;
    installedVersion: string | null;
    newVersion: string | null;
}): UpdateDecision {
    const { origin, sourceRepo, installedVersion, newVersion } = input;
    if (!origin.repo) {
        return {
            ok: false,
            reason: 'This plugin is already installed from a source without an update repository. Uninstall it first to install it from GitHub.',
        };
    }
    if (!reposEqual(origin.repo, sourceRepo)) {
        return {
            ok: false,
            reason: `This plugin is already installed from "${origin.repo}". Uninstall it first to install it from another repository.`,
        };
    }
    if (!parseVersion(newVersion)) {
        return { ok: false, reason: 'The release has no valid version number, so it cannot replace the installed plugin.' };
    }
    if (!isNewerVersion(newVersion, installedVersion)) {
        return {
            ok: false,
            reason: parseVersion(installedVersion)
                ? `The installed version (${installedVersion}) is the same or newer than the release (${newVersion}).`
                : 'The installed version is not a valid version number. Uninstall the plugin first to reinstall it.',
        };
    }
    return { ok: true };
}

/** Where a package that is being installed comes from. */
export type IncomingPackage = { kind: 'zip' } | { kind: 'github'; repo: string };

/** Why a package may not replace the installed plugin with the same id. */
export type ReplaceRefusalCode = 'downgrade' | 'version-uncomparable' | 'github-refused';

/**
 * proceed: no extra prompt (GitHub update from the recorded repository, strictly newer; the user already
 *          confirmed it with the repository shown).
 * confirm: a second confirmation naming the id, both versions and both origins is required first.
 * refuse:  nothing may be written; the installed plugin stays as it is.
 */
export type ReplaceDecision =
    | { action: 'proceed' }
    | { action: 'confirm'; change: 'reinstall' | 'upgrade' }
    | { action: 'refuse'; code: ReplaceRefusalCode; reason: string };

/**
 * Decides what happens when a package's id is already installed (T-137). Pure; runs before any write.
 * GitHub: `decideGithubReplace` (recorded repository only, strictly newer; an unknown origin is refused).
 * Local ZIP: always a second confirmation; a lower version is refused (no downgrade), and so is a pair of
 * versions that cannot be compared (one of them is not a valid version), since a downgrade cannot be ruled out.
 * main.cts passes the recorded origin or, without a record, an in-memory `legacyOrigin` snapshot, so `origin` is
 * never null from there; the null branch is kept fail closed for other callers.
 */
export function decideReplaceInstalled(input: {
    incoming: IncomingPackage;
    origin: OriginRecord | null;
    installedVersion: string | null;
    newVersion: string | null;
}): ReplaceDecision {
    const { incoming, origin, installedVersion, newVersion } = input;
    if (incoming.kind === 'github') {
        if (!origin) {
            return {
                action: 'refuse',
                code: 'github-refused',
                reason: 'The source of the installed plugin is unknown. Uninstall it first to install it from GitHub.',
            };
        }
        const decision = decideGithubReplace({ origin, sourceRepo: incoming.repo, installedVersion, newVersion });
        return decision.ok ? { action: 'proceed' } : { action: 'refuse', code: 'github-refused', reason: decision.reason };
    }
    const order = compareVersions(newVersion, installedVersion);
    if (order === null) {
        return {
            action: 'refuse',
            code: 'version-uncomparable',
            reason: 'The plugin is already installed and the versions cannot be compared. Uninstall it first to install this package.',
        };
    }
    if (order < 0) {
        return {
            action: 'refuse',
            code: 'downgrade',
            reason: `The installed version (${installedVersion}) is newer than the package (${newVersion}). Uninstall the plugin first to install an older version.`,
        };
    }
    return { action: 'confirm', change: order === 0 ? 'reinstall' : 'upgrade' };
}
