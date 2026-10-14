// Bounded respawn policy for the persistent PowerShell bridge (T-142). Pure: the clock is injected.
// Each unexpected exit asks for the next delay; null means "give up". A bridge that stayed up for
// `stableMs` earns a fresh budget, so only a crash loop exhausts the attempts.

export interface RespawnPolicyOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    stableMs?: number;
    now?: () => number;
}

export interface RespawnPolicy {
    /** Call when the bridge has just been (re)started. */
    markStarted(): void;
    /** Call when it exited unexpectedly. Returns the delay before the next spawn, or null when out of attempts. */
    nextDelay(): number | null;
    /** T-317: respawn attempts used from the current budget (1 after the first nextDelay that returned a delay). */
    attempts(): number;
    /** T-317: a fresh budget (used when a user action restarts the bridge after a give-up). */
    reset(): void;
}

export function createRespawnPolicy(options: RespawnPolicyOptions = {}): RespawnPolicy {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;
    const maxDelayMs = options.maxDelayMs ?? 8000;
    const stableMs = options.stableMs ?? 60000;
    const now = options.now ?? Date.now;
    let attempts = 0;
    let startedAt: number | null = null;

    return {
        markStarted() {
            startedAt = now();
        },
        nextDelay() {
            if (startedAt !== null && now() - startedAt >= stableMs) attempts = 0;
            if (attempts >= maxAttempts) return null;
            const delay = Math.min(baseDelayMs * 2 ** attempts, maxDelayMs);
            attempts += 1;
            return delay;
        },
        attempts: () => attempts,
        reset() {
            attempts = 0;
        },
    };
}

export interface RestartGateOptions {
    /** Minimum time between two user-initiated restarts. */
    cooldownMs?: number;
    now?: () => number;
}

export interface RestartGate {
    /** True (and starts the cooldown) when a restart is allowed now; false while the previous one is too recent. */
    tryAcquire(): boolean;
}

export interface PsBridgeState {
    quitting: boolean;
    running: boolean;
    respawnPending: boolean;
    gaveUp: boolean;
}

/**
 * T-317: whether a user action may restart the bridge. Only a bridge that gave up qualifies; never once quitting has begun,
 * while one is running or while a respawn is already scheduled. The cooldown (RestartGate) is checked after this.
 */
export function shouldRestartPsBridge(state: PsBridgeState): boolean {
    return !state.quitting && !state.running && !state.respawnPending && state.gaveUp;
}

/** T-317: default cooldown between two user-initiated restarts of a bridge that gave up. */
export const PS_RESTART_COOLDOWN_MS = 30000;

/** T-317: rate limit for restarting a bridge that gave up, so repeated user actions cannot turn into a spawn loop. */
export function createRestartGate(options: RestartGateOptions = {}): RestartGate {
    const cooldownMs = options.cooldownMs ?? PS_RESTART_COOLDOWN_MS;
    const now = options.now ?? Date.now;
    let lastAt: number | null = null;
    return {
        tryAcquire() {
            const t = now();
            if (lastAt !== null && t - lastAt < cooldownMs) return false;
            lastAt = t;
            return true;
        },
    };
}
