import { describe, expect, it } from 'vitest';
import { parsePipParams } from '../src/pip/params';

describe('parsePipParams', () => {
    it('decodes values once and keeps a literal percent sign', () => {
        const p = parsePipParams('?url=https%3A%2F%2Fexample.com%2Fa&title=100%25%20Pure');
        expect(p.url).toBe('https://example.com/a');
        expect(p.title).toBe('100% Pure');
    });

    it('does not throw on a raw percent that is not an escape', () => {
        expect(() => parsePipParams('?title=100%')).not.toThrow();
        expect(parsePipParams('?title=100%').title).toBe('100%');
    });

    it('uses defaults when params are missing', () => {
        expect(parsePipParams('')).toEqual({ url: '', title: 'PIP Video', albumArt: '' });
    });
});
