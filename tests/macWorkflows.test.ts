import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(resolve(__dirname, '..', '.github', 'workflows', name), 'utf8');

describe('mac workflows', () => {
    const build = read('mac-build.yml');
    const ci = read('mac-ci.yml');

    it('mac-build is a manual, unsigned, non-publishing arm64 build', () => {
        expect(build).toContain('workflow_dispatch:');
        expect(build).not.toMatch(/^\s+(push|pull_request|schedule|release):/m);
        expect(build).toContain('npm run dist:mac');
        expect(build).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
        expect(build).toContain('KOBAR_AUTO_UPDATE: "false"');
        expect(build).not.toContain('KOBAR_MAC_SIGNED');
        expect(build).not.toContain('secrets.');
        expect(build).toContain('retention-days: 3');
        expect(build).toContain('macos-14');
        expect(build).not.toContain('macos-latest');
    });

    it('dist:mac script passes --publish never', () => {
        const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
        expect(pkg.scripts['dist:mac']).toContain('--publish never');
    });

    it('mac-ci runs on macos-14 with a paths filter and no packaging or secrets', () => {
        expect(ci).toContain('runs-on: macos-14');
        expect(ci).toContain('paths:');
        expect(ci).not.toContain('secrets.');
        expect(ci).not.toContain('dist:');
    });
});
