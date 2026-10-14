import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextField } from '../../src/ui';
import { cleanup, fire, render } from './render';

afterEach(cleanup);

const input = () => document.querySelector('input')!;

function setValue(el: HTMLInputElement, value: string) {
    // React tracks the value via the native setter; go through the prototype so onChange fires.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    fire(el, new Event('input', { bubbles: true }));
}

describe('TextField', () => {
    it('labels the input via a generated id', () => {
        render(<TextField label="Name" />);
        const el = input();
        expect(el.type).toBe('text');
        expect(el.id).not.toBe('');
        expect(el.labels).toHaveLength(1);
        expect(el.labels![0].textContent).toBe('Name');
        expect(el.hasAttribute('aria-invalid')).toBe(false);
        expect(el.hasAttribute('aria-describedby')).toBe(false);
    });

    it('keeps a caller id and links the hint with aria-describedby', () => {
        render(<TextField id="name" label="Name" hint="Shown on the bar" />);
        const el = input();
        expect(el.id).toBe('name');
        expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toBe('Shown on the bar');
    });

    it('error: aria-invalid + message (with decorative icon) linked after the hint and caller ids', () => {
        render(<TextField label="Name" hint="Hint" error="Required" aria-describedby="extra" />);
        const el = input();
        expect(el.getAttribute('aria-invalid')).toBe('true');
        const ids = el.getAttribute('aria-describedby')!.split(' ');
        expect(ids).toHaveLength(3);
        expect(document.getElementById(ids[0])?.textContent).toBe('Hint');
        const err = document.getElementById(ids[1])!;
        expect(err.textContent).toBe('errorRequired');
        expect(err.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
        expect(ids[2]).toBe('extra');
        expect(el.className).toContain('border-[var(--kb-danger)]');
    });

    it('error={true} marks invalid without a message', () => {
        render(<TextField label="Name" error />);
        expect(input().getAttribute('aria-invalid')).toBe('true');
        expect(input().hasAttribute('aria-describedby')).toBe(false);
    });

    it('is controlled and forwards the ref and input props', () => {
        const onChange = vi.fn();
        const ref = { current: null as HTMLInputElement | null };
        function Controlled() {
            const [value, setV] = useState('');
            return (
                <TextField
                    ref={ref}
                    label="Name"
                    placeholder="Type"
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setV(e.target.value.toUpperCase());
                    }}
                />
            );
        }
        render(<Controlled />);
        expect(ref.current).toBe(input());
        expect(input().placeholder).toBe('Type');
        setValue(input(), 'ab');
        expect(onChange).toHaveBeenCalledWith('ab');
        expect(input().value).toBe('AB');
    });

    it('disabled and leading icon', () => {
        const { host } = render(<TextField label="Search" icon="search" disabled />);
        expect(input().disabled).toBe(true);
        const icon = host.querySelector('.material-symbols-outlined')!;
        expect(icon.textContent).toBe('search');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(input().className).toContain('ps-8');
    });

    it('hideLabel keeps the label for assistive technology only', () => {
        render(<TextField label="Search" hideLabel />);
        expect(input().labels![0].className).toContain('sr-only');
    });

    it('drag-region, focus ring, no select-none, token classes only', () => {
        const { host } = render(<TextField label="Name" hint="h" error="e" />);
        const cls = input().className;
        expect(cls).toContain('no-drag-region');
        expect(cls).toContain('pointer-events-auto');
        expect(cls).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(cls).not.toContain('select-none');
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        // The whole field (label, hint, error) is outside the window drag region.
        expect((host.firstElementChild as HTMLElement).className).toContain('no-drag-region');
    });
});
