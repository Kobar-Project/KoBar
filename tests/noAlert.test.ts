// T-624: the renderer never calls alert(); informational messages are toasts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('renderer alert() cleanup', () => {
    it('has no alert( call in src/', () => {
        const offenders = sources('src').filter((file) => /(^|[^.\w'"])(window\.)?alert\(/.test(readFileSync(file, 'utf8')));
        expect(offenders).toEqual([]);
    });
});
