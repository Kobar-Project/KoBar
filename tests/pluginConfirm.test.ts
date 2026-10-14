import { describe, expect, it } from 'vitest';
import {
    LEGACY_ORIGIN_WARNING,
    UNVERIFIED_WARNING,
    buildPluginConfirmation,
    filterExtensionsConfig,
    isOfficialRepo,
    mergeExtensionsConfig,
    PLUGIN_CANCELED_REASON as MAIN_CANCELED_REASON,
} from '../electron/lib/pluginConfirm.cjs';
import { MAIN_LANGS, t } from '../electron/lib/mainStrings.cjs';
import { PLUGIN_CANCELED_REASON as RENDERER_CANCELED_REASON } from '../src/components/plugins/pluginResults';

describe('isOfficialRepo', () => {
    it('accepts the official owner case-insensitively', () => {
        expect(isOfficialRepo('Kobar-Project/todolist')).toBe(true);
        expect(isOfficialRepo('kobar-project/todolist')).toBe(true);
    });
    it('rejects other owners and malformed values', () => {
        expect(isOfficialRepo('someone/todolist')).toBe(false);
        expect(isOfficialRepo('Kobar-Project')).toBe(false);
        expect(isOfficialRepo(undefined)).toBe(false);
    });
    it.each(['Kobar-Project-evil/x', 'xKobar-Project/x', 'Kobar-Project/x/y', 'https://github.com/Kobar-Project/x'])(
        'rejects lookalike %s',
        (repo) => {
            expect(isOfficialRepo(repo)).toBe(false);
        }
    );
});

describe('buildPluginConfirmation', () => {
    it('warns for ZIP installs', () => {
        const c = buildPluginConfirmation({ kind: 'zip', fileName: 'x.zip' });
        expect(c.unverified).toBe(true);
        expect(c.detail).toBe(UNVERIFIED_WARNING);
        expect(c.detail).toContain('full privileges');
        expect(c.message).toContain('x.zip');
    });
    it('warns for non-official GitHub repos but not for official ones', () => {
        expect(buildPluginConfirmation({ kind: 'github', repo: 'evil/x' }).unverified).toBe(true);
        expect(buildPluginConfirmation({ kind: 'github', repo: 'Kobar-Project/x' }).unverified).toBe(false);
    });
    it('names the installed plugin whose recorded source is the repo, without claiming an update', () => {
        const c = buildPluginConfirmation({ kind: 'github', repo: 'Kobar-Project/x', update: { name: 'X', legacyOrigin: false } });
        expect(c.message).toContain('Kobar-Project/x');
        expect(c.message).not.toContain('Update the plugin');
        expect(c.detail).toContain('recorded source of the installed plugin "X"');
        expect(c.detail).toContain('Source: official Kobar-Project repository.');
        expect(c.confirmLabel).toBe('Install');
        expect(c.unverified).toBe(false);
    });
    it('official plugins (registry origin) get no legacy warning', () => {
        // Official ids with a Kobar-Project manifest repo are snapshotted as "registry", so legacyOrigin is false.
        const official = buildPluginConfirmation({ kind: 'github', repo: 'Kobar-Project/x', update: { name: 'X', legacyOrigin: false } });
        expect(official.detail).not.toContain(LEGACY_ORIGIN_WARNING);
        expect(official.detail).not.toContain(UNVERIFIED_WARNING);
    });
    it('adds the legacy-origin warning for third-party plugins installed before origin tracking', () => {
        const third = buildPluginConfirmation({ kind: 'github', repo: 'someone/x', update: { name: 'X', legacyOrigin: true } });
        expect(third.detail).toContain(UNVERIFIED_WARNING);
        expect(third.detail).toContain(LEGACY_ORIGIN_WARNING);
        expect(third.unverified).toBe(true);
        const tracked = buildPluginConfirmation({ kind: 'github', repo: 'someone/x', update: { name: 'X', legacyOrigin: false } });
        expect(tracked.detail).toContain(UNVERIFIED_WARNING);
        expect(tracked.detail).not.toContain(LEGACY_ORIGIN_WARNING);
    });
    it('strips control characters from the plugin name', () => {
        const c = buildPluginConfirmation({ kind: 'github', repo: 'a/b', update: { name: 'X\nFake line', legacyOrigin: false } });
        expect(c.detail).toContain('"X Fake line"');
        expect(c.message).not.toContain('\n');
    });
    it('uninstall asks without the unverified warning', () => {
        const c = buildPluginConfirmation({ kind: 'uninstall', id: 'p' });
        expect(c.unverified).toBe(false);
        expect(c.confirmLabel).toBe('Uninstall');
    });
    it('strips control characters and truncates long names', () => {
        const c = buildPluginConfirmation({ kind: 'zip', fileName: 'a\nb\u0000' + 'z'.repeat(500) });
        expect(c.message.includes('\n')).toBe(false);
        expect(c.message.includes('\u0000')).toBe(false);
        expect(c.message.length).toBeLessThan(250);
    });
});

