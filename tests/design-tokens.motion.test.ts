import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DURATION_MS, EASING, REDUCED_FADE_MS, Z } from '../src/ui/tokens';

// T-507: z-index and motion tokens in src/index.css must equal the TS mirror in src/ui/tokens.ts.
const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const norm = (value: string) => value.replace(/\s+/g, '').toLowerCase();

/** First declaration of a custom property (the :root default, before any media override). */
function token(name: string): string {
    const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
    if (!m) throw new Error(`missing ${name}`);
    return norm(m[1]);
}

describe('layer tokens', () => {
    it('mirror the TS constants', () => {
        for (const [key, value] of Object.entries(Z)) {
            expect(token(`--kb-z-${key}`)).toBe(String(value));
        }
    });

    it('keep the documented order', () => {
        const values = Object.values(Z);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(new Set(values).size).toBe(6);
    });
});

describe('motion tokens', () => {
    it('durations mirror the TS constants', () => {
        for (const [key, value] of Object.entries(DURATION_MS)) {
            expect(token(`--kb-dur-${key}`)).toBe(`${value}ms`);
        }
    });

    it('easings mirror the TS constants', () => {
        for (const [key, value] of Object.entries(EASING)) {
            expect(token(`--kb-ease-${key}`)).toBe(norm(value));
        }
    });

    it('defines the three keyframes', () => {
        for (const name of ['kb-fade', 'kb-pop', 'kb-slide']) {
            expect(css).toContain(`@keyframes ${name}`);
        }
    });

    it('zeroes durations and keeps kb-fade at 80ms under reduced motion', () => {
        const idx = css.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(idx).toBeGreaterThan(-1);
        const reduced = css.slice(idx);
        for (const key of Object.keys(DURATION_MS)) {
            expect(norm(reduced)).toContain(`--kb-dur-${key}:0ms`);
        }
        expect(norm(css)).toContain(`.kb-fade{animation-duration:${REDUCED_FADE_MS}ms!important;}`);
    });
});
