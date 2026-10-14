// Change filter for polled main-> renderer channels (T-128). Pure logic, no Electron imports (see tests/dedupe.test.ts).
//
// The media poll tick runs every 1.5-3s; most ticks produce the same payload as the previous one. `shouldSend`
// returns true only when the payload for a channel differs from the last one sent on that channel, so unchanged
// data (including an empty video list) is delivered once instead of every tick. `reset` forgets everything so the
// next payload of every channel is sent again (used when the renderer reloads and needs the current state once).

export class ChangeFilter {
    private readonly signatures = new Map<string, string>();
    private readonly payloads = new Map<string, unknown>();

    /** True when `payload` differs from the last payload recorded for `key` (or none was recorded yet). */
    shouldSend(key: string, payload: unknown): boolean {
        // JSON.stringify(undefined) is undefined; normalise it so `undefined` and `null` payloads behave consistently.
        const signature = JSON.stringify(payload === undefined ? null : payload);
        if (this.signatures.get(key) === signature) return false;
        this.signatures.set(key, signature);
        this.payloads.set(key, payload === undefined ? null : payload);
        return true;
    }

    /** The last payload recorded for `key`, wrapped so a stored `null` is distinguishable from "nothing recorded". */
    last(key: string): { payload: unknown } | undefined {
        return this.payloads.has(key) ? { payload: this.payloads.get(key) } : undefined;
    }

    /** Forgets all recorded payloads: the next `shouldSend` call for every key returns true. */
    reset(): void {
        this.signatures.clear();
        this.payloads.clear();
    }
}

export function createChangeFilter(): ChangeFilter {
    return new ChangeFilter();
}
