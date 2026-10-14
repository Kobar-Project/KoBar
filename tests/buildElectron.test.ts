import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import type { Metafile } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTRY_POINTS, buildElectron, checkExternalImports, createBuildOptions, packageNameOf } from '../tools/build-electron.mjs';
import { resolvePdfWorkerPath } from '../electron/lib/pdfText.cjs';

// T-301: the Electron main process, preloads and workers are bundled by esbuild into single CommonJS files. These tests build
// into a temp directory (never dist-electron/) and check the outputs as text; nothing is executed and Electron is not launched.

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const ENTRY_NAMES = Object.keys(ENTRY_POINTS);

let outdir = '';
const bundle = (name: string) => fs.readFileSync(path.join(outdir, `${name}.cjs`), 'utf8');
const requiresIn = (code: string) => [...code.matchAll(/\brequire\(([^)]*)\)/g)].map((m) => m[1]);

beforeAll(async () => {
    outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-build-electron-'));
    await buildElectron({ outdir });
}, 60_000);

afterAll(() => {
    if (outdir) fs.rmSync(outdir, { recursive: true, force: true });
});

describe('esbuild bundle of the Electron entries', () => {
    it('emits exactly the entry files under their old names (plus the T-606 settings-preload), flat in the output directory', () => {
        expect(ENTRY_NAMES.sort()).toEqual(['main', 'pdf-worker', 'pip-preload', 'preload', 'settings-preload', 'smtc-worker']);
        expect(fs.readdirSync(outdir).sort()).toEqual(ENTRY_NAMES.map((n) => `${n}.cjs`).sort());
    });

    it('produces strict, syntactically valid CommonJS without inlined node_modules code', () => {
        for (const name of ENTRY_NAMES) {
            const code = bundle(name);
            expect(code.startsWith('"use strict";'), name).toBe(true);
            expect(() => new vm.Script(code, { filename: `${name}.cjs` }), name).not.toThrow();
            expect(code, name).not.toMatch(/^\/\/ node_modules\//m);
            expect(code, name).not.toMatch(/\bimport\s*\(|^\s*(import|export)\s/m);
        }
    });

    it('sandboxed preloads require nothing but electron', () => {
        for (const name of ['preload', 'pip-preload', 'settings-preload']) {
            const requires = requiresIn(bundle(name));
            expect(requires.length, name).toBeGreaterThan(0);
            expect(new Set(requires), name).toEqual(new Set(['"electron"']));
        }
    });

    it('keeps runtime packages as external requires resolved from the packed node_modules', () => {
        const main = requiresIn(bundle('main'));
        expect(main).toContain('"electron"');
        expect(main).toContain('"electron-updater"');
        expect(main).toContain('"adm-zip"');
        // The PDF worker must require pdf-parse lazily at runtime, after its native-addon guard is installed.
        expect(requiresIn(bundle('pdf-worker'))).toContain('"pdf-parse"');
        expect(requiresIn(bundle('smtc-worker'))).toContain('"@coooookies/windows-smtc-monitor"');
        // No relative requires: first-party modules (electron/lib, shared/) are inlined.
        for (const name of ENTRY_NAMES) {
            for (const spec of requiresIn(bundle(name))) expect(spec, `${name}: ${spec}`).not.toMatch(/^["']\./);
        }
    });

    it('every sibling file main.cjs resolves via __dirname exists next to it', () => {
        const main = bundle('main');
        // T-305: the paths are built by lib/appPaths (createAppPaths(dirname)); main.cjs must hand it ITS __dirname (the bundle directory).
        expect(main).toMatch(/createAppPaths\d*\(__dirname\)/);
        const siblings = [...main.matchAll(/path\d*\.join\((?:__dirname|dirname\d*), "([^"./][^"]*\.cjs)"\)/g)].map((m) => m[1]);
        expect(new Set(siblings)).toEqual(new Set(['preload.cjs', 'pip-preload.cjs', 'settings-preload.cjs', 'smtc-worker.cjs']));
        for (const file of siblings) expect(fs.existsSync(path.join(outdir, file)), file).toBe(true);
    });

    it('resolves the PDF worker next to the bundle that inlines lib/pdfText (__dirname is the output directory)', () => {
        expect(bundle('main')).toMatch(/resolvePdfWorkerPath\d*\(__dirname\)/);
        expect(resolvePdfWorkerPath(outdir)).toBe(path.join(outdir, 'pdf-worker.cjs'));
        expect(fs.existsSync(resolvePdfWorkerPath(outdir))).toBe(true);
    });
});

describe('build configuration', () => {
    it('targets Node CommonJS with source maps off and node_modules external', () => {
        const options = createBuildOptions({ outdir: 'x' });
        expect(options).toMatchObject({ bundle: true, platform: 'node', format: 'cjs', packages: 'external', sourcemap: false });
        expect(options.external).toContain('electron');
        expect(options.outExtension).toEqual({ '.js': '.cjs' });
    });

    it('tsc is type-check only and also covers shared/', () => {
        const tsconfig = JSON.parse(read('electron/tsconfig.json'));
        expect(tsconfig.compilerOptions.noEmit).toBe(true);
        expect(tsconfig.compilerOptions).not.toHaveProperty('outDir');
        expect(tsconfig.include).toContain('../shared/**/*.cts');
    });

    it('the dev script runs esbuild watch and waits for every entry output', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.scripts.dev).toContain('node tools/build-electron.mjs --watch');
        expect(pkg.scripts.dev).not.toContain('tsc -w');
        for (const name of ENTRY_NAMES) expect(pkg.scripts.dev).toContain(`dist-electron/${name}.cjs`);
        expect(pkg.scripts.build).toContain('node tools/build-electron.mjs');
        expect(pkg.main).toBe('dist-electron/main.cjs');
    });
});

describe('checkExternalImports', () => {
    const pkg = { dependencies: { 'electron-updater': '^6' }, optionalDependencies: { '@scope/native': '^1' } };
    const meta = (outputs: Record<string, string[]>): Metafile => ({
        inputs: {},
        outputs: Object.fromEntries(
            Object.entries(outputs).map(([name, specs]) => [
                `dist-electron/${name}.cjs`,
                {
                    bytes: 0,
                    inputs: {},
                    exports: [],
                    imports: specs.map((p) => ({ path: p, kind: 'require-call' as const, external: true })),
                },
            ])
        ),
    });

    it('accepts built-ins, electron and production/optional dependencies', () => {
        expect(
            checkExternalImports(
                meta({
                    main: ['electron', 'fs', 'node:path', 'fs/promises', 'electron-updater', 'electron-updater/out/x', '@scope/native'],
                }),
                pkg
            )
        ).toEqual([]);
    });

    it('rejects devDependencies / unknown packages in main and anything but electron in a sandboxed preload', () => {
        expect(checkExternalImports(meta({ main: ['vite'] }), pkg)).toHaveLength(1);
        expect(checkExternalImports(meta({ preload: ['electron', 'path'] }), pkg)).toHaveLength(1);
        expect(checkExternalImports(meta({ 'pip-preload': ['electron-updater'] }), pkg)).toHaveLength(1);
        expect(checkExternalImports(meta({ 'settings-preload': ['zod'] }), pkg)).toHaveLength(1);
    });

    it('extracts package names from deep and scoped specifiers', () => {
        expect(packageNameOf('@a/b/c')).toBe('@a/b');
        expect(packageNameOf('a/b')).toBe('a');
        expect(packageNameOf('a')).toBe('a');
    });
});
