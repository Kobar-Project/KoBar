import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from '../../src/ui';
import { cleanup, fire, getByRole, queryByRole, render } from './render';

afterEach(cleanup);

describe('IconButton', () => {
    it('label becomes aria-label; the icon ligature is hidden from assistive technology', () => {
        render(<IconButton icon="settings" label="Settings" />);
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.getAttribute('aria-label')).toBe('Settings');
        expect(btn.type).toBe('button');
        const icon = btn.querySelector('.material-symbols-outlined')!;
        expect(icon.textContent).toBe('settings');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
    });

    it('label is required by the type', () => {
        // @ts-expect-error -- `label` (the accessible name) is mandatory
        const missingLabel = <IconButton icon="close" />;
        expect(missingLabel).toBeTruthy();
    });

    it('label wins over a stray aria-label attribute', () => {
        render(<IconButton icon="close" label="Close" aria-label="x" tooltip={false} />);
        expect(getByRole('button').getAttribute('aria-label')).toBe('Close');
    });

    it('applies drag-region and pointer-events classes inside the primitive', () => {
        render(<IconButton icon="close" label="Close" tooltip={false} />);
        const cls = getByRole('button').className;
        expect(cls).toContain('no-drag-region');
        expect(cls).toContain('pointer-events-auto');
        expect(cls).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
    });

    it.each([
        [28, 'size-7'],
        [32, 'size-8'],
        [40, 'size-10'],
    ] as const)('size %i maps to %s (>= 28 px target)', (size, cls) => {
        render(<IconButton icon="add" label="Add" size={size} tooltip={false} />);
        expect(getByRole('button').className).toContain(cls);
    });

    it('pressed sets aria-pressed and the filled icon; omitted pressed has no aria-pressed', () => {
        const { rerender } = render(<IconButton icon="push_pin" label="Pin" tooltip={false} />);
        expect(getByRole('button').hasAttribute('aria-pressed')).toBe(false);
        rerender(<IconButton icon="push_pin" label="Pin" pressed tooltip={false} />);
        const btn = getByRole('button');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.querySelector<HTMLElement>('.material-symbols-outlined')!.style.fontVariationSettings).toContain("'FILL' 1");
        rerender(<IconButton icon="push_pin" label="Pin" pressed={false} tooltip={false} />);
        expect(getByRole('button').getAttribute('aria-pressed')).toBe('false');
    });

    it('click works when enabled and is blocked when disabled', () => {
        const onClick = vi.fn();
        const { rerender } = render(<IconButton icon="add" label="Add" onClick={onClick} />);
        fire(getByRole('button'), new MouseEvent('click', { bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
        rerender(<IconButton icon="add" label="Add" onClick={onClick} disabled />);
        fire(getByRole('button'), new MouseEvent('click', { bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('tooltip={false} renders no tooltip wrapper', () => {
        const { host } = render(<IconButton icon="add" label="Add" tooltip={false} />);
        expect(host.firstElementChild?.tagName).toBe('BUTTON');
        expect(queryByRole('tooltip')).toBeNull();
    });
});
