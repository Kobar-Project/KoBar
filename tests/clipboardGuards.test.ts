import { describe, expect, it } from 'vitest';
import { readMainModule, readMainSources } from './helpers/mainSource';
import {
    EXCLUSION_MAX_RETRIES,
    createExclusionRetryGate,
    imageSignature,
    inspectClipboardTypes,
    isCanIncludeZero,
    osClipboardMime,
    shouldSkipClipboard,
    textSignature,
} from '../electron/lib/clipboardGuards.cjs';

describe('inspectClipboardTypes', () => {
    it('detects the exclude marker in a wrapped OS format', () => {
        const info = inspectClipboardTypes(['text/plain', osClipboardMime('ExcludeClipboardContentFromMonitorProcessing')]);
        expect(info.excluded).toBe(true);
    });
    it('reports the CanInclude type name case-insensitively', () => {
        const info = inspectClipboardTypes(['canincludeinclipboardhistory']);
        expect(info.canIncludeType).toBe('canincludeinclipboardhistory');
        expect(info.excluded).toBe(false);
    });
    it('is clean for ordinary content', () => {
        expect(inspectClipboardTypes(['text/plain', 'text/html', 'image/png'])).toEqual({ excluded: false, canIncludeType: null });
    });
});

describe('isCanIncludeZero / shouldSkipClipboard', () => {
    it('treats DWORD 0 as exclude and non-zero as include', () => {
        expect(isCanIncludeZero(new Uint8Array([0, 0, 0, 0]))).toBe(true);
        expect(isCanIncludeZero(new Uint8Array([1, 0, 0, 0]))).toBe(false);
        expect(isCanIncludeZero(new Uint8Array([0, 0, 0, 1]))).toBe(false);
    });
    it('does not exclude on missing or truncated data', () => {
        expect(isCanIncludeZero(null)).toBe(false);
        expect(isCanIncludeZero(new Uint8Array([0, 0]))).toBe(false);
    });
    it('skips on marker or explicit zero', () => {
        expect(shouldSkipClipboard({ excludedMarker: true, canIncludePresent: false, canIncludeValue: null })).toBe(true);
        expect(shouldSkipClipboard({ excludedMarker: false, canIncludePresent: true, canIncludeValue: new Uint8Array(4) })).toBe(true);
    });
    it('skips when CanInclude is present but unreadable or truncated (fail closed)', () => {
        expect(shouldSkipClipboard({ excludedMarker: false, canIncludePresent: true, canIncludeValue: null })).toBe(true);
        expect(shouldSkipClipboard({ excludedMarker: false, canIncludePresent: true, canIncludeValue: new Uint8Array(2) })).toBe(true);
    });
    it('allows only when absent, or present with a readable non-zero value', () => {
        expect(shouldSkipClipboard({ excludedMarker: false, canIncludePresent: false, canIncludeValue: undefined })).toBe(false);
        expect(shouldSkipClipboard({ excludedMarker: false, canIncludePresent: true, canIncludeValue: new Uint8Array([1, 0, 0, 0]) })).toBe(
            false
        );
    });
});

describe('imageSignature', () => {
    it('is deterministic and sensitive to content, length and mime', () => {
        const a = new Uint8Array([1, 2, 3, 4]);
        expect(imageSignature('image/png', a)).toBe(imageSignature('image/png', new Uint8Array([1, 2, 3, 4])));
        expect(imageSignature('image/png', a)).not.toBe(imageSignature('image/png', new Uint8Array([1, 2, 3, 5])));
        expect(imageSignature('image/png', a)).not.toBe(imageSignature('image/jpeg', a));
        expect(imageSignature('image/png', a)).not.toBe(imageSignature('image/png', new Uint8Array([1, 2, 3])));
    });
});

