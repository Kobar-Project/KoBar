import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { InvokeResult } from '../shared/ipc-contract';
import { readMainModule } from './helpers/mainSource';
import {
    type InvokeHandler,
    type IpcMainLike,
    type SendHandler,
    INVALID_ARGS_MESSAGE,
    SENDER_DENIED_MESSAGE,
    createIpcRegistry,
    describeIssues,
} from '../electron/main/ipc/registry.cjs';
import {
    GET_FILE_ICON_OPTIONS,
    GRANT_PATH_OPTIONS,
    INSTALL_EXTENSION_FROM_GITHUB_OPTIONS,
    INSTALL_EXTENSION_FROM_PATH_OPTIONS,
    INSTALL_FROM_GITHUB_INVALID_REASON,
    INSTALL_FROM_PATH_INVALID_REASON,
    KOBOX_CLEAN_OPTIONS,
    KOBOX_DROP_OPTIONS,
    PARSE_FILE_OPTIONS,
    SAVE_SCREENSHOT_OPTIONS,
    SET_EXTENSIONS_CONFIG_OPTIONS,
    TOGGLE_EXTENSION_ENABLED_OPTIONS,
    UNINSTALL_EXTENSION_OPTIONS,
} from '../electron/main/ipc/schemas.cjs';

// T-303: the typed IPC registry. Pure module: a fake ipcMain records the wrapped listeners so they can be called like
// Electron would (Electron awaits a handle listener and rejects the renderer's invoke with whatever it throws).

type Listener = (event: never, ...args: unknown[]) => unknown;

function setup(options: { allow?: boolean } = {}) {
    const handlers = new Map<string, Listener>();
    const listeners = new Map<string, Listener>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => void handlers.set(channel, listener as Listener),
        on: (channel, listener) => void listeners.set(channel, listener as Listener),
    };
    const logger = { warn: vi.fn(), error: vi.fn() };
    const policy = vi.fn(() => options.allow ?? true);
    const registry = createIpcRegistry({ ipcMain, logger, senderPolicies: { 'main-window-top-frame': policy } });
    const invoke = async (channel: string, event: object, ...args: unknown[]) => handlers.get(channel)!(event as never, ...args);
    const send = (channel: string, event: object, ...args: unknown[]) => listeners.get(channel)!(event as never, ...args);
    return { registry, handlers, listeners, logger, policy, invoke, send };
}

const fakeEvent = () => ({ sender: { id: 1 }, senderFrame: { id: 2 } });

/** Every logged line as one string, to check that argument values never reach the log. */
function logged(logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }): string {
    return [...logger.warn.mock.calls, ...logger.error.mock.calls].map((call) => call.map((x) => String(x)).join(' ')).join('\n');
}

