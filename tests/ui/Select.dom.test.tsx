import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from '../../src/ui';
import { cleanup, fire, render } from './render';

afterEach(cleanup);

const select = () => document.querySelector('select')!;

const OPTIONS: SelectOption[] = [
    { value: 'en', label: 'English' },
    { value: 'tr', label: 'Türkçe' },
    { value: 'de', label: 'Deutsch', disabled: true },
];

describe('Select', () => {
    it('renders a labelled native select with the given options', () => {
        const { host } = render(<Select label="Language" options={OPTIONS} defaultValue="tr" />);
        const el = select();
        expect(el.labels).toHaveLength(1);
        expect(el.labels![0].textContent).toBe('Language');
        expect(Array.from(el.options).map((o) => o.textContent)).toEqual(['English', 'Türkçe', 'Deutsch']);
        expect(el.options[2].disabled).toBe(true);
        expect(el.value).toBe('tr');
        const chevron = host.querySelector('.material-symbols-outlined')!;
        expect(chevron.textContent).toBe('expand_more');
        expect(chevron.getAttribute('aria-hidden')).toBe('true');
    });

    it('accepts option children instead of `options`', () => {
        render(
            <Select label="Size" defaultValue="m">
                <option value="s">Small</option>
                <option value="m">Medium</option>
            </Select>
        );
        expect(select().options).toHaveLength(2);
        expect(select().value).toBe('m');
    });

    it('is controlled via value/onChange and forwards the ref', () => {
        const onChange = vi.fn();
        const ref = { current: null as HTMLSelectElement | null };
        function Controlled() {
            const [value, setValue] = useState('en');
            return (
                <Select
                    ref={ref}
                    label="Language"
                    options={OPTIONS}
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setValue(e.target.value);
                    }}
                />
            );
        }
        render(<Controlled />);
        expect(ref.current).toBe(select());
        select().value = 'tr';
        fire(select(), new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('tr');
        expect(select().value).toBe('tr');
    });

    it('hint and error: aria-describedby + aria-invalid', () => {
        render(<Select label="Language" options={OPTIONS} hint="Restart needed" error="Pick one" />);
        const el = select();
        expect(el.getAttribute('aria-invalid')).toBe('true');
        const [hintId, errorId] = el.getAttribute('aria-describedby')!.split(' ');
        expect(document.getElementById(hintId)?.textContent).toBe('Restart needed');
        expect(document.getElementById(errorId)?.textContent).toBe('errorPick one');
        expect(el.className).toContain('border-[var(--kb-danger)]');
    });

    it('disabled', () => {
        render(<Select label="Language" options={OPTIONS} disabled />);
        expect(select().disabled).toBe(true);
    });

    it('drag-region, focus ring, density height, token classes only', () => {
        const { host } = render(<Select id="lang" label="Language" options={OPTIONS} />);
        const el = select();
        expect(el.id).toBe('lang');
        expect(el.className).toContain('no-drag-region');
        expect(el.className).toContain('pointer-events-auto');
        expect(el.className).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(el.className).toContain('h-[var(--kb-control-h)]');
        expect(el.className).toContain('border-[var(--kb-stroke-control)]');
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });
});
