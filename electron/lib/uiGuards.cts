// Pure helpers that keep renderer/plugin-supplied values from reaching native UI or the network unchecked
// (SEC-15, SEC-18). No Electron imports so they can be unit tested.

const MAX_NOTIFICATION_TITLE = 100;
const MAX_NOTIFICATION_BODY = 300;

// C0/C1 control characters (including newlines and tabs) and Unicode line/paragraph separators.
const c = String.fromCharCode;
// Control chars, zero-width and bidi override/isolate marks, and line/paragraph separators.
const CONTROL_CHARS = new RegExp(
    `[${c(0)}-${c(31)}${c(127)}-${c(159)}${c(0x200b)}-${c(0x200f)}${c(0x2028)}-${c(0x202e)}${c(0x2066)}-${c(0x2069)}]+`,
    'g'
);

// Cuts on code points so a surrogate pair is never split.
function truncate(text: string, maxLength: number): string {
    const chars = Array.from(text);
    return chars.length > maxLength ? chars.slice(0, maxLength - 1).join('') + '…' : text;
}

/** Strips control characters, collapses whitespace and truncates. Non-strings become an empty string. */
export function sanitizeUiText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    const clean = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > maxLength ? truncate(clean, maxLength) : clean;
}

export function sanitizeNotification(title: unknown, body: unknown): { title: string; body: string } {
    return {
        title: sanitizeUiText(title, MAX_NOTIFICATION_TITLE),
        body: sanitizeUiText(body, MAX_NOTIFICATION_BODY),
    };
}

/** Returns the version when it looks like a plain semver-ish string (e.g. 2.1.0, 2.1.0-beta.1), else null. */
export function sanitizeVersion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    return /^v?\d{1,4}(\.\d{1,4}){1,3}(-[0-9A-Za-z.-]{1,20})?$/.test(v) ? v : null;
}

/**
 * True only for http(s) URLs whose host is loopback: localhost, 127.0.0.0/8 or [::1].
 * The WHATWG URL parser (the same one fetch uses) normalizes decimal/hex/octal IPv4 forms, so
 * `http://2130706433` is judged as the 127.0.0.1 it really is. URLs with credentials, lookalike
 * hosts (localhost.evil.com) and IPv4-mapped IPv6 are rejected.
 */
export function isLoopbackUrl(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '[::1]') return true;
    const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    return !!m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255);
}
