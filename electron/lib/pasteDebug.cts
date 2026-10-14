// R3-01: opt-in diagnostics for the global paste flow (KOBAR_DEBUG_PASTE=1). Pure: clock and sink are injected.
// When disabled, `log` is a shared no-op so the normal path costs nothing. Callers must only pass kinds, lengths,
// indexes and error messages: never clipboard text, file paths or image data.

export type PasteDebugLog = (step: string) => void;

export interface PasteDebugOptions {
    enabled: boolean;
    /** Absolute clock in ms (Date.now in production). */
    now: () => number;
    /** Output sink (console.log in production). */
    sink: (line: string) => void;
}

const noop: PasteDebugLog = () => undefined;

export function createPasteDebug(opts: PasteDebugOptions): PasteDebugLog {
    if (!opts.enabled) return noop;
    let first: number | null = null;
    let seq = 0;
    return (step) => {
        const t = opts.now();
        seq += 1;
        if (first === null) {
            first = t;
            opts.sink(`[PASTE-DBG +0ms #${seq}] ${step} (abs=${t})`);
        } else {
            opts.sink(`[PASTE-DBG +${t - first}ms #${seq}] ${step}`);
        }
    };
}

/** Production instance: enabled only if KOBAR_DEBUG_PASTE=1 was set when the main process started. */
export const pasteDbg: PasteDebugLog = createPasteDebug({
    enabled: process.env.KOBAR_DEBUG_PASTE === '1',
    now: Date.now,
    sink: (line) => console.log(line),
});

/** Error message only (never the payload or stack). */
export function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : 'non-Error value thrown';
}
