import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_ZIP_LIMITS,
    extractZipSafely,
    unsafeEntryName,
    validateZipEntries,
    type ZipEntryInfo,
    type ZipLimits,
} from '../electron/lib/zipGuards.cjs';

const file = (entryName: string, size = 10, attr?: number): ZipEntryInfo => ({ entryName, size, isDirectory: false, attr });

describe('unsafeEntryName', () => {
    it.each(['/etc/passwd', '\\evil.txt', 'C:\\x.txt', 'c:x', '\\\\server\\share\\a', '../a', 'a/../../b', 'a\\..\\b', 'a\0b', ''])(
        'rejects %j',
        (name) => {
            expect(unsafeEntryName(name)).not.toBeNull();
        }
    );
    it.each(['a:stream', 'a<b', 'a|b', 'a"b', 'a?b', 'a*b', 'dir/file.', 'dir/file ', 'con', 'NUL.txt', 'a/aux.js', 'x/COM1', 'lpt9.log'])(
        'rejects Windows-unsafe %j',
        (name) => {
            expect(unsafeEntryName(name)).not.toBeNull();
        }
    );
    it.each(['manifest.json', 'dist/index.js', 'sub/dir/', 'a..b/c.txt', './', './a.js', 'console.js', 'com10.txt', 'auxiliary/x'])(
        'accepts %j',
        (name) => {
            expect(unsafeEntryName(name)).toBeNull();
        }
    );
});

describe('validateZipEntries', () => {
    const limits: ZipLimits = { maxEntries: 3, maxEntryBytes: 100, maxTotalBytes: 150 };

    it('accepts a normal list, including regular-file unix attrs', () => {
        expect(validateZipEntries([file('a.js', 10, (0o100644 << 16) >>> 0), file('b/c.js')], limits).ok).toBe(true);
    });
    it('rejects too many entries', () => {
        expect(validateZipEntries([file('a'), file('b'), file('c'), file('d')], limits).ok).toBe(false);
    });
    it('rejects an oversized entry', () => {
        expect(validateZipEntries([file('a', 101)], limits).ok).toBe(false);
    });
    it('rejects an oversized total', () => {
        expect(validateZipEntries([file('a', 90), file('b', 90)], limits).ok).toBe(false);
    });
    it('rejects invalid sizes', () => {
        expect(validateZipEntries([file('a', -1)], limits).ok).toBe(false);
        expect(validateZipEntries([file('a', NaN)], limits).ok).toBe(false);
    });
    it('rejects symlink and special-file entries', () => {
        expect(validateZipEntries([file('l', 1, (0o120777 << 16) >>> 0)], limits).ok).toBe(false);
        expect(validateZipEntries([file('p', 1, (0o010644 << 16) >>> 0)], limits).ok).toBe(false);
    });
    it('rejects unsafe names', () => {
        expect(validateZipEntries([file('../x')], limits).ok).toBe(false);
        expect(validateZipEntries([file('/x')], limits).ok).toBe(false);
    });
    it('default limits leave headroom for official plugins', () => {
        const many = Array.from({ length: 600 }, (_, i) => file(`dist/f${i}.js`, 200 * 1024));
        expect(validateZipEntries(many).ok).toBe(true);
        expect(DEFAULT_ZIP_LIMITS.maxEntries).toBeGreaterThanOrEqual(1000);
    });
});

