// T-308: clipboard monitoring and clipboard writes, moved unchanged out of main.cts (pure helpers stay in electron/lib/clipboardGuards.cts).
// Nothing here is injected: the module only needs electron APIs and its own state. Polling still starts and stops exactly as before,
// i.e. only while at least one renderer called `start-clipboard-listener`; the Clipboard Manager protection rules (password-manager
// exclusion, no clipboard access without a subscriber) are untouched.
import { clipboard, ClipboardItem, ipcMain, nativeImage, webContents, type WebContents } from 'electron';
import {
    CAN_INCLUDE_FORMAT,
    EXCLUDE_FORMAT,
    clipboardImageMatches,
    clipboardTextMatches,
    type ExclusionVerdict,
    createExclusionRetryGate,
    imageSignature,
    hasMacConcealedMarker,
    inspectClipboardTypes,
    MAC_CONCEALED_FORMATS,
    osClipboardMime,
    shouldSkipClipboard,
    textSignature,
} from '../../lib/clipboardGuards.cjs';
import { pasteDbg } from '../../lib/pasteDebug.cjs';
import { SubscriberSet } from '../../lib/subscribers.cjs';

const isMac = process.platform === 'darwin';

let clipboardPollingInterval: ReturnType<typeof setInterval> | null = null;
// SHA-256 of the clipboard text last seen ('' = none). Only a hash is kept, never the plain text (T-037).
let lastClipboardTextSig = '';
// Turns endless 'retry' exclusion verdicts for the same content into 'skip' (T-037).
const clipboardRetryGate = createExclusionRetryGate();
// Signature (mime + length + SHA-1) of the encoded image last seen on the clipboard. Electron 44 removed
// the sync readImage()/toBitmap() path, so change detection compares this small signature instead.
let lastClipboardImageSig: string | null = null;
let isClipboardPollInFlight = false;
// True until the current clipboard content has been recorded after a (re)start, so it is never announced as new.
let clipboardBaselinePending = false;
// webContents ids of renderers that called startClipboardListener. Polling only runs while this is non-empty
// and updates are only sent to these renderers. Released on stop, main-frame reload, crash or destroy.
const clipboardSubscribers = new SubscriberSet<number>();
const clipboardSubscriberCleanups = new Map<number, () => void>();
// Serializes async clipboard work (poller + writers) so a poll can never interleave with a write.
let clipboardTaskQueue: Promise<unknown> = Promise.resolve();

// --- Clipboard Polling ---
export function runClipboardTask<T>(task: () => Promise<T>): Promise<T> {
    const run = clipboardTaskQueue.then(task, task);
    clipboardTaskQueue = run.catch(() => undefined);
    return run;
}

// Reads the clipboard image as encoded bytes (PNG preferred, JPEG fallback), or null if none.
// Pass already-read items to avoid a second clipboard.read() in the same tick.
async function readClipboardImage(
    preReadItems?: Electron.ClipboardItem[]
): Promise<{ bytes: Buffer; mime: 'image/png' | 'image/jpeg' } | null> {
    const items = preReadItems ?? (await clipboard.read());
    const pngItem = items.find((item) => item.types.includes('image/png'));
    const item = pngItem ?? items.find((i) => i.types.includes('image/jpeg'));
    if (!item) return null;
    const mime: 'image/png' | 'image/jpeg' = pngItem ? 'image/png' : 'image/jpeg';
    const blob = await item.getType(mime);
    const bytes = Buffer.from(await blob.arrayBuffer());
    return bytes.length > 0 ? { bytes, mime } : null;
}

// Reads the clipboard text from already-read items (one clipboard.read() per tick, T-037); '' if none.
// Falls back to readText() only when the text item cannot be decoded.
async function readClipboardText(items: Electron.ClipboardItem[]): Promise<string> {
    const item = items.find((i) => i.types.includes('text/plain'));
    if (!item) return '';
    try {
        const blob = await item.getType('text/plain');
        return (await blob.text()) || '';
    } catch {
        return (await clipboard.readText()) || '';
    }
}

// Records the current clipboard text and image signatures exactly as the poller will read them back, so the next
// tick sees no change. Used for the start baseline and right after KoBar itself wrote to the clipboard.
async function recordClipboardSnapshot(): Promise<void> {
    const items = await clipboard.read();
    lastClipboardTextSig = textSignature(await readClipboardText(items));
    const image = await readClipboardImage(items);
    lastClipboardImageSig = image ? imageSignature(image.mime, image.bytes) : null;
    clipboardRetryGate.reset();
}

