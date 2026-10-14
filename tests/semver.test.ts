import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from '../electron/lib/semver.cjs';

describe('parseVersion', () => {
    it('parses x.y.z with optional v, prerelease and build', () => {
        expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
        expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
        expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['beta', '1'] });
        expect(parseVersion('1.2.3+build.5')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    });
    it('accepts short forms with missing parts as 0', () => {
        expect(parseVersion('2')).toEqual({ major: 2, minor: 0, patch: 0, prerelease: [] });
        expect(parseVersion('2.1')).toEqual({ major: 2, minor: 1, patch: 0, prerelease: [] });
    });
    it('rejects invalid values', () => {
        for (const bad of [
            '',
            'latest',
            '1.2.3.4',
            '01.2.3',
            '1..2',
            '1.2.3-',
            ' 1.2.3',
            '1.2.3 ',
            'release-2024',
            '1.2.x',
            '-1.0.0',
            '99999999999999999999.0.0',
            'v',
            '1.0.0-' + 'a'.repeat(80),
        ]) {
            expect(parseVersion(bad)).toBeNull();
        }
        expect(parseVersion(undefined)).toBeNull();
        expect(parseVersion(null)).toBeNull();
        expect(parseVersion(1)).toBeNull();
        expect(parseVersion({})).toBeNull();
    });
});

describe('compareVersions', () => {
    it('orders by major, minor, patch numerically', () => {
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
        expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
        expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
        expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
        expect(compareVersions('1.2', '1.2.0')).toBe(0);
    });
    it('follows semver prerelease precedence', () => {
        const ordered = [
            '1.0.0-alpha',
            '1.0.0-alpha.1',
            '1.0.0-alpha.beta',
            '1.0.0-beta',
            '1.0.0-beta.2',
            '1.0.0-beta.11',
            '1.0.0-rc.1',
            '1.0.0',
        ];
        for (let i = 0; i < ordered.length - 1; i++) {
            expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1);
            expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
        }
    });
    it('ignores build metadata', () => {
        expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0);
    });
    it('returns null when either side is invalid', () => {
        expect(compareVersions('1.0.0', 'abc')).toBeNull();
        expect(compareVersions('abc', '1.0.0')).toBeNull();
        expect(compareVersions(undefined, undefined)).toBeNull();
    });
});

describe('isNewerVersion', () => {
    it('is true only for strictly greater versions', () => {
        expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
        expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
        expect(isNewerVersion('1.0.0', '1.0.0-beta')).toBe(true);
        expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
    });
    it('treats invalid versions as not newer', () => {
        expect(isNewerVersion('garbage', '1.0.0')).toBe(false);
        expect(isNewerVersion('2.0.0', 'garbage')).toBe(false);
        expect(isNewerVersion('', '')).toBe(false);
        expect(isNewerVersion(null, '1.0.0')).toBe(false);
    });
});
