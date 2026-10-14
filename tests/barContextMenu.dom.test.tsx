// T-619: bar context menu: items, keyboard, workspace view, actions.
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarContextMenu } from '../src/sidebar/ContextMenu';
import { useAppStore } from '../src/store/useAppStore';
import { translations } from '../src/i18n';
import { cleanup, render } from './ui/render';

const en = translations.en;

function Harness({ onReorder = () => {}, onMiniMode = () => {} }: { onReorder?: () => void; onMiniMode?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div
            onContextMenu={(e) => {
                e.preventDefault();
                setOpen(true);
            }}
            data-testid="handle"
        >
            <BarContextMenu open={open} onOpenChange={setOpen} onReorder={onReorder} onMiniMode={onMiniMode} />
        </div>
    );
}

const items = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemradio"]'));
const byText = (txt: string) => items().find((i) => i.textContent?.includes(txt))!;
const key = (el: Element, k: string) =>
    act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    });

beforeEach(() => {
    useAppStore.setState({ language: 'en', activeWorkspaceId: null, workspaces: [] } as never);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('BarContextMenu', () => {
    it('opens on right-click with the expected items and focuses the first', () => {
        const { host } = render(<Harness />);
        act(() => {
            host.querySelector('[data-testid="handle"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        });
        expect(document.querySelector('[role="menu"]')).not.toBeNull();
        expect(items().map((i) => i.textContent)).toEqual(
            [en.notesList, `${en.workspaces} \u25B8`, en.plugins, en.settings, en.barMenuReorder, en.miniMode, en.barMenuQuit].map((x) =>
                expect.stringContaining(x)
            )
        );
        expect(document.activeElement).toBe(items()[0]);
    });

    it('opens from the more button, arrows move focus, Escape closes and returns focus', () => {
        const { host } = render(<Harness />);
        const btn = host.querySelector<HTMLButtonElement>('[data-testid="bar-more"]')!;
        act(() => btn.click());
        const menu = document.querySelector('[role="menu"]')!;
        key(menu, 'ArrowDown');
        expect(document.activeElement).toBe(items()[1]);
        key(menu, 'Escape');
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(btn);
    });

    it('reorder, mini mode and quit call their handlers', () => {
        const onReorder = vi.fn();
        const onMiniMode = vi.fn();
        const quitApp = vi.fn();
        (window as unknown as { api: unknown }).api = { quitApp };
        const { host } = render(<Harness onReorder={onReorder} onMiniMode={onMiniMode} />);
        const open = () => act(() => host.querySelector<HTMLButtonElement>('[data-testid="bar-more"]')!.click());
        open();
        act(() => byText(en.barMenuReorder).click());
        open();
        act(() => byText(en.miniMode).click());
        open();
        act(() => byText(en.barMenuQuit).click());
        expect(onReorder).toHaveBeenCalledOnce();
        expect(onMiniMode).toHaveBeenCalledOnce();
        expect(quitApp).toHaveBeenCalledOnce();
        delete (window as unknown as { api?: unknown }).api;
    });

    it('workspace view lists workspaces and switches via the store', () => {
        const setActive = vi.fn();
        useAppStore.setState({ workspaces: [{ id: 'w1', name: 'Alpha' }], setActiveWorkspaceId: setActive } as never);
        const { host } = render(<Harness />);
        act(() => host.querySelector<HTMLButtonElement>('[data-testid="bar-more"]')!.click());
        act(() => byText(en.workspaces).click());
        expect(document.querySelector('[role="menu"]')).not.toBeNull();
        expect(byText('Alpha').getAttribute('aria-checked')).toBe('false');
        expect(byText(en.colorDefault).getAttribute('aria-checked')).toBe('true');
        act(() => byText('Alpha').click());
        expect(setActive).toHaveBeenCalledWith('w1');
        expect(document.querySelector('[role="menu"]')).toBeNull();
    });
});
