import React from 'react';
import type { RestorePreview } from '../../backup/parseBackup';
import { SKIP_REASON_TEXT, WARNING_ORDER, WARNING_TEXT } from '../../backup/previewTexts';
import type { TranslationKeys } from '../../i18n';

// Warning list of the backup restore preview (T-215, T-159): one localized line per warning code of parseBackup.ts and one
// short line naming why entries were skipped. `own-backups-only` and `missing-plugins` stay with the callers.

/**
 * The warning lines of `preview` (without the always-present own-backups-only line and the missing plugins line).
 * `t` is passed in: the recovery panel translates with its own language (the store is not hydrated there).
 */
export const BackupWarnings: React.FC<{ preview: RestorePreview; t: (key: TranslationKeys) => string }> = ({ preview, t }) => {
    const reasons: TranslationKeys[] = [];
    for (const item of preview.skipped) {
        const key = SKIP_REASON_TEXT[item.reason];
        if (key && !reasons.includes(key)) reasons.push(key);
    }
    return (
        <>
            {WARNING_ORDER.filter((code) => preview.warnings.includes(code)).map((code) => {
                const key = WARNING_TEXT[code];
                return key ? <li key={code}>{t(key)}</li> : null;
            })}
            {preview.counts.pluginFlagsDropped > 0 && (
                // T-418: enable flags of plugins that are off or not installed here are not carried over (T-415).
                <li>{t('backupWarnPluginFlags').replace('{count}', () => String(preview.counts.pluginFlagsDropped))}</li>
            )}
            {preview.counts.skippedKeys > 0 && (
                <li>
                    {t('backupWarnSkipped')} {preview.counts.skippedKeys}
                    {reasons.length > 0 && ` (${reasons.map((key) => t(key)).join('; ')})`}
                </li>
            )}
        </>
    );
};
