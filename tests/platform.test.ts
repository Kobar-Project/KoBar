import { describe, expect, it } from 'vitest';
import { topmostLevelFor } from '../electron/lib/platform.cjs';

describe('topmostLevelFor', () => {
    it('keeps screen-saver on Windows and Linux', () => {
        expect(topmostLevelFor('win32')).toBe('screen-saver');
        expect(topmostLevelFor('linux')).toBe('screen-saver');
    });
    it('uses floating on macOS', () => {
        expect(topmostLevelFor('darwin')).toBe('floating');
    });
    it('defaults to screen-saver elsewhere', () => {
        expect(topmostLevelFor('freebsd')).toBe('screen-saver');
    });
});
