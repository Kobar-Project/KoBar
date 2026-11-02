import { describe, expect, it } from 'vitest';
import { buildPinTargetScript, PIN_EXCLUDED_CLASSES, sanitizeHandles } from '../electron/lib/pinTarget.cjs';
import { readMainModule } from './helpers/mainSource';

// CNL (owner report): with pin targeting armed, a screenshot hid KoBar, the blur completed the pin request and the desktop got
// pinned (cyan border around the whole screen). Dry-run on Windows: Progman / Shell_TrayWnd reply SKIPPED, a normal window PINNED.
describe('pin target script', () => {
    it('never pins the desktop shell, the taskbars or KoBar windows', () => {
        const script = buildPinTargetScript(7, ['123', '456']);
        for (const cls of PIN_EXCLUDED_CLASSES) expect(script).toContain(`'${cls}'`);
        expect(script).toContain('$own = @(123,456)');
        expect(script).toContain('Write-Output "7|SKIPPED:$hwnd"');
        expect(script).toContain('Write-Output "7|PINNED:$hwnd"');
        expect(script).toContain('Write-Output "7|UNPINNED:$hwnd"');
        // The class check runs before any SetWindowPos.
        expect(script.indexOf('SKIPPED')).toBeLessThan(script.indexOf('SetWindowPos'));
    });

    it('interpolates only decimal handles', () => {
        expect(sanitizeHandles(['123', 'abc', '0', '1); Remove-Item x', '99999999999999999999', '18446744073709551615'])).toEqual([
            '123',
            '99999999999999999999',
            '18446744073709551615',
        ]);
        expect(buildPinTargetScript(1, ['x;y'])).toContain('$own = @()');
    });

    it('main uses it, and a capture cancels armed targeting before hiding KoBar', () => {
        const pin = readMainModule('services/pin.cts');
        expect(pin).toContain('buildPinTargetScript(id, own)');
        expect(pin).toContain('export function cancelPinTargeting()');
        const shot = readMainModule('services/screenshot.cts');
        const session = shot.indexOf('suspendMainWindowModel();');
        expect(shot.lastIndexOf('cancelPinTargeting();', session)).toBeGreaterThan(0);
        expect(shot.lastIndexOf('cancelPinTargeting();', session)).toBeGreaterThan(session - 300);
        const legacy = shot.indexOf("ipcMain.on('take-screenshot'");
        const legacyHide = shot.indexOf('appState.mainWindow.hide();', legacy);
        expect(shot.indexOf('cancelPinTargeting();', legacy)).toBeLessThan(legacyHide);
    });
});
