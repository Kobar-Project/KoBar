import { afterEach, describe, expect, it } from 'vitest';
import { Button, EmptyState, Skeleton } from '../../src/ui';
import { cleanup, getByRole, render } from './render';

afterEach(cleanup);

describe('EmptyState', () => {
    it('renders a decorative icon, title, description and action', () => {
        const { host } = render(
            <EmptyState icon="inbox" title="No tasks yet" description="Add one with the + button." action={<Button>Add task</Button>} />
        );
        expect(host.textContent).toContain('No tasks yet');
        expect(host.textContent).toContain('Add one with the + button.');
        expect(host.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
        expect(getByRole('button', host).textContent).toBe('Add task');
    });

    it('omits empty slots', () => {
        const { host } = render(<EmptyState title="Nothing here" />);
        expect(host.querySelectorAll('p')).toHaveLength(1);
        expect(host.querySelector('.material-symbols-outlined')).toBeNull();
    });
});

describe('Skeleton', () => {
    it('is hidden from assistive technology and uses a token fill without continuous animation', () => {
        const { host } = render(<Skeleton width={120} />);
        const el = host.querySelector<HTMLElement>('[data-skeleton]')!;
        expect(el.getAttribute('aria-hidden')).toBe('true');
        expect(el.className).toContain('bg-[var(--kb-fill-selected)]');
        expect(el.className).not.toMatch(/animate-/);
        expect(el.style.width).toBe('120px');
        expect(el.style.height).toBe('12px');
    });

    it('stacks lines with a shorter last line and sizes circles from the width', () => {
        const { host } = render(
            <>
                <Skeleton lines={3} />
                <Skeleton shape="circle" width={40} />
            </>
        );
        const [lines, circle] = Array.from(host.querySelectorAll<HTMLElement>('[data-skeleton]'));
        expect(lines.getAttribute('aria-hidden')).toBe('true');
        expect(lines.children).toHaveLength(3);
        expect((lines.children[2] as HTMLElement).style.width).toBe('60%');
        expect(circle.className).toContain('rounded-full');
        expect(circle.style.height).toBe('40px');
    });
});
