// T-141: worker thread that parses one PDF per message. It deliberately imports no Electron API: only the PDF library (via
// ./lib/pdfText.cjs) and the message port. The main process terminates it after the answer or on timeout.
import { parentPort } from 'worker_threads';
import Module from 'module';
import { parsePdfInProcess } from './lib/pdfText.cjs';
import type { PdfWorkerRequest, PdfWorkerResponse } from './lib/pdfText.cjs';

// pdf-parse (pdfjs) loads the native `@napi-rs/canvas` addon at import time and copies its DOMMatrix / Path2D / ImageData onto
// globalThis. Tearing a worker thread down while that addon is loaded segfaults the whole process (reproduced with plain
// Node 24: any worker exit, incl. terminate(), after loading pdf-parse). Text extraction never renders, so the worker refuses
// to load the addon (pdfText.cjs requires pdf-parse lazily, i.e. after this guard) and gives pdfjs inert stand-ins for the
// three globals it only needs for rendering. If a future pdf-parse needs them for text it fails with a readable
// `Could not read PDF` error; the manual owner PDF test is the ONLY coverage of this guarded path (no automated test).
const moduleInternals = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = moduleInternals._load;
moduleInternals._load = function (this: unknown, request: string, ...rest: unknown[]) {
    if (typeof request === 'string' && request.startsWith('@napi-rs/canvas')) {
        return {};
    }
    return originalLoad.call(this, request, ...rest);
};
const globals = globalThis as unknown as Record<string, unknown>;
for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) {
    if (!globals[name]) globals[name] = class {};
}

if (parentPort) {
    const port = parentPort;
    port.on('message', (req: PdfWorkerRequest) => {
        parsePdfInProcess(req.data, req.maxChars)
            .then((text): PdfWorkerResponse => ({ type: 'result', text }))
            .catch((e): PdfWorkerResponse => ({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
            .then((res) => port.postMessage(res));
    });
}
