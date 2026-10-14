// PDF text extraction for the `parse-file` IPC handler, written for the pdf-parse v2 API
// (`new PDFParse({ data }).getText()`); the v1 `pdfParse(buffer)` function no longer exists.
//
// T-141: parsing a hostile or huge PDF can block for a long time, so `extractPdfText` never parses in the main process. It runs
// `parsePdfInProcess` inside a short-lived worker thread (electron/pdf-worker.cts) with a hard timeout and `terminate()`.
// The worker gets no Electron APIs: it only loads this file (and pdf-parse) and talks over its message port.

import { Worker } from 'worker_threads';
import * as path from 'path';

/** Extracted text is capped so a huge document cannot flood the renderer / an LLM request. */
export const PDF_TEXT_MAX_CHARS = 2_000_000;

interface PdfParserLike {
    getText(): Promise<{ text?: string }>;
    destroy(): Promise<void>;
}
type PdfParseCtor = new (options: { data: Uint8Array }) => PdfParserLike;

let cachedCtor: PdfParseCtor | null = null;
function loadPdfParse(): PdfParseCtor {
    if (!cachedCtor) {
        // Lazy: pdfjs is heavy and only needed when a PDF is actually attached.
        cachedCtor = (require('pdf-parse') as { PDFParse: PdfParseCtor }).PDFParse;
    }
    return cachedCtor;
}

/**
 * Parses a PDF in the CURRENT thread. Only the worker (and tests) should call this; the main process uses
 * `extractPdfText`. Throws an Error with a short message for empty, corrupt or encrypted documents.
 */
export async function parsePdfInProcess(buffer: Buffer | Uint8Array, maxChars: number = PDF_TEXT_MAX_CHARS): Promise<string> {
    if (!buffer || buffer.length === 0) throw new Error('Empty PDF file');
    let PDFParse: PdfParseCtor;
    try {
        PDFParse = loadPdfParse();
    } catch {
        throw new Error('PDF reader unavailable');
    }
    // pdfjs may detach/transfer the underlying memory, so hand it a private copy.
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
        const result = await parser.getText();
        const text = typeof result?.text === 'string' ? result.text : '';
        return text.length > maxChars ? text.slice(0, maxChars) + '\n\n[... PDF text truncated]' : text;
    } catch (e) {
        if (e instanceof Error && e.name === 'PasswordException') throw new Error('PDF is password-protected');
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(`Could not read PDF: ${reason}`);
    } finally {
        try {
            await parser.destroy();
        } catch {
            // best effort cleanup
        }
    }
}

/** Hard wall-clock limit for one extraction; after it the worker is terminated. */
export const PDF_EXTRACT_TIMEOUT_MS = 30_000;

/** Message sent to the worker. */
export interface PdfWorkerRequest {
    data: Uint8Array;
    maxChars: number;
}
/** Message the worker answers with (exactly one per request). */
export type PdfWorkerResponse = { type: 'result'; text: string } | { type: 'error'; message: string };

/** The small part of `worker_threads.Worker` this module uses (lets tests inject a fake). */
export interface PdfWorkerLike {
    on(event: 'message', listener: (msg: unknown) => void): unknown;
    on(event: 'error', listener: (err: unknown) => void): unknown;
    on(event: 'exit', listener: (code: number) => void): unknown;
    postMessage(msg: PdfWorkerRequest, transferList?: ArrayBuffer[]): void;
    terminate(): Promise<number> | unknown;
}

export interface ExtractPdfOptions {
    timeoutMs?: number;
    /** Test seam; defaults to spawning dist-electron/pdf-worker.cjs (see resolvePdfWorkerPath). */
    createWorker?: () => PdfWorkerLike;
}

/**
 * Path of the PDF worker script. T-301: esbuild inlines this module into dist-electron/main.cjs, so at runtime `bundleDir`
 * (__dirname) is dist-electron itself and the worker is its sibling dist-electron/pdf-worker.cjs (same resolution in dev and
 * inside app.asar).
 */
export function resolvePdfWorkerPath(bundleDir: string): string {
    return path.join(bundleDir, 'pdf-worker.cjs');
}

function defaultCreateWorker(): PdfWorkerLike {
    // maxOldGenerationSizeMb makes a runaway parse kill only the worker instead of the whole app.
    return new Worker(resolvePdfWorkerPath(__dirname), { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
}

function runInWorker(buffer: Buffer, maxChars: number, options: ExtractPdfOptions): Promise<string> {
    const timeoutMs = options.timeoutMs ?? PDF_EXTRACT_TIMEOUT_MS;
    return new Promise<string>((resolve, reject) => {
        let worker: PdfWorkerLike;
        try {
            worker = (options.createWorker ?? defaultCreateWorker)();
        } catch {
            reject(new Error('PDF reader unavailable'));
            return;
        }
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                // Always tear the worker down, success or not; a rejected terminate() must not become unhandled.
                Promise.resolve(worker.terminate()).catch(() => {});
            } catch {
                // best effort
            }
            fn();
        };
        const timer = setTimeout(
            () => finish(() => reject(new Error(`PDF took too long to read (over ${Math.max(1, Math.round(timeoutMs / 1000))} s)`))),
            timeoutMs
        );
        worker.on('message', (msg: unknown) => {
            const res = msg as Partial<PdfWorkerResponse> | null;
            if (res && res.type === 'result' && typeof res.text === 'string') {
                const text = res.text;
                finish(() => resolve(text));
            } else if (res && res.type === 'error' && typeof res.message === 'string') {
                const message = res.message;
                finish(() => reject(new Error(message)));
            } else {
                finish(() => reject(new Error('Could not read PDF: unexpected reader response')));
            }
        });
        worker.on('error', (err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            finish(() => reject(new Error(`Could not read PDF: ${reason}`)));
        });
        worker.on('exit', () => finish(() => reject(new Error('Could not read PDF: reader stopped unexpectedly'))));
        try {
            // Hand over a private copy and transfer it, so the (up to 50 MB) buffer is not copied a second time.
            const copy = new Uint8Array(buffer);
            worker.postMessage({ data: copy, maxChars }, [copy.buffer]);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            finish(() => reject(new Error(`Could not read PDF: ${reason}`)));
        }
    });
}

// Concurrency: at most ONE PDF job runs at a time. Further calls wait their turn (each still gets its own timeout once it
// starts), so several attached PDFs cannot spawn several large parsers at once. A failed job never blocks the queue.
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Extracts the text of a PDF in a worker thread with a hard timeout. Rejects with an Error with a short message for empty,
 * corrupt, encrypted or timed-out documents; the caller turns that into its normal `{ type: 'error' }` result.
 */
export function extractPdfText(buffer: Buffer, maxChars: number = PDF_TEXT_MAX_CHARS, options: ExtractPdfOptions = {}): Promise<string> {
    if (!buffer || buffer.length === 0) return Promise.reject(new Error('Empty PDF file'));
    const job = queueTail.then(() => runInWorker(buffer, maxChars, options));
    queueTail = job.catch(() => {});
    return job;
}