describe('textSignature', () => {
    it('maps empty text to the reset value', () => {
        expect(textSignature('')).toBe('');
    });

    it('is a deterministic SHA-256 hex digest that does not contain the text', () => {
        const sig = textSignature('hunter2-secret');
        expect(sig).toMatch(/^[0-9a-f]{64}$/);
        expect(sig).toBe(textSignature('hunter2-secret'));
        expect(sig).not.toContain('hunter2');
    });

    it('distinguishes different texts, including whitespace and unicode', () => {
        expect(textSignature('a')).not.toBe(textSignature('b'));
        expect(textSignature('a')).not.toBe(textSignature('a '));
        expect(textSignature('line\n')).not.toBe(textSignature('line\r\n'));
        expect(textSignature('ü')).not.toBe(textSignature('u'));
    });
});

describe('createExclusionRetryGate', () => {
    it('passes allow and skip through unchanged', () => {
        const gate = createExclusionRetryGate();
        expect(gate.resolve('a', 'allow')).toBe('allow');
        expect(gate.resolve('a', 'skip')).toBe('skip');
    });

    it('turns the third consecutive retry for the same content into skip', () => {
        expect(EXCLUSION_MAX_RETRIES).toBe(3);
        const gate = createExclusionRetryGate();
        expect(gate.resolve('a', 'retry')).toBe('retry');
        expect(gate.resolve('a', 'retry')).toBe('retry');
        expect(gate.resolve('a', 'retry')).toBe('skip');
        // The count starts over afterwards.
        expect(gate.resolve('a', 'retry')).toBe('retry');
    });

    it('resets the count when the content changes', () => {
        const gate = createExclusionRetryGate();
        gate.resolve('a', 'retry');
        gate.resolve('a', 'retry');
        expect(gate.resolve('b', 'retry')).toBe('retry');
        expect(gate.resolve('b', 'retry')).toBe('retry');
        expect(gate.resolve('b', 'retry')).toBe('skip');
    });

    it('resets the count after a non-retry verdict or reset()', () => {
        const gate = createExclusionRetryGate();
        gate.resolve('a', 'retry');
        gate.resolve('a', 'retry');
        expect(gate.resolve('a', 'allow')).toBe('allow');
        expect(gate.resolve('a', 'retry')).toBe('retry');
        expect(gate.resolve('a', 'retry')).toBe('retry');
        gate.reset();
        expect(gate.resolve('a', 'retry')).toBe('retry');
    });

    it('honours a custom limit', () => {
        const gate = createExclusionRetryGate(1);
        expect(gate.resolve('a', 'retry')).toBe('skip');
    });
});

describe('clipboard poller wiring in electron/main/services/clipboard.cts (T-037)', () => {
    // T-308: the poller moved out of main.cts.
    const src = readMainModule('services/clipboard.cts');
    const body = (start: string) => {
        const idx = src.indexOf(start);
        expect(idx).toBeGreaterThanOrEqual(0);
        const from = src.slice(idx);
        return from.slice(0, from.search(/\r?\n\}\r?\n/));
    };

    it('keeps only a hash of the last clipboard text', () => {
        expect(readMainSources()).not.toMatch(/\blastClipboardText\b/);
        expect(src).toContain('lastClipboardTextSig');
    });

    it('reads the clipboard once per tick and routes exclusion verdicts through the retry gate', () => {
        const poll = body('async function pollClipboardOnce(');
        expect(poll.match(/clipboard\.read\(\)/g)).toHaveLength(1);
        expect(poll).not.toContain('readText(');
        expect(poll.match(/clipboardRetryGate\.resolve\(/g)).toHaveLength(2);
    });

    it('updates the write dedupe cache only after the write', () => {
        const write = body('async function writeClipboardEntry(');
        const snapshot = write.indexOf('recordClipboardSnapshot()');
        expect(write.indexOf('clipboard.writeText(')).toBeGreaterThanOrEqual(0);
        expect(snapshot).toBeGreaterThan(write.indexOf('clipboard.writeText('));
        expect(snapshot).toBeGreaterThan(write.indexOf('writeClipboardImage('));
    });
});
