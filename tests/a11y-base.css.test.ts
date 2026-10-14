import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

describe('index.css accessibility base', () => {
    it('does not globally kill button outlines', () => {
        expect(css).not.toMatch(/button\s*,\s*\[role="button"\]\s*\{[^}]*outline:\s*none/);
        expect(css).not.toMatch(/button:focus\s*,\s*\[role="button"\]:focus/);
    });

    it('has a :focus-visible ring', () => {
        expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    });

    it('keeps the :focus-visible ring inside @layer base', () => {
        const start = css.indexOf('@layer base {');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = start;
        for (let i = css.indexOf('{', start); i < css.length; i++) {
            if (css[i] === '{') depth++;
            if (css[i] === '}' && --depth === 0) {
                end = i;
                break;
            }
        }
        expect(css.slice(start, end)).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    });

    it('does not suppress focus on radios; editor has no frame (R-12)', () => {
        expect(css).not.toMatch(/\.custom-radio\s*\{[^}]*outline:\s*none/);
        expect(css).toMatch(/\.custom-radio:focus-visible\s*\{[^}]*outline:\s*2px solid/);
        expect(css).not.toMatch(/\.tiptap:focus-visible\s*\{[^}]*outline:\s*1px/); // R-12
    });

    it('has a prefers-reduced-motion block', () => {
        const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(block).toMatch(/animation-duration:\s*0\.01ms/);
        expect(block).toMatch(/transition-duration:\s*0\.01ms/);
        expect(block).toMatch(/animation-iteration-count:\s*1/);
        expect(block).toMatch(/scroll-behavior:\s*auto/);
    });
});
