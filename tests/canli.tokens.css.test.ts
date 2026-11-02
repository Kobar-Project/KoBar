import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NEUTRALS, TINT } from '../src/theme/canli';

// Canlı tokens (src/theme/canli.css): gated by :root[data-ui="canli"], neutrals and shares in step with src/theme/canli.ts,
// imported by src/index.css and switched on by every window entry.
const read = (rel: string) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
// Prettier writes single quotes in attribute selectors; compare in one quote style.
const css = read('src/theme/canli.css')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'/g, '"');
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();

function block(selectorStart: string): string {
    const idx = css.indexOf(selectorStart);
    expect(idx, selectorStart).toBeGreaterThan(-1);
    const open = css.indexOf('{', idx);
    return css.slice(open + 1, css.indexOf('}', open));
}

function decl(body: string, name: string): string | undefined {
    for (const part of body.split(';')) {
        const idx = part.indexOf(':');
        if (idx !== -1 && part.slice(0, idx).trim() === name) return norm(part.slice(idx + 1));
    }
    return undefined;
}

describe('Canlı CSS tokens', () => {
    it('every rule is gated by the data-ui attribute (or sits in a media/layer block of gated rules)', () => {
        const selectors = Array.from(css.matchAll(/([^{}@]+)\{[^{}]*\}/g), (m) => m[1].trim()).filter(Boolean);
        for (const sel of selectors) {
            for (const part of sel.split(',')) expect(part.trim(), sel).toMatch(/^:root\[data-ui="canli"\]/);
        }
    });

    it('dark and light neutrals and accent shares match src/theme/canli.ts', () => {
        const roles = ['nav', 'shell', 'surface', 'tile', 'inset', 'line', 'container'] as const;
        const dark = block(':root[data-ui="canli"]:not([data-scheme="light"])');
        const light = block(':root[data-ui="canli"][data-scheme="light"]');
        for (const role of roles) {
            expect(decl(dark, `--kb-n-${role}`)).toBe(NEUTRALS.dark[role]);
            expect(decl(light, `--kb-n-${role}`)).toBe(NEUTRALS.light[role]);
            expect(decl(dark, `--kb-share-${role}`)).toBe(`${TINT.dark[role]}%`);
            expect(decl(light, `--kb-share-${role}`)).toBe(`${TINT.light[role]}%`);
        }
    });

    it('surfaces follow the tonal switch, the selection container does not', () => {
        const derived = block(':root[data-ui="canli"],');
        expect(decl(derived, '--kb-bg-shell')).toBe(
            'color-mix(inoklab,var(--kb-accent)calc(var(--kb-tint)*var(--kb-share-shell)),var(--kb-n-shell))'
        );
        expect(decl(derived, '--kb-bg-container')).toBe(
            'color-mix(inoklab,var(--kb-accent)var(--kb-share-container),var(--kb-n-container))'
        );
        expect(decl(block(':root[data-ui="canli"][data-tonal="off"]'), '--kb-tint')).toBe('0');
    });

    it('density invariants hold: 2 × cell + gap = tile, tile + 2 × pad = wide bar', () => {
        for (const sel of [':root[data-ui="canli"][data-density="compact"]', ':root[data-ui="canli"][data-density="comfortable"]']) {
            const b = block(sel);
            const px = (n: string) => Number(decl(b, n)!.replace('px', ''));
            expect(2 * px('--kb-tile-cell') + px('--kb-tile-gap')).toBe(px('--kb-tile'));
            expect(px('--kb-tile') + 2 * px('--kb-bar-pad')).toBe(px('--kb-bar-wide'));
        }
    });

    it('is imported by index.css and switched on in every window entry', () => {
        expect(read('src/index.css')).toContain('@import "./theme/canli.css";');
        for (const html of ['index.html', 'settings.html', 'pip.html']) expect(read(html)).toMatch(/<html[^>]*data-ui="canli"/);
        for (const entry of ['src/main.tsx', 'src/settings/main.tsx', 'src/pip/main.tsx']) {
            const src = read(entry);
            expect(src).toContain('@fontsource-variable/figtree');
            expect(src).toContain('@fontsource-variable/outfit');
            expect(src).toContain('material-symbols/rounded.css');
        }
    });
});
