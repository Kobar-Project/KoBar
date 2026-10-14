import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCleanTargets } from './cleanTargets.mjs';

// Removes stale compiled output (dist/, dist-electron/) so orphan files never enter a package.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const target of resolveCleanTargets(root)) {
    fs.rmSync(target, { recursive: true, force: true });
}
