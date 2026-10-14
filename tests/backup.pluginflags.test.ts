import { describe, expect, it } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { parseBackup } from '../src/backup/parseBackup';
import { approvedPluginIds, restrictRestoredPluginFlags, restrictRestoredPluginFlagsCounted } from '../src/backup/restorePluginFlags';
import { approvedPluginIdsFromSources } from '../src/backup/pluginFlagRules';
import { planExtensionsContextSwitch } from '../src/store/workspace/enabledExtensions';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';

// T-415: plugin flags inside a restored kobar-storage must not enable a plugin that is not enabled on this machine
// (T-213 rule, T-409 workspace records). Synthetic data only.

function appStore(state: Record<string, unknown>): string {
    return JSON.stringify({ state: { notes: [], globalNotes: [], language: 'en', ...state }, version: KOBAR_STORAGE_VERSION });
}

function stateOf(value: string): Record<string, unknown> {
    return (JSON.parse(value) as { state: Record<string, unknown> }).state;
}

const workspaces = [
    {
        id: 'ws-a',
        name: 'A',
        isIsolated: false,
        enabledExtensions: { 'on-here': true, 'off-here': true, 'not-installed': true, 'kept-off': false },
    },
    { id: 'ws-b', name: 'B', isIsolated: false, enabledExtensions: { 'off-here': false } },
];

/** parseBackup result for a backup made from `state`, parsed with this machine's plugins and config. */
function parsedBackup(state: Record<string, unknown>, currentExtensionsConfig?: unknown) {
    const text = serializeBackup(
        buildBackup({
            localStorage: { 'kobar-storage': appStore(state) },
            extensionsConfig: {},
            plugins: [],
            appVersion: '1.3.0',
            now: new Date(0),
        })
    );
    const options = { installedPluginIds: ['on-here', 'off-here', 'kept-off'], currentAppVersion: '1.3.0' };
    const parsed = parseBackup(text, currentExtensionsConfig === undefined ? options : { ...options, currentExtensionsConfig });
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed;
}

/** Plan value of `kobar-storage` for a backup made from `state`, parsed with this machine's plugins and config. */
function restoredState(state: Record<string, unknown>, currentExtensionsConfig?: unknown): Record<string, unknown> {
    const parsed = parsedBackup(state, currentExtensionsConfig);
    const entry = parsed.plan.entries.find((e) => e.key === 'kobar-storage');
    if (!entry) throw new Error('no kobar-storage entry');
    return stateOf(entry.value);
}

describe('approvedPluginIds', () => {
    it('approves installed plugins the current config does not disable (a missing entry counts as enabled)', () => {
        const approved = approvedPluginIds(['a', 'b', 'c', 7, ''], { a: true, b: false, x: true });
        expect([...approved].sort()).toEqual(['a', 'c']);
    });

    it('approves nothing when the config is unknown', () => {
        for (const config of [undefined, null, 'x', ['a'], 3]) expect(approvedPluginIds(['a'], config).size).toBe(0);
    });

    it('T-418: reads the getBackupSources shape and fails closed on anything else', () => {
        const sources = { extensionsConfig: { a: true, b: false }, plugins: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, null, 'd'] };
        expect([...approvedPluginIdsFromSources(sources)].sort()).toEqual(['a', 'c']);
        for (const bad of [undefined, null, [], 'x', { plugins: [{ id: 'a' }] }, { extensionsConfig: {}, plugins: 'a' }]) {
            expect(approvedPluginIdsFromSources(bad).size).toBe(0);
        }
    });
});

