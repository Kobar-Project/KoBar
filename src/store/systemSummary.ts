// T-614: the small, secret-free system summary the main window publishes to the Settings window (app version, update centre state,
// full-backup export state) and the payload types of the `backup.*` / `update.*` actions the Settings window may send back. Plain TS
// only (no zod, no store): the Settings window bundles this file for the mirror. The action validation lives in ./systemSync.
import type { IpcSystemSummary, IpcSystemUpdateStatus } from '../../shared/ipc-contract';

export type SystemSummary = IpcSystemSummary;
export type SystemUpdateStatus = IpcSystemUpdateStatus;

export const SYSTEM_VERSION_MAX = 64;

const UPDATE_STATUSES: readonly SystemUpdateStatus[] = ['idle', 'checking', 'upToDate', 'available', 'downloading', 'downloaded', 'error'];
const BACKUP_RESULTS = ['done', 'failed', 'canceled'] as const;

/** Action type -> payload of the allow-listed system actions (handled by src/store/systemSync.ts in the main window). */
export interface SystemActionPayloads {
    /** Full backup export: the main window builds the file and main shows the save dialog. Secrets only when asked for. */
    'backup.export': { includeSecrets: boolean };
    /** Opens the restore dialog in the main window (file pick, validation, safety backup and confirmation happen there). */
    'backup.restore': Record<string, never>;
    /** Restarts the first-run tutorial in the main window (and brings that window forward). */
    'app.restartTutorial': Record<string, never>;
    /** T-615b: each opens the main window's transfer dialog (export has its own button there; import picks the file there). No file content travels. */
    'data.exportSettings': Record<string, never>;
    'data.exportNotes': Record<string, never>;
    'data.importSettings': Record<string, never>;
    'data.importNotes': Record<string, never>;
    'update.check': Record<string, never>;
    /** Only valid while an update is `available`. */
    'update.download': Record<string, never>;
    /** Only valid once the update is `downloaded`: restarts the app. */
    'update.install': Record<string, never>;
}
export type SystemActionType = keyof SystemActionPayloads;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const shortText = (value: unknown): string => (typeof value === 'string' && value.length <= SYSTEM_VERSION_MAX ? value : '');

/** The summary from untrusted data (a snapshot message). Null when it is not a summary. */
export function sanitizeSystemSummary(raw: unknown): SystemSummary | null {
    if (!isRecord(raw) || !isRecord(raw.update) || !isRecord(raw.backup)) return null;
    const status = UPDATE_STATUSES.find((s) => s === (raw.update as Record<string, unknown>).status) ?? 'idle';
    const percent = (raw.update as Record<string, unknown>).percent;
    const last = BACKUP_RESULTS.find((r) => r === (raw.backup as Record<string, unknown>).last) ?? null;
    return {
        version: shortText(raw.version),
        updatesEnabled: raw.updatesEnabled === true,
        update: {
            status,
            version: shortText(raw.update.version),
            percent: typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : 0,
        },
        backup: { busy: raw.backup.busy === true, last },
    };
}
