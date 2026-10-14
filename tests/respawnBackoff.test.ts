import { describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import { createRespawnPolicy } from '../electron/lib/respawnBackoff.cjs';

describe('createRespawnPolicy', () => {
    it('backs off exponentially then gives up', () => {
        let t = 0;
        const p = createRespawnPolicy({ now: () => t });
        p.markStarted();
        expect(p.nextDelay()).toBe(500);
        t += 100;
        p.markStarted();
        expect(p.nextDelay()).toBe(1000);
        p.markStarted();
        expect(p.nextDelay()).toBe(2000);
        expect(p.nextDelay()).toBeNull();
    });

    it('caps the delay', () => {
        const p = createRespawnPolicy({ maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 3000 });
        expect([p.nextDelay(), p.nextDelay(), p.nextDelay(), p.nextDelay()]).toEqual([1000, 2000, 3000, 3000]);
    });

    it('restores the budget after a stable run', () => {
        let t = 1000;
        const p = createRespawnPolicy({ maxAttempts: 2, stableMs: 60000, now: () => t });
        p.markStarted();
        p.nextDelay();
        p.nextDelay();
        expect(p.nextDelay()).toBeNull();
        t += 61000;
        p.markStarted();
        t += 61000;
        expect(p.nextDelay()).toBe(500);
    });

    it('does not reset the budget after a run shorter than stableMs', () => {
        let t = 1000;
        const p = createRespawnPolicy({ maxAttempts: 2, stableMs: 60000, now: () => t });
        p.markStarted();
        p.nextDelay();
        t += 30000;
        p.markStarted();
        p.nextDelay();
        t += 30000;
        expect(p.nextDelay()).toBeNull();
    });
});

describe('main.cts bridge wiring', () => {
    // T-315: the whenReady / will-quit handlers moved to electron/main/app/lifecycle.cts.
    const main = readMainModule('app/lifecycle.cts');
    // T-309: the bridge (spawn, respawn policy, quit cleanup) moved into electron/main/services/native.cts.
    const native = readMainModule('services/native.cts');
    it('rejects pending requests only for the current process and clears the timer on quit', () => {
        expect(native).toMatch(/if \(psProcess !== proc\) return;\s+psRequests\.rejectAll\(\);/);
        expect(native).toContain('if (psRespawnTimer) clearTimeout(psRespawnTimer);');
        expect(native).toMatch(/try \{\s*proc\.kill\(\);\s*\} catch/);
    });
    it('will-quit stops the bridge (psQuitting first, then the timer, then the kill) before stopping media polling', () => {
        const stop = native.slice(native.indexOf('export function stopPsBridge'));
        const quittingAt = stop.indexOf('psQuitting = true;');
        const clearAt = stop.indexOf('clearTimeout(psRespawnTimer)');
        const killAt = stop.indexOf('psProcess.kill()');
        expect(quittingAt).toBeGreaterThanOrEqual(0);
        expect(clearAt).toBeGreaterThanOrEqual(0);
        expect(killAt).toBeGreaterThanOrEqual(0);
        expect(quittingAt).toBeLessThan(clearAt);
        expect(clearAt).toBeLessThan(killAt);
        expect(main).toMatch(/globalShortcut\.unregisterAll\(\);\s+stopPsBridge\(\);\s+stopMediaPolling\(\);/);
        expect(main).toMatch(/if \(isWin\) \{\s+startPsBridge\(\);\s+\}/);
    });
});
