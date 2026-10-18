// Pure classifiers deciding whether a renderer/plugin supplied address may be opened by the OS.
// No Electron imports here so the logic stays unit-testable (see tests/external.test.ts).

import { fileURLToPath } from 'node:url';

export type ExternalDecision =
    { kind: 'allow'; url: URL; reason: string } | { kind: 'confirm'; url: URL; reason: string } | { kind: 'deny'; reason: string };

/** Schemes opened without asking: web, mail, phone/VoIP and common meeting-app deep links. */
export const ALLOWED_SCHEMES: ReadonlySet<string> = new Set([
    'http:',
    'https:',
    'mailto:',
    'tel:',
    'sip:',
    'zoommtg:',
    'zoomus:',
    'msteams:',
    'webex:',
]);

/**
 * Well-known URI handlers that can run code, read local data or leak credentials. They are always
 * refused and never even offered in a confirmation dialog.
 */
export const DANGEROUS_SCHEMES: ReadonlySet<string> = new Set([
    // Browser-level pseudo schemes (script execution / content smuggling)
    'javascript:',
    'vbscript:',
    'data:',
    'blob:',
    'filesystem:',
    'about:',
    'view-source:',
    'mhtml:',
    'ms-its:',
    'mk:',
    'res:',
    'jar:',
    // Local file access (also an NTLM leak when pointing at a UNC host)
    'file:',
    // Windows handlers with a history of remote code execution (Follina, search-ms, App Installer...)
    'ms-msdt:',
    'msdt:',
    'search-ms:',
    'search:',
    'ms-search:',
    'ms-appinstaller:',
    'ms-cxh:',
    'ms-cxh-full:',
    'ms-gamebar:',
    'ms-gamebarservices:',
    'ms-help:',
    'shell:',
    'microsoft-edge:',
    // Office handlers that download and open documents (macro / OLE risk)
    'ms-officecmd:',
    'ms-excel:',
    'ms-word:',
    'ms-powerpoint:',
    'ms-access:',
    'ms-publisher:',
    'ms-visio:',
    'ms-project:',
    'ms-infopath:',
    'ms-spd:',
    // Legacy Windows help / compiled-help handlers that can execute content
    'hcp:',
    'its:',
    'ms-itss:',
    // Java Web Start
    'jnlp:',
    'jnlps:',
    // MAC-019: macOS handlers that run automation. `shortcuts://run-shortcut?name=X` runs an Apple Shortcut and
    // `applescript:` opens a script in Script Editor. Refused on every OS, like the Windows-only handlers above.
    'shortcuts:',
    'applescript:',
]);

/**
 * MAC-019: schemes that are deliberately NEVER allow-listed: remote-session, file-share and system handlers.
 * They always need an explicit user confirmation (the dialog shows the query on macOS). Kept as an explicit set so
 * a later edit cannot move them to ALLOWED_SCHEMES silently; a test asserts the two sets never overlap.
 */
export const CONFIRM_SCHEMES: ReadonlySet<string> = new Set([
    'ssh:',
    'vnc:',
    'smb:',
    'afp:',
    'nfs:',
    'telnet:',
    'facetime:',
    'x-apple.systempreferences:',
    // Opens Terminal with a man page.
    'x-man-page:',
]);

/** Generous enough for the app's own mailto export with a long note body; dialogs truncate separately. */
const MAX_URL_LENGTH = 32768;
/** Any whitespace (incl. unicode spaces) or C0/C1 control character. */
// eslint-disable-next-line no-control-regex
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

