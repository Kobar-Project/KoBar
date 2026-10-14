// Rate limiter for screen capture IPC (SEC-16). It is a mitigation, not authentication: a same-realm
// plugin can call the capture API like the app itself, so a real user click cannot be proven.
// The limiter only bounds how fast and how often captures can happen; the visible flash makes each one noticeable.

/** Minimum gap between two accepted captures. */
export const CAPTURE_MIN_INTERVAL_MS = 1000;
/** Maximum accepted captures inside the sliding window. */
export const CAPTURE_MAX_PER_WINDOW = 10;
export const CAPTURE_WINDOW_MS = 60_000;

export type CaptureDecision = { allowed: true } | { allowed: false; reason: 'too_fast' | 'too_many'; retryAfterMs: number };

export interface CaptureLimiter {
    /** Records the attempt when allowed. Rejected attempts are not recorded. */
    tryAcquire(): CaptureDecision;
}

export function createCaptureLimiter(
    now: () => number = () => performance.now(), // monotonic: immune to wall-clock changes
    minIntervalMs: number = CAPTURE_MIN_INTERVAL_MS,
    maxPerWindow: number = CAPTURE_MAX_PER_WINDOW,
    windowMs: number = CAPTURE_WINDOW_MS
): CaptureLimiter {
    let stamps: number[] = [];
    return {
        tryAcquire() {
            const t = now();
            stamps = stamps.filter((s) => t - s < windowMs && s <= t);
            const last = stamps[stamps.length - 1];
            const fastWait = last !== undefined && t - last < minIntervalMs ? minIntervalMs - (t - last) : 0;
            const capWait = stamps.length >= maxPerWindow ? windowMs - (t - stamps[0]) : 0;
            if (fastWait > 0 || capWait > 0) {
                // When both limits apply, report the longer wait.
                return capWait >= fastWait
                    ? { allowed: false, reason: 'too_many', retryAfterMs: capWait }
                    : { allowed: false, reason: 'too_fast', retryAfterMs: fastWait };
            }
            stamps.push(t);
            return { allowed: true };
        },
    };
}
