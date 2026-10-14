// T-606: the main process half of the Settings window state sync. The pure relay (electron/lib/settingsSync.cts), the channel
// schemas and sender policies through the real typed registry, the real wiring (electron/main/windows/settingsSync.cts) with fake
// windows, the main window preload's claim-once bridge, and the rule that only the main window's top frame may write persisted
// state (the real storage IPC on a temp dir). Electron is never launched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcSettingsAction, IpcSettingsPublish, IpcSettingsStateMessage } from '../shared/ipc-contract';
import { SETTINGS_ACTION_MAX_CHARS, SETTINGS_STATE_MAX_CHARS, createSettingsRelay, jsonLength } from '../electron/lib/settingsSync.cjs';
import { createSettingsSyncBridge } from '../electron/lib/settingsSyncBridge.cjs';
import { type IpcMainLike, type SenderPolicy, createIpcRegistry } from '../electron/main/ipc/registry.cjs';
import { SETTINGS_ACTION_OPTIONS, SETTINGS_PUBLISH_STATE_OPTIONS, SETTINGS_REQUEST_STATE_OPTIONS } from '../electron/main/ipc/schemas.cjs';
import { createStorageIpc } from '../electron/main/services/storage/storageIpc.cjs';
import { createStorageService } from '../electron/main/services/storage/storageService.cjs';
import { appState } from '../electron/main/state.cjs';
import { registerSettingsSyncIpc } from '../electron/main/windows/settingsSync.cjs';
import { readMainModule } from './helpers/mainSource';

const publishOf = (epoch: string, rev: number, state: Record<string, unknown> = { theme: `t${rev}` }, ack = 0): IpcSettingsPublish => ({
    epoch,
    rev,
    ack,
    state,
});

function relayHarness(mainAvailable = true) {
    const toSettings: IpcSettingsStateMessage[] = [];
    const toMain: IpcSettingsAction[] = [];
    const log = vi.fn();
    const relay = createSettingsRelay({
        sendToSettings: (message) => void toSettings.push(message),
        sendToMain: (action) => {
            if (!mainAvailable) return false;
            toMain.push(action);
            return true;
        },
        log,
    });
    return { relay, toSettings, toMain, log };
}

