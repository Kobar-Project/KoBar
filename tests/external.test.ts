import { describe, expect, it } from 'vitest';
import { classifyExternalUrl, classifyLaunchTarget, describeUrlForDialog, truncateForDialog } from '../electron/lib/external.cjs';

const kind = (raw: unknown) => classifyExternalUrl(raw).kind;

describe('classifyExternalUrl', () => {
    it.each([
        'https://kobar.org',
        'HTTP://Example.com/a?b=c',
        'mailto:hello@kobar.org',
        'mailto:?subject=Hi%20there&body=a%0Ab',
        'tel:+905551112233',
        'sip:alice@example.com',
        'zoommtg://zoom.us/join?confno=1',
        'zoomus://zoom.us/join?confno=1',
        'msteams://teams.microsoft.com/l/meetup-join/x',
        'webex://meet/x',
        'https://bücher.example/pfad',
        'https://example.com/' + 'a'.repeat(1000),
        'mailto:a@b.co?body=' + 'x'.repeat(10000),
    ])('allows %s', (u) => expect(kind(u)).toBe('allow'));

    it.each(['ftp://example.com/x', 'ms-settings:network', 'steam://run/1', 'slack://open'])('asks for %s', (u) =>
        expect(kind(u)).toBe('confirm')
    );

    it.each([
        'file:///C:/Windows/System32/calc.exe',
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        '\tjavascript:alert(1)',
        ' https://example.com',
        'java\nscript:alert(1)',
        'java\u0000script:alert(1)',
        'data:text/html,<script>1</script>',
        'vbscript:msgbox(1)',
        'ms-msdt:/id PCWDiagnostic',
        String.raw`search-ms:query=x&crumb=location:\\evil\share`,
        'ms-officecmd:{}',
        'ms-excel:ofe|u|https://evil/x.xlsx',
        'ms-appinstaller:?source=https://evil/x.msix',
        '//evil/share',
        String.raw`\\evil\share`,
        String.raw`C:\Windows\notepad.exe`,
        'example.com',
        'meet.google.com/abc-defg',
        'http://user:pass@host.example/',
        'https://user@host.example/',
        'https://example.com/' + 'a'.repeat(40000),
        'https://example.com/"onload=x',
        'https://example.com/<b>',
        'hcp://system/sysinfo/x',
        'its:x.chm::/a.htm',
        'ms-itss:x.chm::/a.htm',
        'jnlp:http://evil/x.jnlp',
        'jnlps://evil/x.jnlp',
        '',
        '   ',
        undefined,
        null,
        42,
    ])('denies %j', (u) => expect(kind(u)).toBe('deny'));

    it('returns the parsed URL for allowed input', () => {
        const d = classifyExternalUrl('zoommtg://zoom.us/join?confno=1');
        expect(d.kind === 'allow' && d.url.host).toBe('zoom.us');
    });

    it('describes URLs without query and truncates long paths', () => {
        const d = classifyExternalUrl('slack://open/path?token=secret');
        expect(d.kind === 'confirm' && describeUrlForDialog(d.url)).toBe('slack://open/path');
        const long = new URL('https://example.com/' + 'a'.repeat(500));
        const text = describeUrlForDialog(long);
        expect(text.length).toBeLessThanOrEqual(123);
        expect(text.endsWith('...')).toBe(true);
    });

    it('strips control and bidi override characters from dialog text', () => {
        expect(truncateForDialog('a‮b⁦c⁩d‎e‏f\u0007g')).toBe('abcdefg');
    });
});

describe('classifyLaunchTarget', () => {
    it.each([String.raw`C:\Program Files\App\app.exe`, 'c:/Users/me/Desktop/x.lnk', String.raw`D:\Folder With Space`, '/usr/bin/env'])(
        'opens local path %s',
        (p) => expect(classifyLaunchTarget(p).kind).toBe('path')
    );

    it.each([String.raw`\\server\share\file.txt`, '//server/share/file.txt'])('confirms UNC %s', (p) =>
        expect(classifyLaunchTarget(p).kind).toBe('confirm-path')
    );

    it('routes http(s) to the URL classifier', () => {
        const d = classifyLaunchTarget('https://example.com/x');
        expect(d.kind === 'url' && d.decision.kind).toBe('allow');
        const bad = classifyLaunchTarget('http://user:pw@example.com/');
        expect(bad.kind).toBe('deny');
    });

    it.each([
        String.raw`relative\path.exe`,
        './x.exe',
        String.raw`..\x.exe`,
        'notepad.exe',
        'javascript:alert(1)',
        'ms-msdt:/id x',
        String.raw`\\?\C:\x`,
        String.raw`\\.\pipe\x`,
        '///x',
        String.raw`\foo`,
        'C:foo',
        'C:\\x\u0000.exe',
        'C:\\x\n.exe',
        '',
        undefined,
        {},
    ])('denies %j', (p) => expect(classifyLaunchTarget(p).kind).toBe('deny'));

    it.each(['mailto:a@b.co', 'steam://run/1', 'ms-settings:network', 'HTTPS://x', 'http://x'])('routes %s through the URL gate', (p) =>
        expect(classifyLaunchTarget(p).kind).toBe('url')
    );

    it.runIf(process.platform === 'win32')('maps file: URLs onto local paths or UNC', () => {
        const local = classifyLaunchTarget('file:///C:/x.lnk');
        expect(local.kind === 'path' && local.path).toBe(String.raw`C:\x.lnk`);
        expect(classifyLaunchTarget('file://localhost/C:/x.lnk').kind).toBe('path');
        const unc = classifyLaunchTarget('file://host/share/a.lnk');
        expect(unc.kind === 'confirm-path' && unc.path).toBe(String.raw`\\host\share\a.lnk`);
        expect(classifyLaunchTarget('file://host/share/x.exe').kind).toBe('confirm-path');
    });

    it.each(['file://./pipe/x', 'file://./C:/Windows/System32/cmd.exe', 'file://host/a%00b', 'file://host/a%0a'])(
        'denies file URL %s that decodes to a device path or control character',
        (p) => expect(classifyLaunchTarget(p).kind).toBe('deny')
    );

    it('opens paths with spaces and unicode', () => {
        expect(classifyLaunchTarget(String.raw`C:\a\b.lnk`).kind).toBe('path');
        expect(classifyLaunchTarget('C:/a b/\u00fc.exe').kind).toBe('path');
    });

    it('still denies dangerous schemes', () => {
        expect(classifyLaunchTarget('javascript:alert(1)').kind).toBe('deny');
        expect(classifyLaunchTarget('ms-msdt:/id').kind).toBe('deny');
    });
});
