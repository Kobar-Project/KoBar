// R2-15: the Google Calendar v1 service (EXPERIMENTAL, READ-ONLY), the logic behind the gcal-* IPC channels.
//   - default OFF: while the switch is off, no network call is made, no timer runs and `listEvents` answers `[]`;
//   - events live ONLY in memory (a small cache, never persisted, never merged into plugin data);
//   - while connected AND enabled a timer refreshes the cached ranges every 15 minutes; `refresh()` does it on demand;
//   - a rejected refresh token (`invalid_grant`, e.g. the 7-day Testing-mode expiry) turns the state into `reconnect-needed`;
//   - tokens never leave this module, and no token, e-mail address or event title is ever logged (this module has no logger at all).
// Pure: every side effect (config file, token store, fetch, browser, HTTP server, clock) is injected; tests use fakes.
import type { IpcGcalConnectResult, IpcGcalEvent, IpcGcalRange, IpcGcalState, IpcGcalStatus } from '../../shared/ipc-contract.js' with {
    'resolution-mode': 'import',
};
import type { GcalClientConfig } from './gcalConfig.cjs';
import { fetchEvents, normalizeRange } from './gcalEvents.cjs';
import { type CreateLoopbackServer, type FetchLike, authorize, exchangeCode, refreshAccessToken, revokeToken } from './gcalOAuth.cjs';
import type { RandomBytes } from './gcalPkce.cjs';
import type { GcalTokenStore } from './gcalTokenStore.cjs';

export const GCAL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MAX_CACHED_RANGES = 6;
const MAX_REFRESHED_RANGES = 4;
/** Access tokens are renewed this long before they expire. */
const TOKEN_SKEW_MS = 60 * 1000;

export interface GcalServiceDeps {
    loadConfig(): Promise<GcalClientConfig | null>;
    store: GcalTokenStore;
    fetch: FetchLike;
    openExternal(url: string): Promise<unknown> | unknown;
    createServer: CreateLoopbackServer;
    now(): number;
    randomBytes?: RandomBytes;
    authTimeoutMs?: number;
    refreshIntervalMs?: number;
}

export interface GcalService {
    status(): Promise<IpcGcalStatus>;
    connect(): Promise<IpcGcalConnectResult>;
    disconnect(): Promise<IpcGcalStatus>;
    setEnabled(enabled: boolean): Promise<IpcGcalStatus>;
    listEvents(range: IpcGcalRange): Promise<IpcGcalEvent[]>;
    refresh(): Promise<IpcGcalStatus>;
    /** Loads the persisted state and starts the timer when connected and enabled. */
    start(): Promise<void>;
    /** Stops the timer (app quit). */
    dispose(): void;
}

interface CacheEntry {
    range: { from: string; to: string };
    events: IpcGcalEvent[];
    at: number;
}

