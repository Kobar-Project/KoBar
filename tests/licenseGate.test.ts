import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('licensing removed (K5)', () => {
    const app = read('../src/App.tsx');

    it('App.tsx has no licensing gate, flag or modal', () => {
        expect(app).not.toContain('isLicensed');
        expect(app).not.toContain('ENABLE_LICENSING');
        expect(app).not.toContain('LicenseActivationModal');
        expect(app).not.toContain('kobar_license_key');
    });

    it('kobar-build.js no longer rewrites ENABLE_LICENSING', () => {
        expect(read('../kobar-build.js')).not.toContain('ENABLE_LICENSING');
    });

    it('preload getHwid is a no-op resolving null', () => {
        const preload = read('../electron/preload.cts');
        expect(preload).toContain('getHwid: () => Promise.resolve(null)');
        expect(preload).not.toContain('get-hwid');
    });

    it('node-machine-id is gone from package.json', () => {
        expect(read('../package.json')).not.toContain('node-machine-id');
    });
});
