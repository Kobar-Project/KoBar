import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Field names (with optional marker and type) of the first `interface <name> { ... }` in a source text. */
function interfaceFields(src: string, name: string): string[] {
    const m = new RegExp(`interface ${name} [{]([^}]*)[}]`).exec(src);
    expect(m, `interface ${name} not found`).not.toBeNull();
    return m![1]
        .split(/[;\n]/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//'))
        .map((l) => l.replace(/\s+/g, ' '));
}

describe('MediaUpdate type (T-136)', () => {
    it('renderer global MediaData matches the main-process MediaTrack', () => {
        const main = interfaceFields(read('electron/lib/mediaTypes.cts'), 'MediaTrack');
        const renderer = interfaceFields(read('src/types/global.d.ts'), 'MediaData');
        expect(renderer).toEqual(main);
    });

    it('both projects define MediaUpdate as the track-or-null union', () => {
        expect(read('electron/lib/mediaTypes.cts')).toMatch(/export type MediaUpdate = MediaTrack \| null;/);
        expect(read('src/types/global.d.ts')).toMatch(/type MediaUpdate = MediaData \| null;/);
    });

    it('the preloads and pipApi use the shared type instead of an inline copy', () => {
        expect(read('electron/pip-preload.cts')).toContain("import type { MediaUpdate } from './lib/mediaTypes.cjs'");
        expect(read('electron/preload.cts')).toContain("import type { MediaUpdate } from './lib/mediaTypes.cjs'");
        expect(read('src/pip/pipApi.d.ts')).toContain('(data: MediaUpdate) => void');
    });
});

describe('media-update forwarding to the PiP window (T-136)', () => {
    // T-311: sendMediaChannel moved to electron/main/services/media.cts.
    const main = readMainModule('services/media.cts');
    const fn = /function sendMediaChannel[\s\S]*?\n\}/.exec(main)?.[0] ?? '';

    it('sends media-update to a live PiP window only', () => {
        expect(fn).toMatch(
            /channel === 'media-update' &&\s*appState\.pipWindow &&\s*!appState\.pipWindow\.isDestroyed\(\) &&\s*!appState\.pipWindow\.webContents\.isDestroyed\(\)/
        );
        expect(fn).toContain('appState.pipWindow.webContents.send(channel, payload)');
    });

    it('does not forward video-urls-update to the PiP window', () => {
        expect(fn.match(/appState\.pipWindow\.webContents\.send/g)).toHaveLength(1);
    });
});

describe('createPipWindow close race (T-136)', () => {
    // T-306: createPipWindow moved to electron/main/windows/pipWindow.cts (it is the last function of that file).
    const fn = /export function createPipWindow[\s\S]*?\n\}\n/.exec(readMainModule('windows/pipWindow.cts'))?.[0] ?? '';

    it('tracks the new window in a local and ignores a stale closed event', () => {
        expect(fn).toContain('const win = new BrowserWindow(');
        expect(fn).toContain('appState.pipWindow = win;');
        expect(fn).toMatch(/win\.on\('closed', \(\) => \{\s*if \(appState\.pipWindow !== win\) return;/);
    });

    it('seeds the PiP with the last media-update once it has loaded', () => {
        expect(fn).toContain("win.webContents.on('did-finish-load'");
        expect(fn).toContain("mediaChangeFilter.last('media-update')");
    });

    it('close-pip leaves clearing pipWindow to the closed handler', () => {
        // T-310: close-pip moved to electron/main/services/pip.cts (indented inside registerPipIpc).
        const handler = /ipcMain\.on\('close-pip'[\s\S]*?\n\s*\}\);/.exec(readMainModule('services/pip.cts'))?.[0] ?? '';
        expect(handler).toContain("ipcMain.on('close-pip'");
        expect(handler).toContain('appState.pipWindow.close()');
        expect(handler).not.toContain('pipWindow = null');
    });
});
