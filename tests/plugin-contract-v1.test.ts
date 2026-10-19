import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ReactDOM from 'react-dom';
import { describe, expect, it } from 'vitest';
import { HOST_CSS_CLASSES, NON_IPC_API_METHODS, NO_OP_API_STUBS, PLUGIN_API_METHODS, THEME_CSS_VARS } from './helpers/pluginContractV1';
import { WINDOW_API_METHODS } from './helpers/windowApi';
import { classifyLaunchTarget } from '../electron/lib/external.cjs';
import { readMainModule, readMainSources } from './helpers/mainSource';

// T-010: pins the v1 plugin contract on the source level: the `window.api`
// surface in electron/preload.cts and its wiring in electron/main.cts, the globals set in
// src/main.tsx and the DOM/CSS contract. Store and KoBarExtensions are checked at runtime in
// tests/plugin-contract-v1.dom.test.ts. The plugin usage lists live in helpers/pluginContractV1.ts.
// If this test breaks, the change breaks official plugins: revert it, or get an owner-approved
// item (CLAUDE.md rule 6) and update the lists deliberately.

function readRepoFile(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

const preload = readRepoFile('electron/preload.cts');
// T-315: main.cts is only wiring now; the external-open gate and the open-external handler live in electron/main/app/helpers.cts.
const main = readMainModule('app/helpers.cts');
// T-306: events pushed from the window modules (pip-closed, ...) live outside main.cts.
const mainAll = readMainSources();
// T-308: clipboard monitoring and global paste moved out of main.cts into these two modules.
const clipboardSrc = readMainModule('services/clipboard.cts');
const globalPasteSrc = readMainModule('services/globalPaste.cts');
// T-312: launch-file moved to services/files.cts (indented inside registerFilesIpc).
const filesSrc = readMainModule('services/files.cts');

/** Body of the object passed to `contextBridge.exposeInMainWorld('api', {` (same parsing as tests/smoke.test.ts). */
function preloadApiBody(): string {
    const start = preload.indexOf("contextBridge.exposeInMainWorld('api', {");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = preload.slice(start);
    const end = rest.search(/^\}\);/m);
    expect(end).toBeGreaterThan(0);
    return rest.slice(0, end);
}

/** Source text of one top-level preload method, up to the next top-level key. */
function preloadMethodSource(name: string): string {
    const body = preloadApiBody();
    const start = body.search(new RegExp(`^ {4}${name}:`, 'm'));
    expect(start, `preload method ${name}`).toBeGreaterThanOrEqual(0);
    const after = body.slice(start + 1);
    const next = after.search(/^ {4}[A-Za-z]\w*:/m);
    return next === -1 ? body.slice(start) : body.slice(start, start + 1 + next);
}

