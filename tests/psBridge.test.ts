import { describe, expect, it } from 'vitest';
import { readMainModule } from './helpers/mainSource';
import { createOutageLog, createRateLimitedLog, PS_LOG_LINE_MAX, sanitizePsLogLine } from '../electron/lib/psBridgeLog.cjs';
import { createPsRequests, PS_REQUEST_TIMEOUT_MS } from '../electron/lib/psRequests.cjs';
import { createRespawnPolicy, createRestartGate, PS_RESTART_COOLDOWN_MS, shouldRestartPsBridge } from '../electron/lib/respawnBackoff.cjs';

describe('T-317 request timeout', () => {
    it('defaults to PS_REQUEST_TIMEOUT_MS, resolves null, frees the entry and ignores the late reply', async () => {
        const timers: { fn: () => void; ms: number }[] = [];
        const ps = createPsRequests({
            send: () => {},
            setTimer: (fn, ms) => {
                const t = { fn, ms };
                timers.push(t);
                return t;
            },
            clearTimer: () => {},
        });
        const p = ps.request((id) => `Write-Output "${id}|OK"`);
        expect(PS_REQUEST_TIMEOUT_MS).toBe(1500);
        expect(timers[0].ms).toBe(PS_REQUEST_TIMEOUT_MS);
        expect(ps.pendingCount()).toBe(1);
        timers[0].fn();
        expect(await p).toBeNull();
        expect(ps.pendingCount()).toBe(0);
        expect(ps.handleLine('1|OK')).toBe(false);
        expect(ps.pendingCount()).toBe(0);
    });
});

describe('sanitizePsLogLine', () => {
    it('strips control characters and cuts long lines to a short prefix', () => {
        expect(sanitizePsLogLine(`  bad${String.fromCharCode(27)}[31mline${String.fromCharCode(7)}  `)).toBe('bad [31mline');
        const long = 'x'.repeat(1000);
        const out = sanitizePsLogLine(long);
        expect(out.startsWith('x'.repeat(PS_LOG_LINE_MAX) + '...')).toBe(true);
        expect(out).toContain('(1000 chars)');
        expect(out.length).toBeLessThan(PS_LOG_LINE_MAX + 30);
        expect(sanitizePsLogLine('abcdef', 3)).toBe('abc... (6 chars)');
        expect(sanitizePsLogLine('   ')).toBe('');
    });

    it('maps C1 controls and bidi overrides/isolates to spaces', () => {
        const ch = (code: number) => String.fromCharCode(code);
        expect(sanitizePsLogLine(`a${ch(0x80)}b${ch(0x9b)}c${ch(0x9f)}d`)).toBe('a b c d');
        expect(sanitizePsLogLine(`x${ch(0x202a)}${ch(0x202e)}y${ch(0x2066)}z${ch(0x2069)}w`)).toBe('x  y z w');
        expect(sanitizePsLogLine(`keep${ch(0xa0)}${ch(0x2029)}${ch(0x206a)}`)).toBe(`keep${ch(0xa0)}${ch(0x2029)}${ch(0x206a)}`);
    });
});

describe('createRateLimitedLog', () => {
    it('logs at most maxPerWindow messages per window and reports the suppressed count later', () => {
        let t = 0;
        const out: string[] = [];
        const log = createRateLimitedLog({ label: '[ps] stderr', maxPerWindow: 2, windowMs: 1000, now: () => t, log: (m) => out.push(m) });
        log.write('a');
        log.write('b');
        log.write('c');
        log.write('d');
        expect(out).toEqual(['[ps] stderr: a', '[ps] stderr: b']);
        t += 1000;
        log.write('e');
        expect(out).toEqual(['[ps] stderr: a', '[ps] stderr: b', '[ps] stderr: 2 more message(s) suppressed', '[ps] stderr: e']);
    });
});

describe('createOutageLog', () => {
    it('logs once per outage, then at most once per interval with the dropped count', () => {
        let t = 0;
        const out: string[] = [];
        const log = createOutageLog({ intervalMs: 1000, now: () => t, log: (m) => out.push(m) });
        log.dropped('gave up after repeated crashes');
        log.dropped('gave up after repeated crashes');
        log.dropped('gave up after repeated crashes');
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('(gave up after repeated crashes); 1 write(s) dropped, not queued.');
        t += 1000;
        log.dropped('gave up after repeated crashes');
        expect(out).toHaveLength(2);
        expect(out[1]).toContain('3 write(s) dropped');
    });

    it('starts a new outage after recovered()', () => {
        let t = 0;
        const out: string[] = [];
        const log = createOutageLog({ intervalMs: 60000, now: () => t, log: (m) => out.push(m) });
        log.dropped('restarting');
        log.recovered();
        t += 10;
        log.dropped('stdin closed');
        expect(out).toHaveLength(2);
        expect(out[1]).toContain('(stdin closed); 1 write(s) dropped');
    });
});

