import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as prettier from 'prettier';

const root = import.meta.dirname;

// Files kept out of the pre-commit check until the M3 refactors are done.
const HOOK_EXCLUDED = [
    /^electron\/main\.cts$/,
    /^src\/App\.tsx$/,
    /^src\/store\/useAppStore\.ts$/,
    /^src\/i18n\/translations\.ts$/,
    /^src\/store\/migrations\//,
    /^kobar-build\.js$/,
];

// Maps new path -> old path for staged renames/copies so a moved file keeps its HEAD history.
// -M uses git's 50% similarity threshold: a heavily rewritten file shows up as add+delete and is checked as new.
function stagedRenames() {
    const map = new Map();
    const out = execFileSync('git', ['diff', '--cached', '--name-status', '-M', '-z'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const parts = out.split('\0');
    for (let i = 0; i < parts.length;) {
        const status = parts[i++];
        if (!status) continue;
        if (status[0] === 'R' || status[0] === 'C') {
            const oldPath = parts[i++];
            const newPath = parts[i++];
            map.set(newPath, oldPath);
        } else {
            i++;
        }
    }
    return map;
}

// Ratchet: enforce prettier only on new files and on files whose HEAD version already passes.
async function enforced(abs, headPath) {
    const info = await prettier.getFileInfo(abs, { ignorePath: path.join(root, '.prettierignore') });
    if (info.ignored || !info.inferredParser) return false;
    let src;
    try {
        src = execFileSync('git', ['show', `HEAD:${headPath}`], {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return true; // not in HEAD -> new file
    }
    const options = (await prettier.resolveConfig(abs)) ?? {};
    return prettier.check(src, { ...options, filepath: abs });
}

export default {
    '*': async (files) => {
        const renames = stagedRenames();
        const kept = [];
        for (const f of files) {
            const rel = path.relative(root, f).split(path.sep).join('/');
            if (HOOK_EXCLUDED.some((re) => re.test(rel))) continue;
            if (await enforced(f, renames.get(rel) ?? rel)) kept.push(f);
        }
        if (kept.length === 0) return [];
        // Batch paths to stay under the Windows command-line length limit.
        const commands = [];
        for (let i = 0; i < kept.length; i += 100) {
            const batch = kept
                .slice(i, i + 100)
                .map((f) => JSON.stringify(f))
                .join(' ');
            commands.push(`prettier --check --ignore-unknown ${batch}`);
        }
        return commands;
    },
};
