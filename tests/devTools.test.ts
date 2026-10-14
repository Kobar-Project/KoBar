import { describe, expect, it } from 'vitest';
import { shouldOpenDevTools } from '../electron/lib/devTools.cjs';

describe('shouldOpenDevTools', () => {
    it('opens only in dev runs with KOBAR_DEVTOOLS=1', () => {
        expect(shouldOpenDevTools(false, { KOBAR_DEVTOOLS: '1' })).toBe(true);
    });

    it('never opens in packaged builds, even with the variable set', () => {
        expect(shouldOpenDevTools(true, { KOBAR_DEVTOOLS: '1' })).toBe(false);
    });

    it('ignores missing or non-"1" values', () => {
        expect(shouldOpenDevTools(false, {})).toBe(false);
        expect(shouldOpenDevTools(false, { KOBAR_DEVTOOLS: '0' })).toBe(false);
        expect(shouldOpenDevTools(false, { KOBAR_DEVTOOLS: 'true' })).toBe(false);
    });
});
