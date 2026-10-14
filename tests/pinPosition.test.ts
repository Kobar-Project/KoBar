import { describe, expect, it } from 'vitest';
import { isSaneWindowRect, parsePinPositionReply } from '../electron/lib/pinPosition.cjs';
import { readMainModule } from './helpers/mainSource';

describe('parsePinPositionReply', () => {
    it('parses a valid POS reply into a rect', () => {
        expect(parsePinPositionReply('POS:100,50,900,650')).toEqual({ kind: 'pos', rect: { x: 100, y: 50, width: 800, height: 600 } });
        expect(parsePinPositionReply('  POS:0,0,1920,1080\r')).toEqual({ kind: 'pos', rect: { x: 0, y: 0, width: 1920, height: 1080 } });
    });
    it('accepts negative coordinates (monitors left of / above the primary)', () => {
        expect(parsePinPositionReply('POS:-1920,-40,-1120,560')).toEqual({
            kind: 'pos',
            rect: { x: -1920, y: -40, width: 800, height: 600 },
        });
    });
    it('parses HIDDEN and LOST', () => {
        expect(parsePinPositionReply('HIDDEN')).toEqual({ kind: 'hidden' });
        expect(parsePinPositionReply('LOST\r')).toEqual({ kind: 'lost' });
    });
    it('rejects malformed replies', () => {
        for (const bad of [
            '',
            'POS:',
            'POS:1,2,3',
            'POS:1,2,3,4,5',
            'POS:a,b,c,d',
            'POS:1.5,2,3,4',
            'xPOS:1,2,30,40',
            'POS:1,2,30,40 junk',
            'hidden',
            'PINNED:5',
        ]) {
            expect(parsePinPositionReply(bad)).toEqual({ kind: 'invalid' });
        }
        expect(parsePinPositionReply(null)).toEqual({ kind: 'invalid' });
        expect(parsePinPositionReply(undefined)).toEqual({ kind: 'invalid' });
    });
    it('rejects empty, inverted and huge rects', () => {
        expect(parsePinPositionReply('POS:10,10,10,100')).toEqual({ kind: 'invalid' });
        expect(parsePinPositionReply('POS:100,10,10,100')).toEqual({ kind: 'invalid' });
        expect(parsePinPositionReply('POS:0,0,200000,100')).toEqual({ kind: 'invalid' });
        expect(parsePinPositionReply('POS:999999,0,1000100,100')).toEqual({ kind: 'invalid' });
        expect(parsePinPositionReply('POS:99999999999,0,1,1')).toEqual({ kind: 'invalid' });
    });
});

describe('isSaneWindowRect', () => {
    it('checks size and coordinate bounds', () => {
        expect(isSaneWindowRect({ x: -32000, y: -32000, width: 160, height: 28 })).toBe(true);
        expect(isSaneWindowRect({ x: 0, y: 0, width: 0, height: 10 })).toBe(false);
        expect(isSaneWindowRect({ x: 0, y: 0, width: 10, height: -1 })).toBe(false);
        expect(isSaneWindowRect({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBe(false);
        expect(isSaneWindowRect({ x: 200000, y: 0, width: 10, height: 10 })).toBe(false);
    });
});

describe('PowerShell position protocol (T-147)', () => {
    // T-309: the Add-Type startup script lives in services/native.cts (the bridge), the tracker script in services/pin.cts.
    const main = readMainModule('services/native.cts');
    const pin = readMainModule('services/pin.cts');
    const k = main.slice(main.indexOf('Add-Type -TypeDefinition'), main.indexOf('Add-Type -TypeDefinition') + 6000);
    const typeDef = k.slice(0, k.indexOf("}'\\n[K]::InitDpi()"));

    it('reads the visible DWM frame bounds with a GetWindowRect fallback', () => {
        expect(typeDef.slice(typeDef.indexOf('public class K'))).not.toContain("'");
        expect(typeDef).toContain('DwmGetWindowAttribute');
        expect(typeDef).toContain('dwmapi.dll');
        expect(typeDef).toMatch(/DwmGetWindowAttribute\(h, 9,/);
        expect(typeDef).toContain('GetWindowRect(h, out r)');
        expect(typeDef).toMatch(/DwmGetWindowAttribute\(h, 14,/);
    });
    it('makes the PowerShell process per-monitor DPI aware before any rect call', () => {
        expect(typeDef).toContain('SetProcessDpiAwarenessContext');
        expect(typeDef).toContain('SetProcessDPIAware');
        expect(typeDef).toContain('SetProcessDpiAwareness(2)');
        const at = main.indexOf('Add-Type -TypeDefinition');
        const end = main.indexOf('`', at);
        expect(end).toBeGreaterThan(at);
        const write = main.slice(at, end);
        expect(typeDef).toMatch(/SetProcessDpiAwarenessContext\(new IntPtr\(-4\)\)/);
        expect(write.indexOf('[K]::InitDpi()')).toBeGreaterThan(write.indexOf('public class K'));
    });
    it('the tracker script answers POS, HIDDEN or LOST and interpolates only numbers', () => {
        const start = pin.indexOf('function startWindowTracking(');
        const tracking = pin.slice(start, pin.indexOf('function stopWindowTracking('));
        const script = tracking.slice(tracking.search(/psRequest\(\s*\(id\) =>\s*`/), tracking.indexOf("` + '\\n'"));
        expect(script).toContain('IsWindow');
        expect(script).toContain('IsIconic');
        expect(script).toContain('IsWindowVisible');
        expect(script).toContain('|HIDDEN');
        expect(script).toContain('|LOST');
        expect(script).toContain('GetVisibleRect');
        expect(script).not.toContain('GetWindowRect');
        expect(tracking).toContain('parsePinPositionReply(output)');
    });
});
