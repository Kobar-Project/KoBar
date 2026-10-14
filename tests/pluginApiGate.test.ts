import { describe, expect, it } from 'vitest';
import { PLUGIN_NEEDS_APP_UPDATE_REASON, checkPluginApiGate } from '../electron/lib/pluginApiGate.cjs';
import { PLUGIN_NEEDS_APP_UPDATE_REASON as RENDERER_REASON, needsAppUpdateMessage } from '../src/components/plugins/pluginResults';
import { translations } from '../src/i18n';
import { readMainModule, readMainSources } from './helpers/mainSource';

// T-220: v1 host refuses plugins that need plugin API >= 2 or a newer app. Synthetic data only.
const APP = '1.1.4';
const base = { id: 'sample-plugin', name: 'Sample' };

function gate(extra: Record<string, unknown>, app: unknown = APP) {
    return checkPluginApiGate({ ...base, ...extra }, app);
}

describe('checkPluginApiGate: apiVersion', () => {
    it('allows a missing apiVersion (v1) and apiVersion 0/1', () => {
        expect(gate({})).toEqual({ ok: true });
        expect(gate({ apiVersion: undefined })).toEqual({ ok: true });
        for (const v of [0, 1, 1.9, '1', '1.0', '1.2.3', 'v1', '0']) expect(gate({ apiVersion: v }), String(v)).toEqual({ ok: true });
    });
    it('refuses major >= 2 with the needs-app-update code', () => {
        for (const v of [2, 2.1, 3, 10, '2', '2.1', '2.0.0', 'v2', '3.0.0', '2.0.0-beta.1']) {
            const r = gate({ apiVersion: v });
            expect(r, String(v)).toEqual({ ok: false, code: 'needs-app-update', reason: PLUGIN_NEEDS_APP_UPDATE_REASON });
        }
    });
    it('rejects odd values as an invalid manifest (never allows them)', () => {
        for (const v of [
            NaN,
            Infinity,
            -1,
            -2.5,
            null,
            true,
            false,
            {},
            [],
            [2],
            { major: 2 },
            '',
            'two',
            '1.2.3.4',
            ' 2',
            '2 ',
            '-1',
            'latest',
        ]) {
            const r = gate({ apiVersion: v });
            expect(r.ok, String(JSON.stringify(v))).toBe(false);
            expect(r).toMatchObject({ code: 'invalid' });
        }
    });
});

describe('checkPluginApiGate: minAppVersion', () => {
    it('allows an equal or older minAppVersion', () => {
        for (const v of ['1.0.0', '1.1.4', '1.1', '1', 'v1.1.4', '1.1.4-beta.1', 0, 1])
            expect(gate({ minAppVersion: v }), String(v)).toEqual({ ok: true });
    });
    it('refuses a newer minAppVersion', () => {
        for (const v of ['1.1.5', '1.2.0', '2.0.0', '2', 'v2.0.0', '1.1.5-beta.1', 2, 1.2]) {
            expect(gate({ minAppVersion: v }), String(v)).toEqual({
                ok: false,
                code: 'needs-app-update',
                reason: PLUGIN_NEEDS_APP_UPDATE_REASON,
            });
        }
    });
    it('treats a prerelease app as older than the release it precedes', () => {
        expect(gate({ minAppVersion: '2.0.0' }, '2.0.0-beta.1')).toMatchObject({ ok: false, code: 'needs-app-update' });
        expect(gate({ minAppVersion: '2.0.0-beta.1' }, '2.0.0')).toEqual({ ok: true });
    });
    it('rejects unparsable minAppVersion as invalid', () => {
        for (const v of [null, true, {}, [], NaN, -1, '', 'soon', '1.2.3.4']) {
            expect(gate({ minAppVersion: v }), String(JSON.stringify(v))).toMatchObject({ ok: false, code: 'invalid' });
        }
    });
    it('fails closed when the app version itself is unreadable', () => {
        expect(gate({ minAppVersion: '1.0.0' }, 'garbage')).toMatchObject({ ok: false, code: 'needs-app-update' });
        expect(gate({ minAppVersion: '1.0.0' }, null)).toMatchObject({ ok: false });
        // Without a minAppVersion the app version is irrelevant.
        expect(gate({}, 'garbage')).toEqual({ ok: true });
    });
});

