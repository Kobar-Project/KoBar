// "Open with KoBar" must only ADD KoBar to the "Open with" list of .txt, never become the default handler of it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const root = nodePath.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(nodePath.join(root, rel), 'utf8');
const require = createRequire(import.meta.url);
const { createBuilderConfig } = require('../tools/builderConfig.cjs') as { createBuilderConfig: (i: unknown) => Record<string, unknown> };

describe('NSIS registration (build/installer.nsh)', () => {
    const nsh = read('build/installer.nsh');
    const code = nsh
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith(';'))
        .join('\n');

    it('registers under OpenWithProgids and Applications\\KoBar.exe\\SupportedTypes', () => {
        expect(code).toContain('Software\\Classes\\.txt\\OpenWithProgids" "KoBar.TextFile"');
        expect(code).toContain('\\SupportedTypes" ".txt"');
    });

    it('never writes the default value of the .txt key or UserChoice', () => {
        expect(code).not.toMatch(/WriteReg\w+\s+\w+\s+"Software\\Classes\\\.txt"/);
        expect(code).not.toMatch(/WriteReg\w+\s+\w+\s+"Software\\Classes\\\.txt\\shell/i);
        expect(code).not.toMatch(/UserChoice/i);
    });

    it('the uninstaller removes the value and the keys it created, but not the .txt key', () => {
        const uninstall = code.slice(code.indexOf('customUnInstall'));
        expect(uninstall).toContain('DeleteRegValue SHCTX "Software\\Classes\\.txt\\OpenWithProgids" "KoBar.TextFile"');
        expect(uninstall).toContain('DeleteRegKey SHCTX "Software\\Classes\\KoBar.TextFile"');
        expect(uninstall).toContain('DeleteRegKey SHCTX "Software\\Classes\\Applications\\${APP_EXECUTABLE_FILENAME}"');
        expect(uninstall).not.toMatch(/DeleteRegKey\s+\w+\s+"Software\\Classes\\\.txt"/);
    });

    it('electron-builder fileAssociations is not used (it would make KoBar the default handler)', () => {
        const config = createBuilderConfig({
            env: { KOBAR_FLAVOR: 'direct' },
            readSettings: () => null,
            readSecrets: () => null,
        });
        expect(config).not.toHaveProperty('fileAssociations');
        expect(config.win).not.toHaveProperty('fileAssociations');
    });
});

describe('Store manifest fragment (build/appx/extensions.xml)', () => {
    it('declares only a .txt file type association', () => {
        const xml = read('build/appx/extensions.xml');
        expect(xml).toContain('windows.fileTypeAssociation');
        expect(xml.match(/<uap:FileType>[^<]+<\/uap:FileType>/g)).toEqual(['<uap:FileType>.txt</uap:FileType>']);
        expect(xml).not.toContain('<Extensions>');
    });
});
