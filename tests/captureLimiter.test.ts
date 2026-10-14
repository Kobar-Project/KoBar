import { describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import {
    CAPTURE_MAX_PER_WINDOW,
    CAPTURE_MIN_INTERVAL_MS,
    CAPTURE_WINDOW_MS,
    createCaptureLimiter,
} from '../electron/lib/captureLimiter.cjs';

function setup() {
    let t = 100_000;
    return { limiter: createCaptureLimiter(() => t), advance: (ms: number) => (t += ms) };
}

describe('captureLimiter', () => {
    it('allows the first capture', () => {
        expect(setup().limiter.tryAcquire()).toEqual({ allowed: true });
    });

    it('rejects a second capture inside the minimum interval', () => {
        const { limiter, advance } = setup();
        limiter.tryAcquire();
        advance(CAPTURE_MIN_INTERVAL_MS - 1);
        expect(limiter.tryAcquire()).toEqual({ allowed: false, reason: 'too_fast', retryAfterMs: 1 });
    });

    it('allows captures spaced at the minimum interval', () => {
        const { limiter, advance } = setup();
        for (let i = 0; i < 5; i++) {
            expect(limiter.tryAcquire().allowed).toBe(true);
            advance(CAPTURE_MIN_INTERVAL_MS);
        }
    });

    it('rejects captures over the per-window cap and recovers afterwards', () => {
        const { limiter, advance } = setup();
        for (let i = 0; i < CAPTURE_MAX_PER_WINDOW; i++) {
            expect(limiter.tryAcquire().allowed).toBe(true);
            advance(CAPTURE_MIN_INTERVAL_MS);
        }
        const denied = limiter.tryAcquire();
        expect(denied.allowed).toBe(false);
        if (!denied.allowed) expect(denied.reason).toBe('too_many');
        advance(CAPTURE_WINDOW_MS);
        expect(limiter.tryAcquire().allowed).toBe(true);
    });

    it('does not extend the lockout for rejected attempts', () => {
        const { limiter, advance } = setup();
        limiter.tryAcquire();
        advance(500);
        limiter.tryAcquire();
        advance(500);
        expect(limiter.tryAcquire().allowed).toBe(true);
    });

    it('reports the longer wait when both limits apply', () => {
        let t = 0;
        const limiter = createCaptureLimiter(() => t, 1000, 2, 3000);
        limiter.tryAcquire();
        t = 1000;
        limiter.tryAcquire();
        t = 1500; // too fast (500 ms left) and cap reached (1500 ms left)
        expect(limiter.tryAcquire()).toEqual({ allowed: false, reason: 'too_many', retryAfterMs: 1500 });
    });
});

describe('capture hardening wiring (SEC-16)', () => {
    // T-310: the screenshot handlers moved to electron/main/services/screenshot.cts.
    const main = readMainModule('services/screenshot.cts');
    const handlerStart = main.indexOf("ipcMain.handle('start-screenshot-capture'");
    const handlerEnd = main.indexOf("ipcMain.on('cancel-screenshot'");
    const handler = main.slice(handlerStart, handlerEnd);

    it('rate-limits the capture handler and flashes after grab and window restore', () => {
        expect(handler).toMatch(/captureLimiter\.tryAcquire\(\)/);
        const grab = handler.indexOf('desktopCapturer.getSources(');
        const show = handler.lastIndexOf('mainWindow.show()');
        const flash = handler.indexOf('flashDisplays(displays)');
        expect(grab).toBeGreaterThan(-1);
        expect(handlerStart).toBeGreaterThan(-1);
        expect(handlerEnd).toBeGreaterThan(handlerStart);
        expect(show).toBeGreaterThan(-1);
        expect(flash).toBeGreaterThan(grab);
        expect(flash).toBeGreaterThan(show);
    });

    it('limits and flashes the Windows PrintScreen path', () => {
        const start = main.indexOf("ipcMain.on('trigger-screenshot'");
        expect(start).toBeGreaterThan(-1);
        const end = main.indexOf("ipcMain.on('take-screenshot'");
        expect(end).toBeGreaterThan(start);
        const block = main.slice(start, end);
        expect(block).toMatch(/captureLimiter\.tryAcquire\(\)/);
        expect(block).toMatch(/flashDisplays\(screen\.getAllDisplays\(\)\)/);
    });
});
