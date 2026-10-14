import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { secureWebPreferences } from '../electron/lib/webPrefs.cjs';

const ELECTRON_DIR = path.resolve(__dirname, '../electron');

function listSources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return listSources(full);
        return /\.(cts|ts)$/.test(e.name) ? [full] : [];
    });
}

describe('secureWebPreferences', () => {
    it('pins the four security keys', () => {
        expect(secureWebPreferences()).toEqual({ contextIsolation: true, sandbox: true, webSecurity: true, nodeIntegration: false });
    });
    it('passes extra keys through', () => {
        const p = secureWebPreferences({ preload: '/x/preload.cjs', backgroundThrottling: false });
        expect(p.preload).toBe('/x/preload.cjs');
        expect(p.backgroundThrottling).toBe(false);
        expect(p.sandbox).toBe(true);
    });
    it('cannot be overridden even when types are bypassed', () => {
        const evil = { sandbox: false, webSecurity: false, nodeIntegration: true, contextIsolation: false } as never;
        expect(secureWebPreferences(evil)).toMatchObject({
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            nodeIntegration: false,
        });
    });
});

describe('electron sources', () => {
    it('every new BrowserWindow uses secureWebPreferences', () => {
        let windows = 0;
        for (const file of listSources(ELECTRON_DIR)) {
            const parts = fs.readFileSync(file, 'utf8').split('new BrowserWindow(');
            for (const body of parts.slice(1)) {
                windows++;
                const chunk = body.slice(0, 1500);
                const idx = chunk.indexOf('webPreferences');
                expect(idx, file).toBeGreaterThanOrEqual(0);
                expect(chunk.slice(idx, idx + 80), file).toMatch(/^webPreferences:\s*secureWebPreferences\(/);
            }
        }
        expect(windows).toBeGreaterThan(0);
    });

    it('no insecure webPreferences anywhere in electron/', () => {
        for (const file of listSources(ELECTRON_DIR)) {
            if (file.endsWith('webPrefs.cts')) continue;
            const src = fs.readFileSync(file, 'utf8');
            expect(src, file).not.toMatch(/(webSecurity|sandbox|contextIsolation|nodeIntegration)\s*:/);
        }
    });
});
