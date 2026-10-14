import { describe, expect, it } from 'vitest';
import { decidePermission } from '../electron/lib/permissions.cjs';

const PROD = { isDev: false, devOrigin: 'http://localhost:5173' };
const DEV = { isDev: true, devOrigin: 'http://localhost:5173' };

describe('decidePermission', () => {
    it('allows clipboard writes for the main app on trusted origins', () => {
        expect(decidePermission('clipboard-sanitized-write', 'file:///C:/app/dist/index.html', PROD, true)).toBe(true);
        expect(decidePermission('clipboard-sanitized-write', 'http://localhost:5173/', DEV, true)).toBe(true);
    });

    it.each([
        'media',
        'audioCapture',
        'videoCapture',
        'display-capture',
        'notifications',
        'geolocation',
        'clipboard-read',
        'fullscreen',
        'openExternal',
        'fileSystem',
        'idle-detection',
        'window-management',
        '',
    ])('denies %s by default', (permission) => {
        expect(decidePermission(permission, 'file:///C:/app/dist/index.html', PROD, true)).toBe(false);
    });

    it('denies everything for non-main webContents', () => {
        expect(decidePermission('clipboard-sanitized-write', 'file:///x/index.html', PROD, false)).toBe(false);
    });

    it('denies untrusted or malformed origins', () => {
        expect(decidePermission('clipboard-sanitized-write', 'https://evil.example/', PROD, true)).toBe(false);
        expect(decidePermission('clipboard-sanitized-write', 'http://localhost.evil.example/', PROD, true)).toBe(false);
        expect(decidePermission('clipboard-sanitized-write', 'not a url', PROD, true)).toBe(false);
        expect(decidePermission('clipboard-sanitized-write', '', PROD, true)).toBe(false);
    });

    it('applies the navigation-style origin policy', () => {
        const p = 'clipboard-sanitized-write';
        expect(decidePermission(p, 'http://localhost:9999/', PROD, true)).toBe(false);
        expect(decidePermission(p, 'http://localhost:5173/', PROD, true)).toBe(false);
        expect(decidePermission(p, 'file://server/share/x.html', PROD, true)).toBe(false);
        expect(decidePermission(p, 'https://localhost:5173/', DEV, true)).toBe(false);
        expect(decidePermission(p, 'http://localhost:9999/', DEV, true)).toBe(false);
        expect(decidePermission(p, 'file:///C:/app/index.html', DEV, true)).toBe(false);
    });

    it('denies non-string input', () => {
        expect(decidePermission(undefined, 'file:///x', PROD, true)).toBe(false);
        expect(decidePermission('clipboard-sanitized-write', null, PROD, true)).toBe(false);
    });
});