describe('registry.handle', () => {
    it('passes the event and the original arguments through and resolves with the handler result', async () => {
        const { registry, invoke } = setup();
        const handler = vi.fn((_event: IpcMainInvokeEvent, data: unknown) => ({
            success: true,
            path: String((data as { buffer: string }).buffer),
        }));
        registry.handle('save-screenshot', SAVE_SCREENSHOT_OPTIONS, handler as never);
        const event = fakeEvent();
        const data = { buffer: 'b', format: 'png', extra: { nested: true } };
        await expect(invoke('save-screenshot', event, data, 'trailing')).resolves.toEqual({ success: true, path: 'b' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBe(event);
        // Validation only gates: the same object (extra keys included) reaches the handler, plus the extra argument.
        expect(handler.mock.calls[0][1]).toBe(data);
        expect(handler.mock.calls[0]).toHaveLength(3);
    });

    it('works without options, with sync and async handlers', async () => {
        const { registry, invoke } = setup();
        registry.handle('get-installed-extensions', () => []);
        registry.handle('check-plugin-updates', async () => []);
        await expect(invoke('get-installed-extensions', fakeEvent())).resolves.toEqual([]);
        await expect(invoke('check-plugin-updates', fakeEvent())).resolves.toEqual([]);
    });

    it('logs an exception with the channel name and re-throws the SAME error (the invoke still rejects as before)', async () => {
        const { registry, invoke, logger } = setup();
        const boom = new Error('boom');
        registry.handle('get-installed-extensions', () => {
            throw boom;
        });
        registry.handle('check-plugin-updates', async () => {
            throw boom;
        });
        await expect(invoke('get-installed-extensions', fakeEvent())).rejects.toBe(boom);
        await expect(invoke('check-plugin-updates', fakeEvent())).rejects.toBe(boom);
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error.mock.calls[0][0]).toContain('get-installed-extensions');
        expect(logger.error.mock.calls[0][1]).toBe(boom);
        expect(logger.error.mock.calls[1][0]).toContain('check-plugin-updates');
    });

    it('invalid arguments return the onInvalid result without calling the handler, and the log has no values', async () => {
        const { registry, invoke, logger } = setup();
        const handler = vi.fn();
        registry.handle('install-extension-from-path', INSTALL_EXTENSION_FROM_PATH_OPTIONS, handler);
        await expect(invoke('install-extension-from-path', fakeEvent(), { secret: 'C:\\Users\\me\\x.zip' })).resolves.toEqual({
            success: false,
            reason: INSTALL_FROM_PATH_INVALID_REASON,
        });
        expect(handler).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logged(logger)).toContain('install-extension-from-path');
        expect(logged(logger)).not.toContain('Users');
    });

    it('invalid arguments without onInvalid reject with a neutral error', async () => {
        const { z } = await import('zod');
        const { registry, invoke } = setup();
        const handler = vi.fn();
        registry.handle('get-melody-audio', { args: z.tuple([z.string()]) }, handler);
        await expect(invoke('get-melody-audio', fakeEvent(), 42)).rejects.toThrow(INVALID_ARGS_MESSAGE);
        expect(handler).not.toHaveBeenCalled();
    });

    it('a sender policy runs first: refused -> onDenied result or neutral rejection; allowed -> handler gets the event', async () => {
        const denied = setup({ allow: false });
        const handler = vi.fn(() => true);
        denied.registry.handle('uninstall-extension', { senderPolicy: 'main-window-top-frame', onDenied: () => false }, handler);
        denied.registry.handle('set-extensions-config', { senderPolicy: 'main-window-top-frame' }, handler);
        await expect(denied.invoke('uninstall-extension', fakeEvent(), 'id')).resolves.toBe(false);
        await expect(denied.invoke('set-extensions-config', fakeEvent(), {})).rejects.toThrow(SENDER_DENIED_MESSAGE);
        expect(handler).not.toHaveBeenCalled();

        const allowed = setup({ allow: true });
        allowed.registry.handle('uninstall-extension', { senderPolicy: 'main-window-top-frame' }, handler);
        const event = fakeEvent();
        await expect(allowed.invoke('uninstall-extension', event, 'id')).resolves.toBe(true);
        expect(allowed.policy).toHaveBeenCalledWith(event);
    });

    it('refuses an unknown sender policy, a missing handler and a duplicate channel at registration time', () => {
        const handlers = new Map<string, unknown>();
        const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined };
        const registry = createIpcRegistry({ ipcMain, logger: { warn: vi.fn(), error: vi.fn() } });
        expect(() => registry.handle('uninstall-extension', { senderPolicy: 'main-window-top-frame' }, () => false)).toThrow(
            /sender policy/
        );
        expect(() => registry.handle('uninstall-extension', {} as never)).toThrow(/missing handler/);
        registry.handle('uninstall-extension', () => false);
        expect(() => registry.handle('uninstall-extension', () => false)).toThrow(/already registered/);
        expect(handlers.size).toBe(1);
    });
});

