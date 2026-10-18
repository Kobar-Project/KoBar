import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canSelfUpdateFor, resolveFlavor } from '../electron/lib/buildFlags.cjs';
import { IS_MAC_SIGNED, IS_STORE_FLAVOR, KOBAR_FLAVOR, isManualUpdateOnly, normalizeFlavor } from '../src/buildFlags';

describe('resolveFlavor (main process, T-216)', () => {
    const packageFlavors: unknown[] = [undefined, 'store', 'direct', 'dev', 'bogus', 42, null];
    const windowsStoreValues: (boolean | undefined)[] = [undefined, false, true];

    it('is always dev when not packaged, whatever the other inputs are', () => {
        for (const packageFlavor of packageFlavors) {
            for (const windowsStore of windowsStoreValues) {
                expect(resolveFlavor({ packageFlavor, windowsStore, isPackaged: false })).toBe('dev');
            }
        }
    });

    it('is always store when packaged and running inside the Store container', () => {
        for (const packageFlavor of packageFlavors) {
            expect(resolveFlavor({ packageFlavor, windowsStore: true, isPackaged: true })).toBe('store');
        }
    });

    it('uses the package.json flag when packaged outside the Store container', () => {
        for (const windowsStore of [undefined, false]) {
            expect(resolveFlavor({ packageFlavor: 'store', windowsStore, isPackaged: true })).toBe('store');
            expect(resolveFlavor({ packageFlavor: 'direct', windowsStore, isPackaged: true })).toBe('direct');
        }
    });

    it('falls back to direct when the flag is missing or invalid outside the Store container', () => {
        for (const packageFlavor of [undefined, 'dev', 'bogus', 42, null, '']) {
            for (const windowsStore of [undefined, false]) {
                expect(resolveFlavor({ packageFlavor, windowsStore, isPackaged: true })).toBe('direct');
            }
        }
    });
});

describe('canSelfUpdateFor (T-216)', () => {
    it('only direct builds that opted in self-update', () => {
        expect(canSelfUpdateFor('direct', undefined)).toBe(false);
        expect(canSelfUpdateFor('direct', true)).toBe(true);
        expect(canSelfUpdateFor('store', true)).toBe(false);
        expect(canSelfUpdateFor('store', undefined)).toBe(false);
        expect(canSelfUpdateFor('dev', true)).toBe(false);
        expect(canSelfUpdateFor('dev', undefined)).toBe(false);
    });

    it('respects an explicit kobarAutoUpdate: false opt-out', () => {
        expect(canSelfUpdateFor('direct', false)).toBe(false);
    });

    it('MAC-016: win32 / linux results are identical to the platform-less call, whatever kobarMacSigned says', () => {
        const flavors = ['dev', 'store', 'direct'] as const;
        for (const platform of ['win32', 'linux', undefined]) {
            for (const flavor of flavors) {
                for (const auto of [undefined, false, true]) {
                    for (const signed of [undefined, false, true]) {
                        expect(canSelfUpdateFor(flavor, auto, platform, signed)).toBe(canSelfUpdateFor(flavor, auto));
                    }
                }
            }
        }
        expect(canSelfUpdateFor('direct', true, 'win32')).toBe(true);
        expect(canSelfUpdateFor('store', true, 'win32')).toBe(false);
    });

    it('MAC-016: macOS self-updates only for a signed direct build that opted in', () => {
        expect(canSelfUpdateFor('direct', true, 'darwin')).toBe(false);
        expect(canSelfUpdateFor('direct', true, 'darwin', false)).toBe(false);
        expect(canSelfUpdateFor('direct', true, 'darwin', 'true')).toBe(false);
        expect(canSelfUpdateFor('direct', true, 'darwin', true)).toBe(true);
        expect(canSelfUpdateFor('direct', false, 'darwin', true)).toBe(false);
        expect(canSelfUpdateFor('store', true, 'darwin', true)).toBe(false);
        expect(canSelfUpdateFor('dev', true, 'darwin', true)).toBe(false);
    });
});

describe('renderer flavor (src/buildFlags.ts, T-216)', () => {
    it('normalizes unknown values to dev', () => {
        expect(normalizeFlavor('store')).toBe('store');
        expect(normalizeFlavor('direct')).toBe('direct');
        expect(normalizeFlavor('dev')).toBe('dev');
        expect(normalizeFlavor(undefined)).toBe('dev');
        expect(normalizeFlavor('STORE')).toBe('dev');
    });

    it('falls back to dev when the Vite define is missing (Vitest)', () => {
        expect(KOBAR_FLAVOR).toBe('dev');
        expect(IS_STORE_FLAVOR).toBe(false);
        expect(IS_MAC_SIGNED).toBe(false);
    });

    it('MAC-016: manual-update mode is only for unsigned macOS builds', () => {
        expect(isManualUpdateOnly('direct', 'darwin', false)).toBe(true);
        expect(isManualUpdateOnly('dev', 'darwin', false)).toBe(true);
        expect(isManualUpdateOnly('direct', 'darwin', true)).toBe(false);
        expect(isManualUpdateOnly('store', 'darwin', false)).toBe(false);
        for (const flavor of ['dev', 'store', 'direct'] as const) {
            for (const signed of [false, true]) {
                expect(isManualUpdateOnly(flavor, 'win32', signed)).toBe(false);
                expect(isManualUpdateOnly(flavor, undefined, signed)).toBe(false);
            }
        }
    });
});

describe('old source-rewritten flags are gone (T-216)', () => {
    const FORBIDDEN = /\b(IS_STORE_BUILD|ENABLE_AUTO_UPDATE)\b/;

    function walk(dir: string, out: string[]): string[] {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) walk(full, out);
            else if (/\.(c?ts|tsx|m?js|cjs)$/.test(name)) out.push(full);
        }
        return out;
    }

    it('src/, electron/ and kobar-build.js contain no store-build / auto-update source constants', () => {
        const files = [
            ...walk(resolve(__dirname, '../src'), []),
            ...walk(resolve(__dirname, '../electron'), []),
            resolve(__dirname, '../kobar-build.js'),
        ];
        expect(files.length).toBeGreaterThan(10);
        const offenders = files.filter((f) => FORBIDDEN.test(readFileSync(f, 'utf8')));
        expect(offenders).toEqual([]);
    });
});
