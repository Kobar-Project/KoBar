import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

/**
 * KoBar Smart Build Manager v2
 * This script automates the configuration and build process.
 */

const settingsPath = './kobar-settings.json';
const packagePath = './package.json';
const mainPath = './electron/main.cts';
const appPath = './src/App.tsx';

function log(msg) {
    console.log(`\n[KoBar Build] 🚀 ${msg}`);
}

function updateFile(filePath, regex, replacement) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(regex, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
}

async function runBuildSequence(isStore) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const mode = isStore ? "STORE (AppX)" : "STANDARD (Standalone)";
    
    // Determine feature flags
    // If it's a store build, we generally disable these, but we'll follow settings if they are global.
    // However, store builds MUST NOT have auto-update. So we force it false for Store.
    const autoUpdate = isStore ? false : settings.enableAutoUpdate;
    const licensing = isStore ? false : settings.enableLicensing;

    log(`Preparing ${mode} configuration... (Version: ${settings.version}, Licensing: ${licensing}, Update: ${autoUpdate})`);

    // 1. Update package.json
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.version = settings.version;
    pkg.build.win.target = isStore ? ["appx"] : ["nsis"];
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2), 'utf8');

    // 2. Update main.cts
    updateFile(mainPath, 
        /const IS_STORE_BUILD = (true|false);/, 
        `const IS_STORE_BUILD = ${isStore};`
    );
    updateFile(mainPath, 
        /const ENABLE_AUTO_UPDATE = (true|false);/, 
        `const ENABLE_AUTO_UPDATE = ${autoUpdate};`
    );

    // 3. Update App.tsx
    updateFile(appPath, 
        /export const IS_STORE_BUILD = (true|false);/, 
        `export const IS_STORE_BUILD = ${isStore};`
    );
    updateFile(appPath, 
        /export const ENABLE_LICENSING = (true|false);/, 
        `export const ENABLE_LICENSING = ${licensing};`
    );

    log(`Compiling files for ${mode}...`);
    execSync('npm run build', { stdio: 'inherit' });

    log(`Packaging ${mode} binary...`);
    const platformFlag = process.platform === 'darwin' ? '--mac' : '--win';
    execSync(`npx electron-builder ${platformFlag}`, { stdio: 'inherit' });
    
    log(`${mode} build complete!`);
}

async function start() {
    try {
        if (!fs.existsSync(settingsPath)) {
            console.error("kobar-settings.json not found!");
            return;
        }

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

        if (settings.buildStandard) {
            await runBuildSequence(false);
        }

        if (settings.buildAppx) {
            await runBuildSequence(true);
        }

        log("All requested builds finished. Check the /release folder.");

    } catch (err) {
        console.error("\n❌ Build failed:", err.message);
    }
}

start();
