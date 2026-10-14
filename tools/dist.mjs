// T-217: packaging runner used by the `dist:*` npm scripts.
//
//   node tools/dist.mjs <store|direct> <electron-builder platform flag...> --publish never
//
// One flavor value drives both steps, so the renderer (Vite `KOBAR_FLAVOR`) and the main process (`extraMetadata.kobarFlavor`
// in electron-builder.config.cjs) can never diverge. No cross-env needed (works the same in PowerShell, cmd and POSIX shells).
// Refuses to run unless the arguments contain exactly `--publish never`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FLAVORS = ['store', 'direct'];

/** Validates the CLI arguments; returns the flavor and the arguments forwarded to electron-builder. Throws on bad input. */
export function parseDistArgs(argv) {
    const [flavor, ...builderArgs] = argv;
    if (!FLAVORS.includes(flavor)) {
        throw new Error(`First argument must be "store" or "direct" (got ${JSON.stringify(flavor ?? null)}).`);
    }
    const publishIndexes = builderArgs.flatMap((arg, i) =>
        arg === '--publish' || arg === '-p' || arg.startsWith('--publish=') ? [i] : []
    );
    if (publishIndexes.length !== 1 || builderArgs[publishIndexes[0]] !== '--publish' || builderArgs[publishIndexes[0] + 1] !== 'never') {
        throw new Error('dist scripts must pass exactly `--publish never` (publishing is never done from this repository).');
    }
    if (
        builderArgs.some(
            (arg) =>
                arg === '--config' || arg === '-c' || arg.startsWith('--config=') || arg.startsWith('--config.') || arg.startsWith('-c.')
        )
    ) {
        throw new Error('Do not override the builder config; electron-builder.config.cjs is always used.');
    }
    return { flavor, builderArgs };
}

/** Builds the two commands (compile, then package) with the same KOBAR_FLAVOR env. Pure, for tests. */
export function planDist({ flavor, builderArgs }, { nodePath, npmCliPath, builderCliPath, configPath, env }) {
    const childEnv = { ...env, KOBAR_FLAVOR: flavor };
    const build = npmCliPath
        ? { command: nodePath, args: [npmCliPath, 'run', 'build'], shell: false }
        : { command: 'npm run build', args: [], shell: true };
    const pack = { command: nodePath, args: [builderCliPath, '--config', configPath, ...builderArgs], shell: false };
    return { env: childEnv, steps: [build, pack] };
}

function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const require = createRequire(import.meta.url);
    const parsed = parseDistArgs(process.argv.slice(2));
    const npmExec = process.env.npm_execpath;
    const plan = planDist(parsed, {
        nodePath: process.execPath,
        npmCliPath: npmExec && /\.c?js$/.test(npmExec) ? npmExec : null,
        builderCliPath: require.resolve('electron-builder/cli.js'),
        configPath: path.join(root, 'electron-builder.config.cjs'),
        env: process.env,
    });
    console.log(`\n[KoBar dist] flavor=${parsed.flavor} args=${parsed.builderArgs.join(' ')}`);
    for (const step of plan.steps) {
        const result = spawnSync(step.command, step.args, { cwd: root, env: plan.env, stdio: 'inherit', shell: step.shell });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            process.exitCode = result.status ?? 1;
            return;
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main();
    } catch (err) {
        console.error(`\n[KoBar dist] ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
