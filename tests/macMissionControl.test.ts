import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// MAC-034: the full-screen transparent bar must stay out of Mission Control / App Exposé on macOS only.
// Source-level guard: every setHiddenInMissionControl( call must sit inside an `if (isMac)` block.
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'electron/main/windows/mainWindow.cts'), 'utf8');
const lines = source.split(/\r?\n/);

const indentOf = (line: string) => line.length - line.trimStart().length;

describe('MAC-034 Mission Control hiding', () => {
    const callIndexes = lines.flatMap((line, i) => (line.includes('setHiddenInMissionControl(') ? [i] : []));

    it('calls setHiddenInMissionControl(true) on the macOS path (constructor branch and ready-to-show)', () => {
        expect(callIndexes.length).toBeGreaterThanOrEqual(2);
        for (const i of callIndexes) {
            expect(lines[i]).toContain('setHiddenInMissionControl(true)');
        }
    });

    it('every call is inside an enclosing `if (isMac)` block (win32/linux never call it)', () => {
        for (const i of callIndexes) {
            const callIndent = indentOf(lines[i]);
            // Walk outwards: the first line with a smaller indent is the enclosing block opener.
            let j = i - 1;
            while (j >= 0 && (lines[j].trim() === '' || indentOf(lines[j]) >= callIndent)) j--;
            expect(j, `no enclosing block for line ${i + 1}`).toBeGreaterThanOrEqual(0);
            expect(lines[j].trim(), `line ${i + 1} is not inside an isMac block`).toBe('if (isMac) {');
        }
    });
});
