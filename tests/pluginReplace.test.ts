// T-137: a package whose id is already installed (second confirmation, no downgrade), the backup of a corrupt
// extension-origins.json before it is rewritten, and the wiring order in the main process (electron/main/services/extensions/).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_LANGS, MAIN_STRINGS } from '../electron/lib/mainStrings.cjs';
import { buildPluginConfirmation, buildReplaceRefusal, describeOrigin } from '../electron/lib/pluginConfirm.cjs';
import {
    MAX_CORRUPT_BACKUPS,
    type OriginRecord,
    backupCorruptOriginsFile,
    decideReplaceInstalled,
    emptyOrigins,
    inspectOriginsFile,
    readOriginsFile,
    withOrigin,
    writeOriginsFileAtomic,
    writeOriginsFileWithBackup,
} from '../electron/lib/pluginOrigins.cjs';
import { translations } from '../src/i18n';
import { readMainModule, readMainSources } from './helpers/mainSource';

// Lets one test make the library's fs.copyFileSync fail (a spy on node:fs does not reach its namespace import).
const copyFailure = vi.hoisted(() => ({ active: false }));
vi.mock('fs', async (importOriginal) => {
    const real = await importOriginal<typeof import('fs')>();
    const copyFileSync: typeof real.copyFileSync = (...args) => {
        if (copyFailure.active) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        return real.copyFileSync(...args);
    };
    return { ...real, default: { ...real, copyFileSync }, copyFileSync };
});

const NOW = '2026-01-01T00:00:00.000Z';
const rec = (partial: Partial<OriginRecord> = {}): OriginRecord => ({
    repo: 'someone/plugin',
    source: 'github',
    installedAt: NOW,
    version: '1.2.0',
    ...partial,
});

describe('decideReplaceInstalled: local ZIP', () => {
    const zip = { kind: 'zip' as const };
    it.each([
        ['1.3.0', 'upgrade'],
        ['2.0.0', 'upgrade'],
        ['v1.2.1', 'upgrade'],
        ['1.2.0', 'reinstall'],
        ['1.2', 'reinstall'],
        ['1.2.0+build.5', 'reinstall'],
    ])('newer or equal version %s asks a second time (%s)', (newVersion, change) => {
        expect(decideReplaceInstalled({ incoming: zip, origin: rec(), installedVersion: '1.2.0', newVersion })).toEqual({
            action: 'confirm',
            change,
        });
    });

    it.each(['1.1.9', '0.9.0', '1.2.0-beta.1'])('lower version %s is refused as a downgrade', (newVersion) => {
        const d = decideReplaceInstalled({ incoming: zip, origin: rec(), installedVersion: '1.2.0', newVersion });
        expect(d.action).toBe('refuse');
        expect(d.action === 'refuse' && d.code).toBe('downgrade');
    });

    it.each([
        [null, '1.2.0'],
        ['', '1.2.0'],
        ['banana', '1.2.0'],
        ['1.3.0', null],
        ['1.3.0', 'not-a-version'],
        [null, null],
    ])('uncomparable versions (new %j, installed %j) are refused', (newVersion, installedVersion) => {
        const d = decideReplaceInstalled({ incoming: zip, origin: rec(), installedVersion, newVersion });
        expect(d.action === 'refuse' && d.code).toBe('version-uncomparable');
    });

    it.each([
        ['same origin (zip)', rec({ source: 'zip', repo: null })],
        ['different origin (registry)', rec({ source: 'registry', repo: 'Kobar-Project/x' })],
        ['different origin (github)', rec()],
        ['legacy origin', rec({ source: 'legacy' })],
        ['unknown origin', null],
    ])('a local ZIP always needs the second confirmation: %s', (_label, origin) => {
        expect(decideReplaceInstalled({ incoming: zip, origin, installedVersion: '1.0.0', newVersion: '1.0.1' }).action).toBe('confirm');
    });
});

