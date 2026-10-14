import { configDefaults, defineConfig } from 'vitest/config';

// Vitest configuration — intentionally separate from vite.config.ts so tests do not
// load the React/Tailwind Vite plugins (add them here only when a test needs them).
//
// Environment convention (by file name):
//   - tests/**/*.test.ts(x)      -> `node` project (pure logic, Electron helpers)
//   - tests/**/*.dom.test.ts(x)  -> `dom` project (jsdom: window, localStorage, window.api mock)
// A single file can still override this with a `// @vitest-environment <name>` docblock,
// but prefer the file-name convention.
//
// Both projects share tests/setup.ts (it only installs DOM mocks when `window` exists).
// Note: `include` is set per project only — with `extends: true` a root-level `include`
// would be merged into the `dom` project too.

const ALL_TESTS = ['tests/**/*.test.ts', 'tests/**/*.test.tsx'];
const DOM_TESTS = ['tests/**/*.dom.test.ts', 'tests/**/*.dom.test.tsx'];
// Vitest defaults plus the Playwright-Electron e2e tests (T-104), which run via `npm run test:e2e`, never via Vitest.
const EXCLUDED = [...configDefaults.exclude, 'tests/e2e/**'];

export default defineConfig({
    // Let esbuild transform electron/*.cts so tests can import pure helpers from the main-process code.
    esbuild: { include: /\.([cm]?ts|[jt]sx)$/ },
    test: {
        setupFiles: ['tests/setup.ts'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    include: ALL_TESTS,
                    exclude: [...DOM_TESTS, ...EXCLUDED],
                },
            },
            {
                extends: true,
                test: {
                    name: 'dom',
                    environment: 'jsdom',
                    include: DOM_TESTS,
                    exclude: EXCLUDED,
                },
            },
        ],
    },
});
