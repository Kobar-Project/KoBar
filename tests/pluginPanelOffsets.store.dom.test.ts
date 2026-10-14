import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig. Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// R-15: store field, setter normalization and persistence (partialize).

afterEach(() => useAppStore.setState({ pluginPanelOffsets: {} }));

describe('pluginPanelOffsets in the store', () => {
    it('defaults to an empty map', () => {
        expect(useAppStore.getState().pluginPanelOffsets).toStrictEqual({});
    });

    it('stores each axis per plugin id independently and rounds', () => {
        const { setPluginPanelOffset } = useAppStore.getState();
        setPluginPanelOffset('a', 'x', 10.4);
        setPluginPanelOffset('a', 'y', -5);
        setPluginPanelOffset('b', 'x', 7);
        expect(useAppStore.getState().pluginPanelOffsets).toStrictEqual({ a: { x: 10, y: -5 }, b: { x: 7 } });
    });

    it('clearing the last axis removes the entry; invalid values clear the axis', () => {
        const { setPluginPanelOffset } = useAppStore.getState();
        setPluginPanelOffset('a', 'x', 10);
        setPluginPanelOffset('a', 'y', 3);
        setPluginPanelOffset('a', 'x', null);
        expect(useAppStore.getState().pluginPanelOffsets).toStrictEqual({ a: { y: 3 } });
        setPluginPanelOffset('a', 'y', Number.NaN);
        expect(useAppStore.getState().pluginPanelOffsets).toStrictEqual({});
    });

    it('is part of the persisted state', () => {
        const partialize = useAppStore.persist.getOptions().partialize!;
        useAppStore.getState().setPluginPanelOffset('a', 'x', 42);
        expect((partialize(useAppStore.getState()) as Record<string, unknown>).pluginPanelOffsets).toStrictEqual({ a: { x: 42 } });
    });
});