describe('decideReplaceInstalled: GitHub', () => {
    const gh = (repo = 'someone/plugin') => ({ kind: 'github' as const, repo });
    it('same recorded repository and strictly newer: proceeds without a second prompt', () => {
        expect(decideReplaceInstalled({ incoming: gh(), origin: rec(), installedVersion: '1.2.0', newVersion: '1.3.0' })).toEqual({
            action: 'proceed',
        });
        // GitHub names are case-insensitive.
        expect(
            decideReplaceInstalled({ incoming: gh('SomeOne/Plugin'), origin: rec(), installedVersion: '1.2.0', newVersion: '1.3.0' }).action
        ).toBe('proceed');
    });
    it.each([
        ['lower', '1.1.0'],
        ['equal', '1.2.0'],
        ['unparsable', 'latest'],
    ])('same repository, %s version: refused (update path never replaces with a non-newer release)', (_l, newVersion) => {
        const d = decideReplaceInstalled({ incoming: gh(), origin: rec(), installedVersion: '1.2.0', newVersion });
        expect(d.action === 'refuse' && d.code).toBe('github-refused');
    });
    it('different repository, no update repository or unknown origin: refused (stricter than a prompt)', () => {
        for (const origin of [rec({ repo: 'other/plugin' }), rec({ source: 'zip', repo: null }), null]) {
            const d = decideReplaceInstalled({ incoming: gh(), origin, installedVersion: '1.0.0', newVersion: '9.0.0' });
            expect(d.action).toBe('refuse');
        }
    });
    it('invalid installed version: refused', () => {
        const d = decideReplaceInstalled({
            incoming: gh(),
            origin: rec({ version: undefined }),
            installedVersion: 'x',
            newVersion: '2.0.0',
        });
        expect(d.action).toBe('refuse');
    });
});

describe('replace confirmation and refusal texts', () => {
    const base = {
        kind: 'replace' as const,
        id: 'my-plugin',
        installedVersion: '1.0.0',
        newVersion: '1.1.0',
        incoming: { kind: 'zip' as const, fileName: 'my-plugin.zip' },
    };
    it('upgrade names id, both versions, recorded origin and the new local package', () => {
        const c = buildPluginConfirmation({ ...base, change: 'upgrade', origin: { source: 'registry', repo: 'Kobar-Project/my-plugin' } });
        expect(c.message).toBe('Update the installed plugin "my-plugin" from version 1.0.0 to 1.1.0?');
        expect(c.detail).toContain('Installed from: official Kobar-Project repository "Kobar-Project/my-plugin"');
        expect(c.detail).toContain('New package: local ZIP file "my-plugin.zip"');
        expect(c.detail).toContain(MAIN_STRINGS.en.unverifiedWarning);
        expect(c.confirmLabel).toBe('Replace');
        expect(c.unverified).toBe(true);
    });
    it('reinstall wording, unknown origin shown as unknown, localised', () => {
        const c = buildPluginConfirmation({ ...base, newVersion: '1.0.0', change: 'reinstall', origin: null });
        expect(c.message).toBe('Reinstall the plugin "my-plugin" (version 1.0.0)? The installed copy will be replaced.');
        expect(c.detail).toContain('Installed from: unknown');
        const tr = buildPluginConfirmation({ ...base, change: 'upgrade', origin: null }, 'tr');
        expect(tr.message).toContain('my-plugin');
        expect(tr.detail).toContain(MAIN_STRINGS.tr.originUnknown);
        expect(tr.confirmLabel).toBe(MAIN_STRINGS.tr.replace);
    });
    it('describes every origin source', () => {
        expect(describeOrigin({ source: 'github', repo: 'a/b' })).toBe('GitHub repository "a/b"');
        expect(describeOrigin({ source: 'zip', repo: null })).toBe('local ZIP file');
        expect(describeOrigin({ source: 'legacy', repo: 'a/b' })).toContain('unverified');
        expect(describeOrigin({ source: 'bundled', repo: null })).toBe('unknown');
        expect(describeOrigin(null)).toBe('unknown');
    });
    it('control characters in shown values cannot fake dialog lines', () => {
        const c = buildPluginConfirmation({ ...base, change: 'upgrade', origin: null, incoming: { kind: 'zip', fileName: 'a\nb.zip' } });
        expect(c.detail).toContain('"a b.zip"');
    });
    it('refusal texts are localised and name id and versions', () => {
        expect(buildReplaceRefusal('downgrade', { id: 'my-plugin', installedVersion: '2.0.0', newVersion: '1.0.0' })).toBe(
            'The installed version of "my-plugin" (2.0.0) is newer than this package (1.0.0). Downgrades are not allowed: uninstall the plugin first to install an older version.'
        );
        expect(buildReplaceRefusal('version-uncomparable', { id: 'p', installedVersion: null, newVersion: 'x' })).toContain('installed: ?');
        for (const lang of MAIN_LANGS) {
            expect(buildReplaceRefusal('downgrade', { id: 'p', installedVersion: '2.0.0', newVersion: '1.0.0' }, lang)).toContain('2.0.0');
        }
    });
});

