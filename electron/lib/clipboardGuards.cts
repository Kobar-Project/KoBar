// Pure helpers for the clipboard poller (no Electron imports, unit-testable).
import * as crypto from 'node:crypto';

export const EXCLUDE_FORMAT = 'ExcludeClipboardContentFromMonitorProcessing';
export const CAN_INCLUDE_FORMAT = 'CanIncludeInClipboardHistory';

// Electron 44 exposes raw OS formats only through this custom MIME wrapper.
export function osClipboardMime(format: string): string {
    return `electron application/osclipboard;format="${format}"`;
}

function findType(types: readonly string[], format: string): string | null {
    const needle = format.toLowerCase();
    return types.find((t) => t.toLowerCase().includes(needle)) ?? null;
}

export interface SensitiveFormatInfo {
    // True when the content carries the "exclude from monitoring" marker (any value).
    excluded: boolean;
    // The clipboard type name carrying CanIncludeInClipboardHistory, if listed.
    canIncludeType: string | null;
}

export function inspectClipboardTypes(types: readonly string[]): SensitiveFormatInfo {
    return {
        excluded: findType(types, EXCLUDE_FORMAT) !== null,
        canIncludeType: findType(types, CAN_INCLUDE_FORMAT),
    };
}

export interface SkipInput {
    // The ExcludeClipboardContentFromMonitorProcessing marker is present (any value).
    excludedMarker: boolean;
    // The CanIncludeInClipboardHistory format is present on the clipboard.
    canIncludePresent: boolean;
    // Raw bytes of CanIncludeInClipboardHistory when they could actually be read.
    canIncludeValue: Uint8Array | null | undefined;
}

// CanIncludeInClipboardHistory is a DWORD: 0 means "do not record", anything else allows it.
// A missing or too-short buffer is unknown and does not exclude.
export function isCanIncludeZero(buf: Uint8Array | null | undefined): boolean {
    if (!buf || buf.length < 4) return false;
    return (buf[0] | buf[1] | buf[2] | buf[3]) === 0;
}

// Fails closed: skip on the exclude marker, or when CanInclude is present unless its value was
// actually read and is non-zero (present + unreadable => skip).
export function shouldSkipClipboard(input: SkipInput): boolean {
    if (input.excludedMarker) return true;
    if (!input.canIncludePresent) return false;
    const v = input.canIncludeValue;
    if (!v || v.length < 4) return true;
    return isCanIncludeZero(v);
}

// Cheap, deterministic signature of an encoded image: mime + byte length + SHA-1 of the bytes.
// Stored instead of the full buffer, so the poller keeps a few dozen bytes instead of the whole image.
export function imageSignature(mime: string, bytes: Uint8Array): string {
    const digest = crypto.createHash('sha1').update(bytes).digest('hex');
    return `${mime}:${bytes.length}:${digest}`;
}

// Signature of clipboard text for dedupe (T-037): SHA-256 hex, so the poller never keeps the plain text (which may be
// excluded content such as a password) in memory. Empty text maps to '' so "no text" compares equal to the reset value.
export function textSignature(text: string): string {
    if (!text) return '';
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// R4: verified global paste. True when the text read back from the clipboard is the text that was written. Line endings
// are normalised (the OS may store CRLF for LF) and trailing NUL characters are ignored.
export function clipboardTextMatches(written: string, readBack: string): boolean {
    const norm = (s: string) => {
        let t = s.replace(/\r\n/g, '\n');
        while (t.endsWith('\u0000')) t = t.slice(0, -1);
        return t;
    };
    return norm(written) === norm(readBack);
}

// R4: verified global paste of an image. The OS may re-encode the PNG, so equal bytes are not required: a read-back image
// with the written pixel size also counts. No image read back (another app replaced it, or the write failed) never matches.
export function clipboardImageMatches(input: {
    writtenSignature: string;
    writtenSize: { width: number; height: number };
    readBackSignature: string | null;
    readBackSize: { width: number; height: number } | null;
}): boolean {
    if (!input.readBackSignature) return false;
    if (input.readBackSignature === input.writtenSignature) return true;
    const a = input.writtenSize;
    const b = input.readBackSize;
    return !!b && a.width > 0 && a.height > 0 && a.width === b.width && a.height === b.height;
}

export type ExclusionVerdict = 'allow' | 'skip' | 'retry';

/** After this many consecutive 'retry' verdicts for the same content, the content is treated as 'skip'. */
export const EXCLUSION_MAX_RETRIES = 3;

export interface ExclusionRetryGate {
    /** Maps a raw exclusion verdict for the content with `contentSig` to the verdict the poller should act on. */
    resolve(contentSig: string, verdict: ExclusionVerdict): ExclusionVerdict;
    /** Forget the retry history (e.g. after the poller recorded new content itself). */
    reset(): void;
}

// A lookup that keeps failing for the same content would otherwise make the poller re-check it forever. Counts
// consecutive 'retry' results per content signature; the Nth one becomes 'skip' (recorded as seen, never announced,
// fails closed). Any other verdict or a different content signature starts the count again.
export function createExclusionRetryGate(maxRetries: number = EXCLUSION_MAX_RETRIES): ExclusionRetryGate {
    let sig: string | null = null;
    let count = 0;
    return {
        resolve(contentSig, verdict) {
            if (verdict !== 'retry') {
                sig = null;
                count = 0;
                return verdict;
            }
            if (contentSig !== sig) {
                sig = contentSig;
                count = 0;
            }
            count++;
            if (count >= maxRetries) {
                sig = null;
                count = 0;
                return 'skip';
            }
            return 'retry';
        },
        reset() {
            sig = null;
            count = 0;
        },
    };
}
