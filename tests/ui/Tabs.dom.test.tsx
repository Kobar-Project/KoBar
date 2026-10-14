import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from '../../src/ui';
import { cleanup, fire, getByRole, keyDown, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const tabs = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

const ITEMS: TabItem[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', disabled: true },
    { value: 'c', label: 'Gamma', icon: 'star' },
    { value: 'd', label: 'Delta' },
];

function Controlled({ onChange, items = ITEMS }: { onChange?: (v: string) => void; items?: TabItem[] }) {
    const [value, setValue] = useState('a');
    return (
        <Tabs
            aria-label="Sections"
            items={items}
            value={value}
            onChange={(next) => {
                onChange?.(next);
                setValue(next);
            }}
        />
    );
}

describe('Tabs', () => {
    it('renders tablist/tab roles with aria-selected and a roving tabindex', () => {
        render(<Tabs aria-label="Sections" items={ITEMS} value="c" onChange={() => {}} />);
        const list = getByRole('tablist');
        expect(list.getAttribute('aria-label')).toBe('Sections');
        expect(list.getAttribute('aria-orientation')).toBe('horizontal');
        const t = tabs();
        expect(t.map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
        expect(t.map((el) => el.tabIndex)).toEqual([-1, -1, 0, -1]);
        expect(t.every((el) => el.type === 'button' && el.id !== '')).toBe(true);
        expect(t[1].disabled).toBe(true);
    });

    it('links tabs to panels via id/aria-controls', () => {
        render(<Tabs aria-label="x" items={[{ value: 'a', label: 'A', id: 'tab-a', panelId: 'panel-a' }]} value="a" onChange={() => {}} />);
        const tab = getByRole('tab');
        expect(tab.id).toBe('tab-a');
        expect(tab.getAttribute('aria-controls')).toBe('panel-a');
    });

    it('click selects (controlled) and does not fire for the selected tab', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        click(tabs()[0]);
        expect(onChange).not.toHaveBeenCalled();
        click(tabs()[3]);
        expect(onChange).toHaveBeenCalledWith('d');
        expect(tabs()[3].getAttribute('aria-selected')).toBe('true');
        expect(tabs()[3].tabIndex).toBe(0);
        expect(tabs()[0].tabIndex).toBe(-1);
    });

    it('ArrowRight/ArrowLeft move focus and selection, skip disabled tabs and wrap', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        act(() => tabs()[0].focus());
        keyDown(tabs()[0], 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith('c');
        expect(document.activeElement).toBe(tabs()[2]);
        keyDown(tabs()[2], 'ArrowRight');
        expect(document.activeElement).toBe(tabs()[3]);
        keyDown(tabs()[3], 'ArrowRight');
        expect(document.activeElement).toBe(tabs()[0]);
        expect(onChange).toHaveBeenLastCalledWith('a');
        keyDown(tabs()[0], 'ArrowLeft');
        expect(document.activeElement).toBe(tabs()[3]);
        expect(tabs()[3].getAttribute('aria-selected')).toBe('true');
    });

    it('Home/End jump to the first/last enabled tab; Up/Down are not handled', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        keyDown(tabs()[0], 'End');
        expect(document.activeElement).toBe(tabs()[3]);
        keyDown(tabs()[3], 'Home');
        expect(document.activeElement).toBe(tabs()[0]);
        onChange.mockClear();
        keyDown(tabs()[0], 'ArrowDown');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('mirrors Left/Right in RTL', () => {
        render(
            <div dir="rtl">
                <Controlled />
            </div>
        );
        keyDown(tabs()[0], 'ArrowLeft');
        expect(document.activeElement).toBe(tabs()[2]);
    });

    it('stays controlled: keyboard calls onChange but selection follows the prop', () => {
        const onChange = vi.fn();
        render(<Tabs aria-label="x" items={ITEMS} value="a" onChange={onChange} />);
        keyDown(tabs()[0], 'ArrowRight');
        expect(onChange).toHaveBeenCalledWith('c');
        expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    });

    it('falls back to the first enabled tab for tabIndex 0 when the value matches none', () => {
        render(
            <Tabs aria-label="x" items={[{ value: 'a', label: 'A', disabled: true }, ...ITEMS.slice(2)]} value="zzz" onChange={() => {}} />
        );
        expect(tabs().map((el) => el.tabIndex)).toEqual([-1, 0, -1]);
    });

    it('variants use token classes, drag-region and focus ring', () => {
        const { host, rerender } = render(<Tabs aria-label="x" items={ITEMS} value="a" onChange={() => {}} />);
        expect(tabs()[0].className).toContain('after:bg-[var(--kb-accent)]');
        expect(tabs()[0].className).toContain('no-drag-region');
        expect(tabs()[0].className).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(getByRole('tablist').className).toContain('pointer-events-auto');
        rerender(<Tabs aria-label="x" items={ITEMS} value="a" onChange={() => {}} variant="segmented" fullWidth />);
        expect(tabs()[0].className).toContain('bg-surface');
        expect(tabs()[0].className).toContain('flex-1');
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        const icon = tabs()[2].querySelector('.material-symbols-outlined')!;
        expect(icon.getAttribute('aria-hidden')).toBe('true');
    });
});
