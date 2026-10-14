import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSIST_FLUSH_TIMEOUT_MS, createPersistFlusher, createQuitFlushGuard } from '../electron/lib/persistFlush.cts';
import { readMainModule } from './helpers/mainSource';

// T-129: main-process side of the renderer persist flush (before-quit / session-end). Pure helpers, no Electron.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createPersistFlusher', () => {
    it('resolves true when the renderer acks the request id', async () => {
        const flusher = createPersistFlusher();
        const send = vi.fn();
        const result = flusher.request(send);
        expect(send).toHaveBeenCalledTimes(1);
        const id = send.mock.calls[0][0];
        expect(flusher.ack(id)).toBe(true);
        await expect(result).resolves.toBe(true);
        expect(flusher.pendingCount()).toBe(0);
    });

    it('resolves false after the bounded timeout (≤ 500 ms) when no ack arrives', async () => {
        expect(PERSIST_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(500);
        const flusher = createPersistFlusher();
        const result = flusher.request(() => {});
        vi.advanceTimersByTime(PERSIST_FLUSH_TIMEOUT_MS);
        await expect(result).resolves.toBe(false);
        expect(flusher.pendingCount()).toBe(0);
    });

    it('resolves false at once when sending throws', async () => {
        const flusher = createPersistFlusher();
        await expect(
            flusher.request(() => {
                throw new Error('destroyed');
            })
        ).resolves.toBe(false);
    });

    it('ignores unknown, late or malformed acks', async () => {
        const flusher = createPersistFlusher();
        let id = 0;
        const result = flusher.request((sent) => {
            id = sent;
        });
        expect(flusher.ack('1')).toBe(false);
        expect(flusher.ack(undefined)).toBe(false);
        expect(flusher.ack(id + 100)).toBe(false);
        vi.advanceTimersByTime(PERSIST_FLUSH_TIMEOUT_MS);
        await result;
        expect(flusher.ack(id)).toBe(false);
    });
});

describe('createQuitFlushGuard', () => {
    const event = () => ({ preventDefault: vi.fn() });

    it('delays the first quit until the flush settles, then quits once; later quits pass through', async () => {
        let finish!: () => void;
        const flush = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        const quit = vi.fn();
        const guard = createQuitFlushGuard({ flush, quit });

        const first = event();
        guard.onBeforeQuit(first);
        expect(first.preventDefault).toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();

        // A second quit request while flushing waits for the same flush.
        const second = event();
        guard.onBeforeQuit(second);
        expect(second.preventDefault).toHaveBeenCalled();
        expect(flush).toHaveBeenCalledTimes(1);

        finish();
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

        const third = event();
        guard.onBeforeQuit(third);
        expect(third.preventDefault).not.toHaveBeenCalled();
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('does not block quitting when there is no renderer to flush', () => {
        const quit = vi.fn();
        const guard = createQuitFlushGuard({ flush: () => null, quit });
        const e = event();
        guard.onBeforeQuit(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(quit).not.toHaveBeenCalled();
    });

    it('still quits when the flush rejects or throws', async () => {
        const quit = vi.fn();
        const rejecting = createQuitFlushGuard({ flush: () => Promise.reject(new Error('x')), quit });
        rejecting.onBeforeQuit(event());
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

        const throwingQuit = vi.fn();
        const throwing = createQuitFlushGuard({
            flush: () => {
                throw new Error('y');
            },
            quit: throwingQuit,
        });
        const e = event();
        throwing.onBeforeQuit(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('end to end with the flusher: an unanswered request still lets the app quit after the timeout', async () => {
        const flusher = createPersistFlusher();
        const quit = vi.fn();
        const guard = createQuitFlushGuard({ flush: () => flusher.request(() => {}), quit });
        guard.onBeforeQuit(event());
        vi.advanceTimersByTime(PERSIST_FLUSH_TIMEOUT_MS);
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    });
});

describe('wiring (source checks)', () => {
    // T-315: before-quit is registered in electron/main/app/lifecycle.cts, the flush-persist-done ack in electron/main/app/appIpc.cts.
    const lifecycle = readMainModule('app/lifecycle.cts');
    const appIpc = readMainModule('app/appIpc.cts');
    // T-306: the main window (and its session-end hooks) moved to electron/main/windows/mainWindow.cts.
    const mainWindowModule = readMainModule('windows/mainWindow.cts');
    const preload = read('../electron/preload.cts');

    it('main registers before-quit through the guard, session-end flushes and the ack is sender-checked', () => {
        expect(lifecycle).toMatch(/app\.on\('before-quit', \(event\) => quitFlushGuard\.onBeforeQuit\(event\)\)/);
        expect(mainWindowModule).toMatch(/appState\.mainWindow\.on\('session-end', onSessionEnding\)/);
        expect(mainWindowModule).toMatch(/appState\.mainWindow\.on\('query-session-end', onSessionEnding\)/);
        expect(appIpc).toMatch(/ipcMain\.on\('flush-persist-done'[\s\S]{0,200}event\.sender !== appState\.mainWindow\.webContents/);
    });

    it('preload handles flush-persist internally (not a window.api member) and always acks', () => {
        expect(preload).toMatch(/subscribe\('flush-persist'/);
        expect(preload).toMatch(/\.dispatchEvent\(new Event\('kobar:flush-persist'\)\)/);
        expect(preload).toMatch(/finally \{\s*ipcRenderer\.send\('flush-persist-done', id\)/);
        const apiBody = preload.slice(preload.indexOf("contextBridge.exposeInMainWorld('api', {"));
        expect(apiBody).not.toMatch(/flush/i);
    });
});
