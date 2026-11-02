import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registry from '../src/components/extensions/extensionRegistry';
import { getBarItemSnapshot, manifestDefaultSize, resetBarPresentationForTests } from '../src/components/extensions/barPresentation';

// Canlı: the additive registry methods and how they hook into registration and unload.

function runAs(extensionId: string, fn: () => void) {
    const script = document.createElement('script');
    script.dataset.extensionId = extensionId;
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    try {
        fn();
    } finally {
        delete (document as unknown as Record<string, unknown>).currentScript;
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    registry.clear();
    resetBarPresentationForTests();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('KoBarExtensions bar additions', () => {
    it('are plain functions on window.KoBarExtensions (feature detection)', () => {
        expect(typeof window.KoBarExtensions.setBarItemState).toBe('function');
        expect(typeof window.KoBarExtensions.onBarItemChange).toBe('function');
    });

    it('registerSidebarButton keeps working without a tile', () => {
        registry.registerSidebarButton({ id: 'x', icon: 'a', label: 'X', onClick: vi.fn() });
        expect(registry.getButtons().map((b: { id: string }) => b.id)).toEqual(['x']);
        expect(getBarItemSnapshot('x').declaration).toEqual({});
    });

    it('merges the registration tile over the manifest bar.tile of the owning plugin', () => {
        registry.registerManifest('plug', {
            id: 'plug',
            bar: { tile: { template: 'ring', live: true }, defaultSize: 'tile' },
        });
        runAs('plug', () =>
            registry.registerSidebarButton({
                id: 'plug-btn',
                icon: 'a',
                label: 'P',
                onClick: () => undefined,
                tile: { sensitive: true },
            })
        );
        expect(getBarItemSnapshot('plug-btn').declaration).toEqual({ template: 'ring', live: true, sensitive: true });
        expect(manifestDefaultSize('plug-btn')).toBe('tile');
    });

    it('setBarItemState from a timer reaches the snapshot', () => {
        registry.registerSidebarButton({ id: 'x', icon: 'a', label: 'X', onClick: () => undefined });
        setTimeout(() => registry.setBarItemState('x', { label: 'X - 3', badge: 3 }), 10);
        vi.advanceTimersByTime(10);
        expect(getBarItemSnapshot('x').state).toEqual({ label: 'X - 3', badge: 3 });
    });

    it('onBarItemChange returns an unsubscribe and fires immediately', () => {
        const listener = vi.fn();
        const off = registry.onBarItemChange('x', listener);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(typeof off).toBe('function');
        off();
    });

    it('unregisterExtension drops presentation state of its buttons and the manifest', () => {
        registry.registerManifest('plug', { id: 'plug', bar: { defaultSize: 'tile' } });
        runAs('plug', () => registry.registerSidebarButton({ id: 'plug-btn', icon: 'a', label: 'P', onClick: () => undefined }));
        registry.setBarItemState('plug-btn', { label: 'P', value: '1' });
        expect(registry.unregisterExtension('plug')).toBe(true);
        expect(getBarItemSnapshot('plug-btn').state).toBeNull();
        expect(manifestDefaultSize('plug-btn')).toBeUndefined();
    });

    it('clear drops presentation state', () => {
        registry.registerSidebarButton({ id: 'x', icon: 'a', label: 'X', onClick: () => undefined });
        registry.setBarItemState('x', { label: 'X' });
        registry.clear();
        expect(getBarItemSnapshot('x').state).toBeNull();
    });

    it('setBarItemState never throws on garbage', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => registry.setBarItemState('x', null as never)).not.toThrow();
        expect(() => registry.setBarItemState(undefined as never, { label: 'x' })).not.toThrow();
        spy.mockRestore();
    });
});