describe('createSettingsRelay', () => {
    it('answers a request with state null until the main window published, then with the cached snapshot', () => {
        const { relay, toSettings } = relayHarness();
        relay.requestState();
        expect(toSettings).toEqual([{ seq: 1, state: null, ack: 0 }]);
        relay.publish(publishOf('A', 1, { theme: 'ocean' }, 0));
        relay.requestState();
        expect(toSettings.slice(1)).toEqual([
            { seq: 2, state: { theme: 'ocean' }, ack: 0 },
            { seq: 3, state: { theme: 'ocean' }, ack: 0 },
        ]);
    });

    it('drops a stale or duplicate publish of the same renderer instance (out of order)', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 2));
        relay.publish(publishOf('A', 1));
        relay.publish(publishOf('A', 2));
        relay.publish(publishOf('A', 3));
        expect(toSettings.map((m) => m.state)).toEqual([{ theme: 't2' }, { theme: 't3' }]);
        expect(relay.stats().dropped.stale).toBe(2);
    });

    it('a main window reset clears the cache, tells the Settings window and retires the old epoch', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 5));
        relay.resetMain('navigate');
        expect(toSettings.at(-1)).toEqual({ seq: 2, state: null, ack: 0 });
        // A late message of the old document never overwrites anything.
        relay.publish(publishOf('A', 6));
        expect(relay.stats().dropped['retired-epoch']).toBe(1);
        relay.requestState();
        expect(toSettings.at(-1)).toEqual({ seq: 3, state: null, ack: 0 });
        // The new renderer starts at rev 1 again: accepted (new epoch), and seq keeps increasing.
        relay.publish(publishOf('B', 1, { theme: 'nord' }));
        expect(toSettings.at(-1)).toEqual({ seq: 4, state: { theme: 'nord' }, ack: 0 });
    });

    it('a new epoch without a reset (missed navigation event) retires the previous one', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 9));
        relay.publish(publishOf('B', 1));
        relay.publish(publishOf('A', 10));
        expect(toSettings.map((m) => m.state)).toEqual([{ theme: 't9' }, { theme: 't1' }]);
        expect(relay.stats().dropped['retired-epoch']).toBe(1);
    });

    it('reload, usual order: start, commit, new publish; the old document is retired, the mirror waits in between', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 3));
        relay.navigationStarted();
        // The old document can still publish until the navigation commits: it is still the current one.
        relay.publish(publishOf('A', 4));
        expect(toSettings.at(-1)).toEqual({ seq: 2, state: { theme: 't4' }, ack: 0 });
        relay.navigationCommitted();
        expect(toSettings.at(-1)).toEqual({ seq: 3, state: null, ack: 0 });
        relay.publish(publishOf('A', 5));
        expect(relay.stats().dropped['retired-epoch']).toBe(1);
        relay.publish(publishOf('B', 1, { theme: 'nord' }));
        expect(toSettings.at(-1)).toEqual({ seq: 4, state: { theme: 'nord' }, ack: 0 });
    });

    it('reload, new document publishes BEFORE did-navigate is processed: its state is kept, never retired', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 3));
        relay.navigationStarted();
        relay.publish(publishOf('B', 1, { theme: 'nord' }));
        relay.navigationCommitted();
        // No reset to null: the cache already belongs to the new document.
        expect(toSettings.map((m) => m.state)).toEqual([{ theme: 't3' }, { theme: 'nord' }]);
        relay.publish(publishOf('B', 2, { theme: 'coffee' }));
        relay.publish(publishOf('A', 4));
        expect(toSettings.at(-1)).toEqual({ seq: 3, state: { theme: 'coffee' }, ack: 0 });
        expect(relay.stats().dropped['retired-epoch']).toBe(1);
        relay.action({ id: 1, type: 'setTheme', payload: 'ocean' });
        expect(relay.stats().forwarded).toBe(1);
    });

    it('a navigation that never commits (blocked, download) retires nothing', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish(publishOf('A', 1));
        relay.navigationStarted();
        relay.publish(publishOf('A', 2));
        expect(relay.stats().dropped['retired-epoch']).toBe(0);
        expect(toSettings.at(-1)).toEqual({ seq: 2, state: { theme: 't2' }, ack: 0 });
        // A commit without a recorded start (nothing published before it) retires nothing either.
        const fresh = relayHarness();
        fresh.relay.navigationStarted();
        fresh.relay.publish(publishOf('B', 1));
        fresh.relay.navigationCommitted();
        expect(fresh.toSettings).toEqual([{ seq: 1, state: { theme: 't1' }, ack: 0 }]);
    });

    it('forwards actions only while the main window has published, and counts the dropped ones', () => {
        const { relay, toMain } = relayHarness();
        relay.action({ id: 1, type: 'setTheme', payload: 'ocean' });
        expect(toMain).toEqual([]);
        expect(relay.stats().dropped['main-not-ready']).toBe(1);
        relay.publish(publishOf('A', 1));
        relay.action({ id: 2, type: 'setTheme', payload: 'ocean' });
        expect(toMain).toEqual([{ id: 2, type: 'setTheme', payload: 'ocean' }]);
        relay.resetMain('render-process-gone:crashed');
        relay.action({ id: 3, type: 'setTheme', payload: 'nord' });
        expect(toMain).toHaveLength(1);
        expect(relay.stats()).toMatchObject({ forwarded: 1, dropped: { 'main-not-ready': 2 } });
    });

    it('drops an action when the main window is gone', () => {
        const { relay, toMain } = relayHarness(false);
        relay.publish(publishOf('A', 1));
        relay.action({ id: 1, type: 'setTheme', payload: 'ocean' });
        expect(toMain).toEqual([]);
        expect(relay.stats().dropped['main-unavailable']).toBe(1);
    });

    it('never logs a payload or a state value', () => {
        const { relay, log } = relayHarness();
        relay.action({ id: 1, type: 'setTheme', payload: 'SECRET-PAYLOAD' });
        relay.publish(publishOf('A', 2, { theme: 'SECRET-STATE' }));
        relay.publish(publishOf('A', 1, { theme: 'SECRET-STATE' }));
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET/);
    });

    it('jsonLength reports -1 for values that cannot be serialised', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(jsonLength(cyclic)).toBe(-1);
        expect(jsonLength(10n)).toBe(-1);
        expect(jsonLength({ a: 1 })).toBe(7);
    });
});

// ─── Channels: schemas and sender policies through the real registry ───────────────

type Listener = (event: unknown, ...args: unknown[]) => unknown;

