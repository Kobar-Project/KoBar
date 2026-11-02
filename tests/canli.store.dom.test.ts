import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { DEFAULT_TILE_BAR_ITEM_IDS } from '../src/config/defaults';
import { applyRootCanli } from '../src/theme/root';
import { readMirroredCanli } from '../src/settings/appearance';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig. Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// CNL-03: store fields, setters, persistence and the root attributes of the Canlı settings.

const RESET = { barItemSizes: {}, barHiddenItems: [], tonalSurfaces: true, notesTabVisible: true, privacyMode: false };
afterEach(() => useAppStore.setState(RESET));

describe('Canlı fields in the store', () => {
    it('fresh install: ToDo List and Clipboard Manager are tiles', () => {
        expect(DEFAULT_TILE_BAR_ITEM_IDS).toStrictEqual(['todolist-plugin-btn', 'kobar-clipboard-manager-inline']);
    });

    it('setBarItemSize: tile and icon are stored', () => {
        const { setBarItemSize } = useAppStore.getState();
        setBarItemSize('a', 'tile');
        expect(useAppStore.getState().barItemSizes).toStrictEqual({ a: 'tile' });
        setBarItemSize('a', 'icon');
        expect(useAppStore.getState().barItemSizes).toStrictEqual({ a: 'icon' });
    });

    it('setBarItemHidden hides once and shows again', () => {
        const { setBarItemHidden } = useAppStore.getState();
        setBarItemHidden('a', true);
        setBarItemHidden('a', true);
        expect(useAppStore.getState().barHiddenItems).toStrictEqual(['a']);
        setBarItemHidden('a', false);
        expect(useAppStore.getState().barHiddenItems).toStrictEqual([]);
    });

    it('setTonalSurfaces, setNotesTabVisible and setPrivacyMode', () => {
        const s = useAppStore.getState();
        s.setTonalSurfaces(false);
        s.setNotesTabVisible(false);
        s.setPrivacyMode(true);
        expect(useAppStore.getState()).toMatchObject({ tonalSurfaces: false, notesTabVisible: false, privacyMode: true });
    });

    it('all five fields are persisted', () => {
        const s = useAppStore.getState();
        s.setBarItemSize('a', 'tile');
        s.setPrivacyMode(true);
        const persisted = useAppStore.persist.getOptions().partialize!(useAppStore.getState()) as Record<string, unknown>;
        expect(persisted).toMatchObject({ barItemSizes: { a: 'tile' }, privacyMode: true, tonalSurfaces: true, notesTabVisible: true });
        expect(persisted.barHiddenItems).toStrictEqual([]);
    });
});

describe('Canlı root attributes', () => {
    it('applyRootCanli writes data-tonal and data-privacy as on/off', () => {
        const root = document.createElement('div');
        applyRootCanli(root, { tonalSurfaces: true, privacyMode: false });
        expect([root.getAttribute('data-tonal'), root.getAttribute('data-privacy')]).toStrictEqual(['on', 'off']);
        applyRootCanli(root, { tonalSurfaces: false, privacyMode: true });
        expect([root.getAttribute('data-tonal'), root.getAttribute('data-privacy')]).toStrictEqual(['off', 'on']);
    });

    it('readMirroredCanli validates a snapshot', () => {
        expect(readMirroredCanli({})).toStrictEqual({ tonalSurfaces: true, privacyMode: false });
        expect(readMirroredCanli({ tonalSurfaces: 'x', privacyMode: 1 })).toStrictEqual({ tonalSurfaces: true, privacyMode: false });
        expect(readMirroredCanli({ tonalSurfaces: false, privacyMode: true })).toStrictEqual({ tonalSurfaces: false, privacyMode: true });
    });
});
