// Texts of the backup restore preview (T-215, T-159): which translation key shows which warning code and skip reason of
// parseBackup.ts. Pure data, shared by BackupWarnings.tsx and tests.

import type { SkipReason } from './keyPolicy';
import type { RestoreWarningCode } from './parseBackup';
import type { TranslationKeys } from '../i18n';

/**
 * Warning codes that have a plain one-line text (`own-backups-only`, `missing-plugins`, `skipped-keys` and
 * `plugin-flags-dropped`, which shows a count, are handled elsewhere).
 */
export const WARNING_TEXT: Partial<Record<RestoreWarningCode, TranslationKeys>> = {
    'from-newer-app': 'backupWarnNewer',
    'unknown-app-version': 'backupWarnUnknownVersion',
    'includes-secrets': 'backupWarnSecrets',
    'secrets-kept-local': 'backupWarnSecretsLocal',
    'secrets-endpoint-changed': 'backupWarnEndpoint',
    'redacted-text': 'backupWarnRedactedText',
    'core-storage-missing': 'backupWarnCoreMissing',
    'core-storage-skipped': 'backupWarnCoreSkipped',
    'core-fields-dropped': 'backupWarnCoreDropped',
    'forbidden-keys-stripped': 'backupWarnForbidden',
    'invalid-plugin-list': 'backupWarnPluginList',
    'invalid-extensions-config': 'backupWarnExtConfig',
};

export const WARNING_ORDER: RestoreWarningCode[] = [
    'from-newer-app',
    'unknown-app-version',
    'includes-secrets',
    'secrets-kept-local',
    'secrets-endpoint-changed',
    'redacted-text',
    'core-storage-missing',
    'core-storage-skipped',
    'core-fields-dropped',
    'forbidden-keys-stripped',
    'invalid-plugin-list',
    'invalid-extensions-config',
];

/** Skip reasons of parseBackup.ts grouped into four short texts. */
export const SKIP_REASON_TEXT: Record<SkipReason | 'invalid-value', TranslationKeys> = {
    'plugin-not-installed': 'backupSkipPlugin',
    'unknown-owner': 'backupSkipPlugin',
    'forbidden-key': 'backupSkipName',
    'junk-key': 'backupSkipName',
    'invalid-key': 'backupSkipName',
    'invalid-isolated-key': 'backupSkipName',
    'retired-key': 'backupSkipLocalOnly',
    'recovery-copy': 'backupSkipLocalOnly',
    'host-internal': 'backupSkipLocalOnly',
    'value-too-large': 'backupSkipValue',
    'invalid-core-value': 'backupSkipValue',
    'invalid-value': 'backupSkipValue',
};