function registryHarness() {
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = {
        handle: () => {},
        on: (channel, listener) => void listeners.set(channel, listener as Listener),
    };
    const main = { id: 1 };
    const settings = { id: 2 };
    const frameOf = new Map<object, object>([
        [main, { frame: 'main-top' }],
        [settings, { frame: 'settings-top' }],
    ]);
    const isTop =
        (contents: object): SenderPolicy =>
        (event) =>
            event.sender === (contents as never) && event.senderFrame === (frameOf.get(contents) as never);
    const registry = createIpcRegistry({
        ipcMain,
        logger: { warn: vi.fn(), error: vi.fn() },
        senderPolicies: { 'main-window-top-frame': isTop(main), 'settings-window-top-frame': isTop(settings) },
    });
    const from = (contents: object, frame: object | undefined = frameOf.get(contents)) => ({ sender: contents, senderFrame: frame });
    const send = (channel: string, event: object, ...args: unknown[]) => listeners.get(channel)!(event, ...args);
    return { registry, main, settings, from, send };
}

describe('settings sync channels (schemas + sender policies)', () => {
    it('use the documented policies', () => {
        expect(SETTINGS_ACTION_OPTIONS.senderPolicy).toBe('settings-window-top-frame');
        expect(SETTINGS_REQUEST_STATE_OPTIONS.senderPolicy).toBe('settings-window-top-frame');
        expect(SETTINGS_PUBLISH_STATE_OPTIONS.senderPolicy).toBe('main-window-top-frame');
    });

    it('settings:action: Settings window top frame only, well-formed and size-capped', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:action', SETTINGS_ACTION_OPTIONS, handler);
        const ok = { id: 1, type: 'setTheme', payload: 'ocean' };
        h.send('settings:action', h.from(h.main), ok);
        h.send('settings:action', h.from(h.settings, { frame: 'sub' }), ok);
        h.send('settings:action', { sender: { id: 3 }, senderFrame: {} }, ok);
        expect(handler).not.toHaveBeenCalled();
        for (const bad of [
            null,
            'setTheme',
            { type: 'setTheme', payload: 'x' },
            { id: -1, type: 'setTheme' },
            { id: 1.5, type: 'setTheme' },
            { id: 1, type: '' },
            { id: 1, type: '__proto__' },
            { id: 1, type: 'set theme' },
            { id: 1, type: 'x'.repeat(65) },
            { id: 1, type: 'setFeatureOrder', payload: ['x'.repeat(SETTINGS_ACTION_MAX_CHARS)] },
            { id: 1, type: 'setTheme', payload: 10n },
        ]) {
            h.send('settings:action', h.from(h.settings), bad);
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:action', h.from(h.settings), ok);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][1]).toBe(ok);
    });

    it('settings:request-state: Settings window top frame only', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:request-state', SETTINGS_REQUEST_STATE_OPTIONS, handler);
        h.send('settings:request-state', h.from(h.main));
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:request-state', h.from(h.settings));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('settings:publish-state: main window top frame only, well-formed and size-capped', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, handler);
        const ok = publishOf('A', 1);
        h.send('settings:publish-state', h.from(h.settings), ok);
        h.send('settings:publish-state', h.from(h.main, { frame: 'sub' }), ok);
        for (const bad of [
            { ...ok, epoch: '' },
            { ...ok, epoch: 'e'.repeat(65) },
            { ...ok, rev: -1 },
            { ...ok, ack: 0.5 },
            { ...ok, state: [] },
            { ...ok, state: null },
            { ...ok, state: { big: 'x'.repeat(SETTINGS_STATE_MAX_CHARS) } },
        ]) {
            h.send('settings:publish-state', h.from(h.main), bad);
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:publish-state', h.from(h.main), ok);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

// ─── The wiring (electron/main/windows/settingsSync.cts) with fake windows ───────────

function fakeWindow(id: number) {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const webContents = {
        id,
        mainFrame: { frame: `${id}-top` },
        sent: [] as Array<[string, unknown]>,
        send(channel: string, payload: unknown) {
            this.sent.push([channel, payload]);
        },
        on(event: string, fn: (...args: unknown[]) => void) {
            handlers.set(event, [...(handlers.get(event) ?? []), fn]);
        },
        once(event: string, fn: (...args: unknown[]) => void) {
            this.on(event, fn);
        },
        emit(event: string, ...args: unknown[]) {
            for (const fn of handlers.get(event) ?? []) fn(...args);
        },
    };
    let destroyed = false;
    return {
        webContents,
        isDestroyed: () => destroyed,
        show: vi.fn(),
        focus: vi.fn(),
        destroy: () => {
            destroyed = true;
        },
    };
}

describe('registerSettingsSyncIpc (wiring)', () => {
    const saved = { main: appState.mainWindow, settings: appState.settingsWindow };
    afterEach(() => {
        appState.mainWindow = saved.main;
        appState.settingsWindow = saved.settings;
    });

    function setup() {
        const listeners = new Map<string, Listener>();
        const ipcMain: IpcMainLike = { handle: () => {}, on: (channel, listener) => void listeners.set(channel, listener as Listener) };
        const mainWin = fakeWindow(1);
        const settingsWin = fakeWindow(2);
        appState.mainWindow = mainWin as never;
        appState.settingsWindow = settingsWin as never;
        const top =
            (win: ReturnType<typeof fakeWindow>): SenderPolicy =>
            (event) =>
                event.sender === (win.webContents as never) && event.senderFrame === (win.webContents.mainFrame as never);
        const registry = createIpcRegistry({
            ipcMain,
            logger: { warn: vi.fn(), error: vi.fn() },
            senderPolicies: { 'main-window-top-frame': top(mainWin), 'settings-window-top-frame': top(settingsWin) },
        });
        const relay = registerSettingsSyncIpc(registry);
        const from = (win: ReturnType<typeof fakeWindow>) => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
        const send = (channel: string, win: ReturnType<typeof fakeWindow>, ...args: unknown[]) =>
            listeners.get(channel)!(from(win), ...args);
        return { relay, mainWin, settingsWin, send };
    }

    it('brings the main window forward for plugin.openSettings only with a string id payload', () => {
        const { mainWin, settingsWin, send } = setup();
        for (const payload of [undefined, null, 'x', 5, {}, { id: 3 }, { id: '' }]) {
            send('settings:action', settingsWin, { id: 1, type: 'plugin.openSettings', payload });
        }
        send('settings:action', settingsWin, { id: 2, type: 'setTheme', payload: { id: 'p' } });
        expect(mainWin.show).not.toHaveBeenCalled();
        expect(mainWin.focus).not.toHaveBeenCalled();
        send('settings:action', settingsWin, { id: 3, type: 'plugin.openSettings', payload: { id: 'p' } });
        expect(mainWin.show).toHaveBeenCalledTimes(1);
        expect(mainWin.focus).toHaveBeenCalledTimes(1);
    });

    it('brings the main window forward for the install-from-file/GitHub actions only with an empty payload', () => {
        const { mainWin, settingsWin, send } = setup();
        for (const type of ['plugin.installFromFile', 'plugin.installFromGithub']) {
            for (const payload of [null, 'x', 5, [], { path: '/tmp/x.zip' }, { url: 'https://example.com' }]) {
                send('settings:action', settingsWin, { id: 1, type, payload });
            }
        }
        expect(mainWin.show).not.toHaveBeenCalled();
        expect(mainWin.focus).not.toHaveBeenCalled();
        send('settings:action', settingsWin, { id: 2, type: 'plugin.installFromFile', payload: {} });
        send('settings:action', settingsWin, { id: 3, type: 'plugin.installFromGithub' });
        expect(mainWin.show).toHaveBeenCalledTimes(2);
        expect(mainWin.focus).toHaveBeenCalledTimes(2);
    });

    it('relays snapshots to the Settings window only and actions to the main window only', () => {
        const { mainWin, settingsWin, send } = setup();
        send('settings:publish-state', mainWin, publishOf('A', 1, { theme: 'ocean' }));
        expect(settingsWin.webContents.sent).toEqual([['settings:state', { seq: 1, state: { theme: 'ocean' }, ack: 0 }]]);
        send('settings:action', settingsWin, { id: 7, type: 'setTheme', payload: 'nord' });
        expect(mainWin.webContents.sent).toEqual([['settings:apply-action', { id: 7, type: 'setTheme', payload: 'nord' }]]);
        // Wrong senders: the main window cannot send actions, the Settings window cannot publish.
        send('settings:action', mainWin, { id: 8, type: 'setTheme', payload: 'nord' });
        send('settings:publish-state', settingsWin, publishOf('X', 1, { theme: 'evil' }));
        expect(mainWin.webContents.sent).toHaveLength(1);
        expect(settingsWin.webContents.sent).toHaveLength(1);
        // Only id / type / payload travel on: extra fields of the Settings window's object are never forwarded.
        send('settings:action', settingsWin, { id: 9, type: 'setTheme', payload: 'nord', origin: 'main', __proto__x: 1 });
        expect(mainWin.webContents.sent.at(-1)).toEqual(['settings:apply-action', { id: 9, type: 'setTheme', payload: 'nord' }]);
    });

    it('a reload, crash or destroyed main renderer resets the mirror to state null', () => {
        const { mainWin, settingsWin, send } = setup();
        send('settings:publish-state', mainWin, publishOf('A', 1));
        // Same-document and sub-frame navigations are ignored; a main-frame reload is start + commit.
        mainWin.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
        mainWin.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
        mainWin.webContents.emit('did-navigate');
        expect(settingsWin.webContents.sent).toHaveLength(1);
        mainWin.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
        mainWin.webContents.emit('did-navigate');
        expect(settingsWin.webContents.sent.at(-1)).toEqual(['settings:state', { seq: 2, state: null, ack: 0 }]);
        send('settings:publish-state', mainWin, publishOf('B', 1));
        mainWin.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
        expect(settingsWin.webContents.sent.at(-1)).toEqual(['settings:state', { seq: 4, state: null, ack: 0 }]);
        send('settings:publish-state', mainWin, publishOf('C', 1));
        mainWin.webContents.emit('destroyed');
        expect(settingsWin.webContents.sent.at(-1)).toEqual(['settings:state', { seq: 6, state: null, ack: 0 }]);
    });

    it('pushes nothing when the Settings window is closed or destroyed', () => {
        const { mainWin, settingsWin, send } = setup();
        settingsWin.destroy();
        send('settings:publish-state', mainWin, publishOf('A', 1));
        appState.settingsWindow = null;
        send('settings:publish-state', mainWin, publishOf('A', 2));
        expect(settingsWin.webContents.sent).toEqual([]);
    });
});

describe('main window preload: claim-once settings sync bridge', () => {
    it('hands the channels out exactly once (a plugin claiming later gets null)', () => {
        const publish = vi.fn();
        const unsubscribe = vi.fn();
        const onAction = vi.fn(() => unsubscribe);
        const openSettings = vi.fn();
        const bridge = createSettingsSyncBridge({ publish, onAction, openSettings });
        expect(Object.keys(bridge)).toEqual(['claim']);
        const claimed = bridge.claim()!;
        expect(bridge.claim()).toBeNull();
        expect(bridge.claim()).toBeNull();
        claimed.publish(publishOf('A', 1));
        expect(publish).toHaveBeenCalledWith(publishOf('A', 1));
        const callback = vi.fn();
        expect(claimed.onAction(callback)).toBe(unsubscribe);
        expect(onAction).toHaveBeenCalledWith(callback);
        // T-615: the host opener passes a string page name only.
        claimed.openSettings('plugins');
        expect(openSettings).toHaveBeenLastCalledWith('plugins');
        claimed.openSettings();
        expect(openSettings).toHaveBeenLastCalledWith(undefined);
        claimed.openSettings({ evil: true } as never);
        expect(openSettings).toHaveBeenLastCalledWith(undefined);
    });
});

// ─── Only the main window's top frame may write persisted state ───────────────────

describe('storage IPC refuses writes from any window but the main window top frame (T-606)', () => {
    let tmp = '';
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-t606-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('the Settings window (and a main window sub-frame) is denied for snapshot, write and sync write; the file is untouched', async () => {
        const mainContents = { id: 1, mainFrame: { top: 1 } };
        const settingsContents = { id: 2, mainFrame: { top: 2 } };
        const service = createStorageService({ root: path.join(tmp, 'kobar-data'), appVersion: '0.0.0-test' });
        const write = vi.spyOn(service, 'write');
        const writeSync = vi.spyOn(service, 'writeSync');
        const storage = createStorageIpc({
            service,
            // The same rule as isMainWindowTopFrame (electron/main/app/helpers.cts).
            isWriter: (event) => event.sender === (mainContents as never) && event.senderFrame === (mainContents.mainFrame as never),
            log: () => {},
        });
        const ev = (contents: { id: number; mainFrame: object }, frame: object = contents.mainFrame) =>
            ({ sender: contents, senderFrame: frame }) as never;

        const boot = storage.snapshot(ev(mainContents), 'kobar-storage');
        expect(boot.ok).toBe(true);
        const ack = await storage.write(ev(mainContents), { key: 'kobar-storage', seq: boot.seq + 1, baseSeq: boot.seq, value: 'main' });
        expect(ack.ok).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);

        for (const event of [ev(settingsContents), ev(mainContents, { sub: true })]) {
            const request = { key: 'kobar-storage', seq: boot.seq + 2, baseSeq: boot.seq, value: 'settings' };
            await expect(storage.write(event, request)).resolves.toMatchObject({ ok: false, reason: 'denied' });
            expect(storage.writeSync(event, request)).toMatchObject({ ok: false, reason: 'denied' });
            // A refused snapshot request never touches the service (it cannot reset the main window's baseline).
            expect(storage.snapshot(event, 'kobar-storage')).toMatchObject({ ok: false, value: null });
        }
        expect(write).toHaveBeenCalledTimes(1);
        expect(writeSync).not.toHaveBeenCalled();
        await service.flush();
        const file = JSON.parse(fs.readFileSync(path.join(tmp, 'kobar-data', 'host', 'kobar-storage.json'), 'utf8')) as { value: string };
        expect(file.value).toBe('main');
    });

    it('main wires the storage writer check and the settings policy to the window helpers', () => {
        const context = readMainModule('app/context.cts');
        expect(context).toContain('isWriter: (event) => isMainWindowTopFrame(event),');
        const helpers = readMainModule('app/helpers.cts');
        expect(helpers).toMatch(
            /export function isSettingsWindowTopFrame\(event: Electron\.IpcMainInvokeEvent\): boolean \{\s*const win = appState\.settingsWindow;\s*return !!win && !win\.isDestroyed\(\) && event\.sender === win\.webContents && event\.senderFrame === win\.webContents\.mainFrame;/
        );
    });
});

// T-610: the optional `plugins` section of the same channels (no new channel).
describe('settings sync: plugin summary section', () => {
    const item = {
        id: 'p1',
        name: 'P1',
        version: '1.0.0',
        enabled: true,
        removable: true,
        updateAvailable: false,
        latestVersion: null,
        hasSettingsPanel: false,
        repo: null,
    };
    const summary = { items: [item], status: { checked: false, checking: false, updating: false }, lastUpdate: null };

    it('the relay sends the plugins of the cached publish with the state, and omits them when absent', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish({ ...publishOf('A', 1), plugins: summary });
        relay.publish(publishOf('A', 2));
        relay.requestState();
        expect(toSettings[0].plugins).toEqual(summary);
        expect('plugins' in toSettings[1]).toBe(false);
        expect('plugins' in toSettings[2]).toBe(false);
        relay.resetMain('test');
        expect('plugins' in toSettings[3]).toBe(false);
    });

    it('settings:publish-state validates and size-caps the plugins section', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, handler);
        const base = publishOf('A', 1);
        for (const bad of [
            { ...summary, items: 'x' },
            { ...summary, extra: 1 },
            { ...summary, items: [{ ...item, extra: 1 }] },
            { ...summary, items: [{ ...item, id: '' }] },
            { ...summary, items: [{ ...item, id: 'x'.repeat(129) }] },
            { ...summary, items: [{ ...item, enabled: 'yes' }] },
            { ...summary, items: Array.from({ length: 201 }, (_, i) => ({ ...item, id: `p${i}` })) },
            { ...summary, status: { checked: true } },
        ]) {
            h.send('settings:publish-state', h.from(h.main), { ...base, plugins: bad });
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:publish-state', h.from(h.main), { ...base, plugins: summary });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    // T-611: the catalogue (Discover) section: strict, bounded, no repo / url fields.
    it('settings:publish-state validates the catalogue section strictly', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, handler);
        const entry = {
            id: 'c1',
            name: 'C1',
            description: 'd',
            author: 'a',
            version: '1.0.0',
            category: 'tools',
            beta: false,
            repo: null,
            installed: false,
        };
        const catalog = { status: 'ready', error: null, items: [entry], installingId: null, lastInstall: null };
        const base = publishOf('A', 1);
        for (const bad of [
            { ...catalog, status: 'weird' },
            { ...catalog, error: 'nope' },
            { ...catalog, extra: 1 },
            { ...catalog, items: [{ ...entry, githubRepo: 'o/r' }] },
            { ...catalog, items: [{ ...entry, repo: 'x'.repeat(161) }] },
            { ...catalog, items: [{ ...entry, description: 'x'.repeat(401) }] },
            { ...catalog, items: [{ ...entry, id: '' }] },
            { ...catalog, items: Array.from({ length: 101 }, (_, i) => ({ ...entry, id: `c${i}` })) },
            { ...catalog, installingId: '' },
            { ...catalog, lastInstall: { id: 'c1', result: 'maybe' } },
        ]) {
            h.send('settings:publish-state', h.from(h.main), { ...base, plugins: { ...summary, catalog: bad } });
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:publish-state', h.from(h.main), { ...base, plugins: { ...summary, catalog } });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('settings:action accepts the dotted plugin.* types and still rejects malformed ones', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:action', SETTINGS_ACTION_OPTIONS, handler);
        for (const type of ['plugin..x', '.plugin', 'plugin.', 'a.b.c', 'plugin.set Enabled', '1plugin.x']) {
            h.send('settings:action', h.from(h.settings), { id: 1, type, payload: {} });
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:action', h.from(h.settings), { id: 1, type: 'plugin.setEnabled', payload: { id: 'p1', enabled: true } });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

// T-612: the optional `workspaces` section of the same channels (no new channel).
describe('settings sync: workspace summary section', () => {
    const item = { id: 'w1', name: 'Work', isolated: false, hasIsolatedData: false, active: true };
    const summary = { items: [item] };

    it('the relay sends the workspaces of the cached publish with the state, and omits them when absent', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish({ ...publishOf('A', 1), workspaces: summary });
        relay.publish(publishOf('A', 2));
        expect(toSettings[0].workspaces).toEqual(summary);
        expect('workspaces' in toSettings[1]).toBe(false);
    });

    it('settings:publish-state validates and size-caps the workspaces section', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, handler);
        const base = publishOf('A', 1);
        for (const bad of [
            { items: 'x' },
            { ...summary, extra: 1 },
            { items: [{ ...item, extra: 1 }] },
            { items: [{ ...item, id: '' }] },
            { items: [{ ...item, id: 'x'.repeat(129) }] },
            { items: [{ ...item, name: 'x'.repeat(201) }] },
            { items: [{ ...item, active: 'yes' }] },
            { items: Array.from({ length: 201 }, (_, i) => ({ ...item, id: `w${i}` })) },
        ]) {
            h.send('settings:publish-state', h.from(h.main), { ...base, workspaces: bad });
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:publish-state', h.from(h.main), { ...base, workspaces: summary });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

// T-614: the optional system section of the same channels (no new channel).
describe('settings sync: system summary section', () => {
    const summary = {
        version: '2.0.0',
        updatesEnabled: true,
        update: { status: 'idle', version: '', percent: 0 },
        backup: { busy: false, last: null },
    };

    it('the relay sends the system summary of the cached publish with the state, and omits it when absent', () => {
        const { relay, toSettings } = relayHarness();
        relay.publish({ ...publishOf('A', 1), system: summary } as IpcSettingsPublish);
        relay.publish(publishOf('A', 2));
        expect(toSettings[0].system).toEqual(summary);
        expect('system' in toSettings[1]).toBe(false);
    });

    it('settings:publish-state validates the system section (strict, bounded, codes only)', () => {
        const h = registryHarness();
        const handler = vi.fn();
        h.registry.on('settings:publish-state', SETTINGS_PUBLISH_STATE_OPTIONS, handler);
        const base = publishOf('A', 1);
        for (const bad of [
            { ...summary, extra: 1 },
            { ...summary, version: 'x'.repeat(65) },
            { ...summary, update: { ...summary.update, status: 'weird' } },
            { ...summary, update: { ...summary.update, percent: 101 } },
            { ...summary, update: { ...summary.update, percent: 1.5 } },
            { ...summary, update: { ...summary.update, message: 'secret-path' } },
            { ...summary, backup: { busy: false, last: 'maybe' } },
            { ...summary, backup: { busy: 'no', last: null } },
            'x',
        ]) {
            h.send('settings:publish-state', h.from(h.main), { ...base, system: bad });
        }
        expect(handler).not.toHaveBeenCalled();
        h.send('settings:publish-state', h.from(h.main), { ...base, system: summary });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
