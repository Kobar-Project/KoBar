// Tiny strict version comparator for plugin update checks (no dependency). Accepts `x.y.z` with an
// optional leading "v", an optional `-prerelease` and an optional `+build` suffix. Short forms `x` and
// `x.y` are accepted too (missing parts count as 0) because older plugin releases used such tags.
// Anything else is invalid, and an invalid version is never "newer" than anything.

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
}

const MAX_VERSION_LENGTH = 64;
const VERSION_RE =
    /^[vV]?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC_RE = /^\d+$/;

/** Parses a version string; returns null for anything that is not a valid (short) semver. */
export function parseVersion(value: unknown): ParsedVersion | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VERSION_LENGTH) return null;
    const match = VERSION_RE.exec(value);
    if (!match) return null;
    const major = Number(match[1]);
    const minor = match[2] === undefined ? 0 : Number(match[2]);
    const patch = match[3] === undefined ? 0 : Number(match[3]);
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
    return { major, minor, patch, prerelease: match[4] === undefined ? [] : match[4].split('.') };
}

function compareIdentifiers(a: string, b: string): number {
    const aNum = NUMERIC_RE.test(a);
    const bNum = NUMERIC_RE.test(b);
    if (aNum && bNum) {
        const diff = Number(a) - Number(b);
        if (diff !== 0) return diff < 0 ? -1 : 1;
        // Same numeric value with different leading zeros: fall back to a stable string order.
        return a === b ? 0 : a < b ? -1 : 1;
    }
    // Numeric identifiers have lower precedence than alphanumeric ones.
    if (aNum) return -1;
    if (bNum) return 1;
    return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Compares two versions by semver precedence: -1, 0 or 1. Returns null when either value is invalid.
 * Build metadata (`+...`) is ignored, as semver requires.
 */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return null;
    for (const key of ['major', 'minor', 'patch'] as const) {
        if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
    }
    // A version without prerelease is higher than the same version with one.
    if (pa.prerelease.length === 0 || pb.prerelease.length === 0) {
        if (pa.prerelease.length === pb.prerelease.length) return 0;
        return pa.prerelease.length === 0 ? 1 : -1;
    }
    const len = Math.max(pa.prerelease.length, pb.prerelease.length);
    for (let i = 0; i < len; i++) {
        if (i >= pa.prerelease.length) return -1;
        if (i >= pb.prerelease.length) return 1;
        const diff = compareIdentifiers(pa.prerelease[i], pb.prerelease[i]);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/** True only when `candidate` is strictly greater than `current`; false when either is invalid. */
export function isNewerVersion(candidate: unknown, current: unknown): boolean {
    return compareVersions(candidate, current) === 1;
}
