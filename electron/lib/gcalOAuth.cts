// R2-15: Google OAuth 2.0 for installed apps: Authorization Code + PKCE (S256) with a 127.0.0.1 loopback redirect, `state` check,
// a 5-minute timeout, the system browser, and the token / refresh / revoke calls. Read-only scope only.
// Pure: the HTTP server factory, `fetch`, the browser opener and the random source are injected (tests use fakes; no network).
// Nothing secret is ever logged or put into an error: failures are plain codes.
import type { GcalClientConfig } from './gcalConfig.cjs';
import { type RandomBytes, codeChallengeFor, createCodeVerifier, createState, statesMatch } from './gcalPkce.cjs';

/** The only scope KoBar asks for: view events (read-only). The v1 design never asks for a write scope. */
export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const GCAL_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GCAL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GCAL_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GCAL_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface FetchResponseLike {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}
export type FetchLike = (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<FetchResponseLike>;

export interface LoopbackRequest {
    url?: string;
    method?: string;
}
export interface LoopbackResponse {
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(body?: string): unknown;
}
export interface LoopbackServer {
    listen(port: number, host: string, callback: () => void): unknown;
    address(): { port: number } | string | null;
    close(): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
}
export type CreateLoopbackServer = (handler: (req: LoopbackRequest, res: LoopbackResponse) => void) => LoopbackServer;

export type AuthorizeFailure = 'timeout' | 'denied' | 'state-mismatch' | 'io';

export type AuthorizeResult =
    { ok: true; code: string; codeVerifier: string; redirectUri: string } | { ok: false; reason: AuthorizeFailure };

export interface AuthorizeDeps {
    config: GcalClientConfig;
    openExternal(url: string): Promise<unknown> | unknown;
    createServer: CreateLoopbackServer;
    randomBytes?: RandomBytes;
    timeoutMs?: number;
}

export function buildAuthUrl(params: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
    const query = new URLSearchParams({
        client_id: params.clientId,
        redirect_uri: params.redirectUri,
        response_type: 'code',
        scope: GCAL_SCOPE,
        state: params.state,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${GCAL_AUTH_ENDPOINT}?${query.toString()}`;
}

const DONE_PAGE =
    '<!doctype html><meta charset="utf-8"><title>KoBar</title><body style="font-family:sans-serif;padding:2rem">' +
    '<p>KoBar: you can close this tab and return to the app.</p></body>';
const FAILED_PAGE =
    '<!doctype html><meta charset="utf-8"><title>KoBar</title><body style="font-family:sans-serif;padding:2rem">' +
    '<p>KoBar: the sign-in did not complete. You can close this tab.</p></body>';

function reply(res: LoopbackResponse, status: number, body: string): void {
    try {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
        res.end(body);
    } catch {
        // the browser went away; nothing to do
    }
}

/**
 * Opens the system browser at Google's consent page and waits for the loopback redirect. Resolves with the authorization code or a
 * failure code; never rejects. The server is closed in every outcome.
 */
export function authorize(deps: AuthorizeDeps): Promise<AuthorizeResult> {
    const { config, openExternal, createServer, randomBytes } = deps;
    const timeoutMs = deps.timeoutMs ?? GCAL_AUTH_TIMEOUT_MS;
    const codeVerifier = createCodeVerifier(randomBytes);
    const state = createState(randomBytes);
    const codeChallenge = codeChallengeFor(codeVerifier);

    return new Promise<AuthorizeResult>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let server: LoopbackServer | undefined;
        let redirectUri = '';

        const finish = (result: AuthorizeResult) => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            try {
                server?.close();
            } catch {
                // already closed
            }
            resolve(result);
        };

        const handler = (req: LoopbackRequest, res: LoopbackResponse) => {
            if (settled) {
                reply(res, 410, FAILED_PAGE);
                return;
            }
            let url: URL;
            try {
                url = new URL(req.url ?? '', 'http://127.0.0.1');
            } catch {
                reply(res, 400, FAILED_PAGE);
                return;
            }
            if (req.method !== undefined && req.method !== 'GET') {
                reply(res, 405, FAILED_PAGE);
                return;
            }
            // Anything but /callback (favicon, probes) is ignored and does not end the sign-in.
            if (url.pathname !== '/callback') {
                reply(res, 404, FAILED_PAGE);
                return;
            }
            const returnedState = url.searchParams.get('state');
            if (returnedState === null || !statesMatch(state, returnedState)) {
                reply(res, 400, FAILED_PAGE);
                finish({ ok: false, reason: 'state-mismatch' });
                return;
            }
            const code = url.searchParams.get('code');
            if (url.searchParams.has('error') || !code) {
                reply(res, 400, FAILED_PAGE);
                finish({ ok: false, reason: 'denied' });
                return;
            }
            reply(res, 200, DONE_PAGE);
            finish({ ok: true, code, codeVerifier, redirectUri });
        };

        try {
            server = createServer(handler);
            server.on('error', () => finish({ ok: false, reason: 'io' }));
            timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
            server.listen(0, '127.0.0.1', () => {
                const address = server?.address();
                if (!address || typeof address === 'string') {
                    finish({ ok: false, reason: 'io' });
                    return;
                }
                redirectUri = `http://127.0.0.1:${address.port}/callback`;
                const authUrl = buildAuthUrl({ clientId: config.clientId, redirectUri, state, codeChallenge });
                Promise.resolve()
                    .then(() => openExternal(authUrl))
                    .catch(() => finish({ ok: false, reason: 'io' }));
            });
        } catch {
            finish({ ok: false, reason: 'io' });
        }
    });
}

export type TokenFailure = 'invalid_grant' | 'network' | 'failed';

export type TokenResult =
    { ok: true; accessToken: string; refreshToken?: string; expiresInSec: number } | { ok: false; error: TokenFailure };

async function postForm(fetchFn: FetchLike, url: string, form: Record<string, string>): Promise<TokenResult> {
    let response: FetchResponseLike;
    try {
        response = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
        });
    } catch {
        return { ok: false, error: 'network' };
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    const data = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (!response.ok) return { ok: false, error: data.error === 'invalid_grant' ? 'invalid_grant' : 'failed' };
    if (typeof data.access_token !== 'string' || data.access_token === '') return { ok: false, error: 'failed' };
    const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
    return {
        ok: true,
        accessToken: data.access_token,
        expiresInSec,
        ...(typeof data.refresh_token === 'string' && data.refresh_token !== '' ? { refreshToken: data.refresh_token } : {}),
    };
}

export function exchangeCode(
    fetchFn: FetchLike,
    config: GcalClientConfig,
    params: { code: string; codeVerifier: string; redirectUri: string }
): Promise<TokenResult> {
    return postForm(fetchFn, GCAL_TOKEN_ENDPOINT, {
        code: params.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: params.codeVerifier,
    });
}

export function refreshAccessToken(fetchFn: FetchLike, config: GcalClientConfig, refreshToken: string): Promise<TokenResult> {
    return postForm(fetchFn, GCAL_TOKEN_ENDPOINT, {
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
    });
}

/** Best effort: true when Google accepted the revocation. Never throws. */
export async function revokeToken(fetchFn: FetchLike, token: string): Promise<boolean> {
    try {
        const response = await fetchFn(GCAL_REVOKE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
        });
        return response.ok;
    } catch {
        return false;
    }
}
