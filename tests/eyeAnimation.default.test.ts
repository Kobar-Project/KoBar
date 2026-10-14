import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';

// T-621: the cursor-tracking default is now off for new installs; existing users keep what they had persisted.
const storeSource = readFileSync('src/store/useAppStore.ts', 'utf8');

describe('enableEyeAnimation default (T-621)', () => {
    it('is off in the initial state', () => {
        expect(storeSource).toMatch(/^\s+enableEyeAnimation: false,/m);
    });

    it('is always written by partialize (the live value, not a default)', () => {
        const partialize = storeSource.slice(storeSource.indexOf('partialize'));
        expect(partialize).toContain('enableEyeAnimation: state.enableEyeAnimation');
    });

    it('migrations keep an existing value and fill a pre-v17 gap with the old default (true)', () => {
        expect(migrateKobarStorage({ enableEyeAnimation: true }, 30, {}).enableEyeAnimation).toBe(true);
        expect(migrateKobarStorage({ enableEyeAnimation: false }, 30, {}).enableEyeAnimation).toBe(false);
        expect(migrateKobarStorage({}, 16, {}).enableEyeAnimation).toBe(true);
    });
});
