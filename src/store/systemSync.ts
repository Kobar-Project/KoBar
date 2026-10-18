// T-614: the main window's side of Settings > Backup & updates and About. Publishes a small system summary (src/store/systemSummary.ts)
// and applies a short allow-list of `backup.*` / `update.*` actions the Settings window relays (src/store/sync.ts routes them here).
// Host-internal: NOT part of window.api or the plugin contract, and it has NO backup or update logic of its own: the actions call the
// SAME functions the old Settings panel called (exportFullBackup; window.api checkForUpdatesManual / downloadAndInstallUpdate /
// quitAndInstallUpdate). File dialogs stay in main: the save dialog is opened by main's `save-full-backup` handler as before.
//
//   - Every action is validated (zod, strict objects; update actions take no payload). Actions before hydration are rejected.
//   - Update actions follow the state machine: check only when idle-ish (not while checking/downloading), download only while
//     `available`, install only once `downloaded`. In the Microsoft Store build (`updatesEnabled` false) all of them are rejected.
//   - The summary carries codes, a version string and a percentage: update error text and backup paths are never published.
//   - T-615a: `backup.restore {}` only OPENS the restore dialog in the main window (it needs a file and a confirm dialog, which live
//     there); T-615b: `data.exportSettings|exportNotes|importSettings|importNotes {}` open the transfer dialog the same way (no file
//     content ever goes through the relay); `app.restartTutorial {}` restarts the tutorial. Both bring the main window forward, and only after the payload validated.
import { z } from 'zod';
import type { IpcUpdateCheckResult } from '../../shared/ipc-contract';
import { SYSTEM_VERSION_MAX, type SystemActionType, type SystemSummary, type SystemUpdateStatus } from './systemSummary';

/** The allow-listed `backup.*` / `update.*` actions and their payload schemas. A Map, so `__proto__` / `toString` are never entries. */
export const SYSTEM_ACTIONS: ReadonlyMap<string, { schema: z.ZodType }> = new Map<SystemActionType, { schema: z.ZodType }>([
    ['backup.export', { schema: z.strictObject({ includeSecrets: z.boolean() }) }],
    ['backup.restore', { schema: z.strictObject({}) }],
    ['app.restartTutorial', { schema: z.strictObject({}) }],
    ['data.exportSettings', { schema: z.strictObject({}) }],
    ['data.exportNotes', { schema: z.strictObject({}) }],
    ['data.importSettings', { schema: z.strictObject({}) }],
    ['data.importNotes', { schema: z.strictObject({}) }],
    ['update.check', { schema: z.strictObject({}) }],
    ['update.download', { schema: z.strictObject({}) }],
    ['update.install', { schema: z.strictObject({}) }],
]);

export type SystemActionRejection = 'unknown-action' | 'invalid-payload' | 'unavailable' | 'busy' | 'bad-state' | 'failed';
export type SystemActionResult = { ok: true } | { ok: false; reason: SystemActionRejection };

/** What sync.ts needs from this module (same shape as the plugin / workspace sync). */
export interface SystemSyncLike {
    getSummary(): SystemSummary | null;
    subscribe(listener: () => void): () => void;
    owns(type: string): boolean;
    handle(action: unknown): Promise<SystemActionResult>;
}

/** The slice of window.api used (all optional: a missing method means the feature is unavailable). */
export interface SystemSyncApi {
    getAppVersion?: () => Promise<string>;
    checkForUpdatesManual?: () => Promise<IpcUpdateCheckResult>;
    downloadAndInstallUpdate?: () => void;
    quitAndInstallUpdate?: () => void;
    onUpdateDownloadProgress?: (callback: (progress: { percent: number }) => void) => () => void;
    onUpdateDownloadComplete?: (callback: (version: string) => void) => () => void;
    onUpdateError?: (callback: (error: string) => void) => () => void;
}

