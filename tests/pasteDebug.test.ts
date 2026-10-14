import { describe, expect, it } from 'vitest';
import { createPasteDebug, errMsg } from '../electron/lib/pasteDebug.cjs';

describe('createPasteDebug', () => {
    it('is a silent no-op when disabled', () => {
        const lines: string[] = [];
        let calls = 0;
        const log = createPasteDebug({
            enabled: false,
            now: () => {
                calls++;
                return 1;
            },
            sink: (l) => lines.push(l),
        });
        log('a');
        log('b');
        expect(lines).toEqual([]);
        expect(calls).toBe(0);
    });

    it('prints absolute time on the first line, then relative ms and a sequence number', () => {
        const lines: string[] = [];
        const times = [1000, 1005, 1123];
        const log = createPasteDebug({ enabled: true, now: () => times.shift() as number, sink: (l) => lines.push(l) });
        log('one');
        log('two');
        log('three');
        expect(lines).toEqual(['[PASTE-DBG +0ms #1] one (abs=1000)', '[PASTE-DBG +5ms #2] two', '[PASTE-DBG +123ms #3] three']);
    });
});

describe('errMsg', () => {
    it('returns only the message', () => {
        expect(errMsg(new Error('boom'))).toBe('boom');
        expect(errMsg('payload')).toBe('non-Error value thrown');
        expect(errMsg({ secret: 1 })).toBe('non-Error value thrown');
    });
});
