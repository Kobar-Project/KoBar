// Logging helpers for the persistent PowerShell bridge (T-317, ARC-04). Pure: the clock and the sink are injected.
// Nothing here ever logs a script body: stderr lines are cut to a short fixed prefix and dropped writes are only counted.

/** Longest piece of one stderr line (or error detail) that reaches the log. */
export const PS_LOG_LINE_MAX = 160;

/** True for C0/C1 control characters, DEL and the bidi embedding/override/isolate controls (log spoofing). */
function isUnsafeLogChar(code: number): boolean {
    return code < 32 || (code >= 0x7f && code <= 0x9f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Makes one line safe to log: control and bidi characters become spaces, the text is trimmed and cut to `max` characters. */
export function sanitizePsLogLine(line: string, max = PS_LOG_LINE_MAX): string {
    let clean = '';
    for (const ch of line) {
        const code = ch.charCodeAt(0);
        clean += isUnsafeLogChar(code) ? ' ' : ch;
    }
    clean = clean.trim();
    return clean.length > max ? `${clean.slice(0, max)}... (${clean.length} chars)` : clean;
}

export interface RateLimitedLogOptions {
    /** Prefix of every message, e.g. `[ps] stderr`. */
    label: string;
    log: (message: string) => void;
    /** Messages allowed per window; the rest are counted and reported when the next window opens. */
    maxPerWindow?: number;
    windowMs?: number;
    now?: () => number;
}

export interface RateLimitedLog {
    write(message: string): void;
}

/**
 * At most `maxPerWindow` messages per `windowMs`; suppressed ones are summarised as a count, never replayed.
 * The summary is emitted lazily: only when a later message arrives and opens a new window (no timer), so a burst
 * followed by silence leaves its suppressed count unreported.
 */
export function createRateLimitedLog(options: RateLimitedLogOptions): RateLimitedLog {
    const maxPerWindow = options.maxPerWindow ?? 5;
    const windowMs = options.windowMs ?? 60000;
    const now = options.now ?? Date.now;
    let windowStart: number | null = null;
    let count = 0;
    let suppressed = 0;
    return {
        write(message) {
            const t = now();
            if (windowStart === null || t - windowStart >= windowMs) {
                if (suppressed > 0) options.log(`${options.label}: ${suppressed} more message(s) suppressed`);
                windowStart = t;
                count = 0;
                suppressed = 0;
            }
            if (count < maxPerWindow) {
                count += 1;
                options.log(`${options.label}: ${message}`);
            } else {
                suppressed += 1;
            }
        },
    };
}

export interface OutageLogOptions {
    log: (message: string) => void;
    /** While one outage lasts, at most one message per interval (with the number of dropped writes). */
    intervalMs?: number;
    now?: () => number;
}

export interface OutageLog {
    /** A write/request was dropped because the bridge is down. `reason` is a short fixed text, never script content. */
    dropped(reason: string): void;
    /** The bridge is up again: the next drop starts a new outage and is logged at once. */
    recovered(): void;
}

/** Logs dropped bridge writes once per outage (then at most once per interval). Writes are never queued for replay. */
export function createOutageLog(options: OutageLogOptions): OutageLog {
    const intervalMs = options.intervalMs ?? 60000;
    const now = options.now ?? Date.now;
    let inOutage = false;
    let lastLogAt = 0;
    let dropped = 0;
    return {
        dropped(reason) {
            const t = now();
            dropped += 1;
            if (inOutage && t - lastLogAt < intervalMs) return;
            options.log(`[ps] PowerShell bridge unavailable (${reason}); ${dropped} write(s) dropped, not queued.`);
            inOutage = true;
            lastLogAt = t;
            dropped = 0;
        },
        recovered() {
            inOutage = false;
            dropped = 0;
        },
    };
}