export function classifyExternalUrl(raw: unknown): ExternalDecision {
    if (typeof raw !== 'string' || raw.length === 0) return { kind: 'deny', reason: 'not a non-empty string' };
    if (raw.length > MAX_URL_LENGTH) return { kind: 'deny', reason: 'too long' };
    // Browsers strip tabs/newlines inside schemes ("java\nscript:"), so refuse them outright.
    if (WHITESPACE_OR_CONTROL.test(raw)) return { kind: 'deny', reason: 'whitespace or control character' };
    // Raw quotes/angle brackets are never legitimate in a link and are a command-line injection vector.
    if (/["<>]/.test(raw)) return { kind: 'deny', reason: 'quote or angle bracket' };

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { kind: 'deny', reason: 'not an absolute URL' };
    }
    if (url.protocol.length <= 2) return { kind: 'deny', reason: 'drive-letter or empty scheme' };
    if (DANGEROUS_SCHEMES.has(url.protocol)) return { kind: 'deny', reason: `dangerous scheme ${url.protocol}` };
    if (url.username || url.password) return { kind: 'deny', reason: 'embedded credentials' };
    if (ALLOWED_SCHEMES.has(url.protocol)) return { kind: 'allow', url, reason: 'allow-listed scheme' };
    if (CONFIRM_SCHEMES.has(url.protocol)) {
        return { kind: 'confirm', url, reason: `scheme ${url.protocol} is a remote-session, file-share or system handler` };
    }
    return { kind: 'confirm', url, reason: `scheme ${url.protocol} is not allow-listed` };
}

/**
 * Short, single-line text for confirmation dialogs: scheme + host + start of the path. The query and fragment
 * are omitted unless `includeQuery` is set (MAC-019: on macOS the query is what carries the payload, e.g.
 * `x-apple.systempreferences:...?Privacy_Camera`). The whole text, query included, is bounded by `maxLength`.
 */
export function describeUrlForDialog(url: URL, maxLength = 120, includeQuery = false): string {
    const base = url.host ? `${url.protocol}//${url.host}${url.pathname}` : `${url.protocol}${url.pathname}`;
    return truncateForDialog(includeQuery ? `${base}${url.search}${url.hash}` : base, maxLength);
}

export function truncateForDialog(text: string, maxLength = 120): string {
    // Strip control characters and bidi marks/overrides/isolates that could visually reorder the text.
    // eslint-disable-next-line no-control-regex
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '');
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

export type LaunchDecision =
    | { kind: 'url'; decision: Exclude<ExternalDecision, { kind: 'deny' }> }
    | { kind: 'path'; path: string; reason: string }
    | { kind: 'confirm-path'; path: string; reason: string }
    | { kind: 'deny'; reason: string };

const MAX_PATH_LENGTH = 32768;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Classifies the string a plugin passes to `window.api.launchFile` (the Shortcuts plugin sends
 * absolute local paths, .lnk/.exe files, folders and http(s) URLs). Lexical checks only.
 */
export function classifyLaunchTarget(raw: unknown): LaunchDecision {
    if (typeof raw !== 'string' || raw.length === 0) return { kind: 'deny', reason: 'not a non-empty string' };
    if (raw.length > MAX_PATH_LENGTH) return { kind: 'deny', reason: 'too long' };
    if (CONTROL_CHARS.test(raw)) return { kind: 'deny', reason: 'control character' };

    // Absolute local path: drive letter ("C:\x", "C:/x") or POSIX root ("/x"). Checked before the
    // scheme test so a drive letter is never mistaken for a one-letter scheme.
    if (/^[a-zA-Z]:[\\/]/.test(raw) || /^\/[^/]/.test(raw)) return { kind: 'path', path: raw, reason: 'absolute local path' };

    // Any "scheme:" (the old handler passed these to shell.openPath, which also opens URL protocols).
    // They now go through the external-URL gate; only `file:` is mapped back onto a path.
    if (/^[a-z][a-z0-9+.-]+:/i.test(raw)) {
        if (/^file:/i.test(raw)) return classifyFileUrl(raw);
        const decision = classifyExternalUrl(raw);
        if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason };
        return { kind: 'url', decision };
    }

    // Windows device / extended-length namespaces (\\?\ and \\.\) are not something a shortcut needs.
    if (/^[\\/]{2}[?.][\\/]/.test(raw)) return { kind: 'deny', reason: 'device namespace path' };
    // UNC (\\host\share or //host/share): opening may leak NTLM credentials to a remote host.
    if (/^[\\/]{2}[^\\/]/.test(raw)) return { kind: 'confirm-path', path: raw, reason: 'UNC path' };
    if (/^[\\/]{2}/.test(raw)) return { kind: 'deny', reason: 'malformed UNC path' };

    return { kind: 'deny', reason: 'not an absolute local path or URL' };
}

/** `file:///C:/x.lnk` (empty host or localhost) is a local path; any other host is a UNC share. */
function classifyFileUrl(raw: string): LaunchDecision {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { kind: 'deny', reason: 'malformed file URL' };
    }
    if (url.username || url.password) return { kind: 'deny', reason: 'embedded credentials' };
    try {
        // The URL parser already normalises a `localhost` host to the empty string for file: URLs.
        if (url.hostname === '') {
            const local = fileURLToPath(url);
            return classifyLaunchTarget(local).kind === 'path'
                ? { kind: 'path', path: local, reason: 'file URL to local path' }
                : { kind: 'deny', reason: 'file URL is not an absolute local path' };
        }
        const unc = '\\\\' + url.hostname + decodeURIComponent(url.pathname).replace(/\//g, '\\');
        // Re-run the raw-path rules so decoded control characters and \\.\ / \\?\ device paths are refused.
        if (classifyLaunchTarget(unc).kind !== 'confirm-path') return { kind: 'deny', reason: 'file URL is not a valid UNC path' };
        return { kind: 'confirm-path', path: unc, reason: 'file URL with remote host (UNC)' };
    } catch {
        return { kind: 'deny', reason: 'malformed file URL' };
    }
}
