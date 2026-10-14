import { defineConfig } from '@playwright/test';

// Playwright runs ONLY the Electron e2e smoke tests (tests/e2e). Vitest owns tests/**/*.test.ts(x).
// `_electron` needs no browser download, so never run `npx playwright install` for this suite.
// The tests launch the BUILT app (`npm run build` first) with a temp --user-data-dir fixture profile.
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 60_000,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [['list'], ['github']] : 'list',
    outputDir: './node_modules/.cache/playwright-results',
});
