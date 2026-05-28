/**
 * Bidirectional converters between Tiptap HTML and Editor.js OutputData format.
 * Used when a user wants to convert a note from one editor engine to the other.
 */

// ─── Editor.js OutputData Types (inline, no external dep needed) ───

export interface EditorJsBlock {
    id?: string;
    type: string;
    data: Record<string, unknown>;
}

export interface EditorJsOutputData {
    time?: number;
    blocks: EditorJsBlock[];
    version?: string;
}

// ─── Tiptap HTML → Editor.js OutputData ───

export function tiptapHtmlToEditorJs(html: string): EditorJsOutputData {
    if (!html || html.trim() === '') {
        return { time: Date.now(), blocks: [], version: '2.30.0' };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks: EditorJsBlock[] = [];

    const children = Array.from(doc.body.childNodes);

    for (const node of children) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = (node.textContent || '').trim();
            if (text) {
                blocks.push({ type: 'paragraph', data: { text } });
            }
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();

        // Skip empty <br> tags used as spacers
        if (tagName === 'br') continue;

        // Headings
        const headingMatch = tagName.match(/^h([1-6])$/);
        if (headingMatch) {
            blocks.push({
                type: 'header',
                data: { text: el.innerHTML.trim(), level: parseInt(headingMatch[1], 10) }
            });
            continue;
        }

        // Unordered list
        if (tagName === 'ul') {
            const items = Array.from(el.querySelectorAll(':scope > li')).map(li => (li as HTMLElement).innerHTML.trim());
            if (items.length > 0) {
                blocks.push({ type: 'list', data: { style: 'unordered', items } });
            }
            continue;
        }

        // Ordered list
        if (tagName === 'ol') {
            const items = Array.from(el.querySelectorAll(':scope > li')).map(li => (li as HTMLElement).innerHTML.trim());
            if (items.length > 0) {
                blocks.push({ type: 'list', data: { style: 'ordered', items } });
            }
            continue;
        }

        // Blockquote
        if (tagName === 'blockquote') {
            blocks.push({ type: 'quote', data: { text: el.innerHTML.trim(), caption: '' } });
            continue;
        }

        // Code block
        if (tagName === 'pre') {
            const code = el.querySelector('code');
            blocks.push({ type: 'code', data: { code: (code || el).textContent || '' } });
            continue;
        }

        // Horizontal rule
        if (tagName === 'hr') {
            blocks.push({ type: 'delimiter', data: {} });
            continue;
        }

        // Image
        if (tagName === 'img') {
            blocks.push({
                type: 'image',
                data: {
                    file: { url: el.getAttribute('src') || '' },
                    caption: el.getAttribute('alt') || '',
                    withBorder: false,
                    stretched: false,
                    withBackground: false,
                }
            });
            continue;
        }

        // Paragraph (default) — skip empty paragraphs that are just spacers
        if (tagName === 'p') {
            const inner = el.innerHTML.trim();
            // Check if paragraph contains only an image
            const imgChild = el.querySelector('img');
            if (imgChild && el.childNodes.length === 1) {
                blocks.push({
                    type: 'image',
                    data: {
                        file: { url: imgChild.getAttribute('src') || '' },
                        caption: imgChild.getAttribute('alt') || '',
                        withBorder: false,
                        stretched: false,
                        withBackground: false,
                    }
                });
                continue;
            }
            if (inner && inner !== '<br>' && inner !== '<br/>') {
                blocks.push({ type: 'paragraph', data: { text: inner } });
            }
            continue;
        }

        // Fallback: treat as paragraph with raw HTML
        const fallbackText = el.innerHTML.trim();
        if (fallbackText) {
            blocks.push({ type: 'paragraph', data: { text: fallbackText } });
        }
    }

    return { time: Date.now(), blocks, version: '2.30.0' };
}

// ─── Editor.js OutputData → Tiptap HTML ───

export function editorJsToTiptapHtml(data: EditorJsOutputData): string {
    if (!data || !data.blocks || data.blocks.length === 0) {
        return '';
    }

    const parts: string[] = [];

    for (const block of data.blocks) {
        switch (block.type) {
            case 'paragraph':
                parts.push(`<p>${block.data.text || ''}</p>`);
                break;

            case 'header': {
                const level = block.data.level || 2;
                parts.push(`<h${level}>${block.data.text || ''}</h${level}>`);
                break;
            }

            case 'list': {
                const tag = block.data.style === 'ordered' ? 'ol' : 'ul';
                const items = (block.data.items as string[]) || [];
                const lis = items.map(item => `<li>${item}</li>`).join('');
                parts.push(`<${tag}>${lis}</${tag}>`);
                break;
            }

            case 'checklist': {
                const checkItems = (block.data.items as Array<{ text: string; checked: boolean }>) || [];
                const lis = checkItems.map(item =>
                    `<li>${item.checked ? '☑ ' : '☐ '}${item.text}</li>`
                ).join('');
                parts.push(`<ul>${lis}</ul>`);
                break;
            }

            case 'quote':
                parts.push(`<blockquote>${block.data.text || ''}</blockquote>`);
                break;

            case 'code':
                parts.push(`<pre><code>${block.data.code || ''}</code></pre>`);
                break;

            case 'delimiter':
                parts.push('<hr>');
                break;

            case 'image': {
                const fileData = block.data.file as { url?: string } | undefined;
                const url = fileData?.url || '';
                const caption = (block.data.caption as string) || '';
                parts.push(`<img src="${url}" alt="${caption}" />`);
                break;
            }

            default:
                // Unknown block types: render as paragraph
                if (block.data.text) {
                    parts.push(`<p>${block.data.text}</p>`);
                }
                break;
        }
    }

    return parts.join('\n');
}

// ─── Validator ───

export function validateEditorJsData(data: unknown): data is EditorJsOutputData {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.blocks)) return false;
    return obj.blocks.every((block: unknown) => {
        if (!block || typeof block !== 'object') return false;
        const b = block as Record<string, unknown>;
        return typeof b.type === 'string' && typeof b.data === 'object' && b.data !== null;
    });
}
