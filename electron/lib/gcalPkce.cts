// R2-15: PKCE (RFC 7636, method S256) and the OAuth `state` for the Google Calendar sign-in. Pure: the random source is injected so
// tests are deterministic; nothing here touches the network or the disk.
import * as crypto from 'node:crypto';

export type RandomBytes = (size: number) => Buffer;

/** base64url without padding (RFC 4648 section 5). */
export function base64Url(data: Buffer): string {
    return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A code verifier: 32 random bytes -> 43 unreserved characters (RFC 7636 allows 43-128). */
export function createCodeVerifier(randomBytes: RandomBytes = crypto.randomBytes): string {
    return base64Url(randomBytes(32));
}

/** `BASE64URL(SHA256(ASCII(verifier)))`. */
export function codeChallengeFor(verifier: string): string {
    return base64Url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

/** An unguessable `state` value for the authorization request. */
export function createState(randomBytes: RandomBytes = crypto.randomBytes): string {
    return base64Url(randomBytes(24));
}

/** Constant-time string comparison (different lengths are simply unequal). */
export function statesMatch(expected: string, actual: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
