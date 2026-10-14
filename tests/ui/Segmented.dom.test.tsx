import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented, type SegmentedItem } from '../../src/ui';
import { cleanup, fire, getByRole, keyDown, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const radios = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

type Side = 'left' | 'right' | 'top';
const ITEMS: SegmentedItem<Side>[] = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'top', label: 'Top', disabled: true },
];

function Controlled({ onChange }: { onChange?: (v: Side) => void }) {
    const [value, setValue] = useState<Side>('left');
    return (
        <Segmented<Side>
            aria-label="Dock side"
            items={ITEMS}
            value={value}
            onChange={(next) => {
                onChange?.(next);
                setValue(next);
            }}
        />
    );
}

describe('Segmented', () => {
    it('renders radiogroup/radio roles with aria-checked and a roving tabindex', () => {
        render(<Segmented aria-label="Dock side" items={ITEMS} value="right" onChange={() => {}} />);
        expect(getByRole('radiogroup').getAttribute('aria-label')).toBe('Dock side');
        expect(radios().map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
        expect(radios().map((el) => el.tabIndex)).toEqual([-1, 0, -1]);
        expect(radios()[2].disabled).toBe(true);
    });

    it('click selects (controlled)', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        click(radios()[1]);
        expect(onChange).toHaveBeenCalledWith('right');
        expect(radios()[1].getAttribute('aria-checked')).toBe('true');
        expect(radios()[1].tabIndex).toBe(0);
    });

    it('all four arrows move and select, skipping disabled items and wrapping', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        keyDown(radios()[0], 'ArrowDown');
        expect(document.activeElement).toBe(radios()[1]);
        expect(onChange).toHaveBeenLastCalledWith('right');
        keyDown(radios()[1], 'ArrowRight');
        expect(document.activeElement).toBe(radios()[0]);
        expect(onChange).toHaveBeenLastCalledWith('left');
        keyDown(radios()[0], 'ArrowUp');
        expect(document.activeElement).toBe(radios()[1]);
        keyDown(radios()[1], 'ArrowLeft');
        expect(document.activeElement).toBe(radios()[0]);
        keyDown(radios()[0], 'End');
        expect(document.activeElement).toBe(radios()[1]);
        keyDown(radios()[1], 'Home');
        expect(document.activeElement).toBe(radios()[0]);
        expect(radios()[0].getAttribute('aria-checked')).toBe('true');
    });

    it('ignores modified arrows and unrelated keys', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        fire(radios()[0], new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
        keyDown(radios()[0], 'a');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('uses token classes, drag-region and focus ring', () => {
        const { host } = render(<Segmented aria-label="x" items={ITEMS} value="left" onChange={() => {}} />);
        expect(radios()[0].className).toContain('bg-surface');
        expect(radios()[0].className).toContain('no-drag-region');
        expect(radios()[0].className).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(getByRole('radiogroup').className).toContain('pointer-events-auto');
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });
});
