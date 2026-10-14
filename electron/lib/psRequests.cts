// Request/response plumbing for the persistent PowerShell child (pin-window tracking, ARC-03).
// One stdout listener feeds a line reader; every request carries an id and the reply line is `id|payload`.
// Lines without a known id (stray output, late replies after a timeout) are ignored.

import { StringDecoder } from 'node:string_decoder';

export interface LineReader {
    push(chunk: Buffer | string): void;
}

/** Splits a stream of chunks into lines. Handles partial chunks and \r\n. */
export function createLineReader(onLine: (line: string) => void): LineReader {
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    return {
        push(chunk) {
            buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            let idx: number;
            while ((idx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, idx).replace(/\r$/, '');
                buffer = buffer.slice(idx + 1);
                onLine(line);
            }
            // Guard against a child that never emits a newline.
            if (buffer.length > 65536) buffer = '';
        },
    };
}

export interface PsRequestOptions {
    /** Writes one script to the child's stdin. */
    send: (script: string) => void;
    timeoutMs?: number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface PsRequests {
    /** `buildScript` receives the numeric id that the script must echo as `id|payload`. Resolves null on timeout/failure. */
    request(buildScript: (id: number) => string, opts?: { timeoutMs?: number }): Promise<string | null>;
    /** Feed one stdout line. Returns true when it matched a pending request. */
    handleLine(line: string): boolean;
    /** Resolve every pending request with null (process exit/error). */
    rejectAll(): void;
    pendingCount(): number;
}

export const PS_REQUEST_TIMEOUT_MS = 1500;

export function createPsRequests(options: PsRequestOptions): PsRequests {
    const timeoutMs = options.timeoutMs ?? PS_REQUEST_TIMEOUT_MS;
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const pending = new Map<number, { resolve: (v: string | null) => void; timer: unknown }>();
    let nextId = 1;

    function settle(id: number, value: string | null): boolean {
        const entry = pending.get(id);
        if (!entry) return false;
        pending.delete(id);
        clearTimer(entry.timer);
        entry.resolve(value);
        return true;
    }

    return {
        request(buildScript, opts) {
            return new Promise((resolve) => {
                const id = nextId++;
                const timer = setTimer(() => settle(id, null), opts?.timeoutMs ?? timeoutMs);
                pending.set(id, { resolve, timer });
                try {
                    options.send(buildScript(id));
                } catch {
                    settle(id, null);
                }
            });
        },
        handleLine(line) {
            const sep = line.indexOf('|');
            if (sep <= 0) return false;
            const idText = line.slice(0, sep);
            if (!/^\d+$/.test(idText)) return false;
            return settle(Number(idText), line.slice(sep + 1).trim());
        },
        rejectAll() {
            for (const id of [...pending.keys()]) settle(id, null);
        },
        pendingCount: () => pending.size,
    };
}
