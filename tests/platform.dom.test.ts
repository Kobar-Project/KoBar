// MAC-022: the <html data-platform> helper, the summary field and the PiP query parsing.
import { afterEach, describe, expect, it } from 'vitest';
import { getDocumentPlatform, isMacPlatform, normalizePlatform, setDocumentPlatform } from '../src/platform';
import { parsePipPlatform } from '../src/pip/params';
import { sanitizeSystemSummary } from '../src/store/systemSummary';

afterEach(() => setDocumentPlatform(null));

describe('platform helper', () => {
    it('normalizes only the three known names', () => {
        expect(normalizePlatform('darwin')).toBe('darwin');
        expect(normalizePlatform('win32')).toBe('win32');
        expect(normalizePlatform('linux')).toBe('linux');
        expect(normalizePlatform('freebsd')).toBeNull();
        expect(normalizePlatform(undefined)).toBeNull();
        expect(normalizePlatform(3)).toBeNull();
    });

    it('sets, reads and removes data-platform', () => {
        expect(getDocumentPlatform()).toBeNull();
        setDocumentPlatform('darwin');
        expect(document.documentElement.dataset.platform).toBe('darwin');
        expect(isMacPlatform()).toBe(true);
        setDocumentPlatform('win32');
        expect(isMacPlatform()).toBe(false);
        setDocumentPlatform(null);
        expect(document.documentElement.hasAttribute('data-platform')).toBe(false);
    });
});

describe('platform in the summary and the PiP query', () => {
    const base = { version: '1', updatesEnabled: true, update: {}, backup: {} };
    it('sanitizeSystemSummary keeps only a known platform', () => {
        expect(sanitizeSystemSummary({ ...base, platform: 'darwin' })?.platform).toBe('darwin');
        expect(sanitizeSystemSummary({ ...base, platform: 'plan9' })).not.toHaveProperty('platform');
        expect(sanitizeSystemSummary(base)).not.toHaveProperty('platform');
    });

    it('parsePipPlatform reads the query', () => {
        expect(parsePipPlatform('?url=x&platform=darwin')).toBe('darwin');
        expect(parsePipPlatform('?platform=bogus')).toBeNull();
        expect(parsePipPlatform('')).toBeNull();
    });
});
