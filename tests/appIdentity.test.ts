import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ID, createBuilderConfig } from '../tools/builderConfig.cjs';

// R-05: the packaged app must present the KoBar name/logo, and the userData folder must not change.
const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('R-05 app identity', () => {
    it('packaged userData stays the KoBar folder under appData: productName is KoBar (Electron derives the app name from it)', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.productName).toBe('KoBar');
    });

    it('app.setName / userData are only touched inside the isDev branch of redirectDevUserData', () => {
        const src = read('electron/main/app/runtime.cts');
        const fn = src.slice(src.indexOf('export function redirectDevUserData'), src.indexOf('export function applyChromiumSwitches'));
        expect(fn).toMatch(/if \(isDev\) \{[\s\S]*app\.setName\('KoBarDev'\)[\s\S]*app\.setPath\('userData'/);
        // Nothing outside that function may rename the app or move userData.
        const rest = src.replace(fn, '');
        expect(rest).not.toMatch(/setName\(|setPath\(/);
    });

    it('AUMID: packaged build uses the builder appId; set synchronously at startup', () => {
        const src = read('electron/main/app/runtime.cts');
        expect(src).toContain(`'${APP_ID}'`);
        expect(src).toContain('app.setAppUserModelId(AUMID)');
    });

    it('builder config sets an explicit Windows icon that exists', () => {
        const config = createBuilderConfig({ env: { KOBAR_FLAVOR: 'direct' }, readSettings: () => null, readSecrets: () => null });
        expect((config.win as { icon?: string }).icon).toBe('build/icon.ico');
        expect(fs.existsSync(path.join(root, 'build/icon.ico'))).toBe(true);
    });

    it('every native Notification gets the KoBar icon', () => {
        const src = read('electron/main/services/notifications.cts');
        const calls = src.match(/new Notification\(\{[^}]*\}\)/g) ?? [];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) expect(call).toContain('icon: notificationIcon');
    });
});
