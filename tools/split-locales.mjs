// One-off migration (T-626): splits the legacy src/i18n/translations.ts into src/i18n/locales/<lang>.json.
// Usage: node tools/split-locales.mjs [path-to-translations.ts]
// The legacy file is transpiled with the TypeScript compiler and evaluated; every language object is
// written as pretty-printed JSON with the original key order and byte-identical values.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? resolve(root, 'src/i18n/translations.ts'));
const outDir = resolve(root, 'src/i18n/locales');

const js = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

mkdirSync(outDir, { recursive: true });
for (const [lang, table] of Object.entries(mod.translations)) {
    writeFileSync(resolve(outDir, `${lang}.json`), JSON.stringify(table, null, 4) + '\n', 'utf8');
    console.log(`${lang}: ${Object.keys(table).length} keys`);
}