describe('registry.on', () => {
    it('passes the event and arguments through', () => {
        const { registry, send } = setup();
        const handler = vi.fn();
        registry.on('kobox-drop', KOBOX_DROP_OPTIONS, handler);
        const event = fakeEvent();
        const paths = ['C:\\a.txt'];
        send('kobox-drop', event, paths);
        expect(handler).toHaveBeenCalledWith(event, paths);
        expect(handler.mock.calls[0][1]).toBe(paths);
    });

    it('ignores invalid arguments with a log line (handler not called)', () => {
        const { registry, send, logger } = setup();
        const handler = vi.fn();
        registry.on('kobox-clean', KOBOX_CLEAN_OPTIONS, handler);
        send('kobox-clean', fakeEvent(), 'everything');
        send('kobox-clean', fakeEvent());
        expect(handler).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logged(logger)).not.toContain('everything');
        send('kobox-clean', fakeEvent(), '24h');
        send('kobox-clean', fakeEvent(), 'quit');
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('ignores a refused sender before validating', () => {
        const { registry, send, logger, policy } = setup({ allow: false });
        const handler = vi.fn();
        registry.on('grant-path', GRANT_PATH_OPTIONS, handler);
        send('grant-path', fakeEvent(), 'C:\\a.txt');
        expect(policy).toHaveBeenCalledTimes(1);
        expect(handler).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('catches and logs sync throws and async rejections with the channel name', async () => {
        const { registry, send, logger } = setup();
        registry.on('kobox-open', () => {
            throw new Error('sync');
        });
        registry.on('hide-app', async () => {
            throw new Error('async');
        });
        expect(() => send('kobox-open', fakeEvent())).not.toThrow();
        send('hide-app', fakeEvent());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(logger.error).toHaveBeenCalledTimes(2);
        expect(logger.error.mock.calls[0][0]).toContain('kobox-open');
        expect(logger.error.mock.calls[1][0]).toContain('hide-app');
    });
});

describe('describeIssues', () => {
    it('names issue paths and codes, never values', async () => {
        const { z } = await import('zod');
        const result = z.tuple([z.string()]).safeParse([1]);
        expect(result.success).toBe(false);
        expect(describeIssues(result.error)).toBe('0: invalid_type');
        expect(describeIssues(null)).toBe('invalid');
    });
});

describe('file and plugin channel schemas: legit calls pass, bad input gets the handler result of today', () => {
    const ok = (schema: { safeParse(x: unknown): { success: boolean } } | undefined, args: unknown[]) => schema!.safeParse(args).success;
    const ev = {} as IpcMainInvokeEvent;

    it('parse-file', () => {
        expect(ok(PARSE_FILE_OPTIONS.args, ['C:\\a.pdf'])).toBe(true);
        expect(ok(PARSE_FILE_OPTIONS.args, ['relative.txt', 'extra'])).toBe(true); // the handler refuses it itself
        expect(ok(PARSE_FILE_OPTIONS.args, [])).toBe(false);
        expect(ok(PARSE_FILE_OPTIONS.args, [{}])).toBe(false);
        // The handler throws new Error('Invalid file path') and returns { type: 'error', content: String(e) }.
        expect(PARSE_FILE_OPTIONS.onInvalid!(ev)).toEqual({ type: 'error', content: String(new Error('Invalid file path')) });
    });

    it('get-file-icon', () => {
        expect(ok(GET_FILE_ICON_OPTIONS.args, ['C:\\a.lnk'])).toBe(true);
        expect(ok(GET_FILE_ICON_OPTIONS.args, [null])).toBe(false);
        expect(GET_FILE_ICON_OPTIONS.onInvalid!(ev)).toBeNull();
    });

    it('save-screenshot', () => {
        expect(ok(SAVE_SCREENSHOT_OPTIONS.args, [{ buffer: 'data:image/png;base64,AA', format: 'png' }])).toBe(true);
        expect(ok(SAVE_SCREENSHOT_OPTIONS.args, [{ buffer: 'x', format: 'png', destinationPath: 'C:\\a.png', defaultPath: 'C:\\' }])).toBe(
            true
        );
        expect(ok(SAVE_SCREENSHOT_OPTIONS.args, [{}])).toBe(true); // the handler answers 'invalid-format' itself
        for (const bad of [[], [null], ['png'], [[1]]]) expect(ok(SAVE_SCREENSHOT_OPTIONS.args, bad)).toBe(false);
        expect(SAVE_SCREENSHOT_OPTIONS.onInvalid!(ev)).toEqual({ success: false, reason: 'invalid-format' });
    });

    it('grant-path, kobox-drop, kobox-clean (send channels: invalid is ignored)', () => {
        expect(ok(GRANT_PATH_OPTIONS.args, ['C:\\a.txt'])).toBe(true);
        expect(ok(GRANT_PATH_OPTIONS.args, [42])).toBe(false);
        expect(GRANT_PATH_OPTIONS.senderPolicy).toBe('main-window-top-frame');
        expect(ok(KOBOX_DROP_OPTIONS.args, [[]])).toBe(true);
        expect(ok(KOBOX_DROP_OPTIONS.args, [['C:\\a', 5]])).toBe(true); // items are checked against the grants in the handler
        expect(ok(KOBOX_DROP_OPTIONS.args, ['C:\\a'])).toBe(false);
        expect(ok(KOBOX_CLEAN_OPTIONS.args, ['24h'])).toBe(true);
        expect(ok(KOBOX_CLEAN_OPTIONS.args, ['quit'])).toBe(true);
        expect(ok(KOBOX_CLEAN_OPTIONS.args, ['all'])).toBe(false);
    });

    it('uninstall-extension, toggle-extension-enabled, set-extensions-config', () => {
        expect(ok(UNINSTALL_EXTENSION_OPTIONS.args, ['my-plugin'])).toBe(true);
        expect(ok(UNINSTALL_EXTENSION_OPTIONS.args, [''])).toBe(true); // canDeletePluginFolder refuses it in the handler
        expect(ok(UNINSTALL_EXTENSION_OPTIONS.args, [7])).toBe(false);
        expect(UNINSTALL_EXTENSION_OPTIONS.onInvalid!(ev)).toBe(false);

        expect(ok(TOGGLE_EXTENSION_ENABLED_OPTIONS.args, ['dev-x', true])).toBe(true);
        expect(ok(TOGGLE_EXTENSION_ENABLED_OPTIONS.args, ['x'])).toBe(true); // a missing `enabled` still means enabled
        expect(ok(TOGGLE_EXTENSION_ENABLED_OPTIONS.args, ['x', 'not-a-boolean'])).toBe(true);
        expect(ok(TOGGLE_EXTENSION_ENABLED_OPTIONS.args, ['a'.repeat(256), false])).toBe(true);
        for (const bad of [[''], ['a'.repeat(257)], [1, true], []]) expect(ok(TOGGLE_EXTENSION_ENABLED_OPTIONS.args, bad)).toBe(false);
        expect(TOGGLE_EXTENSION_ENABLED_OPTIONS.onInvalid!(ev)).toBe(false);

        expect(ok(SET_EXTENSIONS_CONFIG_OPTIONS.args, [{ a: true, b: false }])).toBe(true);
        expect(ok(SET_EXTENSIONS_CONFIG_OPTIONS.args, [{ a: 'odd' }])).toBe(true); // mergeExtensionsConfig filters entries
        for (const bad of [[], [null], [[]], ['x']]) expect(ok(SET_EXTENSIONS_CONFIG_OPTIONS.args, bad)).toBe(false);
        expect(SET_EXTENSIONS_CONFIG_OPTIONS.onInvalid!(ev)).toBe(false);
    });

    it('install-extension-from-path, install-extension-from-github', () => {
        expect(ok(INSTALL_EXTENSION_FROM_PATH_OPTIONS.args, ['C:\\p.zip'])).toBe(true);
        for (const bad of [[], [''], [null], [3]]) expect(ok(INSTALL_EXTENSION_FROM_PATH_OPTIONS.args, bad)).toBe(false);
        expect(INSTALL_EXTENSION_FROM_PATH_OPTIONS.onInvalid!(ev)).toEqual({ success: false, reason: 'Invalid file path.' });

        expect(ok(INSTALL_EXTENSION_FROM_GITHUB_OPTIONS.args, ['plugin-id', 'owner/name'])).toBe(true);
        expect(ok(INSTALL_EXTENSION_FROM_GITHUB_OPTIONS.args, [undefined, 'owner/name'])).toBe(true); // id is display-only
        expect(ok(INSTALL_EXTENSION_FROM_GITHUB_OPTIONS.args, ['id', 'not a repo'])).toBe(true); // parseGithubRepo refuses it in the handler
        for (const bad of [[], ['id'], ['id', 5]]) expect(ok(INSTALL_EXTENSION_FROM_GITHUB_OPTIONS.args, bad)).toBe(false);
        expect(INSTALL_EXTENSION_FROM_GITHUB_OPTIONS.onInvalid!(ev)).toEqual({
            success: false,
            reason: 'Invalid GitHub repository format.',
        });
    });
});

describe('main.cts wiring (T-303)', () => {
    // T-315: the registry is created in electron/main/app/context.cts (createMainContext).
    const mainOnly = readMainModule('app/context.cts');
    // T-310: save-screenshot is registered in electron/main/services/screenshot.cts (indented inside registerScreenshotIpc).
    const screenshot = readMainModule('services/screenshot.cts');
    // T-312: grant-path / kobox-* are registered in services/kobox.cts, parse-file / get-file-icon in services/files.cts.
    const kobox = readMainModule('services/kobox.cts');
    const files = readMainModule('services/files.cts');
    // T-314: the extension channels are registered in the electron/main/services/extensions/*.cts modules (indented inside their register functions).
    const extensions = ['installed', 'update', 'manage', 'install'].map((name) => readMainModule(`services/extensions/${name}.cts`));
    const main = [mainOnly, screenshot, kobox, files, ...extensions].join('\n');
    const MIGRATED_HANDLE = [
        'parse-file',
        'save-screenshot',
        'get-file-icon',
        'get-installed-extensions',
        'check-plugin-updates',
        'uninstall-extension',
        'toggle-extension-enabled',
        'set-extensions-config',
        'install-extension-from-file',
        'install-extension-from-path',
        'install-extension-from-github',
    ];
    const MIGRATED_ON = ['grant-path', 'kobox-drop', 'kobox-open', 'kobox-clean'];

    function block(start: string): string {
        // `start` is a registration prefix such as "registry.handle('x'"; prettier may wrap the call after the parenthesis.
        const escaped = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\(', '\\(\\s*');
        const from = main.search(new RegExp(escaped));
        expect(from, start).toBeGreaterThan(0);
        // The handler ends at the closing line (`});` or a wrapped `);`) with the same indentation as its registration line.
        const indent = /[ \t]*$/.exec(main.slice(main.lastIndexOf('\n', from) + 1, from))![0];
        const end = main.slice(from).search(new RegExp('\\n' + indent + '\\}?\\);'));
        expect(end, start).toBeGreaterThan(0);
        return main.slice(from, from + end);
    }

    it('the file and plugin channels are registered once, through the registry', () => {
        for (const channel of MIGRATED_HANDLE) {
            expect(main.match(new RegExp(`^[ \\t]*registry\\.handle\\(\\s*'${channel}',`, 'gm')), channel).toHaveLength(1);
            expect(main).not.toContain(`ipcMain.handle('${channel}'`);
        }
        for (const channel of MIGRATED_ON) {
            expect(main.match(new RegExp(`^[ \\t]*registry\\.on\\('${channel}',`, 'gm')), channel).toHaveLength(1);
            expect(main).not.toContain(`ipcMain.on('${channel}'`);
        }
    });

    it('the sender policy is the existing main-window/top-frame helper, and grant-path keeps its own checks', () => {
        // T-606 added a second policy (the Settings window's top frame), so the object now spans several lines.
        expect(main).toMatch(
            /createIpcRegistry\(\{\s*ipcMain,\s*senderPolicies: \{\s*'main-window-top-frame': \(event\) => isMainWindowTopFrame\(event\),/
        );
        expect(main).toMatch(/'settings-window-top-frame': \(event\) => isSettingsWindowTopFrame\(event\),\s*\},/);
        const grant = block("registry.on('grant-path'");
        expect(grant).toContain('GRANT_PATH_OPTIONS');
        expect(grant).toMatch(/event\.sender !== appState\.mainWindow\.webContents/);
        expect(grant).toMatch(/event\.senderFrame !== appState\.mainWindow\.webContents\.mainFrame/);
    });

    it('the onInvalid reasons are the strings the handlers return for the same bad input', () => {
        expect(block("registry.handle('install-extension-from-path'")).toContain(
            `return { success: false, reason: '${INSTALL_FROM_PATH_INVALID_REASON}' };`
        );
        expect(block("registry.handle('install-extension-from-github'")).toContain(
            `return { success: false, reason: '${INSTALL_FROM_GITHUB_INVALID_REASON}' };`
        );
        expect(block("registry.handle('save-screenshot'")).toContain("return { success: false, reason: 'invalid-format' };");
        expect(block("registry.handle('parse-file'")).toContain("throw new Error('Invalid file path')");
        expect(block("registry.handle('parse-file'")).toContain("return { type: 'error', content: String(e) };");
    });
});

// Compile-time checks (verified by `tsc -b` through tsconfig.test.json).
describe('registry types follow shared/ipc-contract.ts', () => {
    it('handler parameters and results come from the contract', () => {
        expectTypeOf<Parameters<InvokeHandler<'install-extension-from-github'>>>().toEqualTypeOf<[IpcMainInvokeEvent, string, string]>();
        expectTypeOf<ReturnType<InvokeHandler<'get-file-icon'>>>().toEqualTypeOf<string | null | Promise<string | null>>();
        expectTypeOf<Parameters<SendHandler<'kobox-clean'>>>().toEqualTypeOf<[IpcMainEvent, '24h' | 'quit']>();
        expectTypeOf<ReturnType<NonNullable<typeof PARSE_FILE_OPTIONS.onInvalid>>>().toEqualTypeOf<InvokeResult<'parse-file'>>();
    });

    it('a wrong result, argument or channel does not compile', () => {
        const { registry } = setup();
        // @ts-expect-error parse-file resolves an IpcParsedFile, not a number
        registry.handle('parse-file', async () => 42);
        // @ts-expect-error uninstall-extension sends a string id
        registry.handle('uninstall-extension', (_event, id: number) => id > 0);
        // @ts-expect-error not a contract channel
        registry.handle('no-such-channel', () => null);
        // @ts-expect-error kobox-drop is a send channel, not an invoke channel
        registry.handle('kobox-drop', () => undefined);
        // @ts-expect-error onInvalid must return the channel result type
        registry.handle('toggle-extension-enabled', { onInvalid: () => 'nope' }, () => true);
        expect(true).toBe(true);
    });
});
