import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import { decideGlobalPasteMode } from '../electron/lib/globalPaste.cjs';

describe('decideGlobalPasteMode', () => {
    it('enables and disables only on a real change', () => {
        expect(decideGlobalPasteMode(false, true)).toBe('enable');
        expect(decideGlobalPasteMode(true, false)).toBe('disable');
        expect(decideGlobalPasteMode(true, true)).toBe('ignore');
        expect(decideGlobalPasteMode(false, false)).toBe('ignore');
    });

    it('ignores non-boolean input', () => {
        for (const v of [undefined, null, 1, 0, 'true', 'false', {}, [], Number.NaN]) {
            expect(decideGlobalPasteMode(false, v)).toBe('ignore');
            expect(decideGlobalPasteMode(true, v)).toBe('ignore');
        }
    });
});

describe('global paste wiring in electron/main/services/globalPaste.cts (T-037, R4)', () => {
    // T-308: global paste moved out of main.cts. R4: the flow is the state machine in electron/lib/pasteSession.cts.
    const src = readMainModule('services/globalPaste.cts');

    it('set-global-paste-mode validates and dedupes before handing the mode to the session', () => {
        const start = src.indexOf("ipcMain.on('set-global-paste-mode'");
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start);
        const decide = body.indexOf('decideGlobalPasteMode(');
        expect(decide).toBeGreaterThan(-1);
        expect(decide).toBeLessThan(body.indexOf('session.setMode('));
    });

    it('the old fixed-delay flow is gone: no unconditional key-ups, no timer-based re-register, verified writes only (R4)', () => {
        expect(src).not.toContain('keybd_event(0x10');
        expect(src).not.toContain('keybd_event(0x12');
        expect(src).not.toMatch(/re-register scheduled/);
        expect(src).not.toContain('writePowerShell');
        expect(src).toContain('writeClipboardEntryVerified');
        expect(src).not.toMatch(/\bwriteClipboardEntry\(/);
    });
});

// Behavioural tests with electron and the clipboard service mocked; the real handlers and the real session run.
type Handler = (event: { sender: { id: number } }, arg: unknown) => void;
const h = vi.hoisted(() => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const gate: { release: (ok: boolean) => void; promise: Promise<boolean> } = { release: () => {}, promise: Promise.resolve(true) };
    return {
        handlers,
        gate,
        register: vi.fn<(accel: string, cb: () => void) => boolean>(() => true),
        unregister: vi.fn(),
        send: vi.fn(),
    };
});

vi.mock('electron', () => ({
    ipcMain: { on: (ch: string, fn: (...args: unknown[]) => void) => h.handlers.set(ch, fn) },
    globalShortcut: { register: h.register, unregister: h.unregister },
}));
vi.mock('../electron/main/services/clipboard.cjs', () => ({
    runClipboardTask: (fn: () => Promise<boolean>) => fn(),
    writeClipboardEntryVerified: () => h.gate.promise,
}));

describe('global paste behaviour (R-01, R4)', () => {
    const isWin = process.platform === 'win32';
    const it$ = isWin ? it : it.skip;
    const scripts: string[] = [];

    async function setup() {
        h.handlers.clear();
        scripts.length = 0;
        h.gate.promise = new Promise<boolean>((r) => (h.gate.release = r));
        const { registerGlobalPasteIpc } = await import('../electron/main/services/globalPaste.cjs');
        const { appState } = await import('../electron/main/state.cjs');
        appState.mainWindow = { webContents: { id: 7, send: h.send } } as never;
        // Fake PowerShell bridge: V is always up, the injection always runs.
        registerGlobalPasteIpc({
            psRequest: async (build) => {
                const script = build(1);
                scripts.push(script);
                return script.includes('GetAsyncKeyState(86)') ? '0' : 'OK';
            },
        });
        const setMode = h.handlers.get('set-global-paste-mode')!;
        const exec = h.handlers.get('execute-global-paste')! as Handler;
        // A real Ctrl+V: the registered shortcut callback (it issues the paste token and sends request-next-paste).
        const pressCtrlV = () => (h.register.mock.calls.at(-1) as unknown as [string, () => void])[1]();
        return { setMode: (v: unknown) => setMode({}, v), exec: (d: unknown) => exec({ sender: { id: 7 } }, d), pressCtrlV };
    }

    afterEach(async () => {
        const { appState } = await import('../electron/main/state.cjs');
        appState.mainWindow = null;
        h.register.mockClear();
        h.unregister.mockClear();
        h.send.mockClear();
        vi.useRealTimers();
    });

    const injections = () => scripts.filter((s) => s.includes('keybd_event(0x56, 0, 0, 0)'));

    it$('setMode(true) registers Ctrl+V and a press sends request-next-paste (plugin contract)', async () => {
        vi.useFakeTimers();
        const t = await setup();
        t.setMode(true);
        expect(h.register).toHaveBeenCalledWith('CommandOrControl+V', expect.any(Function));
        t.pressCtrlV();
        expect(h.send).toHaveBeenCalledWith('request-next-paste');
        t.setMode('yes'); // non-boolean: ignored (T-037)
        t.setMode(true); // no change: ignored
        expect(h.register).toHaveBeenCalledTimes(1);
        t.setMode(false);
        expect(h.unregister).toHaveBeenCalledWith('CommandOrControl+V');
    });

    it$('execute then immediate disable still pastes the last item; no key-ups and no re-register afterwards', async () => {
        vi.useFakeTimers();
        const t = await setup();
        t.setMode(true);
        t.pressCtrlV();
        t.exec({ type: 'text', content: 'last' });
        t.setMode(false); // the plugin turns the mode off right after the last item, while the write is pending
        await vi.advanceTimersByTimeAsync(10);
        expect(injections()).toHaveLength(0);
        h.gate.release(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(injections()).toHaveLength(1);
        expect(scripts.some((s) => s.includes('keybd_event(0x10') || s.includes('keybd_event(0x12'))).toBe(false);
        h.register.mockClear();
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.register).not.toHaveBeenCalled();
    });

    it$('no keypress when the mode was turned off before execute (T-037)', async () => {
        vi.useFakeTimers();
        const t = await setup();
        t.setMode(true);
        t.pressCtrlV();
        t.setMode(false);
        h.gate.release(true);
        t.exec({ type: 'text', content: 'x' });
        await vi.advanceTimersByTimeAsync(100);
        expect(injections()).toHaveLength(0);
    });

    it$('an unverified clipboard write is not pasted and reports clipboard-paste-error', async () => {
        vi.useFakeTimers();
        const t = await setup();
        t.setMode(true);
        t.pressCtrlV();
        t.exec({ type: 'text', content: 'x' });
        h.gate.release(false);
        await vi.advanceTimersByTimeAsync(100);
        expect(injections()).toHaveLength(0);
        expect(h.send).toHaveBeenCalledWith('clipboard-paste-error', expect.objectContaining({ error: 'write_failed' }));
        t.setMode(false);
    });
});
