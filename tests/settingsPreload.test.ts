// T-606: the Settings window's narrow preload (electron/settings-preload.cts), loaded against a mocked `electron`. It must expose
// ONLY window.settingsBridge (no window.api, no storage bridge, no plugin globals) and use only the three sync channels.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsWindowBridge } from '../shared/ipc-contract';

const exposed = new Map<string, unknown>();
const ipcRenderer = {
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(),
    sendSync: vi.fn(),
};

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: (name: string, value: unknown) => {
            exposed.set(name, value);
        },
    },
    ipcRenderer,
}));

const source = readFileSync(fileURLToPath(new URL('../electron/settings-preload.cts', import.meta.url)), 'utf8');

beforeAll(async () => {
    await import('../electron/settings-preload.cts');
});

describe('settings-preload surface', () => {
    it('exposes exactly window.settingsBridge with onState / requestState / dispatch', () => {
        expect([...exposed.keys()]).toEqual(['settingsBridge']);
        expect(Object.keys(exposed.get('settingsBridge') as object).sort()).toEqual([
            'dispatch',
            'gcalConnect',
            'gcalDisconnect',
            'gcalRefresh',
            'gcalSetEnabled',
            'gcalStatus',
            'onShowPage',
            'onState',
            'requestState',
        ]);
    });

    it('sends nothing at load time and never invokes or blocks (no storage, no window.api channel)', () => {
        expect(ipcRenderer.send).not.toHaveBeenCalled();
        expect(ipcRenderer.invoke).not.toHaveBeenCalled();
        expect(ipcRenderer.sendSync).not.toHaveBeenCalled();
        expect(source).not.toMatch(/ipcRenderer\.sendSync\(/);
        // R2-15: the only invokes are the Google Calendar status/control channels (statuses, never a token).
        const invoked = [...source.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]);
        expect(invoked.length).toBe(5);
        for (const channel of invoked) expect(channel).toMatch(/^gcal-settings-/);
        expect(source).not.toMatch(/storage-|__kobarStorage|exposeInMainWorld\('api'/);
        expect(source).not.toMatch(/\brequire\(/);
    });

    it('dispatch / requestState send the two settings channels; onState subscribes and unsubscribes its own handler', () => {
        const bridge = exposed.get('settingsBridge') as IpcSettingsWindowBridge;
        bridge.requestState();
        expect(ipcRenderer.send).toHaveBeenLastCalledWith('settings:request-state');
        const action = { id: 1, type: 'setTheme', payload: 'ocean' };
        bridge.dispatch(action);
        expect(ipcRenderer.send).toHaveBeenLastCalledWith('settings:action', action);

        const callback = vi.fn();
        const unsubscribe = bridge.onState(callback);
        expect(ipcRenderer.on).toHaveBeenCalledTimes(1);
        const [channel, handler] = ipcRenderer.on.mock.calls[0] as [string, (event: unknown, message: unknown) => void];
        expect(channel).toBe('settings:state');
        const message = { seq: 1, state: { theme: 'ocean' }, ack: 0 };
        handler({ sender: 'ipc-event' }, message);
        // The IPC event object is stripped; only the message reaches the page.
        expect(callback).toHaveBeenCalledWith(message);
        unsubscribe();
        expect(ipcRenderer.removeListener).toHaveBeenCalledWith('settings:state', handler);
    });
});
