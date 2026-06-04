import type { API, BlockTool, BlockToolData, ToolConfig } from '@editorjs/editorjs';

export interface CodeData extends BlockToolData {
    code: string;
    language: string;
    height: number;
}

export default class CustomCodeTool implements BlockTool {
    api: API;
    data: CodeData;
    config: ToolConfig;
    wrapper: HTMLElement | null = null;
    textarea: HTMLTextAreaElement | null = null;
    pre: HTMLElement | null = null;
    codeContainer: HTMLElement | null = null;
    select: HTMLSelectElement | null = null;

    static get isReadOnlySupported() {
        return true;
    }

    static get enableLineBreaks() {
        return true;
    }

    static get toolbox() {
        return {
            icon: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1 7l4-4v2.5L2.5 7l2.5 1.5V11L1 7zm12 0l-4 4V8.5L11.5 7 9 5.5V3l4 4z"/></svg>',
            title: 'Code'
        };
    }

    constructor({ data, config, api }: { data: any; config: ToolConfig; api: API }) {
        this.api = api;
        this.config = config;
        this.data = {
            code: data.code || '',
            language: data.language || 'javascript',
            height: data.height || 150
        };
    }

    render() {
        this.wrapper = document.createElement('div');
        this.wrapper.classList.add('custom-code-tool');
        this.wrapper.style.marginBottom = '1.5rem';

        const header = document.createElement('div');
        header.classList.add('code-header');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.backgroundColor = 'var(--theme-bg-dark)';
        header.style.padding = '4px 12px';
        header.style.borderTopLeftRadius = '8px';
        header.style.borderTopRightRadius = '8px';
        header.style.border = '1px solid var(--theme-border)';
        header.style.borderBottom = 'none';
        header.style.userSelect = 'none';

        this.select = document.createElement('select');
        this.select.style.background = 'transparent';
        this.select.style.color = '#94a3b8';
        this.select.style.border = 'none';
        this.select.style.outline = 'none';
        this.select.style.fontSize = '0.75rem';
        this.select.style.cursor = 'pointer';

        const langs = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'plaintext'];
        langs.forEach(lang => {
            const opt = document.createElement('option');
            opt.value = lang;
            opt.innerText = lang.toUpperCase();
            opt.style.background = 'var(--theme-bg-base)';
            if (this.data.language === lang) opt.selected = true;
            this.select?.appendChild(opt);
        });

