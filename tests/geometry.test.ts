import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as geometry from '../shared/geometry';

// T-319: the window-model pixel constants live in shared/geometry.ts. T-320: only the main process imports them; the renderer gets
// the window model from main (sync IPC `get-window-geometry`, read once by src/utils/windowGeometry.ts).
// The table below is the set of literals that used to be repeated in the code; it must not change (plugins and persisted
// mini-mode / sidebar positions are relative to this window model). The source scan guards against the literals coming back.
// T-321 (window model A): on Windows the main window covers the active display, so GHOST_WINDOW_MAX_SIZE (the 12000 setMaximumSize
// hack) and DEFAULT_RIGHT_DOCK_OFFSET_X (3040, the old saved-position default) were removed; the remaining ghost values serve the
// renderer fallback and the unchanged non-Windows branches (tests/windowModel.test.ts covers the new model's wiring).

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Source without block and line comments, so prose that mentions "6000x4000" does not count as a literal. */
const code = (rel: string) =>
    read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Every .ts / .tsx / .cts file under `dir` (relative to the repo root), without src/i18n/. */
function listSources(dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return listSources(rel);
        return /\.(ts|tsx|cts)$/.test(entry.name) && !rel.startsWith('src/i18n/') ? [rel] : [];
    });
}

describe('shared/geometry.ts values', () => {
    it('matches the literals the code used before', () => {
        expect({ ...geometry }).toEqual({
            GHOST_WINDOW_WIDTH: 6000,
            GHOST_WINDOW_HEIGHT: 4000,
            GHOST_WINDOW_CENTER_X: 3000,
            GHOST_WINDOW_CENTER_Y: 2000,
            FALLBACK_SCREEN_WIDTH: 1920,
            FALLBACK_SCREEN_HEIGHT: 800,
            PIP_WINDOW_WIDTH: 480,
            PIP_WINDOW_HEIGHT: 270,
            PIP_WINDOW_MIN_WIDTH: 240,
            PIP_WINDOW_MIN_HEIGHT: 135,
            PIP_WINDOW_SCREEN_MARGIN: 20,
        });
    });

    it('is a dependency-free module (usable from the renderer and, bundled, from the main process)', () => {
        expect(read('shared/geometry.ts')).not.toMatch(/^\s*import\s/m);
    });
});

