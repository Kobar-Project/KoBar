import { describe, expect, it } from 'vitest';
import {
    booleanExtensionEntries,
    extensionsConfigDiffers,
    needsFullPluginReload,
    overlayExtensionsConfig,
    planExtensionsContextSwitch,
    type ExtensionsContextState,
    type ExtensionsWorkspace,
} from '../src/store/workspace/enabledExtensions';

// T-409 (PROD-19, WS-09): one owner for the enabled-plugin set of each context. Synthetic data only.

const ws = (id: string, enabledExtensions?: unknown, isIsolated = false): ExtensionsWorkspace => ({ id, isIsolated, enabledExtensions });

function st(
    activeWorkspaceId: string | null,
    workspaces: ExtensionsWorkspace[],
    currentExtensionsConfig: unknown,
    defaultExtensionsConfig: unknown = null
): ExtensionsContextState {
    return { activeWorkspaceId, workspaces, currentExtensionsConfig, defaultExtensionsConfig };
}

describe('enabledExtensions: entries and merge rule', () => {
    it('keeps only own boolean entries, never prototype names, never throws', () => {
        expect(booleanExtensionEntries({ a: true, b: false, c: 'x', d: { enabled: true } })).toStrictEqual({ a: true, b: false });
        expect(booleanExtensionEntries(JSON.parse('{"__proto__": true, "constructor": true, "ok": false}'))).toStrictEqual({ ok: false });
        for (const garbage of [null, undefined, 1, 'x', [true], true]) expect(booleanExtensionEntries(garbage)).toStrictEqual({});
    });

    it('the owner wins where it has an entry; other ids keep the current value', () => {
        expect(overlayExtensionsConfig({ a: true, b: false, c: true }, { a: false, z: true })).toStrictEqual({
            a: false,
            b: false,
            c: true,
            z: true,
        });
        expect(overlayExtensionsConfig({ a: true }, undefined)).toStrictEqual({ a: true });
        expect(overlayExtensionsConfig({ a: true }, { a: 'no' })).toStrictEqual({ a: true });
    });

    it('a missing entry means enabled when two sets are compared', () => {
        expect(extensionsConfigDiffers({ a: true }, { a: true, b: true })).toBe(false);
        expect(extensionsConfigDiffers({ a: true }, { a: true, b: false })).toBe(true);
        expect(extensionsConfigDiffers({ a: true }, { a: false })).toBe(true);
        expect(extensionsConfigDiffers({}, {})).toBe(false);
    });
});