function preloadChannel(name: string): { kind: string; channel: string } {
    const source = preloadMethodSource(name);
    // `subscribe(channel, ...)` is the shared ipcRenderer.on wrapper used by every on* API (T-127).
    const match =
        source.match(/ipcRenderer\.(send|invoke|on|sendSync)\(\s*'([^']+)'/) ?? source.match(/\b(subscribe)(?:<[^>]*>)?\(\s*'([^']+)'/);
    expect(match, `IPC channel of preload method ${name}`).not.toBeNull();
    return { kind: match![1] === 'subscribe' ? 'on' : match![1], channel: match![2] };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMainHandler(channel: string): boolean {
    // T-303: a channel is registered either on ipcMain directly or through the typed registry (registry.on/handle).
    // T-307: some handlers (send-notification, updater, auto-launch) are registered from electron/main/services/*.cts.
    return new RegExp(`(?:ipcMain|registry)\\.(on|handle)\\(\\s*'${escapeRegExp(channel)}'`).test(mainAll);
}

/** Source of the `ipcMain|registry.on|handle('<channel>', ...)` callback, up to the next top-level registration. */
function mainHandlerSource(channel: string): string {
    // T-308: the handler is in main.cts or (clipboard / global paste) in one of the two service modules, where it is indented
    // inside its register function; the slice then ends at the next registration with the same indentation.
    const pattern = new RegExp(`^( *)(?:ipcMain|registry)\\.(on|handle)\\(\\s*'${escapeRegExp(channel)}'`, 'm');
    const text = [main, clipboardSrc, globalPasteSrc, filesSrc].find((source) => pattern.test(source)) ?? '';
    const found = pattern.exec(text);
    expect(found, `main handler for ${channel}`).not.toBeNull();
    const start = found!.index;
    const after = text.slice(start + 1);
    const next = after.search(new RegExp(`^${found![1]}(?:ipcMain|registry)\\.`, 'm'));
    return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

describe('plugin contract v1: window.api surface', () => {
    const preloadMethods = new Set([...preloadApiBody().matchAll(/^ {4}([A-Za-z]\w*):/gm)].map((m) => m[1]));

    it.each(PLUGIN_API_METHODS)('preload still exposes %s', (name) => {
        expect(preloadMethods.has(name)).toBe(true);
        expect((WINDOW_API_METHODS as readonly string[]).includes(name)).toBe(true);
    });

    it.each(NO_OP_API_STUBS)('preload still exposes the compatibility stub %s', (name) => {
        expect(preloadMethods.has(name)).toBe(true);
    });

    it.each([
        ['startEyeDropper', /Promise\.resolve\(\{ x: 0, y: 0 \}\)/],
        ['getAvailableExtensions', /Promise\.resolve\(\[/],
        ['installExtension', /Promise\.resolve\(false\)/],
    ])('no-op stub %s keeps its legacy return shape and has no IPC call', (name, shape) => {
        const src = preloadMethodSource(name);
        expect(src).toMatch(shape);
        expect(src).not.toMatch(/ipcRenderer/);
    });

    const ipcMethods = PLUGIN_API_METHODS.filter(
        (name) => !(NON_IPC_API_METHODS as readonly string[]).includes(name) && !(NO_OP_API_STUBS as readonly string[]).includes(name)
    );

    it.each(ipcMethods)('%s is wired to the main process', (name) => {
        const { kind, channel } = preloadChannel(name);
        if (kind === 'on') {
            // Event subscription: main must still emit the channel.
            expect(mainAll).toMatch(new RegExp(`\\.send\\(\\s*'${escapeRegExp(channel)}'`));
        } else {
            expect(hasMainHandler(channel)).toBe(true);
        }
    });

    it('getFilePath stays a synchronous webUtils call (plugins call it without await)', () => {
        expect(preloadMethodSource('getFilePath')).toMatch(/webUtils\.getPathForFile\(/);
    });

    it.each([
        ['onClipboardUpdate', 'clipboard-updated'],
        ['onLlmStreamChunk', 'llm-stream-chunk'],
        ['onLlmStreamEnd', 'llm-stream-end'],
        ['onLlmStreamError', 'llm-stream-error'],
        ['onPipClosed', 'pip-closed'],
        ['onPinnedWindowChanged', 'pinned-window-changed'],
        ['onPinTargetingComplete', 'pin-targeting-complete'],
        ['onRequestNextPaste', 'request-next-paste'],
    ])('%s returns an unsubscribe function for %s', (name, channel) => {
        // Every on* API goes through the shared subscribe() helper, which unsubscribes with removeListener(channel, handler).
        expect(preloadMethodSource(name)).toMatch(new RegExp(`=>\\s*subscribe(?:<[^>]*>)?\\(\\s*'${escapeRegExp(channel)}'`));
    });
});

describe('plugin contract v1: documented semantics', () => {
    it("Shortcuts: launchFile('http(s)://…') opens the URL in the browser, other paths via shell.openPath", () => {
        const { kind, channel } = preloadChannel('launchFile');
        expect(kind).toBe('send');
        const handler = mainHandlerSource(channel);
        // T-108: http(s) values go through the allow-list gate (which ends in shell.openExternal),
        // local paths still go straight to shell.openPath.
        expect(handler).toContain('classifyLaunchTarget(');
        expect(handler).toContain('openExternalChecked(');
        expect(handler).toMatch(/shell\.openPath\(/);
        const gate = main.slice(main.indexOf('async function openExternalChecked('));
        expect(gate.slice(0, gate.search(/\r?\n\}\r?\n/))).toContain('shell.openExternal(');
        // Behavior of the classifier the handler relies on (Shortcuts: URLs and local paths keep working).
        for (const url of ['http://x', 'https://x', 'HTTPS://x']) {
            const d = classifyLaunchTarget(url);
            expect(d.kind === 'url' && d.decision.kind).toBe('allow');
        }
        for (const p of [String.raw`C:\a\b.lnk`, 'C:/a b/\u00fc.exe']) expect(classifyLaunchTarget(p).kind).toBe('path');
    });

    it('Clipboard Manager: startClipboardListener subscribes the sender window to polling that emits clipboard-updated', () => {
        const { kind, channel } = preloadChannel('startClipboardListener');
        expect(kind).toBe('send');
        expect(mainHandlerSource(channel)).toMatch(/subscribeClipboard\(\s*event\.sender\s*\)/);
        const subscribe = clipboardSrc.slice(clipboardSrc.indexOf('function subscribeClipboard('));
        expect(subscribe.slice(0, subscribe.search(/\r?\n\}\r?\n/))).toMatch(/startClipboardPolling\(\)/);
        // No polling at app startup: subscribeClipboard is the only caller.
        expect(mainAll.match(/(?<!function )startClipboardPolling\(\)/g)).toHaveLength(1);
        // T-114: updates go only to subscribed windows, as { type: 'text' | 'image', content }.
        const broadcast = clipboardSrc.slice(clipboardSrc.indexOf('function broadcastClipboardUpdate('));
        expect(broadcast.slice(0, broadcast.search(/\r?\n\}\r?\n/))).toMatch(/\.send\(\s*'clipboard-updated',\s*data\s*\)/);
        expect(clipboardSrc).toMatch(/broadcastClipboardUpdate\(\{\s*type:\s*'text',\s*content:/);
        expect(clipboardSrc).toMatch(/broadcastClipboardUpdate\(\{\s*type:\s*'image',\s*content:/);
        // SEC-08: a clipboard change must never bring the window forward or steal focus.
        const pollStart = clipboardSrc.indexOf('async function pollClipboardOnce(');
        expect(pollStart).toBeGreaterThanOrEqual(0);
        const poll = clipboardSrc.slice(pollStart);
        const pollBody = poll.slice(0, poll.search(/\r?\n\}\r?\n/));
        expect(pollBody).toContain("broadcastClipboardUpdate({ type: 'image'");
        for (const call of ['.focus(', '.show(', '.restore(', 'setAlwaysOnTop(']) expect(pollBody).not.toContain(call);
    });

    it('Clipboard Manager: stopClipboardListener is a fire-and-forget send that releases the sender window', () => {
        const { kind, channel } = preloadChannel('stopClipboardListener');
        expect(kind).toBe('send');
        expect(mainHandlerSource(channel)).toMatch(/unsubscribeClipboard\(\s*event\.sender\.id\s*\)/);
    });

    it('Clipboard Manager: setGlobalPasteMode(true) hijacks Ctrl+V and emits request-next-paste', () => {
        const handler = mainHandlerSource(preloadChannel('setGlobalPasteMode').channel);
        // R4: the handler validates the mode and hands it to the paste session (electron/lib/pasteSession.cts); the session's
        // Ctrl+V shortcut and request-next-paste wiring sit in the same module. tests/globalPaste.test.ts checks the behaviour
        // (setMode(true) registers Ctrl+V, a press sends request-next-paste) with electron mocked.
        expect(handler).toContain('decideGlobalPasteMode(');
        expect(handler).toContain('session.setMode(');
        expect(globalPasteSrc).toContain("globalShortcut.register('CommandOrControl+V'");
        expect(globalPasteSrc).toContain("send('request-next-paste')");
        expect(globalPasteSrc).toContain("globalShortcut.unregister('CommandOrControl+V')");
    });
});

describe('plugin contract v1: globals', () => {
    const mainTsx = readRepoFile('src/main.tsx');

    it('src/main.tsx exposes window.React, window.ReactDOM and window.useAppStore', () => {
        expect(mainTsx).toMatch(/^window\.React = React;$/m);
        expect(mainTsx).toMatch(/^window\.ReactDOM = ReactDOM;$/m);
        expect(mainTsx).toMatch(/^window\.useAppStore = useAppStore;$/m);
        // window.ReactDOM must be the classic `react-dom` module (plugins use createPortal from it).
        expect(mainTsx).toMatch(/^import ReactDOM from 'react-dom'$/m);
    });

    it('src/main.tsx claims the internal storage bridge before the app (and so any plugin script) is loaded (T-403)', () => {
        const claim = mainTsx.indexOf("import './storage/client'");
        expect(claim).toBeGreaterThanOrEqual(0);
        for (const later of ["import App from './App.tsx'", "import { useAppStore } from './store/useAppStore'"]) {
            expect(mainTsx.indexOf(later), later).toBeGreaterThan(claim);
        }
    });

    it('react-dom still provides createPortal', () => {
        expect(typeof ReactDOM.createPortal).toBe('function');
    });

    it('src/main.tsx loads the extension registry (sets window.KoBarExtensions)', () => {
        expect(mainTsx).toContain("import './components/extensions/extensionRegistry'");
        const registry = readRepoFile('src/components/extensions/extensionRegistry.ts');
        expect(registry).toMatch(/\.KoBarExtensions\s*=\s*registry/);
    });
});

describe('plugin contract v1: DOM/CSS contract', () => {
    const css = readRepoFile('src/index.css');
    const appTsx = readRepoFile('src/App.tsx');

    it.each(THEME_CSS_VARS)('src/index.css defines %s', (name) => {
        expect(css).toMatch(new RegExp(`${escapeRegExp(name)}\\s*:`));
    });

    it('bg-/text-/border-primary resolve to --theme-primary', () => {
        expect(css).toMatch(/--color-primary:\s*var\(--theme-primary\)/);
    });

    it.each(HOST_CSS_CLASSES)('src/index.css defines .%s', (name) => {
        expect(css).toMatch(new RegExp(`\\.${escapeRegExp(name)}\\b`));
    });

    it('the click-through check treats .pointer-events-auto ancestors as solid', () => {
        expect(appTsx).toContain("closest('.pointer-events-auto')");
    });

    it('runtime Tailwind is loaded so plugin class names work', () => {
        expect(appTsx).toContain("import '@tailwindcss/browser'");
    });

    it('the material-symbols-outlined font is loaded', () => {
        expect(readRepoFile('src/main.tsx')).toContain("import 'material-symbols/outlined.css'");
    });

    it("the sidebar dispatches 'kobar-drag' on document with { x, y }", () => {
        const sidebar = readRepoFile('src/components/layout/Sidebar.tsx');
        expect(sidebar).toMatch(/document\.dispatchEvent\(new CustomEvent\('kobar-drag', \{ detail: \{ x: \w+, y: \w+ \} \}\)\)/);
    });

    it("the store dispatches 'kobar:workspace-changed' on window with { workspaceId }", () => {
        const store = readRepoFile('src/store/useAppStore.ts');
        expect(store).toMatch(
            /window\.dispatchEvent\(new CustomEvent\('kobar:workspace-changed', \{ detail: \{ workspaceId: \w+ \} \}\)\)/
        );
    });

    // Not implemented yet: there is no light theme and no data-scheme attribute today. When T-503/T-504
    // introduce `data-scheme`, v1 plugin roots must keep data-scheme="dark".
    it.todo('v1 plugin roots keep data-scheme="dark" (add with T-503/T-504)');
});
