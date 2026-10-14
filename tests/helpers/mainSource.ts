// T-305: source-level tests used to read electron/main.cts alone. Code that moved into electron/main/lib/*.cts (and other
// electron/main/**) is still part of "the main process source", so tests that assert on it read it through these helpers
// instead of weakening their assertions.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ELECTRON_DIR = resolve(__dirname, '../../electron');

function ctsFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
            entry.isDirectory() ? ctsFilesUnder(join(dir, entry.name)) : entry.name.endsWith('.cts') ? [join(dir, entry.name)] : []
        )
        .sort();
}

/** electron/main.cts as text. */
export function readMainCts(): string {
    return readFileSync(join(ELECTRON_DIR, 'main.cts'), 'utf8');
}

/** One file of electron/main/ (e.g. `lib/llmRequest.cts`) as text. */
export function readMainModule(relativePath: string): string {
    return readFileSync(join(ELECTRON_DIR, 'main', relativePath), 'utf8');
}

/**
 * main.cts followed by every electron/main/**\/*.cts (sorted), joined with a newline.
 * `exclude` lists files of electron/main/ (posix paths such as `ipc/registry.cts`) to leave out.
 */
export function readMainSources(exclude: readonly string[] = []): string {
    const mainDir = join(ELECTRON_DIR, 'main');
    const skipped = new Set(exclude.map((relativePath) => join(mainDir, relativePath)));
    const files = ctsFilesUnder(mainDir).filter((file) => !skipped.has(file));
    return [readMainCts(), ...files.map((file) => readFileSync(file, 'utf8'))].join('\n');
}