describe('geometry literals are not repeated outside shared/geometry.ts', () => {
    const MAIN_WINDOW_FILES = [
        'electron/main/windows/mainWindow.cts',
        'electron/main/windows/windowIpc.cts',
        'electron/main/windows/pipWindow.cts',
    ];
    const RENDERER_FILES = [
        'src/App.tsx',
        'src/store/useAppStore.ts',
        'src/components/layout/Sidebar.tsx',
        'src/components/layout/FloatingEye.tsx',
        'src/components/layout/PipPlayer.tsx',
        'src/hooks/useUnifiedResize.ts',
    ];

    it('has no 6000 / 4000 / 12000 literal in the window code and the layout files (no allow-listed exceptions in these files)', () => {
        for (const file of [...MAIN_WINDOW_FILES, ...RENDERER_FILES]) {
            expect(code(file), file).not.toMatch(/\b(6000|4000|12000)\b/);
        }
    });

    it('has no centre / dock / fallback-size literal in the files that share them', () => {
        for (const file of [
            'src/App.tsx',
            'src/components/layout/Sidebar.tsx',
            'src/components/layout/FloatingEye.tsx',
            ...MAIN_WINDOW_FILES,
        ]) {
            expect(code(file), file).not.toMatch(/\b(3000|2000|3040)\b/);
        }
        for (const file of ['src/App.tsx', 'src/components/layout/FloatingEye.tsx', 'src/hooks/useUnifiedResize.ts']) {
            expect(code(file), file).not.toMatch(/\?\? (800|1920)\b/);
        }
        expect(code('src/store/useAppStore.ts')).not.toMatch(/\?\? (800|1920)\b|: 3000;/);
    });

    it('has no PiP window size literal in pipWindow.cts', () => {
        expect(code('electron/main/windows/pipWindow.cts')).not.toMatch(/\b(480|270|240|135)\b/);
    });

    it('main imports the constants from shared/geometry', () => {
        for (const file of MAIN_WINDOW_FILES) {
            expect(read(file), file).toMatch(/from '(\.\.\/)+(shared\/geometry)(\.js)?'/);
        }
    });

    it('the renderer layout files take the window model from getWindowGeometry() (T-320)', () => {
        for (const file of [
            'src/App.tsx',
            'src/store/useAppStore.ts',
            'src/components/layout/Sidebar.tsx',
            'src/components/layout/FloatingEye.tsx',
            // T-615b: the mini-mode switch after a settings import moved here from the settings panel.
            'src/store/dataTransfer.ts',
            'src/hooks/useUnifiedResize.ts',
        ]) {
            // T-322: a file may import more helpers of the live model (useWindowGeometry, subscribeWindowGeometry) on the same line.
            expect(read(file), file).toMatch(/^import \{ getWindowGeometry(, \w+)* \} from '(\.\.?\/)+utils\/windowGeometry';$/m);
            expect(code(file), file).not.toMatch(/\b(GHOST_WINDOW|FALLBACK_SCREEN)_[A-Z_]+\b/);
        }
    });

    it('main answers get-window-geometry with the current window model, to the main window top frame only (T-320, T-321)', () => {
        // T-321: the size / centre come from the display the window is fitted to (getMainWindowGeometry in mainWindow.cts); only the
        // fallback screen size is still a shared/geometry constant.
        const model = code('electron/main/windows/mainWindow.cts');
        const toIpc = model.slice(model.indexOf('function toIpcWindowGeometry('));
        for (const [key, value] of [
            ['width', 'geometry.width'],
            ['height', 'geometry.height'],
            ['centerX', 'geometry.centerX'],
            ['centerY', 'geometry.centerY'],
            ['fallbackScreenWidth', 'FALLBACK_SCREEN_WIDTH'],
            ['fallbackScreenHeight', 'FALLBACK_SCREEN_HEIGHT'],
            ['displayId', 'geometry.displayId'],
            ['scaleFactor', 'geometry.scaleFactor'],
        ]) {
            expect(toIpc).toContain(`${key}: ${value},`);
        }
        const source = code('electron/main/windows/windowIpc.cts');
        expect(source).not.toMatch(/\bGHOST_WINDOW_(HEIGHT|CENTER_X|CENTER_Y)\b/);
        const handler = source.slice(source.indexOf("ipcMain.on('get-window-geometry'"));
        expect(handler).toMatch(
            /^ipcMain\.on\('get-window-geometry', \(event\) => \{\s+let result: IpcWindowGeometry \| null = null;\s+try \{\s+if \(isMainWindowTopFrame\(event\)\) result = getMainWindowGeometry\(\);/
        );
        expect(handler).toMatch(/finally \{\s+event\.returnValue = result;/);
    });
});

describe('the renderer does not import shared/geometry (T-320)', () => {
    it('no file under src/ imports it', () => {
        const offenders = listSources('src').filter((file) => /from '[^']*shared\/geometry(\.js)?'/.test(read(file)));
        expect(offenders).toEqual([]);
    });
});

describe('repo-wide scan of src/ and electron/ for the ghost-window literals', () => {
    // Every hit must be a real geometry use that belongs in shared/geometry.ts, except these reviewed unrelated ones (file -> why).
    // Other numbers that look similar are not matched by the patterns below and need no entry: `: 800` in Sidebar.tsx (its own max-height
    // fallback), lastSidebarHeight 800 in useAppStore.ts, the windowIpc.cts sidebarRect defaults, importExport maxNotes 2000, PERSIST_MAX_WAIT_MS,
    // the paste token TTL, zipGuards maxEntries and the media.cts polling interval (`3000` without a `: ` prefix or in another file/shape).
    const ALLOWED: Record<string, string> = {
        'electron/main/services/pip.cts': 'timeout: 6000 is the PowerShell exec timeout in ms, not a window size',
        'src/utils/windowGeometry.ts':
            'WINDOW_GEOMETRY_FALLBACK: the documented test/non-Electron fallback, pinned equal to shared/geometry by tests/windowGeometry.dom.test.ts',
    };
    const LITERALS = /\b(6000|4000|12000|3040)\b|: 3000\b|\?\? (800|1920)\b/;

    it('finds no ghost-window literal in code outside the allow-list', () => {
        const offenders = [...listSources('src'), ...listSources('electron')].filter(
            (file) => !(file in ALLOWED) && LITERALS.test(code(file))
        );
        expect(offenders).toEqual([]);
    });

    it('keeps the allow-list honest (each allowed file still contains the literal)', () => {
        for (const file of Object.keys(ALLOWED)) expect(code(file), file).toMatch(LITERALS);
    });
});
