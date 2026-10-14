import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WINDOW_API_METHODS } from './helpers/windowApi';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Behavioural + source-level checks for the shared `subscribe()` helper in electron/preload.cts (T-127).

type Listener = (...args: unknown[]) => void;
type ApiFn = (...args: unknown[]) => unknown;

const exposed: { api?: Record<string, ApiFn> } = {};
const ipcRenderer = {
    on: vi.fn<(channel: string, listener: Listener) => void>(),
    removeListener: vi.fn<(channel: string, listener: Listener) => void>(),
    removeAllListeners: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(),
    sendSync: vi.fn(),
};

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: (_name: string, api: Record<string, ApiFn>) => {
            exposed.api = api;
        },
    },
    ipcRenderer,
    webUtils: { getPathForFile: vi.fn() },
}));

const preloadSource = readFileSync(fileURLToPath(new URL('../electron/preload.cts', import.meta.url)), 'utf8');

beforeAll(async () => {
    await import('../electron/preload.cts');
});

beforeEach(() => {
    ipcRenderer.on.mockClear();
    ipcRenderer.removeListener.mockClear();
    ipcRenderer.removeAllListeners.mockClear();
});

function onApis(): [string, (cb: Listener) => () => void][] {
    return Object.entries(exposed.api!).filter(([name]) => /^on[A-Z]/.test(name)) as [string, (cb: Listener) => () => void][];
}

describe('preload subscribe helper', () => {
    it('exposes on* APIs', () => {
        const exposedNames = onApis()
            .map(([name]) => name)
            .sort();
        const expected = WINDOW_API_METHODS.filter((name) => /^on[A-Z]/.test(name)).sort();
        expect(exposedNames).toEqual(expected);
    });

    it('every on* API returns an unsubscribe that removes only its own handler', () => {
        for (const [name, fn] of onApis()) {
            ipcRenderer.on.mockClear();
            ipcRenderer.removeListener.mockClear();
            const unsubscribe = fn(vi.fn());
            expect(typeof unsubscribe, name).toBe('function');
            expect(ipcRenderer.on, name).toHaveBeenCalledTimes(1);
            const [channel, handler] = ipcRenderer.on.mock.calls[0];
            unsubscribe();
            expect(ipcRenderer.removeListener, name).toHaveBeenCalledWith(channel, handler);
            expect(ipcRenderer.removeAllListeners, name).not.toHaveBeenCalled();
        }
    });

    it('registers a distinct handler per subscriber so one unsubscribe leaves the other intact', () => {
        const a = vi.fn();
        const b = vi.fn();
        const unsubA = exposed.api!.onLlmStreamChunk(a) as () => void;
        exposed.api!.onLlmStreamChunk(b);
        const [, handlerA] = ipcRenderer.on.mock.calls[0];
        const [, handlerB] = ipcRenderer.on.mock.calls[1];
        expect(handlerA).not.toBe(handlerB);
        unsubA();
        expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1);
        expect(ipcRenderer.removeListener).toHaveBeenCalledWith('llm-stream-chunk', handlerA);
    });

    it('onEdgeChanged now returns an unsubscribe and still forwards edge and bounds without the event', () => {
        const cb = vi.fn();
        const unsubscribe = exposed.api!.onEdgeChanged(cb);
        expect(typeof unsubscribe).toBe('function');
        const [channel, handler] = ipcRenderer.on.mock.calls[0];
        expect(channel).toBe('edge-changed');
        handler({}, 'left', { x: 1 });
        expect(cb).toHaveBeenCalledWith('left', { x: 1 });
    });

    it('forwards only the payload (no IPC event) and keeps zero-arg callbacks argument-free', () => {
        const progress = vi.fn();
        exposed.api!.onPluginInstallProgress(progress);
        ipcRenderer.on.mock.calls[0][1]({}, { id: 'p', percent: 40 });
        expect(progress).toHaveBeenCalledWith('p', 40);

        ipcRenderer.on.mockClear();
        const opened = vi.fn();
        exposed.api!.onOpenSettings(opened);
        ipcRenderer.on.mock.calls[0][1]({}, 'extra');
        expect(opened).toHaveBeenCalledWith();
    });

    it('preload source never calls removeAllListeners and registers listeners only via subscribe()', () => {
        const code = preloadSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/removeAllListeners/);
        expect(code.match(/ipcRenderer\.on\(/g)).toHaveLength(1);
    });
});

describe('preload media resync (T-128)', () => {
    it('onMediaUpdate and onVideoUrlsUpdate ask main to resend after subscribing, via an internal channel', () => {
        ipcRenderer.send.mockClear();
        ipcRenderer.on.mockClear();
        exposed.api!.onMediaUpdate(vi.fn());
        expect(ipcRenderer.on.mock.invocationCallOrder[0]).toBeLessThan(ipcRenderer.send.mock.invocationCallOrder[0]);
        expect(ipcRenderer.send).toHaveBeenCalledWith('media-resync', 'media-update');
        exposed.api!.onVideoUrlsUpdate(vi.fn());
        expect(ipcRenderer.send).toHaveBeenCalledWith('media-resync', 'video-urls-update');
        expect(Object.keys(exposed.api!)).not.toContain('mediaResync');
    });
});
