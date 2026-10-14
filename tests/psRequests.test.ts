import { describe, expect, it } from 'vitest';
import { createLineReader, createPsRequests } from '../electron/lib/psRequests.cjs';

describe('createLineReader', () => {
    it('joins partial chunks and handles \\r\\n', () => {
        const lines: string[] = [];
        const r = createLineReader((l) => lines.push(l));
        r.push('1|PO');
        r.push(Buffer.from('S:1,2\r\n2|LO'));
        r.push('ST\n\n');
        expect(lines).toEqual(['1|POS:1,2', '2|LOST', '']);
    });
});

function setup() {
    const sent: string[] = [];
    const timers: { fn: () => void; ms: number; live: boolean }[] = [];
    const ps = createPsRequests({
        send: (s) => sent.push(s),
        timeoutMs: 1500,
        setTimer: (fn, ms) => {
            const t = { fn, ms, live: true };
            timers.push(t);
            return t;
        },
        clearTimer: (h) => {
            (h as { live: boolean }).live = false;
        },
    });
    return { ps, sent, timers };
}

describe('createPsRequests', () => {
    it('matches a reply to its id and clears the timer', async () => {
        const { ps, sent, timers } = setup();
        const p = ps.request((id) => `echo ${id}`);
        expect(sent).toEqual(['echo 1']);
        expect(ps.handleLine('1|POS:1,2,3,4')).toBe(true);
        expect(await p).toBe('POS:1,2,3,4');
        expect(timers[0].live).toBe(false);
        expect(ps.pendingCount()).toBe(0);
    });

    it('ignores unknown ids, plain lines and late replies', async () => {
        const { ps, timers } = setup();
        const p = ps.request(() => 'x');
        expect(ps.handleLine('garbage')).toBe(false);
        expect(ps.handleLine('99|POS:0,0,0,0')).toBe(false);
        expect(ps.handleLine('|x')).toBe(false);
        timers[0].fn();
        expect(await p).toBeNull();
        expect(ps.handleLine('1|POS:1,1,1,1')).toBe(false);
    });

    it('times out to null and frees the slot', async () => {
        const { ps, timers } = setup();
        const p = ps.request(() => 'x');
        expect(timers[0].ms).toBe(1500);
        timers[0].fn();
        expect(await p).toBeNull();
        expect(ps.pendingCount()).toBe(0);
    });

    it('rejectAll resolves everything with null', async () => {
        const { ps } = setup();
        const a = ps.request(() => 'a');
        const b = ps.request(() => 'b');
        ps.rejectAll();
        expect(await a).toBeNull();
        expect(await b).toBeNull();
        expect(ps.pendingCount()).toBe(0);
    });

    it('resolves null when send throws', async () => {
        const ps = createPsRequests({
            send: () => {
                throw new Error('closed');
            },
        });
        expect(await ps.request(() => 'x')).toBeNull();
        expect(ps.pendingCount()).toBe(0);
    });
});

describe('createPsRequests extras', () => {
    it('honours a per-request timeout override', () => {
        const { ps, timers } = setup();
        void ps.request(() => 'x', { timeoutMs: 10000 });
        void ps.request(() => 'y');
        expect(timers.map((t) => t.ms)).toEqual([10000, 1500]);
    });

    it('settles out-of-order replies by id', async () => {
        const { ps } = setup();
        const a = ps.request(() => 'a');
        const b = ps.request(() => 'b');
        ps.handleLine('2|B');
        ps.handleLine('1|A');
        expect(await a).toBe('A');
        expect(await b).toBe('B');
    });

    it('drops an oversized line without a newline and decodes split utf8', () => {
        const lines: string[] = [];
        const r = createLineReader((l) => lines.push(l));
        r.push('x'.repeat(70000));
        r.push('1|ok\n');
        expect(lines).toEqual(['1|ok']);
        const euro = Buffer.from('1|€\n');
        r.push(euro.subarray(0, 3));
        r.push(euro.subarray(3));
        expect(lines[1]).toBe('1|€');
    });
});
