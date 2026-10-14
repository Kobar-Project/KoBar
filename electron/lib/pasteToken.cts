// One-shot user-action token for global paste (SEC-13). The main process issues a token when its own
// global Ctrl+V shortcut asks the renderer for the next paste item; `execute-global-paste` must consume
// it. This requires a recent main-initiated request (a real Ctrl+V press); it cannot stop a same-realm
// plugin from answering that request.

/** How long the renderer has to answer a `request-next-paste` (headroom for async work in plugins). */
export const PASTE_TOKEN_TTL_MS = 3000;

export interface PasteToken {
    /** Call when main sends `request-next-paste` to the window with this webContents id. */
    issue(senderId: number): void;
    /** Returns true at most once per issue, only for the same sender and before expiry. */
    consume(senderId: number): boolean;
}

export function createPasteToken(now: () => number = Date.now, ttlMs: number = PASTE_TOKEN_TTL_MS): PasteToken {
    let expiresAt = 0;
    let owner = -1;
    return {
        issue(senderId) {
            owner = senderId;
            expiresAt = now() + ttlMs;
        },
        consume(senderId) {
            const valid = expiresAt > 0 && now() < expiresAt && owner === senderId;
            // Single use: any attempt (valid or not) clears the token.
            expiresAt = 0;
            owner = -1;
            return valid;
        },
    };
}