export function createGcalService(deps: GcalServiceDeps): GcalService {
    const { store } = deps;
    const interval = deps.refreshIntervalMs ?? GCAL_REFRESH_INTERVAL_MS;

    let initialized: Promise<void> | null = null;
    let enabled = false;
    let hasToken = false;
    let reconnectNeeded = false;
    let lastRefreshAt: number | null = null;
    let config: GcalClientConfig | null = null;
    let accessToken: { value: string; expiresAt: number } | null = null;
    let authInFlight = false;
    let refreshInFlight: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const cache = new Map<string, CacheEntry>();

    function init(): Promise<void> {
        initialized ??= (async () => {
            enabled = await store.readEnabled();
            hasToken = await store.hasToken();
        })();
        return initialized;
    }

    async function loadConfig(): Promise<GcalClientConfig | null> {
        if (config) return config;
        try {
            config = await deps.loadConfig();
        } catch {
            config = null;
        }
        return config;
    }

    function stopTimer(): void {
        if (timer !== null) clearInterval(timer);
        timer = null;
    }

    function startTimerIfNeeded(): void {
        if (timer !== null || !enabled || !hasToken || reconnectNeeded) return;
        timer = setInterval(() => void refreshNow(), interval);
        (timer as { unref?: () => void }).unref?.();
    }

    function stateOf(configured: boolean): IpcGcalState {
        if (!configured) return 'not-configured';
        if (!hasToken) return 'not-connected';
        return reconnectNeeded ? 'reconnect-needed' : 'connected';
    }

    async function status(): Promise<IpcGcalStatus> {
        await init();
        const configured = (await loadConfig()) !== null;
        const state = stateOf(configured);
        return { state, enabled, configured, connected: state === 'connected', lastRefreshAt };
    }

    function resetMemory(): void {
        accessToken = null;
        cache.clear();
        lastRefreshAt = null;
    }

    /** A valid access token, or null (not connected / the refresh token was rejected / offline). */
    async function ensureAccessToken(): Promise<string | null> {
        if (accessToken && deps.now() < accessToken.expiresAt - TOKEN_SKEW_MS) return accessToken.value;
        const cfg = await loadConfig();
        if (!cfg || !hasToken || reconnectNeeded) return null;
        const refreshToken = await store.readRefreshToken();
        if (refreshToken === null) {
            reconnectNeeded = true;
            stopTimer();
            return null;
        }
        const result = await refreshAccessToken(deps.fetch, cfg, refreshToken);
        if (!result.ok) {
            if (result.error === 'invalid_grant') {
                reconnectNeeded = true;
                accessToken = null;
                stopTimer();
            }
            return null;
        }
        accessToken = { value: result.accessToken, expiresAt: deps.now() + result.expiresInSec * 1000 };
        return accessToken.value;
    }

    const rangeKey = (range: { from: string; to: string }) => `${range.from}|${range.to}`;

    /** Fetches one range from Google and caches it; null when it could not be fetched. */
    async function fetchRange(range: { from: string; to: string }): Promise<IpcGcalEvent[] | null> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const token = await ensureAccessToken();
            if (token === null) return null;
            const result = await fetchEvents({ fetch: deps.fetch, accessToken: token, range });
            if (result.ok) {
                const key = rangeKey(range);
                cache.delete(key);
                cache.set(key, { range, events: result.events, at: deps.now() });
                while (cache.size > MAX_CACHED_RANGES) {
                    const oldest = cache.keys().next().value;
                    if (oldest === undefined) break;
                    cache.delete(oldest);
                }
                lastRefreshAt = deps.now();
                return result.events;
            }
            if (result.error !== 'unauthorized') return null;
            accessToken = null; // expired earlier than announced: renew once and retry
        }
        return null;
    }

    function defaultRange(): { from: string; to: string } {
        const now = new Date(deps.now());
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
        return { from: from.toISOString(), to: to.toISOString() };
    }

    function refreshNow(): Promise<void> {
        refreshInFlight ??= (async () => {
            try {
                await init();
                if (!enabled || !hasToken || reconnectNeeded) return;
                const ranges = [...cache.values()].slice(-MAX_REFRESHED_RANGES).map((entry) => entry.range);
                if (ranges.length === 0) ranges.push(defaultRange());
                for (const range of ranges) await fetchRange(range);
            } finally {
                refreshInFlight = null;
            }
        })();
        return refreshInFlight;
    }

    return {
        status,
        async start() {
            await init();
            startTimerIfNeeded();
        },
        dispose() {
            stopTimer();
        },
        async setEnabled(next) {
            await init();
            if (next !== enabled) {
                enabled = next;
                await store.writeEnabled(next);
            }
            if (enabled) startTimerIfNeeded();
            else {
                stopTimer();
                resetMemory();
            }
            return status();
        },
        async connect() {
            await init();
            const fail = async (reason: NonNullable<IpcGcalConnectResult['reason']>): Promise<IpcGcalConnectResult> => ({
                success: false,
                reason,
                status: await status(),
            });
            if (!enabled) return fail('disabled');
            const cfg = await loadConfig();
            if (!cfg) return fail('not-configured');
            if (authInFlight) return fail('busy');
            // No plaintext fallback: refuse before the browser even opens.
            if (!store.encryptionAvailable()) return fail('encryption-unavailable');
            authInFlight = true;
            try {
                const auth = await authorize({
                    config: cfg,
                    openExternal: deps.openExternal,
                    createServer: deps.createServer,
                    randomBytes: deps.randomBytes,
                    timeoutMs: deps.authTimeoutMs,
                });
                if (!auth.ok) return await fail(auth.reason);
                const tokens = await exchangeCode(deps.fetch, cfg, auth);
                if (!tokens.ok || !tokens.refreshToken) return await fail('exchange-failed');
                const saved = await store.saveRefreshToken(tokens.refreshToken, deps.now());
                if (!saved.ok) return await fail(saved.reason);
                hasToken = true;
                reconnectNeeded = false;
                resetMemory();
                accessToken = { value: tokens.accessToken, expiresAt: deps.now() + tokens.expiresInSec * 1000 };
                startTimerIfNeeded();
                return { success: true, status: await status() };
            } finally {
                authInFlight = false;
            }
        },
        async disconnect() {
            await init();
            stopTimer();
            const refreshToken = hasToken ? await store.readRefreshToken() : null;
            if (refreshToken !== null) await revokeToken(deps.fetch, refreshToken);
            await store.clearToken();
            hasToken = false;
            reconnectNeeded = false;
            resetMemory();
            return status();
        },
        async listEvents(range) {
            await init();
            if (!enabled) return [];
            const normalized = normalizeRange(range);
            if (!normalized || !hasToken || reconnectNeeded) return [];
            const cached = cache.get(rangeKey(normalized));
            if (cached && deps.now() - cached.at < interval) return cached.events;
            const fresh = await fetchRange(normalized);
            return fresh ?? cached?.events ?? [];
        },
        async refresh() {
            await refreshNow();
            return status();
        },
    };
}
