'use strict';

// T-217: electron-builder configuration factory.
//
// Pure on purpose: it never touches the file system and takes every input (env, settings, secrets) as an argument, so it
// can be unit-tested with synthetic values. The file-reading defaults live in electron-builder.config.cjs.
//
// The app version lives ONLY in package.json (T-218); electron-builder reads it from there, nothing overrides it.
//
// Nothing is mutated for a build: the per-flavor fields that the packaged main process reads at runtime
// (see electron/lib/buildFlags.cts) go into electron-builder `extraMetadata`, which only affects the package.json that is
// written INTO the package. The Store (AppX) identity is resolved here at build time from env or kobar-secrets.json and is
// never written to any tracked file.

const FLAVORS = ['store', 'direct'];

const APP_ID = 'com.eedali.kobar';

// T-219: canonical repository (releases + auto-update feed). A plain .cjs cannot import electron/lib/links.cts, so these two
// literals are a copy of REPO_OWNER / REPO_NAME there; tests/links.test.ts fails if they drift.
const PUBLISH_OWNER = 'Kobar-Project';
const PUBLISH_REPO = 'KoBar';

// Electron fuses (SEC-21), flipped by electron-builder right before signing.
// Left untouched on purpose (Electron defaults):
//   - enableCookieEncryption: a one-way change for existing users' cookie stores.
//   - grantFileProtocolExtraPrivileges: the app still loads its pages via file:// (loadFile).
//   - loadBrowserProcessSpecificV8Snapshot: no custom snapshot is shipped.
const ELECTRON_FUSES = {
    // ELECTRON_RUN_AS_NODE is ignored; the app uses worker_threads (smtc-worker), never process.fork.
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    // electron-builder embeds the ASAR header hash into the executable (Windows resource / macOS Info.plist).
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // Unsigned macOS builds (CI) need a fresh ad-hoc signature after the binary is patched; a real signature replaces it.
    resetAdHocDarwinSignature: true,
};

const APPX_IDENTITY_FIELDS = [
    ['identityName', 'KOBAR_APPX_IDENTITY_NAME'],
    ['publisher', 'KOBAR_APPX_PUBLISHER'],
    ['publisherDisplayName', 'KOBAR_APPX_PUBLISHER_DISPLAY_NAME'],
];

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function parseFlavor(value) {
    if (FLAVORS.includes(value)) return value;
    throw new Error(
        'KOBAR_FLAVOR must be "store" or "direct". Package with `npm run dist:store`, `npm run dist:direct:win` or `npm run dist:mac`.'
    );
}

/**
 * Resolves the AppX identity. Env variables win per field; missing fields come from the secrets reader
 * (kobar-secrets.json). Error messages never contain any value.
 */
function resolveAppxIdentity(env, readSecrets) {
    const identity = {};
    for (const [field, envName] of APPX_IDENTITY_FIELDS) {
        if (isNonEmptyString(env[envName])) identity[field] = env[envName];
    }
    if (APPX_IDENTITY_FIELDS.some(([field]) => !(field in identity))) {
        let secrets;
        try {
            secrets = readSecrets();
        } catch {
            // Do not propagate the original message: it may contain a snippet of the secrets file.
            throw new Error('Could not read or parse kobar-secrets.json');
        }
        if (secrets && typeof secrets === 'object') {
            for (const [field] of APPX_IDENTITY_FIELDS) {
                if (!(field in identity) && isNonEmptyString(secrets[field])) identity[field] = secrets[field];
            }
        }
    }
    const missing = APPX_IDENTITY_FIELDS.filter(([field]) => !(field in identity)).map(([, envName]) => envName);
    if (missing.length > 0) {
        throw new Error(
            `Store build needs the AppX identity. Missing: ${missing.join(', ')}. ` +
                'Set these env variables or provide identityName / publisher / publisherDisplayName in kobar-secrets.json.'
        );
    }
    return identity;
}

/**
 * @param {object} inputs
 * @param {Record<string, string | undefined>} inputs.env  usually process.env
 * @param {() => unknown} inputs.readSettings  returns parsed kobar-settings.json (or null)
 * @param {() => unknown} inputs.readSecrets  returns parsed kobar-secrets.json (or null); only called for the store flavor
 *
 * Env opt-out: KOBAR_AUTO_UPDATE=false forces kobarAutoUpdate to false (e.g. CI builds that must never self-update).
 */
function createBuilderConfig({ env, readSettings, readSecrets }) {
    const flavor = parseFlavor(env.KOBAR_FLAVOR);
    const rawSettings = readSettings();
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};

    const extraMetadata = {
        kobarFlavor: flavor,
        // Only a direct build may self-update, and only when kobar-settings.json opts in with a real boolean `true`.
        kobarAutoUpdate: flavor === 'direct' && settings.enableAutoUpdate === true && env.KOBAR_AUTO_UPDATE !== 'false',
    };

    const config = {
        appId: APP_ID,
        extraMetadata,
        // Kept so electron-updater gets app-update.yml; the dist scripts always pass `--publish never`.
        publish: [
            {
                provider: 'github',
                owner: PUBLISH_OWNER,
                repo: PUBLISH_REPO,
            },
        ],
        asar: true,
        directories: {
            output: 'release',
            buildResources: 'build',
        },
        files: ['dist/**/*', 'dist-electron/**/*', 'Assets/**/*', 'build/**/*', 'package.json'],
        // T-141: asarUnpack is deliberately absent: unpacked files escape EmbeddedAsarIntegrity validation, and the PDF worker
        // (electron/pdf-worker.cts) refuses to load the native @napi-rs/canvas addon, so nothing native is needed. If the packaged
        // PDF test fails (e.g. dynamic import of pdf.worker.mjs from the asar), add `**/node_modules/pdf-parse/**` ONLY.
        electronFuses: { ...ELECTRON_FUSES },
        win: {
            target: [flavor === 'store' ? 'appx' : 'nsis'],
            // R-05/R2-13: explicit multi-size KoBar icon (16..256 px, generated from build/icon.png) for KoBar.exe (Task Manager,
            // taskbar, shortcuts); the NSIS installer/uninstaller icons default to this one.
            icon: 'build/icon.ico',
        },
        nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            artifactName: 'KoBar-Setup-${version}.${ext}',
        },
        mac: {
            target: ['dmg', 'zip'],
            icon: 'build/icon.icns',
            hardenedRuntime: true,
            gatekeeperAssess: false,
            extendInfo: {
                NSScreenCaptureUsageDescription: 'KoBar needs access to your screen to let you capture and edit screenshots.',
            },
        },
    };

    if (flavor === 'store') {
        config.appx = {
            applicationId: 'KoBar',
            ...resolveAppxIdentity(env, readSecrets),
            displayName: 'KoBar',
            backgroundColor: '#1a1612',
            capabilities: ['runFullTrust'],
            addAutoLaunchExtension: true,
        };
    }

    return config;
}

module.exports = { createBuilderConfig, ELECTRON_FUSES, APP_ID, FLAVORS };
