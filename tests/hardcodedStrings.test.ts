import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { MAIN_LANGS, MAIN_STRINGS, t } from '../electron/lib/mainStrings.cjs';

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'locales' || e.name === 'node_modules') continue;
            walk(full, out);
        } else if (/\.(ts|tsx|cts)$/.test(e.name)) out.push(full);
    }
    return out;
}

describe('T-627 no hard-coded language ternaries', () => {
    it('has no `language === "tr"` style checks in src/ or electron/', () => {
        const re = /\b(?:language|lang|locale)\s*===?\s*['"]tr['"]|\bisTr\s*\?/;
        const hits: string[] = [];
        for (const root of ['src', 'electron']) {
            for (const f of walk(path.join(__dirname, '..', root))) {
                if (re.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(path.join(__dirname, '..'), f));
            }
        }
        expect(hits).toEqual([]);
    });
});

describe('tray labels', () => {
    const keys = ['trayShowHide', 'traySettings', 'trayTeleport', 'trayQuit'] as const;
    it.each(MAIN_LANGS)('%s has non-empty tray labels', (lang) => {
        for (const k of keys) expect(MAIN_STRINGS[lang][k].trim().length, `${lang}.${k}`).toBeGreaterThan(0);
    });
    it('looks up by language and falls back to English', () => {
        expect(t('tr', 'traySettings')).toBe('Ayarlar');
        expect(t('xx', 'trayQuit')).toBe('Quit');
    });
    it('tray.cts has no hard-coded menu labels', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'electron/main/tray.cts'), 'utf8');
        for (const k of keys) expect(src).toContain(`'${k}'`);
        expect(src).not.toMatch(/label: '(Show\/Hide KoBar|Settings|Teleport to Center|Quit)'/);
    });
});