describe('checkPluginApiGate: combinations and shape', () => {
    it('refuses when either field fails', () => {
        expect(gate({ apiVersion: 1, minAppVersion: '9.0.0' })).toMatchObject({ ok: false, code: 'needs-app-update' });
        expect(gate({ apiVersion: 2, minAppVersion: '1.0.0' })).toMatchObject({ ok: false, code: 'needs-app-update' });
        expect(gate({ apiVersion: 1, minAppVersion: '1.0.0' })).toEqual({ ok: true });
        expect(gate({ apiVersion: 'x', minAppVersion: '9.0.0' })).toMatchObject({ ok: false, code: 'invalid' });
    });
    it('rejects a manifest that is not an object', () => {
        for (const m of [null, undefined, 'x', 1, []]) expect(checkPluginApiGate(m, APP)).toMatchObject({ ok: false, code: 'invalid' });
    });
    it('ignores a prototype-inherited apiVersion', () => {
        const m = Object.create({ apiVersion: 2 });
        Object.assign(m, base);
        expect(checkPluginApiGate(m, APP)).toEqual({ ok: true });
    });
});

describe('renderer wiring', () => {
    it('shares the reason code with the main process', () => {
        expect(RENDERER_REASON).toBe(PLUGIN_NEEDS_APP_UPDATE_REASON);
        expect(needsAppUpdateMessage(PLUGIN_NEEDS_APP_UPDATE_REASON, () => 'msg')).toBe('msg');
        expect(needsAppUpdateMessage('Invalid manifest.json file.', () => 'msg')).toBeNull();
        expect(needsAppUpdateMessage(undefined, () => 'msg')).toBeNull();
    });
    it('has the message in all 10 languages', () => {
        const all = translations as unknown as Record<string, Record<string, string>>;
        const langs = Object.keys(all);
        expect(langs.length).toBe(10);
        for (const lang of langs) expect(all[lang].pluginNeedsAppUpdate, lang).toBeTruthy();
    });
});

describe('main process wiring (source order)', () => {
    // T-314: the install pipeline moved from main.cts to electron/main/services/extensions/install.cts (indented inside registerExtensionInstallIpc).
    const install = readMainModule('services/extensions/install.cts');
    // Everything the main process is made of (main.cts + electron/main/**), for the "nothing else installs" checks.
    const main = readMainSources();
    const start = install.indexOf('async function installExtensionFromZipPath(');
    const end = install.indexOf("registry.handle('install-extension-from-file'", start);
    const body = install.slice(start, end);

    it('the shared installer runs the gate before anything is written to extensions/', () => {
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const gateAt = body.indexOf('checkPluginApiGate(manifest, app.getVersion())');
        expect(gateAt).toBeGreaterThan(0);
        // T-318: the manifest rewrite and the removal of the old folder are asynchronous now; every write must still exist and follow the gate.
        for (const write of [
            'withInstallLock(',
            'fs.promises.writeFile(',
            'fs.promises.rm(targetDir',
            'fs.mkdirSync(extensionsDir',
            'fs.renameSync(',
            'saveExtensionsConfig(',
            'recordExtensionOrigin(',
        ]) {
            const at = body.indexOf(write);
            expect(at, write).toBeGreaterThan(0);
            expect(gateAt, write).toBeLessThan(at);
        }
        // A refusal returns the gate reason and cleans the temp folder.
        expect(body).toMatch(
            /if \(!gate\.ok\) \{[^]*?await fs\.promises\.rm\(tempExtractDir[^]*?return \{ success: false, reason: gate\.reason \};/
        );
    });

    it('every install handler goes through the shared installer and nothing else moves files into extensions/', () => {
        for (const channel of ['install-extension-from-file', 'install-extension-from-path', 'install-extension-from-github']) {
            const from = install.indexOf(`registry.handle('${channel}'`);
            expect(from, channel).toBeGreaterThan(0);
            const handlerEnd = install.indexOf('\n    });', from);
            expect(handlerEnd, channel).toBeGreaterThan(from);
            const handler = install.slice(from, handlerEnd);
            expect(handler, channel).toContain('installExtensionFromZipPath(');
            expect(handler, channel).not.toMatch(/renameSync|rename\(|copyFileSync|copyFile\(|cpSync|\.cp\(|extractAllTo|extractZipSafely/);
        }
        // The only place that moves a package into the extensions folder is the gated installer.
        expect(main.match(/fs\.renameSync\(searchDir, targetDir\)/g)?.length).toBe(1);
        expect(main.match(/installExtensionFromZipPath\(/g)?.length).toBe(4); // definition + 3 handlers
        expect(main).not.toMatch(/(?:ipcMain|registry)\.handle\('(install|update)-extension(?!-from-(file|path|github))/);
    });
});
