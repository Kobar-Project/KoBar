// T-618: bar item look and a11y: no round background, indicator bar on the active item, token density, tooltip side per edge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarItem } from '../src/sidebar/BarItem';
import { tooltipSideForEdge } from '../src/sidebar/barEdge';
import { cleanup, render } from './ui/render';

afterEach(cleanup);

describe('BarItem', () => {
    it('is a labelled, token-sized button without round, glow or scale classes', () => {
        const { host } = render(
            <BarItem label="Notes" orientation="vertical" edge="left">
                <span className="material-symbols-outlined">note</span>
            </BarItem>
        );
        const btn = host.querySelector('button')!;
        expect(btn.getAttribute('aria-label')).toBe('Notes');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.className).toContain('size-[var(--kb-bar-item)]');
        expect(btn.className).not.toMatch(/rounded-full|(^| )shadow|scale-|(^| )ring-|(^| )border/);
        expect(btn.querySelector('.material-symbols-outlined')?.textContent).toBe('note');
        expect(host.querySelector('[data-bar-indicator]')).toBeNull();
        expect(btn.hasAttribute('aria-pressed')).toBe(false);
    });

    it('accent tone replaces the neutral idle colours', () => {
        const { host } = render(
            <BarItem label="Eye" tone="accent" orientation="vertical" edge="left">
                x
            </BarItem>
        );
        const cls = host.querySelector('button')!.className;
        expect(cls).toContain('text-[var(--kb-accent)]');
        expect(cls).not.toMatch(/text-fg-/);
    });

    it('shows the indicator bar only when active, on the left (vertical) or bottom (horizontal)', () => {
        const v = render(
            <BarItem label="A" active orientation="vertical" edge="right">
                x
            </BarItem>
        );
        const bar = v.host.querySelector('[data-bar-indicator]')!;
        expect(bar.className).toContain('left-0');
        expect(v.host.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
        const h = render(
            <BarItem label="B" active orientation="horizontal" edge="top">
                x
            </BarItem>
        );
        expect(h.host.querySelector('[data-bar-indicator]')!.className).toContain('bottom-0');
    });

    it('forwards click and ref, and maps the tooltip side away from the docked edge', () => {
        const onClick = vi.fn();
        const ref = { current: null as HTMLButtonElement | null };
        const { host } = render(
            <BarItem label="C" ref={ref} onClick={onClick} orientation="vertical" edge="left">
                x
            </BarItem>
        );
        host.querySelector('button')!.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(ref.current).toBe(host.querySelector('button'));
        expect(['left', 'right', 'top', 'bottom'].map((e) => tooltipSideForEdge(e as 'left'))).toEqual(['right', 'left', 'bottom', 'top']);
    });
});
