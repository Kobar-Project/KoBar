import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// MAC-013: the macOS menu bar template icons must exist, be real PNGs and have the sizes Electron expects (18 px and the @2x sibling at 36 px).
function pngSize(file: string): { width: number; height: number } {
    const buf = readFileSync(join(__dirname, '..', 'build', file));
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('tray template icons', () => {
    it('trayTemplate.png is an 18x18 PNG', () => {
        expect(pngSize('trayTemplate.png')).toEqual({ width: 18, height: 18 });
    });
    it('trayTemplate@2x.png is a 36x36 PNG', () => {
        expect(pngSize('trayTemplate@2x.png')).toEqual({ width: 36, height: 36 });
    });
});
