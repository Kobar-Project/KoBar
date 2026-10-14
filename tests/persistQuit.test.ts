// T-403: the quit / session-end flush in electron/main/app/persist.cts with the file-store hooks. Electron is mocked; the real
// flusher and quit guard run. Main asks the renderer to flush, waits (bounded) for its ack, then waits (bounded) for the file
// writes, and only a complete flush before quit records a clean shutdown. Quitting never hangs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSIST_FLUSH_TIMEOUT_MS } from '../electron/lib/persistFlush.cjs';

const quit = vi.fn();
const flushStorageData = vi.fn();

vi.mock('electron', () => ({
    app: { quit },
    session: { defaultSession: { flushStorageData } },
}));

const { createPersistSession } = await import('../electron/main/app/persist.cjs');
const { appState } = await import('../electron/main/state.cjs');

type Session = ReturnType<typeof createPersistSession>;

/** A main window whose renderer acks `flush-persist` (or stays silent / is gone). */
function installWindow(session: () => Session, mode: 'ack' | 'silent' | 'crashed', onFlush: () => void = () => {}) {
    const webContents = {
        isDestroyed: () => false,
        isCrashed: () => mode === 'crashed',
        send: vi.fn((channel: string, id: number) => {
            if (channel !== 'flush-persist' || mode !== 'ack') return;
            // The renderer flushes (its storage writes go out first), then acks on the same pipe.
            onFlush();
            queueMicrotask(() => session().persistFlusher.ack(id));
        }),
    };
    appState.mainWindow = { isDestroyed: () => false, webContents } as never;
    return webContents;
}

function hooks(drained: boolean | Promise<boolean> = true) {
    return {
        drain: vi.fn(() => (drained instanceof Promise ? drained : Promise.resolve(drained))),
        markCleanShutdown: vi.fn(() => true),
    };
}

afterEach(() => {
    appState.mainWindow = null;
    quit.mockClear();
    flushStorageData.mockClear();
    vi.useRealTimers();
});

describe('before-quit with the file store (T-403)', () => {
    it('waits for the ack, then the file drain, marks a clean shutdown and quits', async () => {
        const storage = hooks(true);
        const order: string[] = [];
        storage.drain.mockImplementation(async () => {
            order.push('drain');
            return true;
        });
        const session = createPersistSession(storage);
        installWindow(
            () => session,
            'ack',
            () => order.push('renderer-flush')
        );
        const event = { preventDefault: vi.fn() };
        session.quitFlushGuard.onBeforeQuit(event);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(quit).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
        expect(order).toEqual(['renderer-flush', 'drain']);
        expect(storage.markCleanShutdown).toHaveBeenCalledTimes(1);
        // The restarted quit passes through.
        const again = { preventDefault: vi.fn() };
        session.quitFlushGuard.onBeforeQuit(again);
        expect(again.preventDefault).not.toHaveBeenCalled();
    });

    it('no ack (timeout): still drains, quits, but no clean shutdown', async () => {
        vi.useFakeTimers();
        const storage = hooks(true);
        const session = createPersistSession(storage);
        installWindow(() => session, 'silent');
        session.quitFlushGuard.onBeforeQuit({ preventDefault: vi.fn() });
        await vi.advanceTimersByTimeAsync(PERSIST_FLUSH_TIMEOUT_MS);
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
        expect(storage.drain).toHaveBeenCalledTimes(1);
        expect(storage.markCleanShutdown).not.toHaveBeenCalled();
    });

    it('drain timed out: quits without a clean shutdown', async () => {
        const storage = hooks(false);
        const session = createPersistSession(storage);
        installWindow(() => session, 'ack');
        session.quitFlushGuard.onBeforeQuit({ preventDefault: vi.fn() });
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
        expect(storage.markCleanShutdown).not.toHaveBeenCalled();
    });

    it('no live renderer (crashed or no window): drains what main has, quits, no clean shutdown', async () => {
        for (const setupWindow of [(s: () => Session) => installWindow(s, 'crashed'), () => (appState.mainWindow = null)]) {
            quit.mockClear();
            const storage = hooks(true);
            const session = createPersistSession(storage);
            setupWindow(() => session);
            session.quitFlushGuard.onBeforeQuit({ preventDefault: vi.fn() });
            await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
            expect(storage.drain).toHaveBeenCalledTimes(1);
            expect(storage.markCleanShutdown).not.toHaveBeenCalled();
        }
    });
});

describe('session end (requestPersistFlush, Windows query-session-end / session-end)', () => {
    it('resolves only after the renderer ack and the file drain, then marks a clean shutdown', async () => {
        let finishDrain: (value: boolean) => void = () => {};
        const storage = hooks(new Promise<boolean>((resolve) => (finishDrain = resolve)));
        const session = createPersistSession(storage);
        installWindow(() => session, 'ack');
        let settled: boolean | null = null;
        void session.requestPersistFlush()!.then((value) => (settled = value));
        await vi.waitFor(() => expect(storage.drain).toHaveBeenCalledTimes(1));
        expect(settled).toBeNull();
        expect(storage.markCleanShutdown).not.toHaveBeenCalled();
        finishDrain(true);
        await vi.waitFor(() => expect(settled).toBe(true));
        expect(flushStorageData).toHaveBeenCalledTimes(1);
        expect(storage.markCleanShutdown).toHaveBeenCalledTimes(1);
    });

    it('an incomplete session-end flush (drain timeout) does not mark a clean shutdown', async () => {
        const storage = hooks(false);
        const session = createPersistSession(storage);
        installWindow(() => session, 'ack');
        await expect(session.requestPersistFlush()).resolves.toBe(false);
        expect(storage.markCleanShutdown).not.toHaveBeenCalled();
    });
});
