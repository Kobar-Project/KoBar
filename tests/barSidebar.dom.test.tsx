// CNL-07: the assembled bar (Sidebar.tsx): thin vs wide, 0 plugins, hidden items, default size for new plugins, mini mode.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registry from '../src/components/extensions/extensionRegistry';
import { resetBarPresentationForTests } from '../src/components/extensions/barPresentation';
import Sidebar from '../src/components/layout/Sidebar';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, render } from './ui/render';

function addButton(id: string, tile?: Record<string, unknown>) {
    registry.registerSidebarButton({ id, icon: 'cloud', label: id, onClick: vi.fn(), ...(tile ? { tile } : {}) } as never);
}

const bar = (host: HTMLElement) => host.querySelector('[role="toolbar"]') as HTMLElement | null;
const itemIds = (host: HTMLElement) => Array.from(host.querySelectorAll('[data-bar-id]')).map((el) => el.getAttribute('data-bar-id'));

beforeEach(() => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    );
    registry.clear();
    resetBarPresentationForTests();
    useAppStore.setState({
        featureOrder: [],
        barItemSizes: {},
        barHiddenItems: [],
        isMiniMode: false,
        privacyMode: false,
        density: 'normal',
        edgePosition: 'left',
        notesTabVisible: true,
    });
});
afterEach(() => {
    cleanup();
    registry.clear();
});

describe('Sidebar (Canlı bar)', () => {
    it('with 0 plugins shows the thin bar with a handle, an Add plugin cell and the mini button', () => {
        const { host } = render(<Sidebar />);
        expect(bar(host)).not.toBeNull();
        expect(host.querySelector('[data-testid="bar-header"]')).not.toBeNull();
        expect(host.querySelector('[data-bar-add-plugin]')).not.toBeNull();
        expect(host.querySelector('[data-bar-mini]')).not.toBeNull();
        expect(host.querySelector('[data-bar-tile]')).toBeNull();
    });

    it('icon-only plugins make a thin bar; one tile makes it wide', () => {
        addButton('a');
        addButton('b');
        const view = render(<Sidebar />);
        expect(bar(view.host)!.getAttribute('data-bar-mode')).toBe('thin');
        expect(view.host.querySelector('[data-bar-tile]')).toBeNull();
        act(() => useAppStore.getState().setBarItemSize('a', 'tile'));
        expect(bar(view.host)!.getAttribute('data-bar-mode')).toBe('wide');
        expect(view.host.querySelectorAll('[data-bar-tile]')).toHaveLength(1);
    });

    it('draws every enabled item: no hidden items and no More cell (owner decision)', () => {
        addButton('a');
        addButton('b');
        useAppStore.setState({ barHiddenItems: ['b'] });
        const { host } = render(<Sidebar />);
        expect(itemIds(host)).toContain('a');
        expect(itemIds(host)).toContain('b');
        expect(host.querySelector('[data-bar-more]')).toBeNull();
    });

    it('gives a new plugin whose manifest asks for a tile that size once and never overrides an existing choice', () => {
        registry.registerManifest('plug', { id: 'plug', bar: { defaultSize: 'tile' } });
        const script = document.createElement('script');
        script.dataset.extensionId = 'plug';
        Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
        try {
            addButton('plug-btn');
            addButton('old-btn');
        } finally {
            delete (document as unknown as Record<string, unknown>).currentScript;
        }
        useAppStore.setState({ barItemSizes: {} });
        render(<Sidebar />);
        expect(useAppStore.getState().barItemSizes['plug-btn']).toBe('tile');
        cleanup();
        useAppStore.setState({ featureOrder: [], barItemSizes: { 'plug-btn': 'icon' } });
        render(<Sidebar />);
        expect(useAppStore.getState().barItemSizes['plug-btn']).toBe('icon');
    });
});
