// R2-15: Google Calendar OAuth (PKCE, state, loopback server, timeout, token calls, client config). No network, no browser, no real server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GCAL_CLIENT_FILE_NAME, loadClientConfig, parseClientConfig } from '../electron/lib/gcalConfig.cjs';
import {
    GCAL_AUTH_ENDPOINT,
    GCAL_SCOPE,
    authorize,
    exchangeCode,
    refreshAccessToken,
    revokeToken,
    type CreateLoopbackServer,
    type FetchLike,
    type LoopbackRequest,
    type LoopbackResponse,
} from '../electron/lib/gcalOAuth.cjs';
import { codeChallengeFor, createCodeVerifier, createState, statesMatch } from '../electron/lib/gcalPkce.cjs';

afterEach(() => vi.useRealTimers());

describe('PKCE', () => {
    it('matches the RFC 7636 appendix B vector', () => {
        expect(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('builds url-safe verifier and state from the injected random source', () => {
        const bytes = (size: number) => Buffer.alloc(size, 0xfb);
        expect(createCodeVerifier(bytes)).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        expect(createState(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('compares states without throwing on different lengths', () => {
        expect(statesMatch('abc', 'abc')).toBe(true);
        expect(statesMatch('abc', 'abd')).toBe(false);
        expect(statesMatch('abc', 'abcd')).toBe(false);
    });
});

interface FakeServer {
    create: CreateLoopbackServer;
    hit(url: string, method?: string): { status: number; body: string };
    closed: () => boolean;
    listened: () => { port: number; host: string } | null;
}

function fakeServer(port = 45678): FakeServer {
    let handler: ((req: LoopbackRequest, res: LoopbackResponse) => void) | null = null;
    let closed = false;
    let listened: { port: number; host: string } | null = null;
    return {
        create: (h) => {
            handler = h;
            return {
                listen: (p, host, callback) => {
                    listened = { port: p, host };
                    callback();
                },
                address: () => ({ port }),
                close: () => {
                    closed = true;
                },
                on: () => undefined,
            };
        },
        hit(url, method = 'GET') {
            const out = { status: 0, body: '' };
            handler?.(
                { url, method },
                {
                    writeHead: (status) => {
                        out.status = status;
                    },
                    end: (body) => {
                        out.body = body ?? '';
                    },
                }
            );
            return out;
        },
        closed: () => closed,
        listened: () => listened,
    };
}

const config = { clientId: 'client-id', clientSecret: 'client-secret' };
const fixedBytes = (size: number) => Buffer.alloc(size, 7);

function stateOf(openedUrl: string): string {
    return new URL(openedUrl).searchParams.get('state') ?? '';
}

describe('authorize (loopback)', () => {
    it('listens on 127.0.0.1 with a random port, opens the consent page with the read-only scope and accepts the matching callback', async () => {
        const server = fakeServer();
        const opened: string[] = [];
        const promise = authorize({
            config,
            openExternal: (url) => void opened.push(url),
            createServer: server.create,
            randomBytes: fixedBytes,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(server.listened()).toEqual({ port: 0, host: '127.0.0.1' });
        const url = new URL(opened[0]);
        expect(`${url.origin}${url.pathname}`).toBe(GCAL_AUTH_ENDPOINT);
        expect(url.searchParams.get('scope')).toBe(GCAL_SCOPE);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:45678/callback');
        const reply = server.hit(`/callback?code=the-code&state=${stateOf(opened[0])}`);
        expect(reply.status).toBe(200);
        const result = await promise;
        expect(result).toMatchObject({ ok: true, code: 'the-code', redirectUri: 'http://127.0.0.1:45678/callback' });
        expect(server.closed()).toBe(true);
    });

    it('rejects a callback whose state does not match', async () => {
        const server = fakeServer();
        const opened: string[] = [];
        const promise = authorize({
            config,
            openExternal: (url) => void opened.push(url),
            createServer: server.create,
            randomBytes: fixedBytes,
        });
        await Promise.resolve();
        await Promise.resolve();
        const reply = server.hit('/callback?code=evil&state=not-the-state');
        expect(reply.status).toBe(400);
        await expect(promise).resolves.toEqual({ ok: false, reason: 'state-mismatch' });
        expect(server.closed()).toBe(true);
    });

    it('treats a missing state as a mismatch and ignores other paths', async () => {
        const server = fakeServer();
        const opened: string[] = [];
        const promise = authorize({
            config,
            openExternal: (url) => void opened.push(url),
            createServer: server.create,
            randomBytes: fixedBytes,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(server.hit('/favicon.ico').status).toBe(404);
        expect(server.hit('/callback?code=x', 'POST').status).toBe(405);
        server.hit('/callback?code=x');
        await expect(promise).resolves.toEqual({ ok: false, reason: 'state-mismatch' });
    });

    it('reports a denied consent', async () => {
        const server = fakeServer();
        const opened: string[] = [];
        const promise = authorize({
            config,
            openExternal: (url) => void opened.push(url),
            createServer: server.create,
            randomBytes: fixedBytes,
        });
        await Promise.resolve();
        await Promise.resolve();
        server.hit(`/callback?error=access_denied&state=${stateOf(opened[0])}`);
        await expect(promise).resolves.toEqual({ ok: false, reason: 'denied' });
    });

    it('times out after 5 minutes and closes the server', async () => {
        vi.useFakeTimers();
        const server = fakeServer();
        const promise = authorize({ config, openExternal: () => undefined, createServer: server.create, randomBytes: fixedBytes });
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
        expect(server.closed()).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(promise).resolves.toEqual({ ok: false, reason: 'timeout' });
        expect(server.closed()).toBe(true);
    });

    it('fails with io when the browser cannot be opened', async () => {
        const server = fakeServer();
        const promise = authorize({
            config,
            openExternal: () => {
                throw new Error('no browser');
            },
            createServer: server.create,
            randomBytes: fixedBytes,
        });
        await expect(promise).resolves.toEqual({ ok: false, reason: 'io' });
        expect(server.closed()).toBe(true);
    });
});

function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('token calls', () => {
    it('exchanges the code with the verifier and returns the tokens', async () => {
        const calls: Array<{ url: string; body: string }> = [];
        const fetchFn: FetchLike = async (url, init) => {
            calls.push({ url, body: init?.body ?? '' });
            return jsonResponse(200, { access_token: 'a', refresh_token: 'r', expires_in: 3599 });
        };
        const result = await exchangeCode(fetchFn, config, { code: 'c', codeVerifier: 'v', redirectUri: 'http://127.0.0.1:1/callback' });
        expect(result).toEqual({ ok: true, accessToken: 'a', refreshToken: 'r', expiresInSec: 3599 });
        const form = new URLSearchParams(calls[0].body);
        expect(form.get('grant_type')).toBe('authorization_code');
        expect(form.get('code_verifier')).toBe('v');
    });

    it('maps invalid_grant, other failures and network errors to plain codes', async () => {
        expect(await refreshAccessToken(async () => jsonResponse(400, { error: 'invalid_grant' }), config, 'r')).toEqual({
            ok: false,
            error: 'invalid_grant',
        });
        expect(await refreshAccessToken(async () => jsonResponse(500, {}), config, 'r')).toEqual({ ok: false, error: 'failed' });
        expect(
            await refreshAccessToken(
                async () => {
                    throw new Error('offline');
                },
                config,
                'r'
            )
        ).toEqual({ ok: false, error: 'network' });
    });

    it('revokes best-effort and never throws', async () => {
        expect(await revokeToken(async () => jsonResponse(200, {}), 't')).toBe(true);
        expect(
            await revokeToken(async () => {
                throw new Error('offline');
            }, 't')
        ).toBe(false);
    });
});

describe('client config', () => {
    it('accepts a real file, rejects placeholders and malformed files', () => {
        expect(parseClientConfig('{"clientId":" id ","clientSecret":"s"}')).toEqual({ clientId: 'id', clientSecret: 's' });
        expect(parseClientConfig('{"clientId":"xxxxxxxx.apps.googleusercontent.com","clientSecret":"s"}')).toBeNull();
        expect(parseClientConfig('{"clientId":"id"}')).toBeNull();
        expect(parseClientConfig('not json')).toBeNull();
        expect(parseClientConfig('[]')).toBeNull();
    });

    it('uses the first valid candidate and returns null when none exists', async () => {
        const files: Record<string, string> = { '/b/gcal.json': '{"clientId":"id","clientSecret":"s"}' };
        const read = async (p: string) => {
            if (p in files) return files[p];
            throw new Error('ENOENT');
        };
        expect(await loadClientConfig(['/a/gcal.json', '/b/gcal.json'], read)).toEqual({ clientId: 'id', clientSecret: 's' });
        expect(await loadClientConfig(['/a/gcal.json'], read)).toBeNull();
        expect(GCAL_CLIENT_FILE_NAME).toBe('gcal-client.local.json');
    });
});