export interface SystemSyncDeps {
    api: () => SystemSyncApi | undefined;
    isHydrated: () => boolean;
    /** False in the Microsoft Store build. */
    updatesEnabled: boolean;
    /** MAC-016: unsigned macOS build; the Settings window shows a manual-download link (absent = false). */
    manualUpdate?: boolean;
    /** Builds the full backup and lets main save it (src/backup/exportBackup.ts). Never rejects. */
    exportBackup: (options: { includeSecrets: boolean }) => Promise<{ success: boolean; reason?: string }>;
    /** T-615a: shows the main window's restore dialog and brings the window forward (absent: `backup.restore` is unavailable). */
    openRestore?: () => void;
    /** T-615a: restarts the tutorial and brings the window forward (absent: `app.restartTutorial` is unavailable). */
    restartTutorial?: () => void;
    /** T-615b: shows the main window's settings / notes export-import dialog and brings the window forward (absent: `data.*` are unavailable). */
    openDataTransfer?: (mode: 'exportSettings' | 'exportNotes' | 'importSettings' | 'importNotes') => void;
    log?: (message: string, details: Record<string, string | number>) => void;
}

const cleanVersion = (value: unknown): string =>
    typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value) && value.length <= SYSTEM_VERSION_MAX ? value : '';

export function createSystemSync(deps: SystemSyncDeps): SystemSyncLike {
    const log = deps.log ?? ((message, details) => console.warn(`[KoBar] system-sync: ${message}`, details));
    let queue: Promise<unknown> = Promise.resolve();
    const listeners = new Set<() => void>();
    let version = '';
    let update: SystemSummary['update'] = { status: 'idle', version: '', percent: 0 };
    let backup: SystemSummary['backup'] = { busy: false, last: null };
    let detach: (() => void) | null = null;

    function changed(): void {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                /* a failing listener must not break the others */
            }
        }
    }
    function setUpdate(next: SystemSummary['update']): void {
        update = next;
        changed();
    }
    function setStatus(status: SystemUpdateStatus, patch: Partial<SystemSummary['update']> = {}): void {
        setUpdate({ ...update, ...patch, status });
    }

    function attach(): void {
        const api = deps.api();
        const unsubscribers: Array<() => void> = [];
        if (api?.getAppVersion) {
            void Promise.resolve()
                .then(() => api.getAppVersion!())
                .then((value) => {
                    const clean = cleanVersion(value);
                    if (clean && clean !== version) {
                        version = clean;
                        changed();
                    }
                })
                .catch(() => {
                    /* the version stays empty: the pages show a placeholder */
                });
        }
        if (deps.updatesEnabled && api) {
            const keep = (off: (() => void) | undefined) => {
                if (typeof off === 'function') unsubscribers.push(off);
            };
            try {
                keep(
                    api.onUpdateDownloadProgress?.((progress) => {
                        const raw = progress?.percent;
                        const percent = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
                        setStatus('downloading', { percent: Math.min(100, Math.max(0, Math.round(percent))) });
                    })
                );
                keep(
                    api.onUpdateDownloadComplete?.((v) =>
                        setStatus('downloaded', { percent: 100, version: cleanVersion(v) || update.version })
                    )
                );
                keep(api.onUpdateError?.(() => setStatus('error', { percent: 0 })));
            } catch {
                /* no live progress then; the check button still works */
            }
        }
        detach = () => unsubscribers.forEach((off) => off());
    }

    async function run(type: SystemActionType, payload: Record<string, unknown>): Promise<SystemActionResult> {
        if (!deps.isHydrated()) return { ok: false, reason: 'unavailable' };
        const api = deps.api();
        switch (type) {
            case 'backup.export': {
                if (backup.busy) return { ok: false, reason: 'busy' };
                backup = { busy: true, last: null };
                changed();
                let last: 'done' | 'failed' | 'canceled' = 'failed';
                try {
                    const result = await deps.exportBackup({ includeSecrets: payload.includeSecrets === true });
                    last = result.success ? 'done' : result.reason === 'canceled' ? 'canceled' : 'failed';
                } catch {
                    last = 'failed';
                }
                backup = { busy: false, last };
                changed();
                return last === 'failed' ? { ok: false, reason: 'failed' } : { ok: true };
            }
            case 'backup.restore':
                if (!deps.openRestore) return { ok: false, reason: 'unavailable' };
                if (backup.busy) return { ok: false, reason: 'busy' };
                deps.openRestore();
                return { ok: true };
            case 'data.exportSettings':
            case 'data.exportNotes':
            case 'data.importSettings':
            case 'data.importNotes':
                if (!deps.openDataTransfer) return { ok: false, reason: 'unavailable' };
                if (backup.busy) return { ok: false, reason: 'busy' };
                deps.openDataTransfer(type.slice('data.'.length) as 'exportSettings' | 'exportNotes' | 'importSettings' | 'importNotes');
                return { ok: true };
            case 'app.restartTutorial':
                if (!deps.restartTutorial) return { ok: false, reason: 'unavailable' };
                deps.restartTutorial();
                return { ok: true };
            case 'update.check': {
                if (!deps.updatesEnabled || !api?.checkForUpdatesManual) return { ok: false, reason: 'unavailable' };
                if (update.status === 'checking' || update.status === 'downloading') return { ok: false, reason: 'busy' };
                setStatus('checking', { percent: 0 });
                try {
                    const result = await api.checkForUpdatesManual();
                    if (result?.status === 'disabled') setStatus('idle');
                    else if (result?.status === 'success') {
                        const found = result.updateAvailable === true ? cleanVersion(result.version) : '';
                        if (found) setStatus('available', { version: found });
                        else setStatus('upToDate', { version: '' });
                    } else setStatus('error');
                } catch {
                    setStatus('error');
                    return { ok: false, reason: 'failed' };
                }
                return { ok: true };
            }
            case 'update.download':
                if (!deps.updatesEnabled || !api?.downloadAndInstallUpdate) return { ok: false, reason: 'unavailable' };
                if (update.status !== 'available') return { ok: false, reason: 'bad-state' };
                setStatus('downloading', { percent: 0 });
                api.downloadAndInstallUpdate();
                return { ok: true };
            case 'update.install':
                if (!deps.updatesEnabled || !api?.quitAndInstallUpdate) return { ok: false, reason: 'unavailable' };
                if (update.status !== 'downloaded') return { ok: false, reason: 'bad-state' };
                api.quitAndInstallUpdate();
                return { ok: true };
        }
    }

    return {
        getSummary: () => ({
            version,
            updatesEnabled: deps.updatesEnabled,
            ...(deps.manualUpdate ? { manualUpdate: true } : {}),
            update: { ...update },
            backup: { ...backup },
        }),
        subscribe(listener) {
            if (listeners.size === 0) attach();
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    detach?.();
                    detach = null;
                }
            };
        },
        owns: (type) => SYSTEM_ACTIONS.has(type),
        handle(action) {
            const { type, payload } = (typeof action === 'object' && action !== null ? action : {}) as {
                type?: unknown;
                payload?: unknown;
            };
            const entry = typeof type === 'string' ? SYSTEM_ACTIONS.get(type) : undefined;
            if (!entry) return Promise.resolve({ ok: false, reason: 'unknown-action' });
            const parsed = entry.schema.safeParse(payload === undefined ? {} : payload);
            if (!parsed.success) return Promise.resolve({ ok: false, reason: 'invalid-payload' });
            const job = queue.then(async (): Promise<SystemActionResult> => {
                try {
                    return await run(type as SystemActionType, parsed.data as Record<string, unknown>);
                } catch {
                    log('action failed', { type: String(type).slice(0, 64) });
                    return { ok: false, reason: 'failed' };
                }
            });
            queue = job;
            return job;
        },
    };
}
