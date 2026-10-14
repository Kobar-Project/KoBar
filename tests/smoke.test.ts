import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WINDOW_API_KEYS, createWindowApiMock } from './helpers/windowApi';

describe('test runner (node environment)', () => {
    it('runs without a DOM', () => {
        expect(1 + 1).toBe(2);
        expect(typeof window).toBe('undefined');
    });
});

describe('window.api mock helper', () => {
    it('lists exactly the methods exposed by electron/preload.cts', () => {
        const preloadPath = fileURLToPath(new URL('../electron/preload.cts', import.meta.url));
        const source = readFileSync(preloadPath, 'utf8');
        // Only parse the object literal passed to the first
        // `contextBridge.exposeInMainWorld('api', {`, up to its closing `});` line.
        const start = source.indexOf("contextBridge.exposeInMainWorld('api', {");
        expect(start).toBeGreaterThanOrEqual(0);
        const rest = source.slice(start);
        const end = rest.search(/^\}\);/m);
        expect(end).toBeGreaterThan(0);
        const body = rest.slice(0, end);

        // Top-level keys of the exposed object are indented by exactly 4 spaces.
        const preloadMethods = [...body.matchAll(/^ {4}([A-Za-z]\w*):/gm)].map((m) => m[1]);
        // Keys written in a form the regex above would miss (shorthand `foo,` or
        // method syntax `foo(`) must fail loudly instead of silently drifting.
        const unparsedKeys = [...body.matchAll(/^ {4}([A-Za-z]\w*)\s*(,|\()/gm)].map((m) => m[1]);

        expect(unparsedKeys).toEqual([]);
        expect(preloadMethods.length).toBeGreaterThan(0);
        expect([...WINDOW_API_KEYS].sort()).toEqual([...preloadMethods].sort());
    });

    it('builds vi.fn() stubs with sensible defaults', async () => {
        const api = createWindowApiMock();

        api.hideApp();
        expect(api.hideApp).toHaveBeenCalledTimes(1);

        await expect(api.getAppVersion()).resolves.toBeUndefined();

        const unsubscribe = api.onUpdateAvailable(() => {});
        expect(typeof unsubscribe).toBe('function');

        expect(api.getWindowPositionSync()).toEqual([0, 0]);
    });
});
