import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

// The agent guides in for-agents/ are public documentation of the plugin API and the design system. These checks fail when
// the code and the guides drift apart: a window.api member, registry method or UI primitive without documentation, a
// documented member that no longer exists, or a referenced repository path that is gone.

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PLUGIN_DIR = 'for-agents/kobar-plugin-developer';
const PLUGIN_DOCS = [
    `${PLUGIN_DIR}/SKILL.md`,
    `${PLUGIN_DIR}/references/api.md`,
    `${PLUGIN_DIR}/references/host-behaviour.md`,
    `${PLUGIN_DIR}/references/manifest-and-publishing.md`,
    `${PLUGIN_DIR}/references/platforms.md`,
];
const UI_DOC = 'for-agents/kobar-ui-ux-designer/SKILL.md';
const ALL_DOCS = [...PLUGIN_DOCS, UI_DOC];
const API_DOC = read(`${PLUGIN_DIR}/references/api.md`);

/** Keys of the object the preload exposes as window.api (4-space indented `name:` lines of that object literal). */
function windowApiKeys(): string[] {
    const src = read('electron/preload.cts');
    const start = src.indexOf("exposeInMainWorld('api', {");
    const end = src.indexOf('\n});', start);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end);
    return Array.from(body.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*):/gm), (m) => m[1]);
}

/** Text of one `## n.` section of a markdown document (up to the next `## ` heading). */
function section(doc: string, heading: string): string {
    const start = doc.indexOf(`\n## ${heading}`);
    expect(start).toBeGreaterThan(-1);
    const next = doc.indexOf('\n## ', start + 4);
    return next === -1 ? doc.slice(start) : doc.slice(start, next);
}

/** Backticked identifiers in the first cell of every table row of `text`. */
function firstCellIdentifiers(text: string): string[] {
    const names: string[] = [];
    for (const line of text.split('\n')) {
        const cell = /^\| ([^|]+) \|/.exec(line)?.[1];
        if (!cell) continue;
        for (const m of cell.matchAll(/`([A-Za-z][A-Za-z0-9]*)/g)) names.push(m[1]);
    }
    return names;
}

describe('for-agents plugin guide: window.api reference', () => {
    const keys = windowApiKeys();

    it('finds the preload api object', () => {
        expect(keys.length).toBeGreaterThan(90);
    });

    it('documents every window.api member', () => {
        const missing = keys.filter((k) => !API_DOC.includes(`\`${k}\``));
        expect(missing).toEqual([]);
    });

    it('documents no window.api member that does not exist', () => {
        const documented = firstCellIdentifiers(section(API_DOC, '1. `window.api`'));
        const unknown = documented.filter((name) => !keys.includes(name));
        expect(unknown).toEqual([]);
    });
});

describe('for-agents plugin guide: registry and store', () => {
    it('lists every ExtensionRegistry method', () => {
        const src = read('src/components/extensions/extensionRegistry.ts');
        const cls = src.slice(src.indexOf('class ExtensionRegistry'), src.indexOf('\ndeclare global'));
        const methods = Array.from(cls.matchAll(/^ {4}([a-zA-Z]+)(?:<[^>]*>)?\(/gm), (m) => m[1]).filter(
            (name) => !['trackOwner', 'constructor'].includes(name)
        );
        expect(methods.length).toBeGreaterThan(10);
        const registrySection = section(API_DOC, '2. `window.KoBarExtensions`');
        expect(methods.filter((m) => !registrySection.includes(m))).toEqual([]);
    });

    it('documents only store fields and actions that exist', () => {
        const store = read('src/store/useAppStore.ts');
        const names = firstCellIdentifiers(section(API_DOC, '3. `window.useAppStore`'));
        expect(names.length).toBeGreaterThan(15);
        const unknown = names.filter((name) => !new RegExp(`\\b${name}\\??\\s*[:(]`).test(store));
        expect(unknown).toEqual([]);
    });

    it('names every UI language the host supports', () => {
        const union = /export type LanguageCode = ([^;]+);/.exec(read('src/i18n/index.ts'))?.[1] ?? '';
        const codes = Array.from(union.matchAll(/'([a-z]{2})'/g), (m) => m[1]);
        expect(codes.length).toBe(10);
        const skill = read(`${PLUGIN_DIR}/SKILL.md`);
        expect(codes.filter((c) => !skill.includes(`\`${c}\``))).toEqual([]);
    });
});

describe('for-agents UI guide', () => {
    const doc = read(UI_DOC);

    it('documents every exported UI primitive and helper', () => {
        const index = read('src/ui/index.ts');
        const exported = Array.from(index.matchAll(/export \{([^}]+)\}/g)).flatMap((m) =>
            m[1]
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s && !s.startsWith('type '))
        );
        const wanted = exported.filter(
            (name) => !['DEFAULT_TOAST_DURATION_MS', 'MAX_TOASTS', 'REDUCED_FADE_MS', 'useToasts'].includes(name)
        );
        expect(wanted.length).toBeGreaterThan(20);
        expect(wanted.filter((name) => !doc.includes(name))).toEqual([]);
    });

    it('points at the locale JSON files, not the removed translations.ts', () => {
        expect(doc).not.toContain('translations.ts');
        expect(doc).toContain('src/i18n/locales/');
    });
});

describe('for-agents guides: references', () => {
    it('every referenced repository path exists', () => {
        const missing: string[] = [];
        for (const file of ALL_DOCS) {
            for (const m of read(file).matchAll(/`((?:src|electron|shared|tests)\/[^`\s:]+?)(?::\d+)?`/g)) {
                const rel = m[1];
                if (/[<*{]/.test(rel)) continue;
                if (!fs.existsSync(path.join(ROOT, rel))) missing.push(`${file}: ${rel}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('every relative markdown link between the guides resolves', () => {
        const missing: string[] = [];
        for (const file of ALL_DOCS) {
            for (const m of read(file).matchAll(/\]\(((?!https?:)[^)#\s]+)\)/g)) {
                if (!fs.existsSync(path.join(ROOT, path.dirname(file), m[1]))) missing.push(`${file}: ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('do not point readers at internal planning documents or task ids', () => {
        // for-agents/ is published; remaster/ and task ids (T-123, R2-15, MAC-061, M7) are not meaningful outside the project.
        const leaks = ALL_DOCS.filter((file) => /remaster\/|\b(?:T|R\d?|MAC)-\d{2,3}\b|\bM[0-9]\b/.test(read(file)));
        expect(leaks).toEqual([]);
    });
});
