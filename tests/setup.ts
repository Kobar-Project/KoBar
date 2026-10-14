import { afterEach, beforeEach } from 'vitest';
import { installWindowApiMock } from './helpers/windowApi';

/*
 * Global test setup (runs before every test file, in both the `node` and the
 * `dom` project — see vitest.config.ts).
 *
 * In a DOM environment (jsdom):
 *   - `window.api` is replaced with a fresh `createWindowApiMock()` before each test;
 *     use `window.api` directly, or call `installWindowApiMock()` from
 *     `tests/helpers/windowApi.ts` to get the typed mock object back.
 *   - `localStorage` and `sessionStorage` are cleared before and after each test.
 * In the node environment there is no `window`, so nothing is installed.
 *
 * Do not import this file from tests (it would register the hooks twice);
 * import helpers from `tests/helpers/*` instead.
 */

const hasDom = typeof window !== 'undefined';

if (hasDom) {
    beforeEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        installWindowApiMock();
    });

    afterEach(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
    });
}
