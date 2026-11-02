// CNL-07: tile templates, privacy mode, overflow popover, item menu and plugin bar button of the Canlı bar.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registry from '../src/components/extensions/extensionRegistry';
import { resetBarPresentationForTests, setBarHostContext, setBarItemPresentation } from '../src/components/extensions/barPresentation';
import { BarButton } from '../src/sidebar/BarButton';
import { BarItemMenu, type BarItemMenuTarget } from '../src/sidebar/BarItemMenu';
import { BarTile } from '../src/sidebar/BarTile';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, render } from './ui/render';

const tileProps = { name: 'Weather', icon: 'cloud', tileSize: 64, edge: 'left', orientation: 'vertical' } as const;

function addButton(id: string, tile?: Record<string, unknown>) {
    registry.registerSidebarButton({ id, icon: 'cloud', label: id, onClick: vi.fn(), ...(tile ? { tile } : {}) } as never);
}

beforeEach(() => {
    registry.clear();
    resetBarPresentationForTests();
    setBarHostContext({ privacy: false, locale: 'en', barVisible: true });
});
afterEach(() => {
    cleanup();
    registry.clear();
});

describe('BarTile templates', () => {
    it('draws the label template until the plugin sends a state', () => {
        addButton('w');
        const { host } = render(<BarTile id="w" {...tileProps} active={false} />);
        const btn = host.querySelector('button')!;
        expect(btn.getAttribute('data-template')).toBe('label');
        expect(btn.getAttribute('aria-label')).toBe('Weather');
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
        expect(btn.hasAttribute('aria-live')).toBe(false);
    });

    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
        ['value-caption', { template: 'value-caption' }, { label: 'Weather 21 degrees', value: '21', caption: 'IST' }],
        ['ring', { template: 'ring' }, { label: 'Weather ring', value: '40', progress: 0.4 }],
        ['level', { template: 'level' }, { label: 'Weather levels', levels: [0.2, 0.5, 0.9] }],
        ['meter', { template: 'meter' }, { label: 'Weather meter', value: '2/3', slots: { filled: 2, total: 3 } }],
        ['badge', { template: 'badge' }, { label: 'Weather 4 new', badge: 4 }],
    ];
    it.each(cases)('renders the %s template with the plugin sentence as accessible name', (template, tile, state) => {
        addButton('w', tile);
        vi.useFakeTimers();
        try {
            registry.setBarItemState('w', state);
            vi.advanceTimersByTime(1500);
        } finally {
            vi.useRealTimers();
        }
        const { host } = render(<BarTile id="w" {...tileProps} active={false} />);
        const btn = host.querySelector('button')!;
        expect(btn.getAttribute('data-template')).toBe(template);
        expect(btn.getAttribute('aria-label')).toBe(state.label);
        if (template === 'badge') expect(btn.querySelector('[data-bar-badge="number"]')?.textContent).toBe('4');
        else expect(btn.querySelector('[data-tile-value]')).not.toBeNull();
    });

    it('shows the label template for a sensitive tile in privacy mode and keeps values out of the name', () => {
        addButton('w', { template: 'value-caption', sensitive: true });
        vi.useFakeTimers();
        try {
            registry.setBarItemState('w', { label: 'Weather 21 degrees', value: '21' });
            vi.advanceTimersByTime(1500);
        } finally {
            vi.useRealTimers();
        }
        const view = render(<BarTile id="w" {...tileProps} privacy={false} />);
        expect(view.host.querySelector('button')!.getAttribute('aria-label')).toBe('Weather 21 degrees');
        view.rerender(<BarTile id="w" {...tileProps} privacy />);
        const btn = view.host.querySelector('button')!;
        expect(btn.getAttribute('data-template')).toBe('label');
        expect(btn.getAttribute('aria-label')).toBe('Weather');
        expect(btn.hasAttribute('data-tile-sensitive')).toBe(true);
        expect(btn.querySelector('[data-tile-value]')).toBeNull();
    });

    it('marks the active tile and shows the filled-accent indicator facing the centre', () => {
        addButton('w');
        const { host } = render(<BarTile id="w" {...tileProps} active />);
        expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
        expect(host.querySelector('[data-bar-indicator]')!.getAttribute('data-side')).toBe('right');
    });
});

describe('BarButton', () => {
    it('shows the auto-collapsed tooltip text as its label', () => {
        addButton('w');
        setBarItemPresentation('w', { size: 'icon', autoCollapsed: true });
        const { host } = render(
            <BarButton
                id="w"
                icon="cloud"
                name="Weather"
                variant="thin"
                active={false}
                autoCollapsed
                privacy={false}
                reorderMode={false}
                edge="left"
                orientation="vertical"
                tooltipDisabled={false}
                reorderLabel="Move"
                onOpen={() => undefined}
            />
        );
        expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('Weather');
        expect(host.querySelector('button')!.getAttribute('aria-label')).not.toBe('Weather');
    });

    it('uses the reorder label in reorder mode and swallows pointer events', () => {
        addButton('w');
        const { host } = render(
            <BarButton
                id="w"
                icon="cloud"
                name="Weather"
                variant="cell"
                active
                autoCollapsed={false}
                privacy={false}
                reorderMode
                edge="right"
                orientation="vertical"
                tooltipDisabled
                reorderLabel="Drag to move"
                onOpen={() => undefined}
            />
        );
        const btn = host.querySelector('button')!;
        expect(btn.getAttribute('aria-label')).toBe('Drag to move');
        expect(btn.style.pointerEvents).toBe('none');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });
});

describe('BarItemMenu', () => {
    const target = (over: Partial<BarItemMenuTarget> = {}): BarItemMenuTarget => ({
        id: 'w',
        name: 'Weather',
        icon: 'cloud',
        widget: false,
        rect: { left: 10, top: 10, width: 44, height: 44 },
        element: null,
        ...over,
    });
    const labels = () => Array.from(document.querySelectorAll('[role^="menuitem"]')).map((el) => el.textContent ?? '');

    beforeEach(() => {
        useAppStore.setState({ barItemSizes: {}, barHiddenItems: [] });
        addButton('w');
    });

    it('offers size radios and reorder for a plugin button (no hide), and applies them', () => {
        const onReorder = vi.fn();
        render(<BarItemMenu target={target()} edge="left" orientation="vertical" onClose={() => undefined} onReorder={onReorder} />);
        const radios = document.querySelectorAll('[role="menuitemradio"]');
        expect(radios).toHaveLength(2);
        expect(radios[1].getAttribute('aria-checked')).toBe('true');
        act(() => (radios[0] as HTMLElement).click());
        expect(useAppStore.getState().barItemSizes.w).toBe('tile');
    });

    it('gives an inline widget only Reorder (no size radios, no settings, no hide)', () => {
        render(
            <BarItemMenu
                target={target({ widget: true })}
                edge="left"
                orientation="vertical"
                onClose={() => undefined}
                onReorder={() => undefined}
            />
        );
        expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
        expect(labels()).toHaveLength(1);
    });

    it('shows no plugin settings entry when the plugin has no settings panel', () => {
        render(<BarItemMenu target={target()} edge="left" orientation="vertical" onClose={() => undefined} onReorder={() => undefined} />);
        // size tile, size icon, reorder
        expect(labels()).toHaveLength(3);
    });

    it('renders nothing when there is no target', () => {
        render(<BarItemMenu target={null} edge="left" orientation="vertical" onClose={() => undefined} onReorder={() => undefined} />);
        expect(document.querySelector('[role="menu"]')).toBeNull();
    });
});
