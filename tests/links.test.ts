import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuilderConfig } from '../tools/builderConfig.cjs';
import * as rendererLinks from '../src/config/links';
import * as mainLinks from '../electron/lib/links.cjs';
import { classifyExternalUrl } from '../electron/lib/external.cjs';

// T-219: one canonical repository / contact address, shared by the renderer, the main process and the builder config.

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('canonical links', () => {
    it('points at Kobar-Project/KoBar', () => {
        expect(rendererLinks.REPO_OWNER).toBe('Kobar-Project');
        expect(rendererLinks.REPO_NAME).toBe('KoBar');
        expect(rendererLinks.REPO_URL).toBe('https://github.com/Kobar-Project/KoBar');
        expect(rendererLinks.RELEASES_URL).toBe('https://github.com/Kobar-Project/KoBar/releases');
        expect(rendererLinks.ISSUES_URL).toBe('https://github.com/Kobar-Project/KoBar/issues');
        expect(rendererLinks.DISCUSSIONS_URL).toBe('https://github.com/Kobar-Project/KoBar/discussions');
    });

    it('uses the e-mail from SECURITY.md as the single contact / security address', () => {
        expect(rendererLinks.CONTACT_EMAIL).toBe('hello@kobar.org');
        expect(rendererLinks.SECURITY_EMAIL).toBe(rendererLinks.CONTACT_EMAIL);
        expect(rendererLinks.CONTACT_MAILTO).toBe('mailto:hello@kobar.org');
        expect(read('SECURITY.md')).toContain(rendererLinks.SECURITY_EMAIL);
        expect(read('README.md')).toContain(rendererLinks.CONTACT_MAILTO);
        expect(read('src/settings/pages/General.tsx')).not.toMatch(/@kobar\.org|@ko48/);
    });

    it('keeps the plugin registry URL unchanged', () => {
        expect(rendererLinks.PLUGIN_REGISTRY_URL).toBe(
            'https://raw.githubusercontent.com/Kobar-Project/kobar-plugins-registry/main/registry.json'
        );
    });

    it('main-process and renderer constants match', () => {
        for (const key of [
            'REPO_OWNER',
            'REPO_NAME',
            'REPO_SLUG',
            'REPO_URL',
            'RELEASES_URL',
            'ISSUES_URL',
            'DISCUSSIONS_URL',
            'CONTACT_EMAIL',
            'SECURITY_EMAIL',
        ] as const) {
            expect(mainLinks[key], key).toBe(rendererLinks[key]);
        }
    });

    it('every link is a well-formed URL', () => {
        for (const value of Object.values(rendererLinks)) {
            if (/^https?:|^mailto:/.test(value)) expect(() => new URL(value)).not.toThrow();
        }
    });

    it('the canonical repo URLs stay openable through the external-URL gate, and lookalikes are not special-cased', () => {
        for (const url of [rendererLinks.REPO_URL, rendererLinks.RELEASES_URL, rendererLinks.ISSUES_URL, rendererLinks.CONTACT_MAILTO]) {
            expect(classifyExternalUrl(url).kind, url).toBe('allow');
        }
        expect(classifyExternalUrl('https://user:pw@github.com/Kobar-Project/KoBar').kind).toBe('deny');
        expect(classifyExternalUrl('javascript:alert(1)').kind).toBe('deny');
    });
});

describe('update channel', () => {
    it('the feed is the canonical GitHub repository only', () => {
        expect(mainLinks.UPDATE_FEED).toEqual({ provider: 'github', owner: 'Kobar-Project', repo: 'KoBar' });
    });

    it('the builder publishes to the same owner/repo as the shared constants', () => {
        for (const KOBAR_FLAVOR of ['store', 'direct']) {
            const config = createBuilderConfig({
                env: { KOBAR_FLAVOR, KOBAR_APPX_IDENTITY_NAME: 'a', KOBAR_APPX_PUBLISHER: 'b', KOBAR_APPX_PUBLISHER_DISPLAY_NAME: 'c' },
                readSettings: () => ({}),
                readSecrets: () => {
                    throw new Error('readSecrets must not be called');
                },
            });
            expect(config.publish).toEqual([{ provider: 'github', owner: mainLinks.REPO_OWNER, repo: mainLinks.REPO_NAME }]);
        }
    });

    it('main wires the feed from the shared constant and never allows downgrades', () => {
        // T-307: the updater setup lives in electron/main/services/updater.cts.
        const main = read('electron/main/services/updater.cts');
        expect(main).toMatch(/autoUpdater\.allowDowngrade = false;/);
        expect(main).not.toMatch(/allowDowngrade = true/);
        expect(main).toMatch(/autoUpdater\.setFeedURL\(\{ \.\.\.UPDATE_FEED \}\)/);
        // The only setFeedURL call uses the constant: no user-controlled feed.
        expect(main.match(/setFeedURL\(/g)).toHaveLength(1);
        expect(main).toContain("from '../../lib/links.cjs'");
    });
});

describe('no stray links to the old repository', () => {
    // Historical mentions that are allowed: the appId / AUMID (com.eedali.kobar) is an identity, not a repo link, and the
    // bridge release lives in the old repo only as a planned artifact outside this tree.
    const SCANNED_DIRS = ['src', 'electron', 'tools'];
    const SCANNED_FILES = [
        'README.md',
        'CONTRIBUTING.md',
        'SECURITY.md',
        'package.json',
        'electron-builder.config.cjs',
        'kobar-settings.json',
    ];
    const EXTS = new Set(['.ts', '.tsx', '.cts', '.cjs', '.mjs', '.js', '.json', '.md', '.html']);

    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
            const rel = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) walk(rel, out);
            else if (EXTS.has(path.extname(entry.name))) out.push(rel);
        }
        return out;
    }

    it('src, electron, tools, README, CONTRIBUTING and package metadata only use the canonical repository', () => {
        const files = [...SCANNED_DIRS.flatMap((d) => walk(d)), ...SCANNED_FILES];
        expect(files.length).toBeGreaterThan(20);
        const offenders: string[] = [];
        for (const file of files) {
            const text = read(file);
            if (/github\.com\/eedali\/KoBar|eedali\/KoBar/i.test(text)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