describe('corrupt extension-origins.json backup', () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-origins-corrupt-'));
        file = path.join(dir, 'extension-origins.json');
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const backups = () =>
        fs
            .readdirSync(dir)
            .filter((n) => n.startsWith('extension-origins.json.corrupt'))
            .sort();
    const sample = withOrigin(emptyOrigins(), 'my-plugin', rec());

    it('classifies missing, valid and corrupt files', () => {
        expect(inspectOriginsFile(file)).toBe('missing');
        writeOriginsFileAtomic(file, sample);
        expect(inspectOriginsFile(file)).toBe('ok');
        fs.writeFileSync(file, '{ not json');
        expect(inspectOriginsFile(file)).toBe('corrupt');
        fs.writeFileSync(file, '[]');
        expect(inspectOriginsFile(file)).toBe('corrupt');
        // Valid JSON with an entry parseOrigins would drop: rewriting would lose it.
        fs.writeFileSync(file, JSON.stringify({ good: rec(), bad: { source: 'evil' } }));
        expect(inspectOriginsFile(file)).toBe('corrupt');
        fs.rmSync(file);
        fs.mkdirSync(file);
        expect(inspectOriginsFile(file)).toBe('corrupt');
    });

    it('a valid or missing file is written without a backup', () => {
        expect(writeOriginsFileWithBackup(file, sample)).toBeNull();
        expect(writeOriginsFileWithBackup(file, sample)).toBeNull();
        expect(backups()).toEqual([]);
    });

    it('copies a corrupt file to .corrupt before overwriting it, keeping the original bytes', () => {
        fs.writeFileSync(file, '{ "my-plugin": { broken');
        const result = writeOriginsFileWithBackup(file, sample);
        expect(result?.backupPath).toBe(`${file}.corrupt`);
        expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('{ "my-plugin": { broken');
        expect(readOriginsFile(file)['my-plugin']).toEqual(rec());
    });

    it('timestamps later copies and keeps at most 3 (the first .corrupt copy is never pruned)', () => {
        for (let i = 0; i < 6; i++) {
            fs.writeFileSync(file, `corrupt ${i}`);
            const r = backupCorruptOriginsFile(file, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
            expect(fs.readFileSync(r.backupPath, 'utf8')).toBe(`corrupt ${i}`);
        }
        const kept = backups();
        expect(kept).toHaveLength(MAX_CORRUPT_BACKUPS);
        expect(kept[0]).toBe('extension-origins.json.corrupt');
        expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('corrupt 0');
        // The two newest timestamped copies stay.
        expect(kept.slice(1).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))).toEqual(['corrupt 4', 'corrupt 5']);
    });

    it('a second copy within the same millisecond gets its own name', () => {
        const when = new Date(Date.UTC(2026, 0, 1));
        fs.writeFileSync(file, 'a');
        backupCorruptOriginsFile(file, when);
        fs.writeFileSync(file, 'b');
        backupCorruptOriginsFile(file, when);
        fs.writeFileSync(file, 'c');
        const r = backupCorruptOriginsFile(file, when);
        expect(new Set(backups()).size).toBe(3);
        expect(fs.readFileSync(r.backupPath, 'utf8')).toBe('c');
    });

    it('fails closed: when the backup cannot be made the corrupt file is not overwritten', () => {
        // A directory where the file should be cannot be copied: nothing is written and the error surfaces.
        fs.mkdirSync(file);
        expect(() => writeOriginsFileWithBackup(file, sample)).toThrow();
        expect(fs.statSync(file).isDirectory()).toBe(true);
    });

    it('fails closed when copying a corrupt regular file fails: bytes unchanged, no backup', () => {
        fs.writeFileSync(file, '{ corrupt but precious');
        copyFailure.active = true;
        try {
            expect(() => writeOriginsFileWithBackup(file, sample)).toThrow('disk full');
        } finally {
            copyFailure.active = false;
        }
        expect(fs.readFileSync(file, 'utf8')).toBe('{ corrupt but precious');
        expect(backups()).toEqual([]);
        expect(fs.readdirSync(dir)).toEqual(['extension-origins.json']);
    });
});

