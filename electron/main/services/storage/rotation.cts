// T-402: `.bak/` rotation policy of the file-backed store. Pure: no I/O.
//   - the 3 newest write backups,
//   - the first backup of each of the last 7 days (UTC days, today included),
//   - the newest backup per (storage schema, persist version) pair, for at most 10 pairs (the "upgrade moment" copies),
//   - at most one backup per 60 s per file, unless a backup is forced (see shouldBackup).
import type { BakNameInfo } from './layout.cjs';

export const BAK_KEEP_LATEST = 3;
export const BAK_KEEP_DAYS = 7;
export const BAK_MAX_VERSION_PINS = 10;
export const BAK_MIN_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BakEntry extends BakNameInfo {
    name: string;
}

/** Newest first: by `takenAt`, then by `seq`, then by name (stable for equal entries). */
export function sortBakNewestFirst<T extends BakEntry>(entries: readonly T[]): T[] {
    return [...entries].sort((a, b) => b.takenAt - a.takenAt || b.seq - a.seq || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** Names of the backups the policy keeps, given `now` (epoch ms). Entries must all belong to one key. */
export function planBakKeep(entries: readonly BakEntry[], now: number): Set<string> {
    const sorted = sortBakNewestFirst(entries);
    const keep = new Set<string>();

    for (const entry of sorted.slice(0, BAK_KEEP_LATEST)) keep.add(entry.name);

    const today = Math.floor(now / DAY_MS);
    const firstOfDay = new Map<number, BakEntry>();
    for (const entry of sorted) {
        const day = Math.floor(entry.takenAt / DAY_MS);
        if (day > today || day <= today - BAK_KEEP_DAYS) continue;
        // `sorted` is newest first, so the last one seen for a day is that day's first backup.
        firstOfDay.set(day, entry);
    }
    for (const entry of firstOfDay.values()) keep.add(entry.name);

    const newestPerVersion = new Map<string, BakEntry>();
    for (const entry of sorted) {
        if (entry.version === null || entry.schema <= 0) continue;
        const pair = `${entry.schema}/${entry.version}`;
        if (!newestPerVersion.has(pair)) newestPerVersion.set(pair, entry);
    }
    const pinned = [...newestPerVersion.values()]
        .sort((a, b) => b.schema - a.schema || (b.version ?? 0) - (a.version ?? 0))
        .slice(0, BAK_MAX_VERSION_PINS);
    for (const entry of pinned) keep.add(entry.name);

    return keep;
}

/** Names the policy deletes (everything not kept). */
export function planBakPrune(entries: readonly BakEntry[], now: number): string[] {
    const keep = planBakKeep(entries, now);
    return sortBakNewestFirst(entries)
        .filter((entry) => !keep.has(entry.name))
        .map((entry) => entry.name);
}

export interface BackupDecisionInput {
    /** First write since the last hydration: the target was never overwritten in this session. */
    forced: boolean;
    now: number;
    /** When this session last made a backup of the file (epoch ms), or null. */
    lastBackupAt: number | null;
    /** `writtenAt` of the file about to be replaced, or null when unknown. */
    existingWrittenAt: number | null;
    /** (schema, persist version) of the file about to be replaced and of the incoming value. */
    existingTag: string | null;
    incomingTag: string | null;
}

/**
 * Whether the file about to be replaced must first be copied to `.bak/`.
 * Always when forced, when the existing file's age is unknown or it is NEWER than this write (clock skew or another writer: a newer file is never
 * overwritten without a backup) or when the version changes (upgrade moment); otherwise at most once per 60 s.
 */
export function shouldBackup(input: BackupDecisionInput): boolean {
    if (input.forced) return true;
    if (input.existingWrittenAt === null || input.existingWrittenAt > input.now) return true;
    if (input.existingTag !== input.incomingTag) return true;
    return input.lastBackupAt === null || input.now - input.lastBackupAt >= BAK_MIN_INTERVAL_MS || input.now < input.lastBackupAt;
}
