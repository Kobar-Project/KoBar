// Restore step 1 for the UI (T-215, shared with the hydration recovery panel in T-152): read a picked backup file and
// turn it into a validated restore plan with parseBackup. Never rejects; failures come back as a translation key.

import type { TranslationKeys } from '../i18n';
import { readRawItem } from './keepLocal';
import { parseBackup, RESTORE_MAX_BYTES, type RestoreErrorCode, type RestorePlan, type RestorePreview } from './parseBackup';

export function restoreErrorKey(code: RestoreErrorCode | 'read-failed'): TranslationKeys {
    switch (code) {
        case 'too-large':
            return 'backupErrTooLarge';
        case 'schema-newer':
        case 'storage-version-newer':
            return 'backupErrNewer';
        case 'read-failed':
            return 'backupErrRead';
        default:
            return 'backupErrInvalid';
    }
}

export type PrepareRestoreResult = { ok: true; plan: RestorePlan; preview: RestorePreview } | { ok: false; errorKey: TranslationKeys };

type PrepareRestoreApi = Pick<Window['api'], 'getBackupSources' | 'getAppVersion'>;

export async function prepareRestoreFromFile(file: File, api: PrepareRestoreApi = window.api): Promise<PrepareRestoreResult> {
    try {
        if (file.size > RESTORE_MAX_BYTES) return { ok: false, errorKey: restoreErrorKey('too-large') };
        const text = await file.text();
        const [sources, appVersion] = await Promise.all([api.getBackupSources(), api.getAppVersion()]);
        const parsed = parseBackup(text, {
            installedPluginIds: (Array.isArray(sources?.plugins) ? sources.plugins : []).map((p) => p.id),
            currentAppVersion: typeof appVersion === 'string' ? appVersion : '',
            // T-415: restored workspace records may not enable a plugin that is disabled here.
            currentExtensionsConfig: sources?.extensionsConfig,
            // Lets the preview warn about secrets that stay blank because their endpoint differs (T-159).
            readLocal: (key) => readRawItem(window.localStorage, key),
        });
        if (!parsed.ok) return { ok: false, errorKey: restoreErrorKey(parsed.error) };
        return { ok: true, plan: parsed.plan, preview: parsed.preview };
    } catch {
        return { ok: false, errorKey: restoreErrorKey('read-failed') };
    }
}
