import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('R-06 contact email', () => {
    it('no tracked source file mentions the old contact domain', () => {
        let out = '';
        try {
            out = execFileSync('git', ['grep', '-il', 'ko48.com', '--', 'src', 'electron', 'README.md', 'SECURITY.md'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).toString();
        } catch {
            out = ''; // git grep exits 1 when nothing matches
        }
        expect(out).toBe('');
    });
});

describe('R-07/R-12 css', () => {
    const css = readFileSync('src/index.css', 'utf8');
    it('spinner rotates on its own centre', () => {
        expect(css).toMatch(/\.kb-spin\s*\{[^}]*transform-origin:\s*50% 50%/);
    });
    it('note editor has no focus frame', () => {
        expect(css).not.toMatch(/\.tiptap:focus-visible\s*\{[^}]*outline:\s*1px/);
    });
});
