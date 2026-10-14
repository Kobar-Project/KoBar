// R2-02: bar header (whole-area button: click or right-click opens the menu, drag does not) and R2-01 plugin button normalisation rule.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarHeader } from '../src/sidebar/BarHeader';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, render } from './ui/render';

function Harness({
    orientation = 'vertical',
    onDragStart = () => {},
    consume = () => false,
}: {
    orientation?: 'vertical' | 'horizontal';
    onDragStart?: () => void;
    consume?: () => boolean;
}) {
    const [open, setOpen] = useState(false);
    return (
        <BarHeader
            orientation={orientation}
            open={open}
            onOpenChange={setOpen}
            onReorder={() => {}}
            onMiniMode={() => {}}
            onDragStart={onDragStart}
            consumeDrag={consume}
        />
    );
}

beforeEach(() => {
    useAppStore.setState({ language: 'en', activeWorkspaceId: null, workspaces: [] } as never);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const header = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="bar-header"]')!;
const menu = () => document.querySelector('[role="menu"]');

describe('BarHeader', () => {
    it('renders a full-width divider header with a three-line grip and no dots', () => {
        const { host } = render(<Harness />);
        const h = header(host);
        expect(h.className).toContain('w-full');
        expect(h.className).toContain('border-b');
        expect(h.querySelectorAll('line')).toHaveLength(3);
        expect(host.querySelector('[data-testid="bar-more"]')).toBeNull();
    });

    it('horizontal header is a full-height block at the left end with a right divider', () => {
        const { host } = render(<Harness orientation="horizontal" />);
        expect(header(host).className).toContain('h-full');
        expect(header(host).className).toContain('border-r');
    });

    it('left click opens the menu', () => {
        const { host } = render(<Harness />);
        act(() => header(host).click());
        expect(menu()).not.toBeNull();
    });

    it('right click opens the menu', () => {
        const { host } = render(<Harness />);
        act(() => {
            header(host).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        });
        expect(menu()).not.toBeNull();
    });

    it('a click that ends a drag does not open the menu', () => {
        const { host } = render(<Harness consume={() => true} />);
        act(() => header(host).click());
        expect(menu()).toBeNull();
    });

    it('left mouse down starts the bar drag, other buttons do not', () => {
        const onDragStart = vi.fn();
        const { host } = render(<Harness onDragStart={onDragStart} />);
        act(() => {
            header(host).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
        });
        expect(onDragStart).not.toHaveBeenCalled();
        act(() => {
            header(host).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        });
        expect(onDragStart).toHaveBeenCalledOnce();
    });
});

describe('plugin bar button normalisation (R2-01)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const block = css.slice(css.indexOf('[data-bar-widget] button {'));
    it('strips fill, border, shadow and scale and unifies colour and icon size', () => {
        expect(block).toMatch(/background: transparent !important/);
        expect(block).toMatch(/border: 0 !important/);
        expect(block).toMatch(/box-shadow: none !important/);
        expect(block).toMatch(/scale: none !important/);
        expect(block).toMatch(/color: var\(--kb-fg-2\) !important/);
        expect(block).toMatch(/font-size: var\(--kb-bar-icon\) !important/);
    });
    it('only hover adds emphasis', () => {
        expect(block).toMatch(/\[data-bar-widget\] button:hover \{[^}]*var\(--kb-fill-hover\)/);
    });
});
