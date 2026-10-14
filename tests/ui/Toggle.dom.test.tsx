import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toggle } from '../../src/ui';
import { cleanup, fire, getByRole, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));

function Controlled({ initial = false, onChange }: { initial?: boolean; onChange?: (v: boolean) => void }) {
    const [checked, setChecked] = useState(initial);
    return (
        <Toggle
            checked={checked}
            onChange={(next) => {
                onChange?.(next);
                setChecked(next);
            }}
            label="Start with Windows"
        />
    );
}

describe('Toggle', () => {
    it('renders a native button with role="switch" and aria-checked', () => {
        render(<Toggle checked={false} onChange={() => {}} label="Wi-Fi" />);
        const sw = getByRole<HTMLButtonElement>('switch');
        expect(sw.tagName).toBe('BUTTON');
        expect(sw.type).toBe('button');
        expect(sw.getAttribute('aria-checked')).toBe('false');
        // Native button: focusable and activated by Space/Enter by the browser itself.
        expect(sw.tabIndex).toBe(0);
    });

    it('associates the visible label with the switch via htmlFor/id', () => {
        render(<Toggle checked onChange={() => {}} label="Wi-Fi" />);
        const sw = getByRole<HTMLButtonElement>('switch');
        expect(sw.id).not.toBe('');
        expect(sw.labels).toHaveLength(1);
        expect(sw.labels[0].textContent).toBe('Wi-Fi');
    });

    it('keeps a caller id and links the description with aria-describedby', () => {
        render(<Toggle id="wifi" checked onChange={() => {}} label="Wi-Fi" description="Uses more battery" />);
        const sw = getByRole('switch');
        expect(sw.id).toBe('wifi');
        const desc = document.getElementById(sw.getAttribute('aria-describedby')!);
        expect(desc?.textContent).toBe('Uses more battery');
    });

    it('is controlled: click calls onChange with the next value and reflects the new prop', () => {
        const onChange = vi.fn();
        render(<Controlled onChange={onChange} />);
        const sw = getByRole('switch');
        click(sw);
        expect(onChange).toHaveBeenLastCalledWith(true);
        expect(sw.getAttribute('aria-checked')).toBe('true');
        click(sw);
        expect(onChange).toHaveBeenLastCalledWith(false);
        expect(sw.getAttribute('aria-checked')).toBe('false');
    });

    it('does not change by itself when the parent ignores onChange', () => {
        const onChange = vi.fn();
        render(<Toggle checked={false} onChange={onChange} label="x" />);
        click(getByRole('switch'));
        expect(onChange).toHaveBeenCalledWith(true);
        expect(getByRole('switch').getAttribute('aria-checked')).toBe('false');
    });

    it('clicking the label toggles', () => {
        const onChange = vi.fn();
        const { host } = render(<Toggle checked={false} onChange={onChange} label="Wi-Fi" />);
        click(host.querySelector('label')!);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('disabled: native disabled, no onChange', () => {
        const onChange = vi.fn();
        const { host } = render(<Toggle checked={false} onChange={onChange} label="Wi-Fi" disabled />);
        const sw = getByRole<HTMLButtonElement>('switch');
        expect(sw.disabled).toBe(true);
        click(sw);
        click(host.querySelector('label')!);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('onClick can veto the change with preventDefault', () => {
        const onChange = vi.fn();
        render(<Toggle checked={false} onChange={onChange} label="x" onClick={(e) => e.preventDefault()} />);
        click(getByRole('switch'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('hideLabel keeps the label for assistive technology only', () => {
        const { host } = render(<Toggle checked={false} onChange={() => {}} label="Wi-Fi" hideLabel />);
        expect(host.querySelector('label')!.parentElement!.className).toContain('sr-only');
        expect(getByRole<HTMLButtonElement>('switch').labels).toHaveLength(1);
    });

    it('uses token classes, drag-region and focus ring; on state uses the accent', () => {
        const { host, rerender } = render(<Toggle checked={false} onChange={() => {}} label="x" />);
        const sw = getByRole('switch');
        expect(sw.className).toContain('no-drag-region');
        expect(sw.className).toContain('pointer-events-auto');
        expect(sw.className).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(sw.className).toContain('border-[var(--kb-stroke-control)]');
        expect((host.firstElementChild as HTMLElement).className).toContain('no-drag-region');
        rerender(<Toggle checked onChange={() => {}} label="x" />);
        expect(getByRole('switch').className).toContain('bg-[var(--kb-accent)]');
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });

    it('fullWidth switches the wrapper from inline-flex to a full-width flex row', () => {
        const { host, rerender } = render(<Toggle checked={false} onChange={() => {}} label="x" />);
        const wrapper = () => (host.firstElementChild as HTMLElement).className.split(' ');
        expect(wrapper()).toContain('inline-flex');
        rerender(<Toggle checked={false} onChange={() => {}} label="x" fullWidth />);
        expect(wrapper()).toEqual(expect.arrayContaining(['flex', 'w-full']));
        expect(wrapper()).not.toContain('inline-flex');
    });

    it.each([false, '', null])('empty description %j renders nothing and no aria-describedby', (description) => {
        const { host } = render(<Toggle checked={false} onChange={() => {}} label="x" description={description} />);
        expect(getByRole('switch').hasAttribute('aria-describedby')).toBe(false);
        expect(host.textContent).toBe('x');
    });

    it('description 0 is rendered inside the linked span', () => {
        render(<Toggle checked={false} onChange={() => {}} label="x" description={0} />);
        expect(document.getElementById(getByRole('switch').getAttribute('aria-describedby')!)?.textContent).toBe('0');
    });
});
