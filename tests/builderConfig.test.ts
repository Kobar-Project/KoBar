import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { APP_ID, ELECTRON_FUSES, createBuilderConfig } from '../tools/builderConfig.cjs';
import { parseDistArgs, planDist } from '../tools/dist.mjs';

// T-217: electron-builder flavor config, dist scripts and fuses. Synthetic values only; kobar-secrets.json is never read.

const SYNTHETIC_IDENTITY = {
    identityName: 'Synthetic.TestIdentity',
    publisher: 'CN=00000000-SYNTHETIC',
    publisherDisplayName: 'Synthetic Publisher',
};
const IDENTITY_ENV = {
    KOBAR_APPX_IDENTITY_NAME: 'Env.Identity',
    KOBAR_APPX_PUBLISHER: 'CN=ENV-PUBLISHER',
    KOBAR_APPX_PUBLISHER_DISPLAY_NAME: 'Env Publisher',
};
const SETTINGS = { buildStandard: true, buildAppx: true, enableAutoUpdate: true };

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function noSecrets(): never {
    throw new Error('readSecrets must not be called');
}

describe('createBuilderConfig', () => {
    it('requires an explicit valid KOBAR_FLAVOR', () => {
        for (const KOBAR_FLAVOR of [undefined, '', 'dev', 'Store', 'bogus']) {
            expect(() => createBuilderConfig({ env: { KOBAR_FLAVOR }, readSettings: () => SETTINGS, readSecrets: noSecrets })).toThrow(
                /KOBAR_FLAVOR/
            );
        }
    });

    it('direct: nsis target, flavor + auto-update in extraMetadata (no version), no appx, secrets never read', () => {
        const readSecrets = vi.fn(noSecrets);
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => SETTINGS, readSecrets });
        expect(config.extraMetadata).toEqual({ kobarFlavor: 'direct', kobarAutoUpdate: true });
        expect(config.win.target).toEqual(['nsis']);
        expect(config.appx).toBeUndefined();
        expect(readSecrets).not.toHaveBeenCalled();
    });

    it('direct: auto-update only for a real boolean true', () => {
        for (const enableAutoUpdate of [false, 'true', 1, undefined, null]) {
            const config = createBuilderConfig({
                env: { KOBAR_FLAVOR: 'direct' },
                readSettings: () => ({ ...SETTINGS, enableAutoUpdate }),
                readSecrets: noSecrets,
            });
            expect(config.extraMetadata.kobarAutoUpdate).toBe(false);
        }
    });

    it('never puts a version into extraMetadata, even if the settings carry a stray one (package.json is the only source)', () => {
        for (const settings of [null, {}, { enableAutoUpdate: true }, { version: '9.8.7', enableAutoUpdate: true }]) {
            const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => settings, readSecrets: noSecrets });
            expect(config.extraMetadata).not.toHaveProperty('version');
        }
    });

    it('KOBAR_AUTO_UPDATE=false forces kobarAutoUpdate off; other values do not enable it beyond the settings', () => {
        const build = (env: Record<string, string>, enableAutoUpdate: boolean) =>
            createBuilderConfig({
                env: { KOBAR_FLAVOR: 'direct', ...env },
                readSettings: () => ({ ...SETTINGS, enableAutoUpdate }),
                readSecrets: noSecrets,
            }).extraMetadata.kobarAutoUpdate;
        expect(build({ KOBAR_AUTO_UPDATE: 'false' }, true)).toBe(false);
        expect(build({ KOBAR_AUTO_UPDATE: 'true' }, true)).toBe(true);
        expect(build({ KOBAR_AUTO_UPDATE: 'true' }, false)).toBe(false);
        expect(build({}, true)).toBe(true);
    });

    it('store: appx target, never self-updates, identity from env without reading secrets', () => {
        const readSecrets = vi.fn(noSecrets);
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'store', ...IDENTITY_ENV }, readSettings: () => SETTINGS, readSecrets });
        expect(config.extraMetadata).toEqual({ kobarFlavor: 'store', kobarAutoUpdate: false });
        expect(config.win.target).toEqual(['appx']);
        expect(config.appx).toMatchObject({
            applicationId: 'KoBar',
            identityName: 'Env.Identity',
            publisher: 'CN=ENV-PUBLISHER',
            publisherDisplayName: 'Env Publisher',
            displayName: 'KoBar',
            capabilities: ['runFullTrust'],
            addAutoLaunchExtension: true,
            customExtensionsPath: 'build/appx/extensions.xml',
        });
        expect(readSecrets).not.toHaveBeenCalled();
    });

    it('store: identity from the injected secrets reader; env wins per field', () => {
        const config = createBuilderConfig({
            env: { KOBAR_FLAVOR: 'store', KOBAR_APPX_PUBLISHER: 'CN=ENV-ONLY' },
            readSettings: () => SETTINGS,
            readSecrets: () => SYNTHETIC_IDENTITY,
        });
        expect(config.appx?.identityName).toBe(SYNTHETIC_IDENTITY.identityName);
        expect(config.appx?.publisher).toBe('CN=ENV-ONLY');
        expect(config.appx?.publisherDisplayName).toBe(SYNTHETIC_IDENTITY.publisherDisplayName);
    });

    it('store: fails without identity and never echoes values', () => {
        const partial = { identityName: 'Leaky.Value' };
        let message = '';
        try {
            createBuilderConfig({ env: { KOBAR_FLAVOR: 'store' }, readSettings: () => SETTINGS, readSecrets: () => partial });
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain('KOBAR_APPX_PUBLISHER');
        expect(message).not.toContain('Leaky.Value');
        expect(() =>
            createBuilderConfig({ env: { KOBAR_FLAVOR: 'store' }, readSettings: () => SETTINGS, readSecrets: () => null })
        ).toThrow(/AppX identity/);
    });

    it('store: a failing secrets reader yields a generic message', () => {
        const readSecrets = () => {
            throw new SyntaxError('Unexpected token in {"publisher":"CN=SECRET-SNIPPET"');
        };
        expect(() => createBuilderConfig({ env: { KOBAR_FLAVOR: 'store' }, readSettings: () => SETTINGS, readSecrets })).toThrow(
            /^Could not read or parse kobar-secrets\.json$/
        );
    });

    it('keeps the app identity unchanged and publishes to the canonical repository (T-219)', () => {
        const config = createBuilderConfig({
            env: { KOBAR_FLAVOR: 'store', ...IDENTITY_ENV },
            readSettings: () => SETTINGS,
            readSecrets: noSecrets,
        });
        expect(APP_ID).toBe('com.eedali.kobar');
        expect(config.appId).toBe('com.eedali.kobar');
        expect(config.publish).toEqual([{ provider: 'github', owner: 'Kobar-Project', repo: 'KoBar' }]);
        expect(config.asar).toBe(true);
        expect(config.directories).toEqual({ output: 'release', buildResources: 'build' });
        expect(JSON.stringify(config)).not.toMatch(/"publish"\s*:\s*"always"/);
    });

    it('flips the expected Electron fuses and leaves the risky ones at their defaults', () => {
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => SETTINGS, readSecrets: noSecrets });
        expect(config.electronFuses).toEqual({
            runAsNode: false,
            enableNodeOptionsEnvironmentVariable: false,
            enableNodeCliInspectArguments: false,
            enableEmbeddedAsarIntegrityValidation: true,
            onlyLoadAppFromAsar: true,
            resetAdHocDarwinSignature: true,
        });
        expect(config.electronFuses).toEqual(ELECTRON_FUSES);
        expect(config.electronFuses).not.toHaveProperty('enableCookieEncryption');
        expect(config.electronFuses).not.toHaveProperty('grantFileProtocolExtraPrivileges');
    });

    it('returns fresh objects (no shared mutable state between calls)', () => {
        const a = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => SETTINGS, readSecrets: noSecrets });
        a.electronFuses.runAsNode = true;
        const b = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => SETTINGS, readSecrets: noSecrets });
        expect(b.electronFuses.runAsNode).toBe(false);
    });
});

