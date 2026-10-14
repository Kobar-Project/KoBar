// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPdfText, parsePdfInProcess } from '../electron/lib/pdfText.cjs';
import type { PdfWorkerLike, PdfWorkerRequest, PdfWorkerResponse } from '../electron/lib/pdfText.cjs';

/** Builds a minimal one-page PDF (Helvetica) containing the given ASCII text. */
function buildPdf(text: string, trailerExtra = ''): Buffer {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

describe('parsePdfInProcess', () => {
    it('extracts the text of a minimal PDF', async () => {
        const text = await parsePdfInProcess(buildPdf('Hello KoBar'));
        expect(text).toContain('Hello KoBar');
    }, 30_000); // first call loads the PDF parser cold; slow CI runners exceed the 5 s default

    it('can be called repeatedly (parser is destroyed each time)', async () => {
        expect(await parsePdfInProcess(buildPdf('First'))).toContain('First');
        expect(await parsePdfInProcess(buildPdf('Second'))).toContain('Second');
    });

    it('rejects an empty buffer', async () => {
        await expect(parsePdfInProcess(Buffer.alloc(0))).rejects.toThrow('Empty PDF');
    });

    it('rejects a corrupt buffer with a readable error', async () => {
        await expect(parsePdfInProcess(Buffer.from('this is not a pdf at all'))).rejects.toThrow(/Could not read PDF/);
    });

    it('truncates text above the cap and appends a marker', async () => {
        const text = await parsePdfInProcess(buildPdf('Hello KoBar'), 5);
        expect(text.startsWith('Hello')).toBe(true);
        expect(text).toContain('[... PDF text truncated]');
        expect(text).not.toContain('KoBar');
    });

    it('does not mark text within the cap as truncated', async () => {
        expect(await parsePdfInProcess(buildPdf('Hello KoBar'))).not.toContain('truncated');
    });

    it('rejects an encrypted PDF', async () => {
        const enc = buildPdf('Secret', '/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>');
        await expect(parsePdfInProcess(enc)).rejects.toThrow(/Could not read PDF|password/);
    });
});

/** Fake worker: records calls; `onPost` decides how (and whether) it answers. */
class FakeWorker extends EventEmitter implements PdfWorkerLike {
    terminate = vi.fn(async () => 0);
    posted: PdfWorkerRequest[] = [];
    private readonly onPost: (req: PdfWorkerRequest, self: FakeWorker) => void;
    constructor(onPost: (req: PdfWorkerRequest, self: FakeWorker) => void) {
        super();
        this.onPost = onPost;
    }
    postMessage(msg: PdfWorkerRequest): void {
        this.posted.push(msg);
        this.onPost(msg, this);
    }
}
const reply = (w: FakeWorker, res: PdfWorkerResponse) => queueMicrotask(() => w.emit('message', res));

describe('extractPdfText (worker, T-141)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the worker result, forwards the data and cap, and terminates the worker', async () => {
        const worker = new FakeWorker((_req, self) => reply(self, { type: 'result', text: 'hello' }));
        const text = await extractPdfText(Buffer.from('%PDF-fake'), 123, { createWorker: () => worker });
        expect(text).toBe('hello');
        expect(worker.posted).toHaveLength(1);
        expect(worker.posted[0].maxChars).toBe(123);
        expect(Buffer.from(worker.posted[0].data).toString()).toBe('%PDF-fake');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('maps a worker error message to a rejected Error and terminates', async () => {
        const worker = new FakeWorker((_req, self) => reply(self, { type: 'error', message: 'PDF is password-protected' }));
        await expect(extractPdfText(Buffer.from('x'), 10, { createWorker: () => worker })).rejects.toThrow('PDF is password-protected');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('maps a worker crash (error event) and an unexpected exit', async () => {
        const crashing = new FakeWorker((_r, self) => queueMicrotask(() => self.emit('error', new Error('out of memory'))));
        await expect(extractPdfText(Buffer.from('x'), 10, { createWorker: () => crashing })).rejects.toThrow(
            /Could not read PDF: out of memory/
        );
        const exiting = new FakeWorker((_r, self) => queueMicrotask(() => self.emit('exit', 1)));
        await expect(extractPdfText(Buffer.from('x'), 10, { createWorker: () => exiting })).rejects.toThrow(/stopped unexpectedly/);
    });

    it('rejects a malformed worker response and a failing worker factory', async () => {
        const odd = new FakeWorker((_r, self) => queueMicrotask(() => self.emit('message', { nope: true })));
        await expect(extractPdfText(Buffer.from('x'), 10, { createWorker: () => odd })).rejects.toThrow(/unexpected reader response/);
        await expect(
            extractPdfText(Buffer.from('x'), 10, {
                createWorker: () => {
                    throw new Error('boom');
                },
            })
        ).rejects.toThrow('PDF reader unavailable');
    });

    it('times out a stalling worker, terminates it and does not wait for a late answer', async () => {
        vi.useFakeTimers();
        const worker = new FakeWorker(() => {});
        const p = extractPdfText(Buffer.from('x'), 10, { timeoutMs: 5000, createWorker: () => worker });
        const assertion = expect(p).rejects.toThrow(/took too long/);
        await vi.advanceTimersByTimeAsync(5000);
        await assertion;
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        worker.emit('message', { type: 'result', text: 'late' }); // ignored: already settled
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('does not let a rejected terminate() become an unhandled rejection', async () => {
        const worker = new FakeWorker((_r, self) => reply(self, { type: 'result', text: 'ok' }));
        worker.terminate = vi.fn(async () => {
            throw new Error('already gone');
        });
        await expect(extractPdfText(Buffer.from('x'), 10, { createWorker: () => worker })).resolves.toBe('ok');
    });

    it('rejects an empty buffer without spawning a worker', async () => {
        const createWorker = vi.fn();
        await expect(extractPdfText(Buffer.alloc(0), 10, { createWorker })).rejects.toThrow('Empty PDF');
        expect(createWorker).not.toHaveBeenCalled();
    });

    it('runs one job at a time and a failed job does not block the next', async () => {
        const order: string[] = [];
        let releaseFirst: () => void = () => {};
        const first = new FakeWorker((_r, self) => {
            order.push('first-start');
            releaseFirst = () => {
                order.push('first-end');
                self.emit('error', new Error('bad'));
            };
        });
        const second = new FakeWorker((_r, self) => {
            order.push('second-start');
            reply(self, { type: 'result', text: 'two' });
        });
        const p1 = extractPdfText(Buffer.from('1'), 10, { createWorker: () => first });
        const p2 = extractPdfText(Buffer.from('2'), 10, { createWorker: () => second });
        const rejection = expect(p1).rejects.toThrow(/bad/);
        await new Promise((r) => setTimeout(r, 20));
        expect(order).toEqual(['first-start']);
        releaseFirst();
        await rejection;
        expect(await p2).toBe('two');
        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });
});