// Returns the PNG bytes that were written, so callers can fall back to their signature.
async function writeClipboardImage(img: Electron.NativeImage): Promise<Buffer> {
    const png = img.toPNG();
    // `as never`: Buffer vs BlobPart lib typing mismatch only (Buffer is a valid Blob part at runtime).
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as never], { type: 'image/png' }) })]);
    return png;
}

// Writes a renderer-provided clipboard entry (text or image data URL). Neither is re-announced by the poller:
// the dedupe cache is updated only AFTER a successful write (a failed write must not poison it), from a single
// read-back of what the poller will see (T-037).
// The small race is intentional: if another app copies something between our write and the read-back, that content
// is recorded as seen and never announced. This fails closed with respect to the exclusion check (a password copied
// in that instant is not announced either).
export async function writeClipboardEntry(data: { type: string; content: string }): Promise<void> {
    let writtenPng: Buffer | null = null;
    pasteDbg(`clipboard write start: type=${data.type}, length=${typeof data.content === 'string' ? data.content.length : 'n/a'}`);
    if (data.type === 'text') {
        await clipboard.writeText(data.content);
    } else if (data.type === 'image') {
        writtenPng = await writeClipboardImage(nativeImage.createFromDataURL(data.content));
    } else {
        pasteDbg('clipboard write skipped: unknown type');
        return;
    }
    pasteDbg('clipboard write end');
    try {
        pasteDbg('snapshot readback start');
        await recordClipboardSnapshot();
        pasteDbg('snapshot readback end');
    } catch (err) {
        pasteDbg(`ERROR snapshot readback failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        // Read-back failed (clipboard locked by another app): fall back to what was written. For images this is
        // best-effort: it matches only if the OS round-trips the PNG bytes unchanged.
        if (data.type === 'text') {
            lastClipboardTextSig = textSignature(data.content);
            lastClipboardImageSig = null;
        } else if (writtenPng) {
            lastClipboardTextSig = '';
            lastClipboardImageSig = writtenPng.length > 0 ? imageSignature('image/png', writtenPng) : null;
        }
    }
}

/**
 * R4: global paste write. Writes the entry, reads the clipboard back once and resolves true only when the read-back matches
 * what was written (text: same text; image: an image with the same bytes or pixel size). The poller's dedupe cache is updated
 * from that read-back exactly like writeClipboardEntry. A failed or unverifiable write resolves false, so the caller does not
 * simulate Ctrl+V over stale clipboard content. Never logs content, only kinds and lengths.
 */
export async function writeClipboardEntryVerified(data: { type: string; content: string }): Promise<boolean> {
    if (!data || typeof data.content !== 'string') {
        pasteDbg('verified write skipped: invalid entry');
        return false;
    }
    pasteDbg(`verified write start: type=${data.type}, length=${data.content.length}`);
    let written: { png: Buffer; size: { width: number; height: number } } | null = null;
    if (data.type === 'text') {
        await clipboard.writeText(data.content);
    } else if (data.type === 'image') {
        const img = nativeImage.createFromDataURL(data.content);
        if (img.isEmpty()) {
            pasteDbg('verified write skipped: image could not be decoded');
            return false;
        }
        written = { png: await writeClipboardImage(img), size: img.getSize() };
    } else {
        pasteDbg('verified write skipped: unknown type');
        return false;
    }
    pasteDbg('verified write end, read-back start');
    let ok = false;
    try {
        const items = await clipboard.read();
        const text = await readClipboardText(items);
        const image = await readClipboardImage(items);
        const readBackSignature = image ? imageSignature(image.mime, image.bytes) : null;
        lastClipboardTextSig = textSignature(text);
        lastClipboardImageSig = readBackSignature;
        clipboardRetryGate.reset();
        if (written) {
            ok = clipboardImageMatches({
                writtenSignature: written.png.length > 0 ? imageSignature('image/png', written.png) : '',
                writtenSize: written.size,
                readBackSignature,
                readBackSize: image ? nativeImage.createFromBuffer(image.bytes).getSize() : null,
            });
        } else {
            ok = clipboardTextMatches(data.content, text);
        }
    } catch (err) {
        pasteDbg(`ERROR read-back failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        // Same fallback as writeClipboardEntry, so the poller does not re-announce our own write; the paste is not verified.
        if (written) {
            lastClipboardTextSig = '';
            lastClipboardImageSig = written.png.length > 0 ? imageSignature('image/png', written.png) : null;
        } else {
            lastClipboardTextSig = textSignature(data.content);
            lastClipboardImageSig = null;
        }
    }
    pasteDbg(`verified write result: verified=${ok}`);
    return ok;
}

function broadcastClipboardUpdate(data: { type: 'text' | 'image'; content: string }): void {
    for (const id of clipboardSubscribers.values()) {
        const wc = webContents.fromId(id);
        if (wc && !wc.isDestroyed()) wc.send('clipboard-updated', data);
    }
}

// Password managers mark secrets with Windows formats that ask clipboard monitors to ignore them.
// Electron 44 only exposes raw OS formats via the `electron application/osclipboard` MIME wrapper.
// Called only when content changed, so the extra lookups do not run on every tick.
// Returns 'allow', 'skip' (excluded: record it as seen, never announce) or 'retry' (lookup failed:
// do not announce and do not record, so the next tick re-evaluates).
async function checkClipboardExclusion(items: Electron.ClipboardItem[]): Promise<ExclusionVerdict> {
    // MAC-018: macOS password managers mark secrets with nspasteboard.org types; fail closed like Windows.
    if (process.platform === 'darwin') {
        try {
            if (hasMacConcealedMarker(items.flatMap((item) => item.types))) return 'skip';
            for (const uti of MAC_CONCEALED_FORMATS) {
                if (await clipboard.has(osClipboardMime(uti))) return 'skip';
            }
            return 'allow';
        } catch {
            return 'retry';
        }
    }
    if (process.platform !== 'win32') return 'allow';
    try {
        const info = inspectClipboardTypes(items.flatMap((item) => item.types));
        const excludedMarker = info.excluded || (await clipboard.has(osClipboardMime(EXCLUDE_FORMAT)));
        let canIncludePresent = info.canIncludeType !== null;
        let canIncludeValue: Uint8Array | null = null;
        if (!excludedMarker) {
            const wrapped = osClipboardMime(CAN_INCLUDE_FORMAT);
            canIncludePresent = canIncludePresent || (await clipboard.has(wrapped));
            const typeName = info.canIncludeType ?? wrapped;
            const item = canIncludePresent ? items.find((i) => i.types.includes(typeName)) : undefined;
            const data = item ? await item.getType(typeName) : null;
            if (data && 'arrayBuffer' in data) canIncludeValue = new Uint8Array(await data.arrayBuffer());
        }
        return shouldSkipClipboard({ excludedMarker, canIncludePresent, canIncludeValue }) ? 'skip' : 'allow';
    } catch {
        return 'retry';
    }
}

// Records the current clipboard text AND image so content that existed before start is not reported as new.
async function captureClipboardBaseline(): Promise<void> {
    await recordClipboardSnapshot();
    clipboardBaselinePending = false;
}

async function pollClipboardOnce(): Promise<void> {
    if (clipboardSubscribers.size === 0) return;
    // The baseline read at start failed (clipboard locked by another app): retry it instead of announcing.
    if (clipboardBaselinePending) return captureClipboardBaseline();

    // A single clipboard read per tick: text, image and exclusion checks all use these items.
    const items = await clipboard.read();
    const types = items.flatMap((item) => item.types);

    // 1. FAST PATH: Check for Text
    if (types.includes('text/plain')) {
        const currentText = await readClipboardText(items);
        const textSig = textSignature(currentText);
        if (currentText && textSig !== lastClipboardTextSig) {
            // A lookup that keeps failing for the same content becomes 'skip' after a few ticks.
            const verdict = clipboardRetryGate.resolve(`text:${textSig}`, await checkClipboardExclusion(items));
            if (verdict === 'retry') return; // nothing recorded: the next tick re-checks
            lastClipboardTextSig = textSig;
            lastClipboardImageSig = null;
            // Excluded content (password manager) is recorded as seen but never announced.
            if (verdict === 'skip') return;
            broadcastClipboardUpdate({ type: 'text', content: currentText });
        }
        return;
    }

    // 2. HEAVY PATH: byte-level comparison of the encoded image
    if (types.includes('image/png') || types.includes('image/jpeg')) {
        const image = await readClipboardImage(items);
        if (!image) return;

        // Signature check: only notify when the image changed. The full SHA-1 per tick is deliberate:
        // a size-only shortcut would miss edits that keep the byte length.
        const sig = imageSignature(image.mime, image.bytes);
        if (sig !== lastClipboardImageSig) {
            const verdict = clipboardRetryGate.resolve(`image:${sig}`, await checkClipboardExclusion(items));
            if (verdict === 'retry') return;
            lastClipboardImageSig = sig;
            lastClipboardTextSig = '';
            if (verdict === 'skip') return;

            // EXECUTED ONLY ONCE PER NEW IMAGE (consumers expect a PNG data URL)
            const currentDataUrl =
                image.mime === 'image/png'
                    ? `data:image/png;base64,${image.bytes.toString('base64')}`
                    : nativeImage.createFromBuffer(image.bytes).toDataURL();

            // No show()/focus() here: copying an image must not steal focus from the user's app (SEC-08).
            broadcastClipboardUpdate({ type: 'image', content: currentDataUrl });
        }
    }
}

function startClipboardPolling() {
    if (clipboardPollingInterval) return;
    clipboardBaselinePending = true;
    void runClipboardTask(captureClipboardBaseline).catch(() => {
        /* clipboard may be locked by another app; the poller retries the baseline */
    });
    clipboardPollingInterval = setInterval(
        () => {
            if (isClipboardPollInFlight) return;
            isClipboardPollInFlight = true;
            runClipboardTask(pollClipboardOnce)
                .catch(() => {
                    /* clipboard may be temporarily locked by another app; retry next tick */
                })
                .finally(() => {
                    isClipboardPollInFlight = false;
                });
        },
        isMac ? 1000 : 500
    );
}

function stopClipboardPolling() {
    if (clipboardPollingInterval) clearInterval(clipboardPollingInterval);
    clipboardPollingInterval = null;
}

function subscribeClipboard(wc: WebContents): void {
    const id = wc.id;
    if (clipboardSubscribers.has(id)) return;
    const release = () => unsubscribeClipboard(id);
    // A committed main-frame cross-document navigation (e.g. a reload) drops the renderer's listeners, so it must
    // start again after loading. 'did-navigate' (not 'did-start-navigation') ignores navigations that never commit,
    // such as external links cancelled by the will-navigate guard, downloads or 204 responses.
    wc.on('did-navigate', release);
    wc.on('render-process-gone', release);
    wc.on('destroyed', release);
    clipboardSubscriberCleanups.set(id, () => {
        if (wc.isDestroyed()) return;
        wc.removeListener('did-navigate', release);
        wc.removeListener('render-process-gone', release);
        wc.removeListener('destroyed', release);
    });
    if (clipboardSubscribers.add(id)) startClipboardPolling();
}

function unsubscribeClipboard(id: number): void {
    clipboardSubscriberCleanups.get(id)?.();
    clipboardSubscriberCleanups.delete(id);
    if (clipboardSubscribers.remove(id)) stopClipboardPolling();
}

// Counted per window (sender webContents); polling starts with the first window and stops with the last.
export function registerClipboardIpc() {
    ipcMain.on('start-clipboard-listener', (event) => {
        subscribeClipboard(event.sender);
    });

    ipcMain.on('stop-clipboard-listener', (event) => {
        unsubscribeClipboard(event.sender.id);
    });

    ipcMain.on('write-to-clipboard', (_event, data: { type: string; content: string }) => {
        runClipboardTask(() => writeClipboardEntry(data)).catch((err) => console.error('Clipboard write failed:', err));
    });
}

// Copy screenshot to system clipboard (registered next to the other screenshot handlers).
export function registerCopyScreenshotIpc() {
    ipcMain.on('copy-screenshot-to-clipboard', (_event, dataUrl: string) => {
        const img = nativeImage.createFromDataURL(dataUrl);
        runClipboardTask(async () => {
            await writeClipboardImage(img);
            // Cache the signatures of what the poller will read back so it does not re-announce this copy.
            await recordClipboardSnapshot();
        }).catch((err) => console.error('Screenshot clipboard copy failed:', err));
    });
}
