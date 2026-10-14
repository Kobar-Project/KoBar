import fs from 'fs';
import { execSync } from 'child_process';

/**
 * KoBar Smart Build Manager v3 (T-217)
 *
 * Thin wrapper: reads kobar-settings.json and runs the matching `dist:*` npm scripts for this platform.
 * No file is rewritten. The auto-update opt-in comes from kobar-settings.json and the flavor from the script
 * (KOBAR_FLAVOR); electron-builder.config.cjs turns them into `extraMetadata` inside the package only.
 * The app version lives ONLY in package.json (T-218) and is just logged here.
 * Every dist script packages with `--publish never` (see tools/dist.mjs).
 *
 * kobar-settings.json:
 *   buildStandard    -> direct build (Windows: NSIS installer via dist:direct:win, macOS: dmg/zip via dist:mac)
 *   buildAppx        -> Microsoft Store build (Windows only, dist:store)
 *   enableAutoUpdate -> self-update for the direct build (never for the Store build)
 */

const settingsPath = './kobar-settings.json';
const packagePath = './package.json';

function log(msg) {
    console.log(`\n[KoBar Build] ${msg}`);
}

/** Maps the settings to the npm scripts to run on the given platform. */
function selectDistScripts(settings, platform) {
    const scripts = [];
    if (platform === 'darwin') {
        if (settings.buildStandard) scripts.push('dist:mac');
        if (settings.buildAppx) log('buildAppx is ignored on macOS (Store builds are Windows only).');
        return scripts;
    }
    if (settings.buildStandard) scripts.push('dist:direct:win');
    if (settings.buildAppx) scripts.push('dist:store');
    return scripts;
}

function start() {
    if (!fs.existsSync(settingsPath)) {
        console.error('kobar-settings.json not found!');
        process.exitCode = 1;
        return;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const scripts = selectDistScripts(settings, process.platform);
    if (scripts.length === 0) {
        log('Nothing to build (buildStandard / buildAppx are off).');
        return;
    }
    const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    log(`Version ${version} (package.json), auto-update (direct only): ${settings.enableAutoUpdate === true}`);
    for (const script of scripts) {
        log(`Running npm run ${script}...`);
        try {
            execSync(`npm run ${script}`, { stdio: 'inherit' });
        } catch {
            console.error(`\n❌ ${script} failed.`);
            process.exitCode = 1;
            return;
        }
    }
    log('All requested builds finished. Check the /release folder.');
}

start();
