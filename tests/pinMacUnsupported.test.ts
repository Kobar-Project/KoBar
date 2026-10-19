// MAC-055 (K-7): Pin Window is unsupported on macOS. enter-pin-targeting leaves targeting mode at once, reports "nothing pinned",
// never touches KoBar's window level / workspace behaviour and shows its notice at most once per session. Electron is mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => void>();
const shown = vi.fn();

vi.mock('electron', () => {
    class Notification {
        static isSupported() {
            return true;
        }
        opts: unknown;
        constructor(opts: unknown) {
            this.opts = opts;
        }
        show() {
            shown(this.opts);
        }
    }
    return {
        app: { on: vi.fn() },
        BrowserWindow: class {},
        screen: {},
        Notification,
        ipcMain: { on: (ch: string, fn: (...a: unknown[]) => void) => handlers.set(ch, fn), handle: vi.fn() },
    };
});
vi.mock('../electron/main/services/native.cjs', () => ({
    isPsAvailable: () => false,
    psRequest: vi.fn(),
    psWrite: vi.fn(),
    restartPsBridgeIfDown: vi.fn(),
}));
vi.mock('../electron/main/app/helpers.cjs', () => ({ getUiLanguage: async () => 'en' }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

describe('pin window on macOS (MAC-055)', () => {
    const win = {
        isDestroyed: () => false,
        setAlwaysOnTop: vi.fn(),
        setVisibleOnAllWorkspaces: vi.fn(),
        webContents: { send: vi.fn() },
    };

    beforeAll(async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        const { appState } = await import('../electron/main/state.cjs');
        appState.mainWindow = win as never;
        const { registerPinIpc } = await import('../electron/main/services/pin.cjs');
        registerPinIpc();
    });
    afterAll(() => Object.defineProperty(process, 'platform', originalPlatform));

    it('reports an unsupported result, leaves the window alone and notifies once', async () => {
        const { appState } = await import('../electron/main/state.cjs');
        handlers.get('enter-pin-targeting')!();
        handlers.get('enter-pin-targeting')!();
        await new Promise((r) => setTimeout(r, 10));
        expect(win.webContents.send).toHaveBeenCalledWith('pinned-window-changed', null);
        expect(win.webContents.send).toHaveBeenCalledWith('pin-targeting-complete');
        expect(win.webContents.send).not.toHaveBeenCalledWith('pinned-window-changed', 1);
        expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
        expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
        expect(appState.isAwaitingPinTarget).toBeFalsy();
        expect(shown).toHaveBeenCalledTimes(1);
        expect(shown.mock.calls[0][0]).toMatchObject({ title: 'KoBar', body: 'Pinning other windows is not supported on macOS.' });
    });

    it('unpin handlers only report nothing pinned', () => {
        win.webContents.send.mockClear();
        handlers.get('unpin-current-window')!();
        handlers.get('unpin-all-windows')!();
        expect(win.webContents.send).toHaveBeenCalledTimes(2);
        expect(win.webContents.send).toHaveBeenCalledWith('pinned-window-changed', null);
        expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    });
});
