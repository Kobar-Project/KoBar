import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton, Menu, type MenuItem } from '../../src/ui';
import { openLayerCount } from '../../src/ui/layers';
import { cleanup, fire, getByRole, keyDown, queryByRole, render } from './render';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const trigger = () => document.querySelector<HTMLButtonElement>('#trigger')!;
const active = () => document.activeElement as HTMLElement;
const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role^="menuitem"]'));

function setup(extra: Partial<Record<'onRename' | 'onDelete' | 'onPin' | 'onSort', () => void>> = {}, pinned = false) {
    const onPinChange = vi.fn();
    const list: MenuItem[] = [
        { id: 'rename', label: 'Rename', icon: 'edit', shortcut: 'F2', onSelect: extra.onRename },
        { id: 'duplicate', label: 'Duplicate', disabled: true },
        { id: 'pin', type: 'checkbox', label: 'Pinned', checked: pinned, onCheckedChange: onPinChange },
        { type: 'separator' },
        { id: 'sort', type: 'radio', label: 'Sort by name', checked: true, onSelect: extra.onSort ?? (() => {}) },
        { id: 'delete', label: 'Delete', danger: true, onSelect: extra.onDelete },
    ];
    render(
        <Menu
            items={list}
            trigger={
                <button id="trigger" type="button">
                    More
                </button>
            }
        />
    );
    return { onPinChange };
}

describe('Menu', () => {
    it('renders menu semantics, labelled by the trigger, with the first enabled item focused', () => {
        setup();
        expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
        click(trigger());
        const menu = getByRole('menu');
        expect(menu.getAttribute('aria-labelledby')).toBe('trigger');
        expect(menu.getAttribute('aria-orientation')).toBe('vertical');
        expect(menu.className).toContain('z-[var(--kb-z-popover)]');
        expect(items().map((el) => el.getAttribute('role'))).toEqual([
            'menuitem',
            'menuitem',
            'menuitemcheckbox',
            'menuitemradio',
            'menuitem',
        ]);
        expect(items()[1].hasAttribute('disabled')).toBe(true);
        expect(items()[2].getAttribute('aria-checked')).toBe('false');
        expect(items()[3].getAttribute('aria-checked')).toBe('true');
        expect(items().every((el) => el.tabIndex === -1)).toBe(true);
        expect(getByRole('separator')).toBeTruthy();
        expect(active().textContent).toContain('Rename');
    });

    it('Arrow keys skip disabled items and wrap; Home/End jump', () => {
        setup();
        click(trigger());
        keyDown(active(), 'ArrowDown');
        expect(active().textContent).toContain('Pinned');
        expect(active().getAttribute('role')).toBe('menuitemcheckbox');
        keyDown(active(), 'ArrowDown');
        keyDown(active(), 'ArrowDown');
        expect(active().textContent).toContain('Delete');
        keyDown(active(), 'ArrowDown');
        expect(active().textContent).toContain('Rename');
        keyDown(active(), 'ArrowUp');
        expect(active().textContent).toContain('Delete');
        keyDown(active(), 'Home');
        expect(active().textContent).toContain('Rename');
        keyDown(active(), 'End');
        expect(active().textContent).toContain('Delete');
    });

    it('Arrow Up on the trigger opens with the last item focused, Arrow Down with the first', () => {
        setup();
        keyDown(trigger(), 'ArrowUp');
        expect(queryByRole('menu')).not.toBeNull();
        expect(active().textContent).toContain('Delete');
        keyDown(active(), 'Escape');
        keyDown(trigger(), 'ArrowDown');
        expect(active().textContent).toContain('Rename');
    });

    it('selecting an item runs it, closes the menu and returns focus to the trigger', () => {
        const onDelete = vi.fn();
        setup({ onDelete });
        click(trigger());
        keyDown(active(), 'End');
        click(active());
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(queryByRole('menu')).toBeNull();
        expect(active()).toBe(trigger());
        expect(openLayerCount()).toBe(0);
    });

    it('a disabled item does nothing', () => {
        setup();
        click(trigger());
        click(items()[1]);
        expect(queryByRole('menu')).not.toBeNull();
    });

    it('a checkbox item toggles without closing', () => {
        const { onPinChange } = setup();
        click(trigger());
        click(items()[2]);
        expect(onPinChange).toHaveBeenCalledWith(true);
        expect(queryByRole('menu')).not.toBeNull();
    });

    it('Escape and Tab close and return focus to the trigger', () => {
        setup();
        click(trigger());
        keyDown(active(), 'Escape');
        expect(queryByRole('menu')).toBeNull();
        expect(active()).toBe(trigger());

        click(trigger());
        keyDown(active(), 'Tab');
        expect(queryByRole('menu')).toBeNull();
        expect(active()).toBe(trigger());
    });

    it('typeahead focuses the next matching enabled item and resets after a pause', () => {
        vi.useFakeTimers();
        setup();
        click(trigger());
        keyDown(active(), 's');
        expect(active().textContent).toContain('Sort by name');
        keyDown(active(), 'd');
        // "sd" matches nothing: focus stays.
        expect(active().textContent).toContain('Sort by name');
        act(() => vi.advanceTimersByTime(600));
        keyDown(active(), 'd');
        // "Duplicate" is disabled, so "d" lands on Delete.
        expect(active().textContent).toContain('Delete');
    });

    it('returns focus to an IconButton trigger wrapped in its tooltip', () => {
        render(
            <Menu
                aria-label="Note actions"
                items={[{ id: 'a', label: 'Archive' }]}
                trigger={<IconButton icon="more_vert" label="More" />}
            />
        );
        const btn = document.querySelector<HTMLButtonElement>('button[aria-label="More"]')!;
        click(btn);
        expect(getByRole('menu').getAttribute('aria-label')).toBe('Note actions');
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        keyDown(active(), 'Escape');
        expect(active()).toBe(btn);
    });

    it('unmounting with a pending typeahead timer leaves no timers behind', () => {
        vi.useFakeTimers();
        setup();
        click(trigger());
        // Baseline: timers owned by React's scheduler, not by the menu.
        const before = vi.getTimerCount();
        keyDown(active(), 'r');
        expect(vi.getTimerCount()).toBe(before + 1);
        cleanup();
        expect(vi.getTimerCount()).toBe(before);
        expect(openLayerCount()).toBe(0);
    });
});
