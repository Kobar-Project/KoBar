// T-131: pure helpers for the CSP diagnostic mode (no Electron imports, unit-testable).
// Builds the proposed policy (no remote font hosts since T-506), turns browser
// violation data into small, redacted records and appends them to a size-capped JSONL file.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const CSP_CONSOLE_PREFIX = '__KOBAR_CSP__';
export const CSP_REPORT_MAX_BYTES = 1024 * 1024;
export const CSP_REPORT_FILE_NAME = 'csp-report.jsonl';

/**
 * The proposed policy. Directive order is stable so tests and the report can quote it.
 * T-506: all fonts (Material Symbols, the Space Grotesk alias) are bundled locally, so no Google Fonts hosts are allowed.
 */
export function buildCspPolicy(): string {
    const directives: Array<[string, string[]]> = [
        ['default-src', ["'self'"]],
        ['script-src', ["'self'", 'blob:']],
        ['style-src', ["'self'", "'unsafe-inline'"]],
        ['font-src', ["'self'", 'data:']],
        ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
        ['connect-src', ["'self'", 'https:', 'http://localhost:*']],
        ['frame-src', ['https://www.youtube.com', 'https://www.youtube-nocookie.com']],
        ['object-src', ["'none'"]],
        ['base-uri', ["'none'"]],
        ['form-action', ["'none'"]],
    ];
    return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

export interface CspViolationRecord {
    timestamp: string;
    documentURI: string;
    violatedDirective: string;
    effectiveDirective: string;
    blockedURI: string;
    sourceFile: string;
    lineNumber: number;
    disposition: string;
    origin: 'event' | 'console';
    /** Which policy delivery path was active for the page (set by main): Report-Only header, injected meta, or none. */
    via?: 'header' | 'meta' | 'none';
}

const MAX_FIELD = 300;

function clip(value: unknown): string {
    return typeof value === 'string' ? value.slice(0, MAX_FIELD) : '';
}

/** Reduces a URL to origin + path (no query, hash or credentials). file:// paths lose the drive/user prefix. Non-URLs pass through clipped. */
export function redactUrl(raw: unknown): string {
    const text = clip(raw).trim();
    if (!text) return '';
    // CSP uses keywords for non-URL cases: "inline", "eval", "self", "data", "blob" ...
    // Raw Windows paths (drive letter + backslash) would otherwise look like a URL scheme: keep only the basename.
    if (/^[a-z]:[\\/]/i.test(text)) return '/<path>/' + (text.split(/[\\/]/).pop() ?? '');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
    if (/^data:/i.test(text)) return 'data:';
    if (/^blob:/i.test(text)) {
        try {
            return 'blob:' + new URL(text.slice(5)).origin;
        } catch {
            return 'blob:';
        }
    }
    try {
        const u = new URL(text);
        if (u.protocol === 'file:') {
            let decoded = u.pathname;
            try {
                decoded = decodeURIComponent(u.pathname);
            } catch {
                // malformed escape: keep the undecoded pathname
            }
            const marker = decoded.toLowerCase().lastIndexOf('/dist/');
            return 'file://' + (marker >= 0 ? '<app>' + decoded.slice(marker) : '/<path>/' + decoded.split('/').pop());
        }
        if (u.origin === 'null') return u.protocol;
        return u.origin + u.pathname;
    } catch {
        return '<unparsed>';
    }
}

/** Normalises one violation (from a `securitypolicyviolation` event or a console line). Returns null when it is unusable. */
export function sanitizeViolation(raw: unknown, now: Date = new Date(), origin: 'event' | 'console' = 'event'): CspViolationRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const violatedDirective = clip(r.violatedDirective);
    const effectiveDirective = clip(r.effectiveDirective);
    if (!violatedDirective && !effectiveDirective) return null;
    const line = typeof r.lineNumber === 'number' && Number.isFinite(r.lineNumber) ? Math.max(0, Math.floor(r.lineNumber)) : 0;
    return {
        timestamp: now.toISOString(),
        documentURI: redactUrl(r.documentURI),
        violatedDirective,
        effectiveDirective,
        blockedURI: redactUrl(r.blockedURI),
        sourceFile: redactUrl(r.sourceFile),
        lineNumber: line,
        disposition: clip(r.disposition) || 'report',
        origin,
    };
}

