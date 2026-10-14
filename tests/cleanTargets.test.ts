import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCleanTargets } from '../tools/cleanTargets.mjs';

describe('resolveCleanTargets', () => {
    it('returns exactly dist and dist-electron under the root', () => {
        const root = path.resolve('some', 'repo');
        expect(resolveCleanTargets(root)).toEqual([path.join(root, 'dist'), path.join(root, 'dist-electron')]);
    });

    it('refuses empty or non-string roots', () => {
        expect(() => resolveCleanTargets('')).toThrow();
        expect(() => resolveCleanTargets(undefined as unknown as string)).toThrow();
    });

    it('refuses a filesystem root', () => {
        expect(() => resolveCleanTargets(path.parse(process.cwd()).root)).toThrow();
    });
});