        this.select.addEventListener('change', (e) => {
            this.data.language = (e.target as HTMLSelectElement).value;
            this.highlightCode();
        });

        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span>';
        copyBtn.style.background = 'none';
        copyBtn.style.border = 'none';
        copyBtn.style.color = '#94a3b8';
        copyBtn.style.cursor = 'pointer';
        copyBtn.title = 'Copy code';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.textarea?.value || '');
            copyBtn.style.color = 'var(--theme-primary)';
            setTimeout(() => copyBtn.style.color = '#94a3b8', 1000);
        });

        header.appendChild(this.select);
        header.appendChild(copyBtn);

        const container = document.createElement('div');
        container.style.position = 'relative';
        container.style.border = '1px solid var(--theme-border)';
        container.style.borderBottomLeftRadius = '8px';
        container.style.borderBottomRightRadius = '8px';
        container.style.overflow = 'hidden';
        container.style.backgroundColor = 'var(--theme-bg-base)';

        this.textarea = document.createElement('textarea');
        this.textarea.value = this.data.code;
        this.textarea.placeholder = 'Write your code here...';
        this.textarea.spellcheck = false;
        
        // Exact styling to overlap nicely
        this.textarea.style.position = 'absolute';
        this.textarea.style.top = '0';
        this.textarea.style.left = '0';
        this.textarea.style.width = '100%';
        this.textarea.style.height = '100%';
        this.textarea.style.margin = '0';
        this.textarea.style.padding = '12px';
        this.textarea.style.border = 'none';
        this.textarea.style.background = 'transparent';
        this.textarea.style.color = 'transparent'; 
        this.textarea.style.caretColor = '#e2e8f0';
        this.textarea.style.outline = 'none';
        this.textarea.style.resize = 'none';
        this.textarea.style.fontFamily = 'monospace';
        this.textarea.style.fontSize = '14px';
        this.textarea.style.lineHeight = '1.5';
        this.textarea.style.zIndex = '2';

        this.pre = document.createElement('pre');
        this.pre.style.margin = '0';
        this.pre.style.padding = '12px';
        this.pre.style.pointerEvents = 'none';
        this.pre.style.position = 'absolute';
        this.pre.style.top = '0';
        this.pre.style.left = '0';
        this.pre.style.width = '100%';
        this.pre.style.height = '100%';
        this.pre.style.zIndex = '1';
        this.pre.style.fontFamily = 'monospace';
        this.pre.style.fontSize = '14px';
        this.pre.style.lineHeight = '1.5';
        this.pre.style.whiteSpace = 'pre-wrap';
        this.pre.style.wordBreak = 'break-all';
        this.pre.style.color = '#e2e8f0';
        this.pre.style.overflow = 'hidden';
        
        this.codeContainer = document.createElement('code');
        this.pre.appendChild(this.codeContainer);

        const resizer = document.createElement('div');
        resizer.style.position = 'absolute';
        resizer.style.bottom = '0';
        resizer.style.left = '0';
        resizer.style.width = '100%';
        resizer.style.height = '12px';
        resizer.style.background = 'transparent';
        resizer.style.cursor = 'ns-resize';
        resizer.style.zIndex = '3';
        
        // A small dash line for visuals
        const dash = document.createElement('div');
        dash.style.width = '30px';
        dash.style.height = '2px';
        dash.style.background = 'var(--theme-border)';
        dash.style.margin = '5px auto';
        resizer.appendChild(dash);

        container.style.height = this.data.height + 'px';

        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = container.getBoundingClientRect().height;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newHeight = Math.max(80, startHeight + (e.clientY - startY));
            container.style.height = newHeight + 'px';
            this.data.height = newHeight;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                // Dispatch change event to save
                this.api.saver.save();
            }
        });

        this.textarea.addEventListener('input', () => {
            this.highlightCode();
        });
        
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.textarea!.selectionStart;
                const end = this.textarea!.selectionEnd;
                this.textarea!.value = this.textarea!.value.substring(0, start) + "    " + this.textarea!.value.substring(end);
                this.textarea!.selectionStart = this.textarea!.selectionEnd = start + 4;
                this.highlightCode();
            }
        });

        this.textarea.addEventListener('scroll', () => {
            if (this.pre && this.textarea) {
                this.pre.scrollTop = this.textarea.scrollTop;
            }
        });

        container.appendChild(this.pre);
        container.appendChild(this.textarea);
        container.appendChild(resizer);

        this.wrapper.appendChild(header);
        this.wrapper.appendChild(container);

        this.highlightCode();

        return this.wrapper;
    }

    highlightCode() {
        if (!this.textarea || !this.codeContainer) return;
        const code = this.textarea.value;
        this.data.code = code;
        
        // Escape HTML
        let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // Tokenize to prevent regex overlapping and HTML corruption
        const tokens: string[] = [];
        const saveToken = (str: string) => {
            const id = `__TOKEN_${tokens.length}__`;
            tokens.push(str);
            return id;
        };

        const lang = this.data.language;
        if (lang === 'javascript' || lang === 'typescript' || lang === 'json') {
            html = html.replace(/(\/\/.*)/g, match => saveToken(`<span style="color: #5c6370; font-style: italic;">${match}</span>`));
            html = html.replace(/(["'`].*?["'`])/g, match => saveToken(`<span style="color: #98c379;">${match}</span>`));
            html = html.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|new|true|false|null|undefined|await|async|interface|type)\b/g, match => saveToken(`<span style="color: #c678dd;">${match}</span>`));
            html = html.replace(/\b(\d+)\b/g, match => saveToken(`<span style="color: #d19a66;">${match}</span>`));
        } else if (lang === 'html') {
            html = html.replace(/(["'].*?["'])/g, match => saveToken(`<span style="color: #98c379;">${match}</span>`));
            html = html.replace(/(&lt;\/?)([a-zA-Z0-9]+)/g, (_, p1, p2) => `${p1}${saveToken(`<span style="color: #e06c75;">${p2}</span>`)}`);
            html = html.replace(/([a-zA-Z0-9-]+)(=)/g, (_, p1, p2) => `${saveToken(`<span style="color: #d19a66;">${p1}</span>`)}${p2}`);
        } else if (lang === 'css') {
            html = html.replace(/([a-zA-Z0-9-]+)(\s*:)/g, (_, p1, p2) => `${saveToken(`<span style="color: #56b6c2;">${p1}</span>`)}${p2}`);
            html = html.replace(/(#[0-9a-fA-F]+|\b\d+(px|em|rem|%)\b)/g, match => saveToken(`<span style="color: #d19a66;">${match}</span>`));
        } else if (lang === 'python') {
            html = html.replace(/(#.*)/g, match => saveToken(`<span style="color: #5c6370; font-style: italic;">${match}</span>`));
            html = html.replace(/(["'`].*?["'`])/g, match => saveToken(`<span style="color: #98c379;">${match}</span>`));
            html = html.replace(/\b(def|return|if|elif|else|for|while|class|import|from|True|False|None|await|async|in|and|or|not)\b/g, match => saveToken(`<span style="color: #c678dd;">${match}</span>`));
            html = html.replace(/\b(\d+)\b/g, match => saveToken(`<span style="color: #d19a66;">${match}</span>`));
        }

        // Restore tokens
        tokens.forEach((token, i) => {
            html = html.replace(`__TOKEN_${i}__`, token);
        });

        this.codeContainer.innerHTML = html + (html.endsWith('\n') ? '<br/>' : '');
    }

    save() {
        return {
            code: this.data.code,
            language: this.data.language,
            height: this.data.height
        };
    }
}
