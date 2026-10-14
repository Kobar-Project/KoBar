import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/ui';
import { cleanup, fire, getByRole, render } from './render';

afterEach(cleanup);

const click = (el: HTMLElement) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('Button', () => {
    it('renders a native button with type="button" by default', () => {
        render(<Button>Save</Button>);
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.type).toBe('button');
        expect(btn.textContent).toBe('Save');
        // Native button: focusable and activated by Enter/Space by the browser itself.
        expect(btn.tabIndex).toBe(0);
    });

    it('keeps an explicit type and forwards the ref', () => {
        const ref = { current: null as HTMLButtonElement | null };
        render(
            <form>
                <Button type="submit" ref={ref}>
                    Send
                </Button>
            </form>
        );
        expect(ref.current?.type).toBe('submit');
    });

    it('applies drag-region, pointer-events and focus-ring classes inside the primitive', () => {
        render(<Button variant="primary">Go</Button>);
        const cls = getByRole('button').className;
        expect(cls).toContain('no-drag-region');
        expect(cls).toContain('pointer-events-auto');
        expect(cls).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        expect(cls).toContain('bg-[var(--kb-accent)]');
    });

    it.each(['primary', 'secondary', 'subtle', 'danger'] as const)('variant %s uses token utilities only', (variant) => {
        render(<Button variant={variant}>x</Button>);
        expect(getByRole('button').className).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });

    it('size md follows --kb-control-h, sm is the 28 px target', () => {
        const { rerender } = render(<Button size="md">x</Button>);
        expect(getByRole('button').className).toContain('h-[var(--kb-control-h)]');
        rerender(<Button size="sm">x</Button>);
        expect(getByRole('button').className).toContain('h-7');
    });

    it('calls onClick when enabled', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>x</Button>);
        click(getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('disabled: native disabled attribute, no clicks', () => {
        const onClick = vi.fn();
        render(
            <Button disabled onClick={onClick}>
                x
            </Button>
        );
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.disabled).toBe(true);
        click(btn);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('loading: aria-busy + aria-disabled, stays focusable, swallows clicks and shows a decorative spinner', () => {
        const onClick = vi.fn();
        render(
            <Button loading icon="save" onClick={onClick}>
                Save
            </Button>
        );
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.disabled).toBe(false);
        click(btn);
        expect(onClick).not.toHaveBeenCalled();
        const icons = btn.querySelectorAll('.material-symbols-outlined');
        expect(icons).toHaveLength(1);
        expect(icons[0].textContent).toBe('progress_activity');
        expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    });

    it('loading prevents form submission', () => {
        const onSubmit = vi.fn((e: Event) => e.preventDefault());
        const { host } = render(
            <form>
                <Button type="submit" loading>
                    Send
                </Button>
            </form>
        );
        host.querySelector('form')!.addEventListener('submit', onSubmit);
        click(getByRole('button'));
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders the leading icon hidden from assistive technology and supports fullWidth', () => {
        render(
            <Button icon="add" fullWidth>
                New
            </Button>
        );
        const btn = getByRole('button');
        expect(btn.className).toContain('w-full');
        const icon = btn.querySelector('.material-symbols-outlined')!;
        expect(icon.textContent).toBe('add');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
    });
});
