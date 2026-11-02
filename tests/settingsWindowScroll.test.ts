import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CNL (owner report): the Settings window document must never scroll into empty space below the app. The document is locked
// (html/body/#root overflow hidden only in the Settings window) and its scroll panes are positioned, so absolutely positioned
// descendants (sr-only live regions) cannot extend the document. Checked live with a temp profile: scrollHeight = innerHeight.
const read = (rel: string) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

describe('Settings window scrolling', () => {
    it('settings.html marks its document and index.css locks only that document', () => {
        expect(read('settings.html')).toMatch(/<html[^>]*data-window="settings"/);
        expect(read('index.html')).not.toContain('data-window="settings"');
        const css = read('src/index.css').replace(/\s+/g, ' ');
        expect(css).toContain(
            ":root[data-window='settings'], :root[data-window='settings'] body, :root[data-window='settings'] #root { overflow: hidden !important; }"
        );
    });

    it('the nav and main scroll panes are positioned', () => {
        const app = read('src/settings/SettingsApp.tsx');
        expect(app).toContain('className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-transparent"');
        expect(app).toContain('className="relative flex min-w-0 flex-1 flex-col overflow-y-auto rounded-ss-xl"');
    });
});
