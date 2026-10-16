// Importing .txt / .md files as notes (and opening one with KoBar): the limits, the name rules and the byte-to-text decoding, shared by
// the main process (which reads and validates the file) and the renderer (which decodes it and builds the note).

export const TEXT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const TEXT_IMPORT_EXTENSIONS = ['.txt', '.md'] as const;

export type { IpcTextFile, IpcTextPickResult, IpcTextReject, IpcTextRejectReason as TextImportRejectReason } from './ipc-contract.js';

export function isImportableTextName(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return TEXT_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/** "Shopping list.txt" -> "Shopping list". */
export function noteTitleFromFileName(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? fileName;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return stem.trim() || base.trim();
}

function isValidUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

/** UTF-16 without a BOM: mostly-ASCII text has a NUL in every other byte. */
function guessUtf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
    const sample = Math.min(bytes.length, 4096) & ~1;
    if (sample < 4) return null;
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < sample; i += 2) {
        if (bytes[i] === 0) evenNul++;
        if (bytes[i + 1] === 0) oddNul++;
    }
    const pairs = sample / 2;
    if (oddNul / pairs > 0.3 && evenNul / pairs < 0.05) return 'utf-16le';
    if (evenNul / pairs > 0.3 && oddNul / pairs < 0.05) return 'utf-16be';
    return null;
}

/**
 * Decodes a text file: UTF-8 (with or without BOM), UTF-16 (LE/BE, BOM or detected), otherwise Windows-1254 (Turkish ANSI, the usual
 * encoding of older Notepad files). Never throws.
 */
export function decodeTextBytes(bytes: Uint8Array): string {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    const utf16 = guessUtf16WithoutBom(bytes);
    if (utf16) return new TextDecoder(utf16).decode(bytes);
    if (isValidUtf8(bytes)) return new TextDecoder('utf-8').decode(bytes);
    return new TextDecoder('windows-1254').decode(bytes);
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text as the editor's HTML: one paragraph per line (the text is escaped, so a .md/.txt file can never inject markup). */
export function textToNoteHtml(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => (line === '' ? '<p></p>' : `<p>${escapeHtml(line)}</p>`))
        .join('');
}
