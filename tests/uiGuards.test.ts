import { describe, expect, it } from 'vitest';
import { isLoopbackUrl, sanitizeNotification, sanitizeVersion } from '../electron/lib/uiGuards.cjs';
import { readMainModule, readMainSources } from './helpers/mainSource';

describe('isLoopbackUrl', () => {
    it.each([
        'http://localhost:11434',
        'http://localhost:1234/v1',
        'https://LOCALHOST',
        'http://127.0.0.1:11434',
        'http://127.5.6.7/v1',
        'http://[::1]:11434',
        'http://2130706433:11434',
        'http://0x7f.0.0.1',
    ])('accepts %s', (u) => expect(isLoopbackUrl(u)).toBe(true));

    it.each([
        'http://localhost.:11434',
        'http://localhost.evil.com',
        'http://evil-localhost',
        'http://127.0.0.1.evil.com',
        'http://127.0.0.1@evil.com',
        'http://localhost:80@evil.com',
        'http://user:pw@127.0.0.1',
        'http://[::ffff:127.0.0.1]',
        'http://[::2]',
        'http://128.0.0.1',
        'http://0.0.0.0',
        'http://192.168.1.5:11434',
        'http://3232235777',
        'ftp://localhost',
        'file:///etc/passwd',
        'localhost:11434',
        'javascript:alert(1)',
        '',
        'not a url',
    ])('rejects %s', (u) => expect(isLoopbackUrl(u)).toBe(false));

    it('rejects non-strings', () => {
        for (const v of [undefined, null, 5, {}, ['http://localhost']]) expect(isLoopbackUrl(v)).toBe(false);
    });
});

describe('sanitizeNotification', () => {
    it('strips control characters and truncates', () => {
        const r = sanitizeNotification('Hi\u0000\n‮there', 'x'.repeat(1000));
        expect(r.title).toBe('Hi there');
        expect(r.body.length).toBe(300);
        const emoji = sanitizeNotification('x', '😀'.repeat(400)).body;
        expect(Array.from(emoji).length).toBe(300);
        expect(emoji).not.toMatch(/[�-�](?![�-�])/);
    });
    it('handles non-strings', () => {
        expect(sanitizeNotification(undefined, 5)).toEqual({ title: '', body: '' });
    });
});

describe('sanitizeVersion', () => {
    it('accepts plain versions only', () => {
        expect(sanitizeVersion('2.1.0')).toBe('2.1.0');
        expect(sanitizeVersion('v2.1.0-beta.1')).toBe('v2.1.0-beta.1');
        expect(sanitizeVersion('Install this now')).toBeNull();
        expect(sanitizeVersion('2.1.0\nClick yes')).toBeNull();
        expect(sanitizeVersion(7)).toBeNull();
    });
});

describe('T-122 wiring in main.cts', () => {
    // T-315: main.cts only wires; the registrations are in bootstrap.cts and app/lifecycle.cts (readMainSources covers all of them).
    const main = readMainSources();
    // T-307: the updater, notification and auto-launch handlers moved to electron/main/services/*.cts.
    const updater = readMainModule('services/updater.cts');
    const notifications = readMainModule('services/notifications.cts');
    const autoLaunch = readMainModule('services/autoLaunch.cts');
    const blockOf = (source: string) => (start: string, end: string) => {
        const s = source.indexOf(start);
        expect(s).toBeGreaterThan(-1);
        return source.slice(s, source.indexOf(end, s));
    };

    it('main.cts still registers the moved handlers', () => {
        expect(main).toMatch(/registerUpdaterIpc\(/);
        expect(main).toMatch(/setupUpdater\(\)/);
        expect(main).toMatch(/registerNotificationIpc\(\)/);
        expect(main).toMatch(/registerAutoLaunchIpc\(/);
    });

    it('ask-for-update uses fixed text and is gated', () => {
        const h = blockOf(updater)("ipcMain.handle('ask-for-update'", "ipcMain.on('download-and-install-update'");
        expect(h).toMatch(/canSelfUpdate/);
        expect(h).toMatch(/sanitizeVersion/);
        expect(h).not.toMatch(/title: title|message: message|yesLabel|noLabel/);
    });

    it('all updater IPCs check canSelfUpdate', () => {
        const block = blockOf(updater);
        for (const [s, e] of [
            ["ipcMain.on('download-and-install-update'", "ipcMain.on('quit-and-install-update'"],
            ["ipcMain.on('quit-and-install-update'", "ipcMain.handle('check-for-updates-manual'"],
            ["ipcMain.handle('check-for-updates-manual'", 'const result'],
        ])
            expect(block(s, e)).toMatch(/canSelfUpdate/);
    });

    it('notifications are sanitized and rate-limited', () => {
        const h = blockOf(notifications)("ipcMain.on('send-notification'", 'function showRateLimitedNotice');
        expect(h).toMatch(/notificationLimiter\.tryAcquire\(\)/);
        expect(h).toMatch(/sanitizeNotification/);
    });

    it('auto-launch asks before enabling and llm localUrl must be loopback', () => {
        const h = blockOf(autoLaunch)("ipcMain.on('set-auto-launch'", '\n}\n');
        expect(h).toMatch(/confirmWithUser/);
        // T-305: the request building (incl. the loopback check) moved to electron/main/lib/llmRequest.cts; main still calls it.
        expect(readMainSources()).toMatch(/isLoopbackUrl\(apiKeys\.localUrl\)/);
        // T-313: the call itself lives in electron/main/services/llm.cts.
        expect(readMainModule('services/llm.cts')).toMatch(/buildRequest\(/);
    });
});
