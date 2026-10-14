// T-301: bundles the Electron main process, the preloads and the worker threads with esbuild.
//
//   node tools/build-electron.mjs            one-shot build into dist-electron/ (used by `npm run build`)
//   node tools/build-electron.mjs --watch    rebuild on change (used by `npm run dev`)
//
// Every entry becomes ONE self-contained CommonJS file under the same name tsc used to emit (dist-electron/main.cjs,
// preload.cjs, ...). First-party code (electron/lib/*, and later ../shared/*) is inlined; everything that comes from
// node_modules stays an external `require()` resolved at runtime from the production node_modules electron-builder packs.
// Type checking is NOT done here: `npx tsc -p electron/tsconfig.json --noEmit` stays the check command (the config is noEmit).

import { builtinModules } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTDIR = path.join(ROOT, 'dist-electron');

/**
 * Output name (without extension) -> source file. main.cts resolves preload.cjs, pip-preload.cjs, settings-preload.cjs (T-606) and
 * smtc-worker.cjs via path.join(__dirname, ...), and lib/pdfText.cts resolves pdf-worker.cjs the same way, so all of them sit flat
 * next to main.cjs.
 */
export const ENTRY_POINTS = Object.freeze({
    main: 'electron/main.cts',
    preload: 'electron/preload.cts',
    'pip-preload': 'electron/pip-preload.cts',
    'settings-preload': 'electron/settings-preload.cts',
    'smtc-worker': 'electron/smtc-worker.cts',
    'pdf-worker': 'electron/pdf-worker.cts',
});

/** Sandboxed preloads only get Electron's limited `require`, so their bundles may require nothing but `electron`. */
export const SANDBOXED_PRELOADS = Object.freeze(['preload', 'pip-preload', 'settings-preload']);

/**
 * The bundle targets Node 24 (assumed to match the Node embedded in the Electron version in use; not verified by running Electron), so it is not down-levelled below what that runtime supports (the preloads run in the
 * same Electron's Chromium, which supports at least the same syntax).
 */
export const NODE_TARGET = 'node24';

function readPackageJson(root) {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/** Packages a bundle may leave as a runtime require: Electron itself plus the production (and optional) dependencies. */
export function allowedRuntimePackages(pkg) {
    return new Set(['electron', ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]);
}

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`. */
export function packageNameOf(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isNodeBuiltin(specifier) {
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    return builtinModules.includes(bare) || builtinModules.includes(bare.split('/')[0]);
}

/**
 * Checks the external imports recorded in an esbuild metafile. Returns human-readable problems (empty = OK):
 * a sandboxed preload may only import `electron`; any other bundle may import Node built-ins, `electron` and packages
 * listed in package.json `dependencies` / `optionalDependencies` (devDependencies are not packed into the app).
 */
export function checkExternalImports(metafile, pkg) {
    const allowed = allowedRuntimePackages(pkg);
    const problems = [];
    for (const [outPath, output] of Object.entries(metafile.outputs)) {
        const name = path.basename(outPath).replace(/\.cjs$/, '');
        if (!Object.hasOwn(ENTRY_POINTS, name)) continue;
        const sandboxed = SANDBOXED_PRELOADS.includes(name);
        for (const imp of output.imports ?? []) {
            if (!imp.external) continue;
            const spec = imp.path;
            if (sandboxed) {
                if (spec !== 'electron') problems.push(`${name}.cjs: sandboxed preload must only require "electron" (found "${spec}")`);
            } else if (!isNodeBuiltin(spec) && !allowed.has(packageNameOf(spec))) {
                problems.push(`${name}.cjs: "${spec}" is not a Node built-in or a production dependency in package.json`);
            }
        }
    }
    return problems;
}

/** esbuild options for one build of all entries. Pure, for tests. */
export function createBuildOptions({ outdir = DEFAULT_OUTDIR, root = ROOT } = {}) {
    return {
        absWorkingDir: root,
        entryPoints: Object.entries(ENTRY_POINTS).map(([out, src]) => ({ in: path.join(root, src), out })),
        outdir,
        outExtension: { '.js': '.cjs' },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: NODE_TARGET,
        // Bare specifiers (node_modules) stay `require()` calls: electron-updater, adm-zip, pdf-parse (lazily required inside
        // the PDF worker, after its native-addon guard is installed) and the optional native SMTC monitor must load from the
        // packed node_modules exactly as before. Node built-ins are external on platform 'node'; relative imports are bundled.
        packages: 'external',
        external: ['electron'],
        // Same compiler settings (strict -> "use strict", class-field semantics) as the type-check config.
        tsconfig: path.join(root, 'electron', 'tsconfig.json'),
        sourcemap: false,
        minify: false,
        keepNames: false,
        legalComments: 'none',
        metafile: true,
        logLevel: 'warning',
    };
}

/** Watch mode: reports externals-guard problems after every rebuild (the one-shot build throws instead). */
function externalsGuardPlugin(root) {
    return {
        name: 'kobar-externals-guard',
        setup(build) {
            build.onEnd((result) => {
                if (!result.metafile) return;
                for (const text of checkExternalImports(result.metafile, readPackageJson(root))) {
                    console.error(`[KoBar build-electron] ${text}`);
                }
            });
        },
    };
}

/** One-shot build. Throws on any esbuild error or when a bundle would require something unavailable at runtime. */
export async function buildElectron({ outdir = DEFAULT_OUTDIR, root = ROOT } = {}) {
    const result = await esbuild.build(createBuildOptions({ outdir, root }));
    const problems = checkExternalImports(result.metafile, readPackageJson(root));
    if (problems.length > 0) throw new Error(problems.join('\n'));
    return result;
}

async function main() {
    const watch = process.argv.includes('--watch');
    if (!watch) {
        await buildElectron();
        console.log(
            `[KoBar build-electron] bundled ${Object.keys(ENTRY_POINTS).length} entries into ${path.relative(ROOT, DEFAULT_OUTDIR)}/`
        );
        return;
    }
    const ctx = await esbuild.context({
        ...createBuildOptions(),
        logLevel: 'info',
        plugins: [externalsGuardPlugin(ROOT)],
    });
    await ctx.watch();
    console.log('[KoBar build-electron] watching electron/ for changes...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((err) => {
        console.error(`\n[KoBar build-electron] ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}
