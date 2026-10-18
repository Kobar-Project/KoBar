// MAC-021: macOS script types need a confirmation in launch-file; Windows/Linux results are unchanged.
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAC_SCRIPT_EXTENSIONS, classifyLaunchTarget } from '../electron/lib/external.cjs';
import { launchRefusalForProtectedRoot } from '../electron/lib/fileArgs.cjs';

describe('classifyLaunchTarget on darwin (MAC-021)', () => {
    it('keeps exactly the K-12 extension list', () => {
        expect([...MAC_SCRIPT_EXTENSIONS].sort()).toEqual(['.command', '.scpt', '.sh', '.terminal', '.tool', '.workflow']);
    });

    it.each([...MAC_SCRIPT_EXTENSIONS])('asks before opening %s (also upper case and with a trailing slash)', (ext) => {
        for (const p of [`/Users/me/run${ext}`, `/Users/me/run${ext.toUpperCase()}`, `/Users/me/My Stuff/run${ext}/`]) {
            const d = classifyLaunchTarget(p, 'darwin');
            expect(d.kind, p).toBe('confirm-script');
            if (d.kind === 'confirm-script') expect(d.path).toBe(p);
        }
    });

    it('opens .app bundles and plain folders silently, also under /Applications', () => {
        for (const p of [
            '/Applications/Safari.app',
            '/Applications/Safari.app/',
            '/Users/me/Apps/Tool.APP',
            '/Users/me/Documents',
            '/Users/me/a.sh.txt',
            '/Users/me/.sh',
        ]) {
            expect(classifyLaunchTarget(p, 'darwin').kind, p).toBe('path');
        }
    });

    it('keeps the confirmation for a file: URL to a script', () => {
        const d = classifyLaunchTarget('file:///Users/me/My%20Dir/run.command', 'darwin');
        expect(d.kind).toBe('confirm-script');
        if (d.kind === 'confirm-script') expect(d.path).toBe('/Users/me/My Dir/run.command');
        expect(classifyLaunchTarget('file:///Applications/Safari.app', 'darwin').kind).toBe('path');
    });

    it('still refuses control characters in a decoded file: URL path', () => {
        expect(classifyLaunchTarget('file:///Users/me/a%0Ab.sh', 'darwin').kind).toBe('deny');
    });
});

describe('classifyLaunchTarget on other platforms is unchanged (MAC-021)', () => {
    it.each(['win32', 'linux'])('%s treats script paths as plain paths', (platform) => {
        for (const p of ['/x/y.sh', '/x/y.command', 'C:\\x\\y.command', 'C:\\x\\y.sh', '/x/y.workflow/']) {
            expect(classifyLaunchTarget(p, platform).kind, `${platform} ${p}`).toBe('path');
        }
    });

    it('win32 keeps UNC confirmation and URL handling', () => {
        expect(classifyLaunchTarget('\\\\host\\share\\a.command', 'win32').kind).toBe('confirm-path');
        expect(classifyLaunchTarget('https://example.com/a.sh', 'win32').kind).toBe('url');
    });

    it('win32 file: URL to a .command stays a plain path', () => {
        expect(classifyLaunchTarget('file:///C:/x/y.command', 'win32').kind).toBe('path');
    });
});

describe('launchRefusalForProtectedRoot (MAC-021)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-launch-'));
    const userData = path.join(tmp, 'userData');
    const koBox = path.join(userData, 'KoBox');
    const ext = path.join(userData, 'extensions', 'plug');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(koBox, { recursive: true });
    fs.mkdirSync(ext, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(ext, 'run.command'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(koBox, 'ok.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(outside, 'ok.command'), '#!/bin/sh\n');

    it('refuses launch targets inside userData and its extensions folder', () => {
        expect(launchRefusalForProtectedRoot(path.join(ext, 'run.command'), [userData], [koBox])).not.toBeNull();
        expect(launchRefusalForProtectedRoot(path.join(userData, 'x.sh'), [userData], [koBox])).not.toBeNull();
    });

    it('allows KoBox (user-facing exception) and anything outside app data', () => {
        expect(launchRefusalForProtectedRoot(path.join(koBox, 'ok.sh'), [userData], [koBox])).toBeNull();
        expect(launchRefusalForProtectedRoot(path.join(outside, 'ok.command'), [userData], [koBox])).toBeNull();
    });

    it('catches a symlink outside userData that points into it', () => {
        const link = path.join(outside, 'link.command');
        try {
            fs.symlinkSync(path.join(ext, 'run.command'), link);
        } catch {
            return; // symlinks need privileges on some Windows setups
        }
        expect(launchRefusalForProtectedRoot(link, [userData], [koBox])).not.toBeNull();
    });
});
