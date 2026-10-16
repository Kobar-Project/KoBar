// Default file name for "save note as text": the note title, made safe for Windows (the old code replaced every non-ASCII letter with "_").
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function noteFileBaseName(title: unknown, fallback = 'note'): string {
    const raw = typeof title === 'string' ? title : '';
    const cleaned = raw
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, 100)
        .trim();
    if (!cleaned || RESERVED.test(cleaned)) return fallback;
    return cleaned;
}

/** Notepad on older Windows only breaks lines on CRLF. */
export function toCrlf(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}
