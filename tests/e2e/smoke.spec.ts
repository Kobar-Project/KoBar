import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// T-104: minimal Electron smoke test.
// Launches the BUILT app (run `npm run build` first) with a fresh temp --user-data-dir, so it never touches the real
// %APPDATA%\KoBar or %APPDATA%\KoBarDev profiles. A synthetic v1 plugin fixture is placed in <userData>/extensions before launch.
// Safety: no clipboard plugin is loaded and no clipboard API is called (CLAUDE.md rule 7).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN_ID = 'e2e-smoke-plugin';
const PLUGIN_FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'plugins', PLUGIN_ID);
const CLOSE_TIMEOUT_MS = 15_000;

// Shape of the plugin-contract globals as seen from the page (kept local: the test tsconfig does not load the renderer types).
interface SmokeWindow {
    React?: { createElement?: unknown };
    ReactDOM?: unknown;
    useAppStore?: { (...args: unknown[]): unknown; getState?: () => unknown; persist?: { hasHydrated?: () => boolean } };
    api?: Record<string, unknown>;
    KoBarExtensions?: { getButtons?: () => Array<{ id: string }>; getPanel?: (id: string) => unknown };
}

let userDataDir = '';
let electronApp: ElectronApplication | undefined;
let page: Page | undefined;
const pageErrors: string[] = [];

function normalizePath(p: string): string {
    return fs.realpathSync.native(p).toLowerCase();
}

async function closeApp(app: ElectronApplication): Promise<void> {
    const proc = app.process();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            app.close(),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
            }),
        ]);
    } catch {
        // Fall through to the forced kill below.
    } finally {
        clearTimeout(timer);
    }
    if (proc.exitCode === null && proc.signalCode === null && proc.pid !== undefined) {
        // Only ever kills the process tree this test started.
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' });
        } else {
            proc.kill('SIGKILL');
        }
    }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    test.setTimeout(90_000);
    // In dev runs the app also loads <repo>/pluginsPlayground; refuse to run so no unknown (possibly clipboard) plugin loads.
    if (fs.existsSync(path.join(REPO_ROOT, 'pluginsPlayground'))) {
        throw new Error(
            'pluginsPlayground/ exists in the repo root; remove or rename it before running the e2e smoke test (clipboard safety).'
        );
    }
    const distIndex = path.join(REPO_ROOT, 'dist', 'index.html');
    const mainBundle = path.join(REPO_ROOT, 'dist-electron', 'main.cjs');
    if (!fs.existsSync(distIndex) || !fs.existsSync(mainBundle)) {
        throw new Error('Built app not found (dist/index.html, dist-electron/main.cjs). Run `npm run build` before `npm run test:e2e`.');
    }

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-e2e-'));
    fs.cpSync(PLUGIN_FIXTURE_DIR, path.join(userDataDir, 'extensions', PLUGIN_ID), { recursive: true });

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
    }
    // Dev-only switch (T-104): load the built dist/index.html via file:// instead of the Vite dev server.
    env.KOBAR_E2E_LOAD_DIST = '1';
    delete env.KOBAR_CSP_REPORT;

    electronApp = await _electron.launch({
        cwd: REPO_ROOT,
        args: [`--user-data-dir=${userDataDir}`, '.'],
        env,
        timeout: 30_000,
    });
    const collectPageErrors = (win: Page) => win.on('pageerror', (err) => pageErrors.push(err.message));
    electronApp.windows().forEach(collectPageErrors);
    electronApp.on('window', collectPageErrors);

    // Safety net: the app must be using the fixture profile, never a real one.
    const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    if (normalizePath(actualUserData) !== normalizePath(userDataDir)) {
        throw new Error(`App is not using the fixture profile: ${actualUserData}`);
    }

    page = await electronApp.firstWindow({ timeout: 30_000 });
    await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
    if (electronApp) await closeApp(electronApp);
    electronApp = undefined;
    page = undefined;
    if (userDataDir) {
        // Only ever delete the temp fixture profile this test created.
        const isOwnTempDir =
            path.basename(userDataDir).startsWith('kobar-e2e-') && normalizePath(path.dirname(userDataDir)) === normalizePath(os.tmpdir());
        if (!isOwnTempDir) throw new Error(`Refusing to delete unexpected directory: ${userDataDir}`);
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
    if (pageErrors.length > 0) console.warn('[e2e] page errors:\n' + pageErrors.join('\n'));
});

test('main window loads the built renderer', async () => {
    expect(page).toBeDefined();
    expect(page!.url().toLowerCase()).toMatch(/^file:.*\/dist\/index\.html/);
});

test('store hydration completes', async () => {
    await page!.waitForFunction(() => (window as unknown as SmokeWindow).useAppStore?.persist?.hasHydrated?.() === true, undefined, {
        timeout: 15_000,
    });
});

test('plugin-contract globals exist', async () => {
    const globals = await page!.evaluate(() => {
        const w = window as unknown as SmokeWindow;
        return {
            React: typeof w.React?.createElement === 'function',
            ReactDOM: typeof w.ReactDOM === 'object' && w.ReactDOM !== null,
            useAppStore: typeof w.useAppStore === 'function' && typeof w.useAppStore.getState === 'function',
            api: typeof w.api === 'object' && w.api !== null,
            KoBarExtensions: typeof w.KoBarExtensions?.getButtons === 'function',
        };
    });
    expect(globals).toEqual({ React: true, ReactDOM: true, useAppStore: true, api: true, KoBarExtensions: true });
});

test('v1 test plugin loads from userData/extensions and registers its button', async () => {
    await page!.waitForFunction(
        (id) => (window as unknown as SmokeWindow).KoBarExtensions?.getButtons?.().some((b) => b.id === id) === true,
        PLUGIN_ID,
        { timeout: 15_000 }
    );
    const state = await page!.evaluate((id) => {
        const w = window as unknown as SmokeWindow;
        return {
            scriptIds: Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-extension-id]')).map(
                (el) => el.dataset.extensionId
            ),
            panel: w.KoBarExtensions?.getPanel?.(id) !== undefined,
        };
    }, PLUGIN_ID);
    // Exactly the fixture plugin is loaded: nothing from a real profile or pluginsPlayground.
    expect(state).toEqual({ scriptIds: [PLUGIN_ID], panel: true });
});

test('no page errors were thrown', async () => {
    expect(pageErrors).toEqual([]);
});