describe('planExtensionsContextSwitch', () => {
    const records = [ws('A', { a: false, x: true }), ws('B', { b: false }), ws('I', { a: true }, true), ws('L')];
    const flags = (savedNewDefault: boolean, clearDefaultAfterWrite: boolean) => ({ savedNewDefault, clearDefaultAfterWrite });

    it('Default -> workspace: the record over the file mirror; the Default list is saved (and must be flushed)', () => {
        const plan = planExtensionsContextSwitch(
            st(null, records, { a: true, b: true, c: false }),
            st('A', records, { a: true, b: true, c: false })
        );
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { a: false, b: true, c: false, x: true },
            defaultExtensionsConfig: { a: true, b: true, c: false },
            changed: true,
            ...flags(true, false),
        });
    });

    it('Default -> workspace with an unconfirmed saved copy: the copy wins over the mirror', () => {
        const plan = planExtensionsContextSwitch(
            st(null, records, { a: false, b: true }, { a: true }),
            st('B', records, { a: false, b: true }, { a: true })
        );
        expect(plan?.defaultExtensionsConfig).toStrictEqual({ a: true, b: true });
        expect(plan?.savedNewDefault).toBe(true);
    });

    it('workspace -> workspace keeps the saved Default list; an unchanged set is not sent', () => {
        const saved = { a: true, b: true };
        const plan = planExtensionsContextSwitch(
            st('A', records, { a: false, b: true }, saved),
            st('L', records, { a: false, b: true }, saved)
        );
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { a: false, b: true },
            defaultExtensionsConfig: saved,
            changed: false,
            ...flags(false, false),
        });
    });

    it('workspace -> Default restores the saved list over the mirror; the copy is dropped only after main wrote it', () => {
        const prev = st('B', records, { a: false, b: false, n: true }, { a: true, b: true });
        const plan = planExtensionsContextSwitch(prev, st(null, records, prev.currentExtensionsConfig, prev.defaultExtensionsConfig));
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { a: true, b: true, n: true },
            defaultExtensionsConfig: { a: true, b: true },
            changed: true,
            ...flags(false, true),
        });
    });

    it('workspace -> Default when the saved list matches the file: the copy is dropped at once', () => {
        const plan = planExtensionsContextSwitch(st('B', records, { a: true }, { a: true }), st(null, records, { a: true }, { a: true }));
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { a: true },
            defaultExtensionsConfig: null,
            changed: false,
            ...flags(false, false),
        });
    });

    it('workspace -> Default without a saved list (pre-v25 state) keeps the current set, like 1.2.x', () => {
        for (const saved of [null, undefined, 'garbage', [1]]) {
            const plan = planExtensionsContextSwitch(st('B', records, { b: false }, saved), st(null, records, { b: false }, saved));
            expect(plan).toStrictEqual({
                currentExtensionsConfig: { b: false },
                defaultExtensionsConfig: null,
                changed: false,
                ...flags(false, false),
            });
        }
    });

    it('a dangling active id is the Default workspace (v24)', () => {
        const plan = planExtensionsContextSwitch(st('gone', records, { a: true }), st('A', records, { a: true }));
        expect(plan?.defaultExtensionsConfig).toStrictEqual({ a: true });
        expect(planExtensionsContextSwitch(st('gone', records, { a: true }), st(null, records, { a: true }))).toBeNull();
    });

    it('no plan when the owner does not change (same record, or Default on both sides)', () => {
        expect(planExtensionsContextSwitch(st('A', records, {}), st('A', [ws('A', { a: true })], {}))).toBeNull();
        expect(planExtensionsContextSwitch(st(null, records, {}), st(null, records, {}))).toBeNull();
    });

    it('a record without enabledExtensions (legacy) keeps the current set', () => {
        const plan = planExtensionsContextSwitch(st('A', records, { a: false }, { a: true }), st('L', records, { a: false }, { a: true }));
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { a: false },
            defaultExtensionsConfig: { a: true },
            changed: false,
            ...flags(false, false),
        });
    });

    it('a garbage mirror is read as empty', () => {
        const plan = planExtensionsContextSwitch(st(null, records, 'garbage'), st('B', records, 'garbage'));
        expect(plan).toStrictEqual({
            currentExtensionsConfig: { b: false },
            defaultExtensionsConfig: {},
            changed: true,
            ...flags(true, false),
        });
    });
});

describe('needsFullPluginReload', () => {
    const records = [ws('A'), ws('B'), ws('I', undefined, true), ws('J', undefined, true)];
    it('only when the plugin data namespace changes', () => {
        expect(needsFullPluginReload(st(null, records, {}), st('A', records, {}))).toBe(false);
        expect(needsFullPluginReload(st('A', records, {}), st('B', records, {}))).toBe(false);
        expect(needsFullPluginReload(st('B', records, {}), st(null, records, {}))).toBe(false);
        expect(needsFullPluginReload(st('A', records, {}), st('A', records, {}))).toBe(false);
        expect(needsFullPluginReload(st('A', records, {}), st('I', records, {}))).toBe(true);
        expect(needsFullPluginReload(st('I', records, {}), st('J', records, {}))).toBe(true);
        expect(needsFullPluginReload(st('I', records, {}), st(null, records, {}))).toBe(true);
        // Isolation toggled on the active workspace.
        expect(needsFullPluginReload(st('A', records, {}), st('A', [ws('A', undefined, true)], {}))).toBe(true);
    });
});
