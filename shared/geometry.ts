/**
 * Window geometry (T-319): the one place for the pixel constants of the window model that the Electron main process and the
 * renderer must agree on. Plain `export const` values only and no imports, so it can be used from both TypeScript projects.
 * T-320: renderer code (src/) does not import this module; it gets the window model from main through the sync IPC
 * `get-window-geometry` (src/utils/windowGeometry.ts). Importers:
 *   - tests/ (bundler resolution): `import * as geometry from '../shared/geometry'`.
 *   - electron/*.cts (Node16 resolution, module Node20 so a CommonJS file may require an ES module): a normal value import,
 *     `import { GHOST_WINDOW_WIDTH } from '../../../shared/geometry.js'`. esbuild inlines it into the CommonJS bundle.
 *
 * The values are the literals that used to be repeated in main and renderer code; changing one changes the window model that
 * plugins (DOM/CSS contract v1) and the persisted mini-mode / sidebar positions are relative to, so do not tune them casually.
 */

/**
 * The legacy transparent "ghost" main window (6000x4000). T-321 (window model A): on Windows the main window now covers exactly
 * the active display (electron/lib/windowModel.cts) and main answers `get-window-geometry` with that dynamic model; the old
 * Windows sizing hacks (enableLargerThanScreen, the 12000 maximum size, the 3040 right-dock offset) are gone. These values remain
 * for: the renderer's built-in fallback when main does not answer (src/utils/windowGeometry.ts, pinned equal by
 * tests/windowGeometry.dom.test.ts) and the unchanged non-Windows branches of main (GHOST_WINDOW_WIDTH in the tray teleport and
 * recenter-window-on-widget code paths that macOS / Linux keep as they were).
 */
export const GHOST_WINDOW_WIDTH = 6000;
export const GHOST_WINDOW_HEIGHT = 4000;
/** The ghost window's centre, in window-relative pixels: where the docked display's centre sits after a recentre. */
export const GHOST_WINDOW_CENTER_X = GHOST_WINDOW_WIDTH / 2;
export const GHOST_WINDOW_CENTER_Y = GHOST_WINDOW_HEIGHT / 2;

/** Renderer fallbacks while the main process has not yet reported the visible screen size (`screenBounds` is null). */
export const FALLBACK_SCREEN_WIDTH = 1920;
export const FALLBACK_SCREEN_HEIGHT = 800;

/** Video Picture-in-Picture window (16:9): initial size, minimum size and the gap to the display's bottom-right corner. */
export const PIP_WINDOW_WIDTH = 480;
export const PIP_WINDOW_HEIGHT = 270;
export const PIP_WINDOW_MIN_WIDTH = 240;
export const PIP_WINDOW_MIN_HEIGHT = 135;
export const PIP_WINDOW_SCREEN_MARGIN = 20;
