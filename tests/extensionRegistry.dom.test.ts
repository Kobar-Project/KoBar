import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registry, { type ExtensionButton } from '../src/components/extensions/extensionRegistry';
import { useAppStore } from '../src/store/useAppStore';

// T-011: pins the current behaviour of the ExtensionRegistry singleton. Synthetic data only.
// File is `.dom.test.ts` because the module touches `window` at import time.
// The window-contract shape itself is covered in tests/plugin-contract-v1*.test.ts.

const btn = (id: string, label = id): ExtensionButton => ({ id, icon: 'x', label, onClick: () => {} });
const render = () => null;

// Every subscription made through sub() is released in afterEach so tests do not leak listeners into the singleton.
const unsubs: Array<() => void> = [];
const sub = (l: () => void): (() => void) => { const off = registry.subscribe(l); unsubs.push(off); return off; };
afterEach(() => { unsubs.splice(0).forEach(off => off()); });
// Every subscription made through sub() is released in afterEach so tests do not leak listeners into the singleton.const unsubs: Array<() => void> = [];const sub = (l: () => void): (() => void) => { const off = registry.subscribe(l); unsubs.push(off); return off; };afterEach(() => { unsubs.splice(0).forEach(off => off()); });

beforeEach(() => {
    registry.resumeNotifications();
    registry.clear();
    (window as unknown as { useAppStore: unknown }).useAppStore = useAppStore;
    useAppStore.setState({ workspaces: [], activeWorkspaceId: 'none', globalPluginData: {} });
});

describe('extensionRegistry: singleton', () => {
    it('is exposed as window.KoBarExtensions', () => {
        expect(window.KoBarExtensions).toBe(registry);
    });
});

describe('extensionRegistry: register/get', () => {
    it('sidebar buttons keep registration order; re-registering an id replaces it and moves it to the end', () => {
        registry.registerSidebarButton(btn('a'));
        registry.registerSidebarButton(btn('b'));
        registry.registerSidebarButton(btn('a', 'A2'));
        expect(registry.getButtons().map((b: ExtensionButton) => b.id)).toEqual(['b', 'a']);
        expect(registry.getButtons()[1].label).toBe('A2');
    });

    it('panels, settings panels and inline widgets are keyed by the first argument', () => {
        registry.registerPanel('p1', { id: 'p1', render });
        registry.registerSettingsPanel('s1', { id: 's1', render });
        registry.registerInlineWidget('w1', { id: 'w1', render });
        expect(registry.getPanel('p1')?.id).toBe('p1');
        expect(registry.getSettingsPanel('s1')?.id).toBe('s1');
        expect(registry.getInlineWidgets().map((w: { id: string }) => w.id)).toEqual(['w1']);
        expect(registry.getPanel('missing')).toBeUndefined();
        expect(registry.getSettingsPanel('missing')).toBeUndefined();
    });

    it('re-registering a panel id overwrites it', () => {
        registry.registerPanel('p', { id: 'first', render });
        registry.registerPanel('p', { id: 'second', render });
        expect(registry.getPanel('p')?.id).toBe('second');
    });

    it('the map key wins over the object id (no consistency check)', () => {
        registry.registerPanel('key', { id: 'other', render });
        expect(registry.getPanel('key')?.id).toBe('other');
        expect(registry.getPanel('other')).toBeUndefined();
    });

    it('inline widgets: re-register keeps the original insertion position (Map semantics)', () => {
        registry.registerInlineWidget('a', { id: 'a', render });
        registry.registerInlineWidget('b', { id: 'b', render });
        registry.registerInlineWidget('a', { id: 'a2', render });
        expect(registry.getInlineWidgets().map((w: { id: string }) => w.id)).toEqual(['a2', 'b']);
    });

    it('manifests: register/get, no notification', () => {
        const l = vi.fn();
        sub(l);
        registry.registerManifest('m', { name: 'M' });
        expect(registry.getManifest('m')).toEqual({ name: 'M' });
        expect(registry.getManifest('nope')).toBeUndefined();
        expect(l).not.toHaveBeenCalled();
    });
});

describe('extensionRegistry: notifications', () => {
    it('register* calls notify subscribers once each; unsubscribe stops them', () => {
        const l = vi.fn();
        const off = sub(l);
        registry.registerSidebarButton(btn('a'));
        registry.registerPanel('p', { id: 'p', render });
        registry.registerSettingsPanel('s', { id: 's', render });
        registry.registerInlineWidget('w', { id: 'w', render });
        expect(l).toHaveBeenCalledTimes(4);
        off();
        registry.registerSidebarButton(btn('b'));
        expect(l).toHaveBeenCalledTimes(4);
    });

    it('suspendNotifications silences notify; resumeNotifications fires exactly one notify', () => {
        const l = vi.fn();
        sub(l);
        registry.suspendNotifications();
        registry.registerSidebarButton(btn('a'));
        registry.registerSidebarButton(btn('b'));
        expect(l).not.toHaveBeenCalled();
        expect(registry.getButtons()).toHaveLength(2);
        registry.resumeNotifications();
        expect(l).toHaveBeenCalledTimes(1);
    });

    it('subscribing the same function twice registers it once (Set)', () => {
        const l = vi.fn();
        sub(l);
        sub(l);
        registry.notify();
        expect(l).toHaveBeenCalledTimes(1);
    });
});

describe('extensionRegistry: clear()', () => {
    it('empties buttons, panels, settings panels, inline widgets and manifests, then notifies', () => {
        registry.registerSidebarButton(btn('a'));
        registry.registerPanel('p', { id: 'p', render });
        registry.registerSettingsPanel('s', { id: 's', render });
        registry.registerInlineWidget('w', { id: 'w', render });
        registry.registerManifest('m', {});
        const l = vi.fn();
        sub(l);
        registry.clear();
        expect(registry.getButtons()).toEqual([]);
        expect(registry.getPanel('p')).toBeUndefined();
        expect(registry.getSettingsPanel('s')).toBeUndefined();
        expect(registry.getInlineWidgets()).toEqual([]);
        expect(registry.getManifest('m')).toBeUndefined();
        expect(l).toHaveBeenCalledTimes(1);
    });

    it('does not remove subscribers', () => {
        const l = vi.fn();
        sub(l);
        registry.clear();
        l.mockClear();
        registry.notify();
        expect(l).toHaveBeenCalledTimes(1);
    });
});

describe('extensionRegistry: getData/setData', () => {
    it('getData returns the default when nothing is stored', () => {
        expect(registry.getData('p', { a: 1 })).toEqual({ a: 1 });
    });

    it('setData stores via the store and notifies; getData reads it back', () => {
        const l = vi.fn();
        sub(l);
        registry.setData('p', { n: 5 });
        expect(registry.getData('p')).toEqual({ n: 5 });
        expect(l).toHaveBeenCalledTimes(1);
    });

    it('without window.useAppStore: getData returns the default, setData is a silent no-op without notify', () => {
        (window as unknown as { useAppStore: unknown }).useAppStore = undefined;
        const l = vi.fn();
        sub(l);
        expect(registry.getData('p', 'dflt')).toBe('dflt');
        registry.setData('p', 1);
        expect(l).not.toHaveBeenCalled();
    });
});
