import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';

// T-505 (UI-04): the flat config forbids hard-coded `#hex` / `rgba(` colors inside JSX
// `className` literals for src/**/*.tsx. Lint in-memory snippets against the real config.
const ROOT = path.resolve(__dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

async function colorErrors(code: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, 'src', '__t505_probe.tsx') });
    return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('eslint className color rule', () => {
    it('flags hex and rgba() in string and template literals', async () => {
        const code = [
            'export const A = () => <div className="text-[#abcdef]" />;',
            'export const B = () => <div className={`p-2 ${1 ? "bg-[#fff]" : "x"}`} />;',
            'export const C = () => <div className={`shadow-[0_0_2px_rgba(0,0,0,1)]`} />;',
        ].join('\n');
        expect(await colorErrors(code)).toBe(3);
    }, 30000);

    it('allows token utilities and CSS variables', async () => {
        const code = [
            'export const A = () => <div className="bg-primary/10 border-stroke text-fg-2 shadow-e2" />;',
            'export const B = () => <div className={`hover:bg-[var(--kb-fill-hover)] ring-offset-background-dark`} />;',
            'export const C = () => <div style={{ color: "#fff" }} className="p-2" />;',
        ].join('\n');
        expect(await colorErrors(code)).toBe(0);
    }, 30000);
});