describe('buildPluginConfirmation localisation', () => {
    it('defaults to English', () => {
        expect(buildPluginConfirmation({ kind: 'uninstall', id: 'p' }, undefined).confirmLabel).toBe('Uninstall');
    });
    it('localises the text but keeps the flags and the sanitised name', () => {
        const c = buildPluginConfirmation({ kind: 'zip', fileName: 'a\nb.zip' }, 'tr');
        expect(c.unverified).toBe(true);
        expect(c.confirmLabel).toBe('Yükle');
        expect(c.message).toContain('"a b.zip"');
        expect(c.message).not.toContain('Install');
        expect(c.detail).toBe(t('tr', 'unverifiedWarning'));
    });
    it.each(MAIN_LANGS)('keeps the unverified warning and legacy warning for third-party updates in %s', (lang) => {
        const c = buildPluginConfirmation({ kind: 'github', repo: 'someone/x', update: { name: 'X', legacyOrigin: true } }, lang);
        expect(c.unverified).toBe(true);
        expect(c.detail).toContain(t(lang, 'unverifiedWarning'));
        expect(c.detail).toContain(t(lang, 'legacyOriginWarning'));
        expect(c.detail).toContain(t(lang, 'updateNote', { name: 'X' }));
        const official = buildPluginConfirmation({ kind: 'github', repo: 'Kobar-Project/x' }, lang);
        expect(official.unverified).toBe(false);
        expect(official.detail).toBe(t(lang, 'officialSource'));
    });
});

describe('filterExtensionsConfig', () => {
    it('keeps only installed ids with boolean values', () => {
        const input = JSON.parse('{"a":true,"b":false,"ghost":true,"c":"yes","__proto__":true}');
        expect(filterExtensionsConfig(input, ['a', 'b', 'c'])).toEqual({ a: true, b: false });
    });
    it('returns an empty object for non-objects', () => {
        expect(filterExtensionsConfig(null, ['a'])).toEqual({});
        expect(filterExtensionsConfig([true], ['0'])).toEqual({});
        expect(filterExtensionsConfig('x', ['x'])).toEqual({});
    });
});

describe('filterExtensionsConfig dev ids', () => {
    it('accepts dev- ids only when listed as installed', () => {
        const input = { 'dev-x': false, 'dev-y': true };
        expect(filterExtensionsConfig(input, ['dev-x'])).toEqual({ 'dev-x': false });
    });
});

describe('mergeExtensionsConfig', () => {
    it('keeps non-installed entries and replaces installed ones with the caller entries', () => {
        const existing = { a: true, b: false, old: false, 'dev-x': true };
        const incoming = JSON.parse('{"a":false,"ghost":true,"dev-x":false,"c":"x","__proto__":true}');
        // b is installed but missing from incoming: dropped (old whole-replacement semantics).
        expect(mergeExtensionsConfig(existing, incoming, ['a', 'b', 'dev-x'])).toEqual({
            old: false,
            a: false,
            'dev-x': false,
        });
    });
    it('tolerates bad inputs', () => {
        expect(mergeExtensionsConfig(null, { a: true }, ['a'])).toEqual({ a: true });
        expect(mergeExtensionsConfig({ z: true }, 5, ['a'])).toEqual({ z: true });
    });
});

describe('cancel reason', () => {
    it('matches between main process and renderer', () => {
        expect(RENDERER_CANCELED_REASON).toBe(MAIN_CANCELED_REASON);
    });
});