describe('restart after give-up', () => {
    it('shouldRestartPsBridge allows only a bridge that gave up, never after quit, while running or respawning', () => {
        const base = { quitting: false, running: false, respawnPending: false, gaveUp: true };
        expect(shouldRestartPsBridge(base)).toBe(true);
        expect(shouldRestartPsBridge({ ...base, quitting: true })).toBe(false);
        expect(shouldRestartPsBridge({ ...base, running: true })).toBe(false);
        expect(shouldRestartPsBridge({ ...base, respawnPending: true })).toBe(false);
        expect(shouldRestartPsBridge({ ...base, gaveUp: false })).toBe(false);
        expect(shouldRestartPsBridge({ quitting: true, running: true, respawnPending: true, gaveUp: false })).toBe(false);
    });

    it('the restart gate allows one restart per cooldown', () => {
        let t = 5000;
        const gate = createRestartGate({ cooldownMs: 30000, now: () => t });
        expect(gate.tryAcquire()).toBe(true);
        t += 29999;
        expect(gate.tryAcquire()).toBe(false);
        t += 1;
        expect(gate.tryAcquire()).toBe(true);
        expect(gate.tryAcquire()).toBe(false);
        expect(PS_RESTART_COOLDOWN_MS).toBe(30000);
    });

    it('reset() gives a policy that gave up a fresh budget; attempts() counts the used ones', () => {
        const p = createRespawnPolicy({ now: () => 0 });
        p.markStarted();
        expect([p.nextDelay(), p.attempts()]).toEqual([500, 1]);
        expect([p.nextDelay(), p.attempts()]).toEqual([1000, 2]);
        expect([p.nextDelay(), p.attempts()]).toEqual([2000, 3]);
        expect(p.nextDelay()).toBeNull();
        p.reset();
        expect(p.attempts()).toBe(0);
        expect(p.nextDelay()).toBe(500);
    });
});

describe('native.cts bridge wiring (T-317)', () => {
    const native = readMainModule('services/native.cts');
    const fnBody = (name: string) => {
        const start = native.indexOf(`export function ${name}`);
        expect(start).toBeGreaterThanOrEqual(0);
        const end = native.indexOf('\n}\n', start);
        expect(end).toBeGreaterThan(start);
        return native.slice(start, end);
    };

    it('psWrite keeps the happy path and only logs (never queues) a dropped write', () => {
        const body = fnBody('psWrite');
        expect(body).toContain('if (psProcess && psProcess.stdin) psProcess.stdin.write(script);');
        expect(body).toContain('else noteDroppedWrite();');
        const drop = native.slice(native.indexOf('function noteDroppedWrite'), native.indexOf('export function isPsAvailable'));
        expect(native.indexOf('function noteDroppedWrite')).toBeGreaterThanOrEqual(0);
        expect(drop.length).toBeGreaterThan(0);
        expect(drop).toMatch(/if \(psQuitting\) return;/);
        expect(drop).toContain('psOutageLog.dropped(reason);');
        expect(drop).not.toContain('script');
        expect(native).not.toMatch(/\.push\(script\)/);
    });

    it('drains stderr into the sanitized, rate-limited log', () => {
        expect(native).not.toContain('proc.stderr?.resume();');
        expect(native).toContain("proc.stderr?.on('data', (chunk: Buffer) => psStderrReader.push(chunk));");
        expect(native).toMatch(/const text = sanitizePsLogLine\(line\);\s+if \(text\) psStderrLog\.write\(text\);/);
    });

    it('logs exit code/signal with the respawn attempt and gives up once', () => {
        expect(native).toContain("proc.on('exit', (code, signal) => onBridgeDown(`code ${code}, signal ${signal}`));");
        expect(native).toContain('respawn attempt ${psRespawn.attempts()} in ${delay} ms.');
        expect(native).toMatch(/if \(delay === null\) \{\s+psGaveUp = true;\s+console\.error\(/);
    });

    it('restartPsBridgeIfDown asks shouldRestartPsBridge, then the cooldown gate, then resets and starts', () => {
        const body = fnBody('restartPsBridgeIfDown');
        expect(body).toContain(
            'const state = { quitting: psQuitting, running: !!psProcess, respawnPending: !!psRespawnTimer, gaveUp: psGaveUp };'
        );
        const decideAt = body.indexOf('if (!shouldRestartPsBridge(state)) return;');
        const gateAt = body.indexOf('if (!psRestartGate.tryAcquire()) return;');
        expect(decideAt).toBeGreaterThanOrEqual(0);
        expect(gateAt).toBeGreaterThan(decideAt);
        const resetAt = body.indexOf('psRespawn.reset();');
        const startAt = body.indexOf('startPsBridge();');
        expect(gateAt).toBeGreaterThanOrEqual(0);
        expect(resetAt).toBeGreaterThan(gateAt);
        expect(startAt).toBeGreaterThan(resetAt);
        expect(fnBody('startPsBridge')).toMatch(/psGaveUp = false;\s+psOutageLog\.recovered\(\);/);
    });

    it('pin targeting and PrintScreen give a bridge that gave up one more chance', () => {
        const pin = readMainModule('services/pin.cts');
        const pinStart = pin.indexOf("ipcMain.on('enter-pin-targeting'");
        const pinEnd = pin.indexOf("ipcMain.on('unpin-current-window'");
        expect(pinStart).toBeGreaterThanOrEqual(0);
        expect(pinEnd).toBeGreaterThan(pinStart);
        expect(pin.slice(pinStart, pinEnd)).toMatch(/if \(isWin\) restartPsBridgeIfDown\(\);\s+appState\.isAwaitingPinTarget = true;/);
        const shot = readMainModule('services/screenshot.cts');
        const shotStart = shot.indexOf("ipcMain.on('trigger-screenshot'");
        const shotEnd = shot.indexOf("ipcMain.on('take-screenshot'");
        expect(shotStart).toBeGreaterThanOrEqual(0);
        expect(shotEnd).toBeGreaterThan(shotStart);
        const block = shot.slice(shotStart, shotEnd);
        const restartAt = block.indexOf('restartPsBridgeIfDown();');
        const availAt = block.indexOf('if (isPsAvailable())');
        expect(restartAt).toBeGreaterThanOrEqual(0);
        expect(availAt).toBeGreaterThan(restartAt);
    });
});
