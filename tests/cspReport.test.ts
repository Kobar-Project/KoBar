import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    CSP_CONSOLE_PREFIX,
    appendCapped,
    buildCspPolicy,
    buildMetaInjectionScript,
    buildPageListenerScript,
    parseChromiumCspConsole,
    parseConsoleViolation,
    redactUrl,
    sanitizeViolation,
} from '../electron/lib/cspReport.cts';

// T-131: CSP diagnostic helpers. Pure, temp dirs only.

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kobar-csp-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-01-02T03:04:05.000Z');

describe('buildCspPolicy', () => {
    it('contains the proposed directives', () => {
        const p = buildCspPolicy();
        expect(p).toContain("default-src 'self'");
        expect(p).toContain("script-src 'self' blob:");
        expect(p).toContain("style-src 'self' 'unsafe-inline';");
        expect(p).toContain("font-src 'self' data:;");
        expect(p).toContain("object-src 'none'");
        expect(p).toContain('frame-src https://www.youtube.com https://www.youtube-nocookie.com');
        expect(p).not.toContain('unsafe-eval');
    });
    it('allows no Google Fonts hosts (T-506: fonts are bundled locally)', () => {
        const p = buildCspPolicy();
        expect(p).not.toContain('googleapis');
        expect(p).not.toContain('gstatic');
    });
});

describe('redactUrl', () => {
    it('strips query, hash and credentials from http URLs', () => {
        expect(redactUrl('https://user:pw@api.example.com/v1/x?key=SECRET#frag')).toBe('https://api.example.com/v1/x');
    });
    it('keeps CSP keywords and collapses data/blob', () => {
        expect(redactUrl('inline')).toBe('inline');
        expect(redactUrl('eval')).toBe('eval');
        expect(redactUrl('data:image/png;base64,AAAA')).toBe('data:');
        expect(redactUrl('blob:http://localhost:5173/abc-123')).toBe('blob:http://localhost:5173');
    });
    it('hides the user path of file URLs', () => {
        expect(redactUrl('file:///C:/Users/bob/App/resources/app/dist/index.html?x=1')).toBe('file://<app>/dist/index.html');
        expect(redactUrl('file:///C:/Users/bob/secret/a.png')).toBe('file:///<path>/a.png');
    });
    it('does not leak the path when percent-decoding fails', () => {
        const out = redactUrl('file:///C:/Users/bob/%E0%A4%A/secret.txt');
        expect(out).not.toContain('bob');
        expect(out).toBe('file:///<path>/secret.txt');
    });
    it('treats raw Windows paths as file paths', () => {
        expect(redactUrl('C:\\Users\\bob\\x.js')).toBe('/<path>/x.js');
        expect(redactUrl('D:/Users/bob/y.js')).toBe('/<path>/y.js');
    });
    it('returns only the protocol for opaque origins', () => {
        expect(redactUrl('about:blank')).toBe('about:');
    });
    it('returns <unparsed> for unparsable URLs', () => {
        expect(redactUrl('http://')).toBe('<unparsed>');
    });
    it('handles junk', () => {
        expect(redactUrl(undefined)).toBe('');
        expect(redactUrl('x'.repeat(1000)).length).toBe(300);
    });
});

describe('sanitizeViolation', () => {
    it('builds a normalised record', () => {
        const r = sanitizeViolation(
            {
                documentURI: 'http://localhost:5173/?a=1',
                violatedDirective: 'img-src',
                effectiveDirective: 'img-src',
                blockedURI: 'http://evil.test/p.png?token=1',
                sourceFile: 'http://localhost:5173/src/x.tsx?t=9',
                lineNumber: 12.7,
                disposition: 'report',
            },
            NOW
        );
        expect(r).toEqual({
            timestamp: '2026-01-02T03:04:05.000Z',
            documentURI: 'http://localhost:5173/',
            violatedDirective: 'img-src',
            effectiveDirective: 'img-src',
            blockedURI: 'http://evil.test/p.png',
            sourceFile: 'http://localhost:5173/src/x.tsx',
            lineNumber: 12,
            disposition: 'report',
            origin: 'event',
        });
    });
    it('rejects unusable input', () => {
        expect(sanitizeViolation(null)).toBeNull();
        expect(sanitizeViolation('x')).toBeNull();
        expect(sanitizeViolation({})).toBeNull();
    });
});

