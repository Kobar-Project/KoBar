import { describe, expect, it } from 'vitest';
import { pickDialogParent } from '../electron/lib/dialogParent.cjs';

const win = (o: { destroyed?: boolean; visible?: boolean; focused?: boolean } = {}) => ({
    isDestroyed: () => o.destroyed ?? false,
    isVisible: () => o.visible ?? true,
    isFocused: () => o.focused ?? true,
});

describe('pickDialogParent', () => {
    it('mac: focused visible Settings wins', () => {
        const main = win();
        const settings = win();
        expect(pickDialogParent({ isMac: true, mainWindow: main, settingsWindow: settings })).toBe(settings);
    });
    it('mac: unfocused, hidden or destroyed Settings falls back to main', () => {
        const main = win();
        for (const s of [win({ focused: false }), win({ visible: false }), win({ destroyed: true }), null]) {
            expect(pickDialogParent({ isMac: true, mainWindow: main, settingsWindow: s })).toBe(main);
        }
    });
    it('mac: no usable main and no Settings gives null', () => {
        expect(pickDialogParent({ isMac: true, mainWindow: null, settingsWindow: null })).toBeNull();
        expect(pickDialogParent({ isMac: true, mainWindow: win({ destroyed: true }), settingsWindow: win({ focused: false }) })).toBeNull();
    });
    it('win32/linux: always main, even with a focused Settings window', () => {
        const main = win();
        expect(pickDialogParent({ isMac: false, mainWindow: main, settingsWindow: win() })).toBe(main);
    });
    it('main destroyed gives null on non-mac', () => {
        expect(pickDialogParent({ isMac: false, mainWindow: win({ destroyed: true }), settingsWindow: win() })).toBeNull();
    });
});
