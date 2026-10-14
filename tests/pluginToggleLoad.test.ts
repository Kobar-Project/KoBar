import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-409 (WS-09): enable/disable toggles and uninstall load only the enabled-set diff (`syncEnabledExtensions`);
// install and update keep the full reload (`triggerExtensionReload`). Source-level check (the plugin screens need the
// whole app to render), same approach as tests/pathGrants.test.ts.

const source = (file: string) => readFileSync(fileURLToPath(new URL(`../src/components/plugins/${file}`, import.meta.url)), 'utf8');

/** The text from `start` up to (not including) `end`. */
function between(text: string, start: string, end: string): string {
    const from = text.indexOf(start);
    expect(from, start).toBeGreaterThanOrEqual(0);
    const to = text.indexOf(end, from + start.length);
    expect(to, end).toBeGreaterThan(from);
    return text.slice(from, to);
}

describe('plugin toggles and uninstall use the diff load', () => {
    // T-615: the old store screens are gone; the same rules now live in the plugin sync actions (src/store/pluginSync.ts).
    const sync = readFileSync(fileURLToPath(new URL('../src/store/pluginSync.ts', import.meta.url)), 'utf8');

    it('plugin.setEnabled and plugin.uninstall call syncEnabledExtensions, never a full reload', () => {
        for (const block of [
            between(sync, "case 'plugin.setEnabled'", "case 'plugin.uninstall'"),
            between(sync, "case 'plugin.uninstall'", "case 'plugin.update'"),
        ]) {
            expect(block).toContain('syncEnabledExtensions()');
            expect(block).not.toContain('triggerExtensionReload()');
        }
    });

    it('install and update keep the full reload', () => {
        expect(between(sync, "case 'plugin.installFromFile'", "case 'plugin.installFromGithub'")).toContain('triggerExtensionReload()');
        expect(sync).toContain('if (tally.updated > 0) deps.store().triggerExtensionReload();');
        expect(sync).toContain("if (result === 'success') deps.store().triggerExtensionReload();");
        expect(source('PluginSettingsHost.tsx')).toContain('triggerExtensionReload()');
    });
});