describe('restrictRestoredPluginFlags', () => {
    it('drops true entries of non-approved plugins from workspace records, the mirror and a Default list', () => {
        const value = appStore({
            workspaces,
            currentExtensionsConfig: { 'on-here': true, 'off-here': true },
            defaultExtensionsConfig: { 'off-here': true, 'on-here': false },
        });
        const state = stateOf(restrictRestoredPluginFlags(value, new Set(['on-here'])));
        expect((state.workspaces as Array<{ enabledExtensions: unknown }>).map((w) => w.enabledExtensions)).toEqual([
            { 'on-here': true, 'kept-off': false },
            { 'off-here': false },
        ]);
        expect(state.currentExtensionsConfig).toEqual({ 'on-here': true });
        // A false entry is kept as it is, never turned into true.
        expect(state.defaultExtensionsConfig).toEqual({ 'on-here': false });
        // Everything else is untouched.
        expect((state.workspaces as Array<{ name: string }>).map((w) => w.name)).toEqual(['A', 'B']);
        expect(state.language).toBe('en');
    });

    it('returns the same string when nothing changes, and leaves unreadable values alone', () => {
        const value = appStore({ workspaces: [{ id: 'w', name: 'W', enabledExtensions: { a: true, b: false } }] });
        expect(restrictRestoredPluginFlags(value, new Set(['a']))).toBe(value);
        for (const raw of ['not json', '[]', '{"state":3}', '{"version":25}']) {
            expect(restrictRestoredPluginFlags(raw, new Set())).toBe(raw);
        }
    });

    it('T-418: counts the dropped enables of workspace records and a Default list, not of the mirror', () => {
        const value = appStore({
            workspaces,
            currentExtensionsConfig: { 'on-here': true, 'off-here': true },
            defaultExtensionsConfig: { 'off-here': true, 'on-here': false },
        });
        const result = restrictRestoredPluginFlagsCounted(value, new Set(['on-here']));
        // ws-a: off-here + not-installed; Default list: off-here. The mirror's off-here is dropped but not counted.
        expect(result.dropped).toBe(3);
        expect(result.value).toBe(restrictRestoredPluginFlags(value, new Set(['on-here'])));
        expect(stateOf(result.value).currentExtensionsConfig).toEqual({ 'on-here': true });
        const mirrorOnly = appStore({ currentExtensionsConfig: { x: true } });
        expect(restrictRestoredPluginFlagsCounted(mirrorOnly, new Set())).toEqual({
            value: JSON.stringify({ state: { ...stateOf(mirrorOnly), currentExtensionsConfig: {} }, version: KOBAR_STORAGE_VERSION }),
            dropped: 0,
        });
    });

    it('ignores records whose flags are not an object', () => {
        const value = appStore({
            workspaces: [{ id: 'w', name: 'W', enabledExtensions: '{"a":true}' }, null],
            currentExtensionsConfig: null,
        });
        expect(restrictRestoredPluginFlags(value, new Set())).toBe(value);
    });
});

describe('parseBackup: restored workspace records (T-415)', () => {
    it('carries true entries over only for plugins that are installed and enabled here', () => {
        const state = restoredState({ workspaces, currentExtensionsConfig: { 'on-here': true, 'off-here': true } }, { 'off-here': false });
        expect((state.workspaces as Array<{ enabledExtensions: unknown }>)[0].enabledExtensions).toEqual({
            'on-here': true,
            'kept-off': false,
        });
        expect(state.currentExtensionsConfig).toEqual({ 'on-here': true });
    });

    it('T-418: the preview counts the flags that are not carried over and warns about them', () => {
        const parsed = parsedBackup({ workspaces }, { 'off-here': false });
        expect(parsed.preview.counts.pluginFlagsDropped).toBe(2);
        expect(parsed.preview.warnings).toContain('plugin-flags-dropped');
        const clean = parsedBackup({ workspaces: [workspaces[1]] }, {});
        expect(clean.preview.counts.pluginFlagsDropped).toBe(0);
        expect(clean.preview.warnings).not.toContain('plugin-flags-dropped');
    });

    it('fails closed without the current config: no true entry survives', () => {
        const state = restoredState({ workspaces });
        expect((state.workspaces as Array<{ enabledExtensions: Record<string, boolean> }>)[0].enabledExtensions).toEqual({
            'kept-off': false,
        });
    });

    it('a switch to the restored workspace cannot enable a plugin that is disabled here', () => {
        const state = restoredState({ workspaces, activeWorkspaceId: null }, { 'off-here': false });
        // After the relaunch the mirror follows extensions-config.json (off-here disabled).
        const before = {
            activeWorkspaceId: null,
            workspaces: state.workspaces as never,
            currentExtensionsConfig: { 'on-here': true, 'off-here': false },
        };
        const plan = planExtensionsContextSwitch(before, { ...before, activeWorkspaceId: 'ws-a' });
        expect(plan?.currentExtensionsConfig['off-here']).toBe(false);
        expect(plan?.currentExtensionsConfig['on-here']).toBe(true);
    });

    it('a plugin installed after the restore is not force-disabled by the restored record', () => {
        const state = restoredState({ workspaces, activeWorkspaceId: null }, {});
        // Later on this machine: not-installed was installed and enabled by the user.
        const before = {
            activeWorkspaceId: null,
            workspaces: state.workspaces as never,
            currentExtensionsConfig: { 'on-here': true, 'not-installed': true },
        };
        const plan = planExtensionsContextSwitch(before, { ...before, activeWorkspaceId: 'ws-a' });
        expect(plan?.currentExtensionsConfig['not-installed']).toBe(true);
    });
});
