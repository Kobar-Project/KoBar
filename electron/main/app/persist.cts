// T-315: the debounced renderer persist flush (T-129), moved unchanged out of main.cts. Main asks the main window to write pending
// `kobar-storage` state before quit / session end. Internal channels `flush-persist` / `flush-persist-done`; every request times out
// (<= 400 ms). `createPersistSession()` is called once by createMainContext, so there is one flusher and one quit guard.
// T-403: after the ack, the flush also waits (bounded, STORAGE_DRAIN_TIMEOUT_MS) until the file-backed store's writes are renamed into
// place (the renderer's writes reach main before its ack, same IPC pipe). Only a complete flush (quit or session end) records a
// clean shutdown.
import { app, session } from 'electron';
import { createPersistFlusher, createQuitFlushGuard } from '../../lib/persistFlush.cjs';
import { appState } from '../state.cjs';

/** The part of the file-store transport (services/storage/storageIpc.cts) the quit path uses. */
export interface PersistStorageHooks {
    drain(): Promise<boolean>;
    markCleanShutdown(): boolean;
}

export function createPersistSession(storage: PersistStorageHooks) {
    const persistFlusher = createPersistFlusher();

    /**
     * Asks the main window renderer to flush its persist state, then waits for the file writes. Null when there is no live
     * renderer to ask. Resolves true only when the renderer acked AND every file write finished in time.
     */
    function requestPersistFlush(): Promise<boolean> | null {
        const win = appState.mainWindow;
        if (!win || win.isDestroyed()) return null;
        const wc = win.webContents;
        if (wc.isDestroyed() || wc.isCrashed()) return null;
        return persistFlusher
            .request((id) => wc.send('flush-persist', id))
            .then(async (acked) => {
                // Commit DOMStorage to disk now instead of on Chromium's own schedule. Best-effort: the renderer's localStorage
                // write and the IPC ack travel on separate channels, so the write may not have reached the browser process yet;
                // a clean shutdown commits it anyway.
                try {
                    session.defaultSession.flushStorageData();
                } catch (err) {
                    console.error('[KoBar] flushStorageData failed:', err);
                }
                const drained = await storage.drain();
                const complete = acked && drained;
                // Quit and Windows session end alike: record a clean shutdown only when nothing was lost on the way.
                // Safe when a session end is cancelled: the service resets the flag on its next write.
                if (complete) storage.markCleanShutdown();
                return complete;
            });
    }

    /** before-quit: flush (see above). No live renderer: still let writes main already received finish (bounded), no clean shutdown. */
    function flushBeforeQuit(): Promise<unknown> | null {
        return requestPersistFlush() ?? storage.drain();
    }

    const quitFlushGuard = createQuitFlushGuard({ flush: flushBeforeQuit, quit: () => app.quit() });

    return { persistFlusher, requestPersistFlush, quitFlushGuard };
}

export type PersistSession = ReturnType<typeof createPersistSession>;