describe('build sources do not write files', () => {
    it('config factory, config file, dist runner and kobar-build.js contain no file writes', () => {
        for (const rel of [
            'tools/builderConfig.cjs',
            'electron-builder.cjs',
            'electron-builder.config.cjs',
            'tools/dist.mjs',
            'kobar-build.js',
        ]) {
            expect(read(rel), rel).not.toMatch(/writeFile|appendFile|copyFile|rmSync|unlink|renameSync/);
        }
        expect(read('tools/builderConfig.cjs')).not.toMatch(/require\(['"](node:)?fs['"]\)/);
    });

    it('electron-builder.cjs (auto-discovered by a bare electron-builder call) re-exports the real config', () => {
        expect(read('electron-builder.cjs')).toContain("module.exports = require('./electron-builder.config.cjs');");
    });

    it('kobar-build.js is a thin wrapper over the dist scripts', () => {
        const src = read('kobar-build.js');
        expect(src).not.toContain('TODO(T-217)');
        expect(src).not.toContain('kobar-secrets');
        // T-218: the version is only read (logged) from package.json, never from kobar-settings.json.
        expect(src).toContain('package.json');
        expect(src).not.toContain('settings.version');
        expect(src).toContain("'dist:direct:win'");
        expect(src).toContain("'dist:store'");
        expect(src).toContain("'dist:mac'");
    });
});

describe('package.json scripts', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; build?: unknown; version: string };

    it('defines the three dist scripts, all with --publish never and the right flavor/platform', () => {
        expect(pkg.scripts['dist:store']).toBe('node tools/dist.mjs store --win --publish never');
        expect(pkg.scripts['dist:direct:win']).toBe('node tools/dist.mjs direct --win --publish never');
        expect(pkg.scripts['dist:mac']).toBe('node tools/dist.mjs direct --mac --publish never');
    });

    it('every packaging script contains --publish never', () => {
        const packaging = Object.entries(pkg.scripts).filter(
            ([name, cmd]) => name.startsWith('dist') || /electron-builder|tools\/dist\.mjs/.test(cmd)
        );
        expect(packaging.length).toBeGreaterThanOrEqual(3);
        for (const [name, cmd] of packaging) expect(cmd, name).toContain('--publish never');
    });

    it('has a semver version and kobar-settings.json carries none (single version source, T-218)', () => {
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
        expect(JSON.parse(read('kobar-settings.json'))).not.toHaveProperty('version');
    });

    it('no builder config (or placeholder AppX identity) is left in package.json', () => {
        expect(pkg.build).toBeUndefined();
        expect(read('package.json')).not.toContain('YOUR_IDENTITY_NAME_HERE');
    });

    it('each dist script parses with the dist runner', () => {
        for (const name of ['dist:store', 'dist:direct:win', 'dist:mac']) {
            const argv = pkg.scripts[name].split(' ').slice(2);
            expect(() => parseDistArgs(argv), name).not.toThrow();
        }
    });
});

describe('tools/dist.mjs', () => {
    it('rejects a missing or wrong flavor', () => {
        expect(() => parseDistArgs([])).toThrow(/store" or "direct/);
        expect(() => parseDistArgs(['dev', '--win', '--publish', 'never'])).toThrow(/store" or "direct/);
    });

    it('requires exactly --publish never', () => {
        expect(() => parseDistArgs(['store', '--win'])).toThrow(/--publish never/);
        expect(() => parseDistArgs(['store', '--win', '--publish', 'always'])).toThrow(/--publish never/);
        expect(() => parseDistArgs(['store', '--win', '--publish=never'])).toThrow(/--publish never/);
        expect(() => parseDistArgs(['store', '--win', '--publish', 'never', '-p', 'always'])).toThrow(/--publish never/);
        expect(parseDistArgs(['store', '--win', '--publish', 'never'])).toEqual({
            flavor: 'store',
            builderArgs: ['--win', '--publish', 'never'],
        });
    });

    it('refuses a config override', () => {
        expect(() => parseDistArgs(['direct', '--win', '--publish', 'never', '--config', 'other.yml'])).toThrow(/config/);
        expect(() => parseDistArgs(['direct', '--win', '--publish', 'never', '-c.appId=x'])).toThrow(/config/);
        expect(() => parseDistArgs(['direct', '--win', '--publish', 'never', '--config.appId=x'])).toThrow(/config/);
        expect(() => parseDistArgs(['direct', '--win', '--publish', 'never', '--config=other.yml'])).toThrow(/config/);
    });

    it('runs build and packaging with the same KOBAR_FLAVOR and the fixed config file', () => {
        const plan = planDist(parseDistArgs(['store', '--win', '--publish', 'never']), {
            nodePath: 'node',
            npmCliPath: '/npm/bin/npm-cli.js',
            builderCliPath: '/eb/cli.js',
            configPath: '/repo/electron-builder.config.cjs',
            env: { KOBAR_FLAVOR: 'direct', OTHER: 'x' },
        });
        expect(plan.env).toEqual({ KOBAR_FLAVOR: 'store', OTHER: 'x' });
        expect(plan.steps).toEqual([
            { command: 'node', args: ['/npm/bin/npm-cli.js', 'run', 'build'], shell: false },
            {
                command: 'node',
                args: ['/eb/cli.js', '--config', '/repo/electron-builder.config.cjs', '--win', '--publish', 'never'],
                shell: false,
            },
        ]);
    });

    it('falls back to a shell npm call when npm_execpath is unknown', () => {
        const plan = planDist(
            { flavor: 'direct', builderArgs: ['--mac', '--publish', 'never'] },
            { nodePath: 'node', npmCliPath: null, builderCliPath: 'cli.js', configPath: 'cfg.cjs', env: {} }
        );
        expect(plan.steps[0]).toEqual({ command: 'npm run build', args: [], shell: true });
    });
});

describe('PDF worker packaging (T-141)', () => {
    it('does not unpack anything from the asar (integrity validation stays complete)', () => {
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => null, readSecrets: noSecrets });
        expect(config).not.toHaveProperty('asarUnpack');
        expect(config.asar).toBe(true);
        expect(config.electronFuses.onlyLoadAppFromAsar).toBe(true);
    });

    it('ships the compiled worker (dist-electron is allow-listed) and the dev script waits for it', () => {
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => null, readSecrets: noSecrets });
        expect(config.files).toContain('dist-electron/**/*');
        expect(read('package.json')).toContain('dist-electron/pdf-worker.cjs');
        expect(fs.existsSync(path.join(root, 'electron', 'pdf-worker.cts'))).toBe(true);
    });

    it('excludes every @napi-rs/canvas package from the asar while keeping the allow-list (MAC-012)', () => {
        const allowList = ['dist/**/*', 'dist-electron/**/*', 'Assets/**/*', 'build/**/*', 'package.json'];
        const negations = ['!**/node_modules/@napi-rs/canvas/**', '!**/node_modules/@napi-rs/canvas-*/**'];
        for (const env of [{ KOBAR_FLAVOR: 'direct' }, { KOBAR_FLAVOR: 'store', ...IDENTITY_ENV }]) {
            const config = createBuilderConfig({ env, readSettings: () => null, readSecrets: noSecrets });
            for (const pattern of negations) expect(config.files).toContain(pattern);
            for (const pattern of allowList) expect(config.files).toContain(pattern);
        }
    });

    it('the PDF worker still stubs @napi-rs/canvas, so the packaging exclusion stays valid (MAC-012)', () => {
        expect(read('electron/pdf-worker.cts')).toContain("request.startsWith('@napi-rs/canvas')");
    });
});