describe('console parsing', () => {
    it('parses the page-side prefixed message', () => {
        const msg = CSP_CONSOLE_PREFIX + JSON.stringify({ violatedDirective: 'script-src-elem', blockedURI: 'inline', lineNumber: 3 });
        expect(parseConsoleViolation(msg, NOW)?.blockedURI).toBe('inline');
    });
    it('ignores other messages and bad JSON', () => {
        expect(parseConsoleViolation('hello')).toBeNull();
        expect(parseConsoleViolation(CSP_CONSOLE_PREFIX + '{nope')).toBeNull();
        expect(parseConsoleViolation(42)).toBeNull();
    });
    it('parses a Chromium report-only line', () => {
        const msg = `[Report Only] Refused to load the stylesheet 'https://cdn.x.com/a.css?v=1' because it violates the following Content Security Policy directive: "style-src 'self'". Note that...`;
        const r = parseChromiumCspConsole(msg, 'http://localhost:5173/', 4, NOW);
        expect(r).toMatchObject({
            violatedDirective: 'style-src',
            blockedURI: 'https://cdn.x.com/a.css',
            disposition: 'report',
            origin: 'console',
            lineNumber: 4,
        });
    });
    it('parses the Chromium eval line as blockedURI eval', () => {
        const msg = `Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "script-src 'self' blob:".`;
        expect(parseChromiumCspConsole(msg, 'http://localhost:5173/x.js?v=2', 9, NOW)).toMatchObject({
            violatedDirective: 'script-src',
            blockedURI: 'eval',
            sourceFile: 'http://localhost:5173/x.js',
            disposition: 'enforce',
            origin: 'console',
        });
        expect(parseChromiumCspConsole('[Report Only] ' + msg, '', 0, NOW)?.disposition).toBe('report');
    });
    it('does not throw on other wordings or plain text', () => {
        expect(parseChromiumCspConsole('Refused to evaluate something else entirely', '', 0)).toBeNull();
        expect(parseChromiumCspConsole('plain', '', 0)).toBeNull();
    });
});

describe('appendCapped', () => {
    const rec = sanitizeViolation({ violatedDirective: 'img-src', blockedURI: 'https://a.test/x' }, NOW)!;
    it('creates parent dirs and appends JSON lines', () => {
        const file = join(dir, 'sub', 'csp-report.jsonl');
        expect(appendCapped(file, rec)).toBe(true);
        expect(appendCapped(file, rec)).toBe(true);
        const lines = readFileSync(file, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).blockedURI).toBe('https://a.test/x');
    });
    it('refuses to grow past the cap', () => {
        const file = join(dir, 'r.jsonl');
        writeFileSync(file, 'x'.repeat(95));
        expect(appendCapped(file, rec, 100)).toBe(false);
        expect(readFileSync(file, 'utf8')).toHaveLength(95);
    });
    it('never throws on an unwritable path', () => {
        const file = join(dir, 'a-file');
        writeFileSync(file, '');
        expect(appendCapped(join(file, 'nested', 'x.jsonl'), rec)).toBe(false);
    });
});

describe('page scripts', () => {
    it('listener script uses the prefix and the violation event', () => {
        const s = buildPageListenerScript();
        expect(s).toContain('securitypolicyviolation');
        expect(s).toContain(CSP_CONSOLE_PREFIX);
        expect(() => new Function(s)).not.toThrow();
    });
    it('meta script embeds the policy safely', () => {
        const s = buildMetaInjectionScript(`default-src 'self'`);
        expect(s).toContain(JSON.stringify(`default-src 'self'`));
        expect(() => new Function(s)).not.toThrow();
    });
});