describe('plugin update strings (Settings plugins page)', () => {
    const keys = [
        'pluginUpdatesTitle',
        'pluginUpdatesAllUpToDate',
        'pluginUpdatesSelectAll',
        'pluginUpdatesUpdating',
        'pluginUpdatesUpdateSelected',
        'pluginUpdatesOriginUnverified',
        'pluginUpdatesOriginUnverifiedHint',
        'pluginUpdateFailed',
        'pluginUpdateCanceled',
    ];
    const all = translations as unknown as Record<string, Record<string, string>>;
    it('exist in all 10 languages and keep their placeholders', () => {
        expect(Object.keys(all)).toHaveLength(10);
        for (const lang of Object.keys(all)) {
            for (const key of keys) expect(all[lang][key], `${lang}.${key}`).toBeTruthy();
            expect(all[lang].pluginUpdatesUpdateSelected).toContain('{count}');
            expect(all[lang].pluginUpdatesOriginUnverified).toContain('{repo}');
        }
    });
});

describe('main process wiring (T-137 source order)', () => {
    // T-314: the installer moved to electron/main/services/extensions/install.cts, the origins store to extensions/origins.cts
    // (both indented inside a factory / register function); every main-process file is scanned for the "only the backup-aware writer" rule.
    const install = readMainModule('services/extensions/install.cts');
    const origins = readMainModule('services/extensions/origins.cts');
    const main = readMainSources();
    const start = install.indexOf('async function installExtensionFromZipPath(');
    const end = install.indexOf("registry.handle('install-extension-from-file'", start);
    const body = install.slice(start, end);

    it('the replace decision and the second confirmation run after the API gate and before every write', () => {
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const gateAt = body.indexOf('checkPluginApiGate(manifest, app.getVersion())');
        const stateAt = body.indexOf('readInstalledPluginState(extensionId, targetDir)');
        const decideAt = body.indexOf('decideReplaceInstalled(');
        const confirmAt = body.indexOf("kind: 'replace'");
        // T-318: the re-check runs under the install lock, which is taken after the confirmation and before every write.
        const lockAt = body.indexOf('const locked = await withInstallLock(async () => {');
        const recheckAt = body.indexOf('sameInstalledState(');
        expect(gateAt).toBeGreaterThan(0);
        expect(gateAt).toBeLessThan(stateAt);
        expect(stateAt).toBeLessThan(decideAt);
        expect(decideAt).toBeLessThan(confirmAt);
        expect(confirmAt).toBeLessThan(lockAt);
        expect(lockAt).toBeLessThan(recheckAt);
        for (const write of [
            'fs.promises.writeFile(',
            'fs.promises.rm(targetDir',
            'fs.mkdirSync(extensionsDir',
            'fs.renameSync(',
            'saveExtensionsConfig(',
            'recordExtensionOrigin(',
        ]) {
            const at = body.indexOf(write);
            expect(at, write).toBeGreaterThan(0);
            expect(recheckAt, write).toBeLessThan(at);
        }
    });

    it('every refusal and a declined second confirmation clean the temp folder and return before writing', () => {
        expect(body).toMatch(
            /if \(replace\.action === 'refuse'\) \{[^]*?await fs\.promises\.rm\(tempExtractDir[^]*?return \{ success: false, reason \};/
        );
        expect(body).toMatch(
            /if \(outcome !== 'ok'\) \{\s*await fs\.promises\.rm\(tempExtractDir[^]*?return \{ success: false, reason: declinedReason\(outcome\) \};/
        );
        expect(body).toMatch(
            /if \(installedBefore \? !sameInstalledState\(installedBefore, installedNow\) : installedNow !== null\) \{[^]*?await fs\.promises\.rm\(tempExtractDir[^]*?return 'changed' as const;/
        );
        // T-318: the localized reason is built after the lock is released.
        expect(body).toMatch(
            /\}\);\s*if \(locked === 'changed'\) \{\s*return \{ success: false, reason: t\(await getUiLanguage\(\), 'pluginChangedDuringConfirm', \{ name: extensionId \}\) \};\s*\}\s*return locked;/
        );
    });

    it('the decision reads state only (no origins snapshot write before the install)', () => {
        const fnAt = origins.indexOf('function readInstalledPluginState(');
        expect(fnAt).toBeGreaterThan(0);
        const fnEnd = origins.indexOf('\n    }\n', fnAt);
        expect(fnEnd).toBeGreaterThan(fnAt);
        const fn = origins.slice(fnAt, fnEnd);
        expect(fn).toContain('readCurrentOrigins()');
        expect(fn).not.toMatch(/loadExtensionOrigins|saveExtensionOrigins|recordExtensionOrigin|writeFileSync|rmSync/);
    });

    it('origins are saved only through the backup-aware writer', () => {
        expect(main).not.toMatch(/writeOriginsFileAtomic\(/);
        const saveAt = origins.indexOf('function saveExtensionOrigins(');
        expect(saveAt).toBeGreaterThan(0);
        const saveEnd = origins.indexOf('\n    }\n', saveAt);
        expect(saveEnd).toBeGreaterThan(saveAt);
        expect(origins.slice(saveAt, saveEnd)).toContain('writeOriginsFileWithBackup(extensionOriginsPath, origins)');
    });
});

describe('install lock wiring (T-318 source order)', () => {
    const install = readMainModule('services/extensions/install.cts');
    const manage = readMainModule('services/extensions/manage.cts');
    const installed = readMainModule('services/extensions/installed.cts');
    const update = readMainModule('services/extensions/update.cts');
    const bootstrap = readMainModule('bootstrap.cts');

    function slice(source: string, from: string, to: string): string {
        const start = source.indexOf(from);
        expect(start, from).toBeGreaterThanOrEqual(0);
        const end = source.indexOf(to, start + from.length);
        expect(end, to).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    function handler(source: string, channel: string): string {
        const start = source.indexOf(`registry.handle('${channel}'`);
        expect(start, channel).toBeGreaterThanOrEqual(0);
        const next = source.indexOf('registry.handle(', start + 1);
        const end = next === -1 ? source.length : next;
        expect(end, channel).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    it('the installer takes the lock once, after every pre-write refusal, and re-reads the installed state first thing under it', () => {
        const body = slice(install, 'async function installExtensionFromZipPath(', "registry.handle('install-extension-from-file'");
        const lockAt = body.indexOf('const locked = await withInstallLock(async () => {');
        expect(lockAt).toBeGreaterThan(0);
        expect(body.match(/withInstallLock\(/g)?.length).toBe(1);
        // Everything before the lock only reads or removes the private temp folder.
        const beforeLock = body.slice(0, lockAt);
        expect(beforeLock).not.toMatch(
            /writeFile|fs\.promises\.rm\(targetDir|rmSync\(targetDir|mkdirSync\(extensionsDir|rename|saveExtensionsConfig\(|recordExtensionOrigin\(/
        );
        const underLock = body.slice(lockAt);
        const recheckAt = underLock.indexOf('const installedNow = readInstalledPluginState(extensionId, targetDir);');
        expect(recheckAt).toBeGreaterThan(0);
        // No await between taking the lock and the re-check.
        expect(underLock.slice('const locked = await withInstallLock(async () => {'.length, recheckAt)).not.toContain('await ');
        // No UI-language lookup while the lock is held: the lock body ends before the 'changed' result is localized.
        const lockBodyEnd = underLock.indexOf("if (locked === 'changed')");
        expect(lockBodyEnd).toBeGreaterThan(recheckAt);
        expect(underLock.slice(0, lockBodyEnd)).not.toContain('getUiLanguage(');
    });

    it('the move into extensions/ and the config + origin writes follow each other with no await in between', () => {
        const moveToOrigin = slice(install, 'fs.renameSync(searchDir, targetDir);', 'recordExtensionOrigin(extensionId');
        expect(moveToOrigin).toContain('saveExtensionsConfig(config);');
        // The only await in between is the failure-only temp clean-up guarded by `if (!targetMoved)`.
        const awaits = moveToOrigin.match(/await /g) ?? [];
        expect(awaits.length).toBe(1);
        expect(moveToOrigin).toMatch(/if \(!targetMoved\) \{\s*await fs\.promises\.rm\(tempExtractDir/);
        expect(moveToOrigin).toMatch(/fs\.renameSync\(searchDir, targetDir\);\s*targetMoved = true;/);
        // The success-path temp clean-up runs after the origin write.
        const afterOrigin = slice(install, 'recordExtensionOrigin(extensionId', 'return { success: true };');
        expect(afterOrigin).toMatch(/\} finally \{[\s\S]*?await fs\.promises\.rm\(tempExtractDir/);
    });

    it('the GitHub handler looks the update target up under the lock, before the confirmation', () => {
        const src = handler(install, 'install-extension-from-github');
        const lookupAt = src.indexOf('await withInstallLock(() => findUpdateTarget(repo))');
        expect(lookupAt).toBeGreaterThan(0);
        expect(lookupAt).toBeLessThan(src.indexOf('confirmPluginAction('));
    });

    it('uninstall confirms outside the lock, then re-checks, deletes and cleans up the config and origin under it', () => {
        const src = handler(manage, 'uninstall-extension');
        const confirmAt = src.indexOf("confirmPluginAction({ kind: 'uninstall', id })");
        const lockAt = src.indexOf('return await withInstallLock(async () => {');
        const recheckAt = src.indexOf('const recheck = canDeletePluginFolder(');
        const rmAt = src.indexOf('await fs.promises.rm(destDir, { recursive: true, force: true });');
        const saveAt = src.indexOf('saveExtensionsConfig(config);');
        const forgetAt = src.indexOf('forgetExtensionOrigin(id);');
        expect(confirmAt).toBeGreaterThan(0);
        expect(confirmAt).toBeLessThan(lockAt);
        expect(lockAt).toBeLessThan(recheckAt);
        expect(recheckAt).toBeLessThan(rmAt);
        expect(rmAt).toBeLessThan(saveAt);
        expect(saveAt).toBeLessThan(forgetAt);
        expect(src).not.toMatch(/rmSync\(destDir/);
        // Only the delete is awaited between the re-check and the clean-up.
        expect(src.slice(recheckAt, forgetAt).match(/await /g)?.length).toBe(1);
    });

    it('toggle-extension-enabled and set-extensions-config read, merge and save the config under the lock', () => {
        const toggle = handler(manage, 'toggle-extension-enabled');
        const toggleLockAt = toggle.indexOf('return await withInstallLock(');
        const toggleReadAt = toggle.indexOf('const config = getExtensionsConfig();');
        const toggleSaveAt = toggle.indexOf('saveExtensionsConfig(config);');
        expect(toggleLockAt).toBeGreaterThan(0);
        expect(toggleLockAt).toBeLessThan(toggleReadAt);
        expect(toggleReadAt).toBeLessThan(toggleSaveAt);
        // The read-modify-write itself has no await in it.
        expect(toggle.slice(toggleReadAt, toggleSaveAt)).not.toContain('await ');

        const setConfig = handler(manage, 'set-extensions-config');
        const setLockAt = setConfig.indexOf('return await withInstallLock(async () => {');
        const idsAt = setConfig.indexOf('const installedIds = await getInstalledExtensionIds();');
        const mergeAt = setConfig.indexOf('saveExtensionsConfig(mergeExtensionsConfig(getExtensionsConfig(), config, installedIds));');
        expect(setLockAt).toBeGreaterThan(0);
        expect(setLockAt).toBeLessThan(idsAt);
        expect(idsAt).toBeLessThan(mergeAt);
        // The config is read inside the save call (one statement: no await between read, merge and save).
        expect(setConfig.match(/getExtensionsConfig\(\)/g)?.length).toBe(1);
    });

    it('get-installed-extensions runs under the lock; check-plugin-updates loads the origins under it but fetches outside it', () => {
        expect(handler(installed, 'get-installed-extensions')).toContain('return await withInstallLock(listInstalledExtensions);');
        const updates = handler(update, 'check-plugin-updates');
        const originsAt = updates.indexOf('await withInstallLock(() => loadExtensionOrigins())');
        expect(originsAt).toBeGreaterThan(0);
        expect(originsAt).toBeLessThan(updates.indexOf('await fetch('));
        expect(updates.match(/withInstallLock\(/g)?.length).toBe(1);
    });

    it('bootstrap creates one lock and hands the same function to every extension module', () => {
        expect(bootstrap.match(/createAsyncLock\(\)/g)?.length).toBe(1);
        expect(bootstrap).toContain('const { run: withInstallLock } = createAsyncLock();');
        for (const call of [
            'registerInstalledExtensionsIpc(',
            'registerPluginUpdatesIpc(',
            'registerExtensionManagementIpc(',
            'registerExtensionInstallIpc(',
        ]) {
            const from = bootstrap.indexOf(call);
            expect(from, call).toBeGreaterThan(0);
            const end = bootstrap.indexOf(');', from);
            expect(end, call).toBeGreaterThan(from);
            expect(bootstrap.slice(from, end), call).toContain('withInstallLock');
        }
    });
});