/** Parses a console message that starts with the page-side prefix. Returns null for anything else. */
export function parseConsoleViolation(message: unknown, now: Date = new Date()): CspViolationRecord | null {
    if (typeof message !== 'string' || !message.startsWith(CSP_CONSOLE_PREFIX)) return null;
    try {
        return sanitizeViolation(JSON.parse(message.slice(CSP_CONSOLE_PREFIX.length)), now, 'event');
    } catch {
        return null;
    }
}

/**
 * Best-effort parse of Chromium's own console line, e.g.
 * `Refused to load the stylesheet 'https://x/y.css' because it violates the following Content Security Policy directive: "style-src 'self'". ...`
 * (prefixed with `[Report Only] ` in report-only mode). Catches violations that happen before the page listener is installed.
 */
export function parseChromiumCspConsole(
    message: unknown,
    sourceId: unknown,
    line: unknown,
    now: Date = new Date()
): CspViolationRecord | null {
    if (typeof message !== 'string') return null;
    const ev =
        /^(\[Report Only\] )?Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "([^"]*)"/.exec(
            message
        );
    if (ev) {
        const directive = ev[2].split(/\s+/)[0] ?? '';
        return sanitizeViolation(
            {
                violatedDirective: directive,
                effectiveDirective: directive,
                blockedURI: 'eval',
                sourceFile: sourceId,
                lineNumber: line,
                disposition: ev[1] ? 'report' : 'enforce',
            },
            now,
            'console'
        );
    }
    const m =
        /^(\[Report Only\] )?Refused to ([^']*?)(?: '([^']*)')? because it violates the following Content Security Policy directive: "([^"]*)"/.exec(
            message
        );
    if (!m) return null;
    const directive = m[4].split(/\s+/)[0] ?? '';
    return sanitizeViolation(
        {
            violatedDirective: directive,
            effectiveDirective: directive,
            blockedURI: m[3] ?? (/inline/i.test(m[2]) ? 'inline' : /eval|string/i.test(m[2]) ? 'eval' : ''),
            sourceFile: sourceId,
            lineNumber: line,
            disposition: m[1] ? 'report' : 'enforce',
        },
        now,
        'console'
    );
}

/** Appends one JSON line unless the file would grow past `maxBytes`. Never throws. Returns true when written. */
export function appendCapped(file: string, record: CspViolationRecord, maxBytes: number = CSP_REPORT_MAX_BYTES): boolean {
    try {
        const line = JSON.stringify(record) + '\n';
        let size = 0;
        try {
            size = fs.statSync(file).size;
        } catch {
            fs.mkdirSync(path.dirname(file), { recursive: true });
        }
        if (size + Buffer.byteLength(line) > maxBytes) return false;
        fs.appendFileSync(file, line, 'utf8');
        return true;
    } catch {
        return false;
    }
}

/** The page-side script: reports every violation through the console with the prefix, using only the event fields. */
export function buildPageListenerScript(): string {
    return `(() => {
  if (window.__kobarCspListener) return;
  window.__kobarCspListener = true;
  document.addEventListener('securitypolicyviolation', (e) => {
    try {
      console.log(${JSON.stringify(CSP_CONSOLE_PREFIX)} + JSON.stringify({
        documentURI: e.documentURI, violatedDirective: e.violatedDirective, effectiveDirective: e.effectiveDirective,
        blockedURI: e.blockedURI, sourceFile: e.sourceFile, lineNumber: e.lineNumber, disposition: e.disposition
      }));
    } catch (_) {}
  });
})();`;
}

/** Script that inserts an enforced CSP meta as early as possible (fallback for file:// pages only). */
export function buildMetaInjectionScript(policy: string): string {
    return `(() => {
  if (document.querySelector('meta[data-kobar-csp-diag]')) return;
  const m = document.createElement('meta');
  m.httpEquiv = 'Content-Security-Policy';
  m.content = ${JSON.stringify(policy)};
  m.setAttribute('data-kobar-csp-diag', '1');
  (document.head || document.documentElement).prepend(m);
})();`;
}
