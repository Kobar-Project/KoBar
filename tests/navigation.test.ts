import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isAllowedNavigation } from '../electron/lib/navigation.cjs';

const devOrigin = 'http://localhost:5173';
const appFileUrls = [
    'file:///C:/Program%20Files/KoBar/resources/app/dist/index.html',
    'file:///C:/Program%20Files/KoBar/resources/app/dist/pip.html',
];
const dev = { isDev: true, appFileUrls, devOrigin };
const prod = { isDev: false, appFileUrls, devOrigin };

describe('isAllowedNavigation (dev)', () => {
    it.each([
        'http://localhost:5173',
        'http://localhost:5173/',
        'http://localhost:5173/?foo=1&url=x',
        'http://localhost:5173/pip.html',
        'http://localhost:5173/pip.html?url=https%3A%2F%2Fa.b%2Fc&title=100%25%20Pure',
        'http://localhost:5173/#/a',
        'HTTP://LOCALHOST:5173/',
    ])('allows %s', (u) => expect(isAllowedNavigation(u, dev)).toBe(true));

    it.each([
        'http://localhost:5174/',
        'http://localhost:5173.evil.com/',
        'http://localhost:5173@evil.com/',
        'http://user:pw@localhost:5173/',
        'http://evil.com/',
        'https://localhost:5173/',
        'file:///etc/passwd',
        'about:blank',
        'data:text/html,hi',
        'javascript:alert(1)',
        'not a url',
        '',
    ])('blocks %s', (u) => expect(isAllowedNavigation(u, dev)).toBe(false));
});

describe('isAllowedNavigation (prod)', () => {
    it.each([
        'file:///C:/Program%20Files/KoBar/resources/app/dist/index.html',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/index.html?foo=1&url=x',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/pip.html',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/pip.html?url=x&title=100%25%20Pure#h',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/index.html#/x',
        'FILE:///C:/Program%20Files/KoBar/resources/app/dist/index.html',
    ])('allows %s', (u) => expect(isAllowedNavigation(u, prod)).toBe(true));

    it.each([
        'file:///etc/passwd',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/other.html',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/pip.html.evil',
        'file:///C:/Program%20Files/KoBar/resources/app/dist/assets/pip.html',
        'file://server/share/index.html',
        'http://localhost:5173/',
        'https://example.com/',
        'about:blank',
        'data:text/html,hi',
        'javascript:alert(1)',
        'kobar://x',
        null,
        undefined,
        42,
    ])('blocks %s', (u) => expect(isAllowedNavigation(u, prod)).toBe(false));
});

describe('isAllowedNavigation (win32 canonical file URL)', () => {
    it('matches the pathToFileURL form for paths with spaces and non-ASCII', () => {
        const p = String.raw`C:\Users\Gökhan Ş\AppData\Local\Programs\KoBar\resources\app.asar\dist\index.html`;
        const href = pathToFileURL(p, { windows: true }).href;
        const policy = { isDev: false, appFileUrls: [href], devOrigin };
        expect(isAllowedNavigation(href, policy)).toBe(true);
        expect(isAllowedNavigation(href + '?foo=1#x', policy)).toBe(true);
        expect(isAllowedNavigation(href.replace('index.html', 'x.html'), policy)).toBe(false);
    });
});
