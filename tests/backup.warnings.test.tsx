import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SkipReason } from '../src/backup/keyPolicy';
import type { RestorePreview, RestoreWarningCode } from '../src/backup/parseBackup';
import { SKIP_REASON_TEXT } from '../src/backup/previewTexts';
import { BackupWarnings } from '../src/components/notes/BackupWarnings';
import { translate } from '../src/i18n/translate';
import { translations } from '../src/i18n';
import type { TranslationKeys } from '../src/i18n';

// T-159: every warning code and skip reason of the restore preview has a localized text in all 10 languages.

const CODES: RestoreWarningCode[] = [
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
const REASONS: (SkipReason | 'invalid-value')[] = [
    'forbidden-key',
    'junk-key',
    'invalid-key',
    'retired-key',
    'recovery-copy',
    'host-internal',
    'value-too-large',
    'invalid-core-value',
    'invalid-isolated-key',
    'plugin-not-installed',
    'unknown-owner',
    'invalid-value',
];

function preview(overrides: Partial<RestorePreview>): RestorePreview {
    return {
        createdAt: null,
        appVersion: '1.1.4',
        currentAppVersion: '1.1.4',
        fromNewerApp: false,
        includesSecrets: false,
        counts: {
            notes: 0,
            workspaces: 0,
            chats: 0,
            coreKeys: 0,
            isolatedKeys: 0,
            pluginKeys: 0,
            acceptedKeys: 1,
            skippedKeys: 0,
            pluginsInBackup: 0,
            missingPlugins: 0,
            keepLocalFields: 0,
            keepLocalBlocked: 0,
            droppedKeepLocalFields: 0,
            keepLocalKeys: 0,
            redactedTexts: 0,
            droppedNotes: 0,
            pluginFlagsDropped: 0,
        },
        skipped: [],
        missingPlugins: [],
        droppedCoreFields: [],
        warnings: ['own-backups-only'],
        ...overrides,
    };
}

const languages = Object.keys(translations) as (keyof typeof translations)[];
const table = translations as unknown as Record<string, Record<string, string>>;

describe('BackupWarnings', () => {
    const full = preview({
        warnings: ['own-backups-only', 'skipped-keys', 'missing-plugins', ...CODES],
        skipped: REASONS.map((reason) => ({ key: `k-${reason}`, reason })),
        counts: { ...preview({}).counts, skippedKeys: REASONS.length },
    });

    it.each(languages)('%s: one localized line per warning code and the skip reasons, never a raw key', (lang) => {
        const t = (key: TranslationKeys) => translate(lang, key);
        const html = renderToStaticMarkup(<BackupWarnings preview={full} t={t} />);
        expect(html.match(/<li>/g)).toHaveLength(CODES.length + 1);
        expect(html).not.toMatch(/backupWarn|backupSkip/);
        // The skip line names every reason group once (four groups).
        const groups = new Set(Object.values(SKIP_REASON_TEXT));
        expect(groups.size).toBe(4);
        for (const key of groups) expect(table[lang][key]?.length ?? 0).toBeGreaterThan(0);
    });

    it('covers every skip reason of the key policy', () => {
        for (const reason of REASONS) expect(SKIP_REASON_TEXT[reason], reason).toBeTruthy();
    });

    it('shows nothing extra for a plain preview and no skip line without skipped keys', () => {
        const html = renderToStaticMarkup(<BackupWarnings preview={preview({})} t={(key) => translate('en', key)} />);
        expect(html).toBe('');
    });

    it.each(languages)('%s: T-418 names how many plugin enable flags were not carried over', (lang) => {
        const html = renderToStaticMarkup(
            <BackupWarnings
                preview={preview({
                    warnings: ['own-backups-only', 'plugin-flags-dropped'],
                    counts: { ...preview({}).counts, pluginFlagsDropped: 3 },
                })}
                t={(key) => translate(lang, key)}
            />
        );
        expect(html.match(/<li>/g)).toHaveLength(1);
        expect(html).toContain('3');
        expect(html).not.toMatch(/\{count\}|backupWarn/);
        expect(table[lang].backupWarnPluginFlags).toContain('{count}');
    });

    it('the endpoint warning never prints a key or a URL', () => {
        for (const lang of languages) {
            const text = table[lang].backupWarnEndpoint;
            expect(text).not.toMatch(/https?:|sk-/);
        }
    });
});