describe('extractZipSafely (real AdmZip)', () => {
    let tmp: string;
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobar-zip-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    // Round-trips through a file so the archive is parsed like a user-supplied one.
    const build = (fill: (z: AdmZip) => void): AdmZip => {
        const z = new AdmZip();
        fill(z);
        const p = path.join(tmp, 'in.zip');
        z.writeZip(p);
        return new AdmZip(p);
    };
    const out = () => path.join(tmp, 'out');

    it('extracts a normal archive', () => {
        const zip = build((z) => {
            z.addFile('manifest.json', Buffer.from('{"id":"x"}'));
            z.addFile('dist/index.js', Buffer.from('console.log(1)'));
        });
        extractZipSafely(zip, out());
        expect(fs.readFileSync(path.join(out(), 'dist', 'index.js'), 'utf8')).toBe('console.log(1)');
    });

    it('rejects a zip bomb (highly compressible entry over the limit)', () => {
        const zip = build((z) => z.addFile('big.bin', Buffer.alloc(2 * 1024 * 1024, 0)));
        const small: ZipLimits = { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
        expect(() => extractZipSafely(zip, out(), small)).toThrow(/too large/);
        expect(fs.existsSync(path.join(out(), 'big.bin'))).toBe(false);
    });

    // Builds a one-entry zip in memory, then rewrites the uncompressed size in the local and central headers.
    const buildLying = (method: number, data: Buffer, claimed: number): AdmZip => {
        const z = new AdmZip();
        z.addFile('a.bin', data);
        z.getEntry('a.bin')!.header.method = method;
        const buf = Buffer.from(z.toBuffer());
        const local = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        const central = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        buf.writeUInt32LE(claimed, local + 22);
        buf.writeUInt32LE(claimed, central + 24);
        return new AdmZip(buf);
    };
    const tiny: ZipLimits = { maxEntries: 10, maxEntryBytes: 100, maxTotalBytes: 1000 };

    it('enforces the limit on real bytes when a STORED entry header lies', () => {
        const zip = buildLying(0, Buffer.alloc(500, 7), 10);
        expect(zip.getEntries()[0].header.size).toBe(10);
        expect(() => extractZipSafely(zip, out(), tiny)).toThrow(/too large/);
        expect(fs.existsSync(path.join(out(), 'a.bin'))).toBe(false);
    });

    it('throws when a DEFLATED entry header lies about its size', () => {
        const zip = buildLying(8, Buffer.alloc(2 * 1024 * 1024, 0), 10);
        expect(() => extractZipSafely(zip, out(), tiny)).toThrow();
        expect(fs.existsSync(path.join(out(), 'a.bin'))).toBe(false);
    });

    it('skips a "./" directory entry and rejects Windows-unsafe names', () => {
        const ok = build((z) => {
            z.addFile('./', Buffer.alloc(0));
            z.addFile('a.txt', Buffer.from('x'));
        });
        extractZipSafely(ok, out());
        expect(fs.readFileSync(path.join(out(), 'a.txt'), 'utf8')).toBe('x');

        const bad = build((z) => z.addFile('nul.txt', Buffer.from('x')));
        expect(() => extractZipSafely(bad, path.join(tmp, 'out2'))).toThrow(/Unsafe/);
    });

    it('rejects when the total exceeds the limit across entries', () => {
        const zip = build((z) => {
            for (let i = 0; i < 4; i++) z.addFile(`f${i}.bin`, Buffer.alloc(600 * 1024, i));
        });
        const small: ZipLimits = { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 };
        expect(() => extractZipSafely(zip, out(), small)).toThrow(/too large/);
    });

    it('rejects too many entries', () => {
        const zip = build((z) => {
            for (let i = 0; i < 5; i++) z.addFile(`f${i}.txt`, Buffer.from('x'));
        });
        expect(() => extractZipSafely(zip, out(), { ...DEFAULT_ZIP_LIMITS, maxEntries: 4 })).toThrow(/too many/);
    });

    it('rejects a symlink entry', () => {
        const zip = build((z) => {
            z.addFile('link', Buffer.from('/etc/passwd'));
            z.getEntry('link')!.attr = (0o120777 << 16) >>> 0;
        });
        expect(() => extractZipSafely(zip, out())).toThrow(/symbolic link/);
        expect(fs.existsSync(path.join(out(), 'link'))).toBe(false);
    });

    it('rejects traversal and absolute entry names', () => {
        const zip = build((z) => {
            z.addFile('ok.txt', Buffer.from('x'));
            z.addFile('placeholder.txt', Buffer.from('y'));
            z.getEntry('placeholder.txt')!.entryName = '../evil.txt';
        });
        expect(() => extractZipSafely(zip, out())).toThrow(/Unsafe/);
        expect(fs.existsSync(path.join(tmp, 'evil.txt'))).toBe(false);

        const abs = build((z) => {
            z.addFile('placeholder.txt', Buffer.from('y'));
            z.getEntry('placeholder.txt')!.entryName = '/abs.txt';
        });
        expect(() => extractZipSafely(abs, out())).toThrow(/Unsafe/);
    });
});