describe('macOS packaging (MAC-011)', () => {
    const mk = (env: Record<string, string | undefined> = {}) =>
        createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct', ...env }, readSettings: () => SETTINGS, readSecrets: noSecrets });
    const keysOf = (rel: string) => [...read(rel).matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);

    it('mac block: arm64 dmg + zip, metadata and entitlement paths', () => {
        const mac = mk().mac as Record<string, unknown> & { extendInfo: Record<string, unknown> };
        expect(mac.target).toEqual([
            { target: 'dmg', arch: ['arm64'] },
            { target: 'zip', arch: ['arm64'] },
        ]);
        expect(mac.category).toBe('public.app-category.productivity');
        expect(mac.artifactName).toBe('KoBar-${version}-${arch}.${ext}');
        expect(mac.darkModeSupport).toBe(true);
        expect(mac.entitlements).toBe('build/entitlements.mac.plist');
        expect(mac.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist');
        expect(mac.extendInfo.LSUIElement).toBe(true);
        expect(String(mac.extendInfo.NSScreenCaptureUsageDescription).length).toBeGreaterThan(0);
        expect(String(mac.extendInfo.NSAppleEventsUsageDescription).length).toBeGreaterThan(0);
    });

    it('mac block has no minimumSystemVersion, identity or notarize credentials', () => {
        const mac = mk({ APPLE_API_KEY: 'k-secret', APPLE_API_KEY_ID: 'id-secret', APPLE_API_ISSUER: 'iss-secret' }).mac;
        expect(mac).not.toHaveProperty('minimumSystemVersion');
        expect(mac).not.toHaveProperty('identity');
        expect(mac).not.toHaveProperty('notarize');
        expect(JSON.stringify(mac)).not.toMatch(/APPLE_API|k-secret|id-secret|iss-secret/);
    });

    it('hardenedRuntime only when KOBAR_MAC_SIGNED is exactly "true"', () => {
        expect(mk().mac.hardenedRuntime).toBe(false);
        for (const v of ['', 'false', 'TRUE', '1', 'yes']) expect(mk({ KOBAR_MAC_SIGNED: v }).mac.hardenedRuntime).toBe(false);
        expect(mk({ KOBAR_MAC_SIGNED: 'true' }).mac.hardenedRuntime).toBe(true);
    });

    it('MAC-016: kobarMacSigned is written only for KOBAR_MAC_SIGNED=true', () => {
        expect(mk().extraMetadata).not.toHaveProperty('kobarMacSigned');
        for (const v of ['', 'false', 'TRUE', '1']) expect(mk({ KOBAR_MAC_SIGNED: v }).extraMetadata).not.toHaveProperty('kobarMacSigned');
        expect(mk({ KOBAR_MAC_SIGNED: 'true' }).extraMetadata.kobarMacSigned).toBe(true);
    });

    it('Windows and Store configuration is unchanged', () => {
        const direct = mk();
        expect(direct.win).toEqual({ target: ['nsis'], icon: 'build/icon.ico' });
        expect(direct.nsis).toEqual({
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            artifactName: 'KoBar-Setup-${version}.${ext}',
        });
        expect(direct).not.toHaveProperty('appx');
        const store = createBuilderConfig({
            env: { KOBAR_FLAVOR: 'store', ...IDENTITY_ENV },
            readSettings: () => SETTINGS,
            readSecrets: noSecrets,
        });
        expect(store.win).toEqual({ target: ['appx'], icon: 'build/icon.ico' });
        expect(store.appx).toEqual({
            applicationId: 'KoBar',
            identityName: 'Env.Identity',
            publisher: 'CN=ENV-PUBLISHER',
            publisherDisplayName: 'Env Publisher',
            displayName: 'KoBar',
            backgroundColor: '#18181B',
            capabilities: ['runFullTrust'],
            addAutoLaunchExtension: true,
            customExtensionsPath: 'build/appx/extensions.xml',
        });
    });

    it('entitlement plists contain exactly the expected keys', () => {
        const jit = 'com.apple.security.cs.allow-jit';
        const mem = 'com.apple.security.cs.allow-unsigned-executable-memory';
        const apple = 'com.apple.security.automation.apple-events';
        expect(keysOf('build/entitlements.mac.plist').sort()).toEqual([apple, jit, mem].sort());
        expect(keysOf('build/entitlements.mac.inherit.plist').sort()).toEqual([jit, mem].sort());
        for (const f of ['build/entitlements.mac.plist', 'build/entitlements.mac.inherit.plist']) {
            expect(read(f)).not.toMatch(/disable-library-validation|app-sandbox/);
        }
    });
});
