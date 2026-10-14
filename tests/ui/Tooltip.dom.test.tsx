import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconButton, Tooltip } from '../../src/ui';
import { cleanup, fire, getByRole, keyDown, queryByRole, render } from './render';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const hover = (el: HTMLElement) => fire(el, new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
const unhover = (el: HTMLElement) => fire(el, new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
const focus = (el: HTMLElement) => act(() => el.focus());
const blur = (el: HTMLElement) => act(() => el.blur());
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('Tooltip', () => {
    it('shows on hover after the delay and hides on mouse leave', () => {
        render(
            <Tooltip content="Save note" delay={500}>
                <button type="button">S</button>
            </Tooltip>
        );
        const btn = getByRole('button');
        hover(btn);
        expect(queryByRole('tooltip')).toBeNull();
        advance(499);
        expect(queryByRole('tooltip')).toBeNull();
        advance(1);
        const tip = getByRole('tooltip');
        expect(tip.textContent).toBe('Save note');
        expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
        unhover(btn);
        expect(queryByRole('tooltip')).toBeNull();
        expect(btn.hasAttribute('aria-describedby')).toBe(false);
    });

    it('renders in a portal on the tooltip layer', () => {
        const { host } = render(
            <Tooltip content="Tip" delay={0}>
                <button type="button">S</button>
            </Tooltip>
        );
        hover(getByRole('button'));
        const tip = getByRole('tooltip');
        expect(host.contains(tip)).toBe(false);
        expect(tip.parentElement).toBe(document.body);
        expect(tip.className).toContain('z-[var(--kb-z-tooltip)]');
        expect(tip.className).toContain('pointer-events-none');
    });

    it('shows immediately on keyboard focus and hides on blur', () => {
        render(
            <Tooltip content="Tip">
                <button type="button">S</button>
            </Tooltip>
        );
        const btn = getByRole('button');
        focus(btn);
        expect(getByRole('tooltip').textContent).toBe('Tip');
        blur(btn);
        expect(queryByRole('tooltip')).toBeNull();
    });

    it('Escape dismisses the tooltip (focus and hover)', () => {
        render(
            <Tooltip content="Tip" delay={0}>
                <button type="button">S</button>
            </Tooltip>
        );
        const btn = getByRole('button');
        focus(btn);
        expect(queryByRole('tooltip')).not.toBeNull();
        keyDown(btn, 'Escape');
        expect(queryByRole('tooltip')).toBeNull();
        expect(document.activeElement).toBe(btn);

        hover(btn);
        expect(queryByRole('tooltip')).not.toBeNull();
        keyDown(document, 'Escape');
        expect(queryByRole('tooltip')).toBeNull();
    });

    it('pointer down hides it, disabled never shows it', () => {
        const { rerender } = render(
            <Tooltip content="Tip" delay={0}>
                <button type="button">S</button>
            </Tooltip>
        );
        hover(getByRole('button'));
        expect(queryByRole('tooltip')).not.toBeNull();
        fire(getByRole('button'), new MouseEvent('pointerdown', { bubbles: true }));
        expect(queryByRole('tooltip')).toBeNull();

        rerender(
            <Tooltip content="Tip" delay={0} disabled>
                <button type="button">S</button>
            </Tooltip>
        );
        hover(getByRole('button'));
        focus(getByRole('button'));
        expect(queryByRole('tooltip')).toBeNull();
    });

    it('becoming disabled while open hides it and it stays closed after re-enabling', () => {
        const ui = (disabled: boolean) => (
            <Tooltip content="Tip" delay={0} disabled={disabled}>
                <button type="button">S</button>
            </Tooltip>
        );
        const { rerender } = render(ui(false));
        hover(getByRole('button'));
        expect(queryByRole('tooltip')).not.toBeNull();
        rerender(ui(true));
        expect(queryByRole('tooltip')).toBeNull();
        rerender(ui(false));
        expect(queryByRole('tooltip')).toBeNull();
    });

    it('focus caused by a mouse press does not open it; later keyboard focus does', () => {
        render(
            <Tooltip content="Tip">
                <button type="button">S</button>
            </Tooltip>
        );
        const btn = getByRole('button');
        fire(btn, new MouseEvent('pointerdown', { bubbles: true }));
        focus(btn);
        expect(queryByRole('tooltip')).toBeNull();
        advance(0);
        // Hovering a mouse-focused trigger again still hides on leave.
        hover(btn);
        advance(500);
        expect(queryByRole('tooltip')).not.toBeNull();
        unhover(btn);
        expect(queryByRole('tooltip')).toBeNull();
        blur(btn);
        focus(btn);
        expect(queryByRole('tooltip')).not.toBeNull();
    });

    it('keeps an existing aria-describedby and appends its own id', () => {
        render(
            <Tooltip content="Tip" delay={0}>
                <button type="button" aria-describedby="hint">
                    S
                </button>
            </Tooltip>
        );
        const btn = getByRole('button');
        expect(btn.getAttribute('aria-describedby')).toBe('hint');
        hover(btn);
        expect(btn.getAttribute('aria-describedby')).toBe(`hint ${getByRole('tooltip').id}`);
    });

    it('describe={false} shows the tooltip without aria-describedby', () => {
        render(
            <Tooltip content="Tip" delay={0} describe={false}>
                <button type="button">S</button>
            </Tooltip>
        );
        hover(getByRole('button'));
        expect(queryByRole('tooltip')).not.toBeNull();
        expect(getByRole('button').hasAttribute('aria-describedby')).toBe(false);
    });

    it('unmounting while a hover timer is pending does not throw or leak', () => {
        const { unmount } = render(
            <Tooltip content="Tip">
                <button type="button">S</button>
            </Tooltip>
        );
        hover(getByRole('button'));
        unmount();
        expect(() => advance(1000)).not.toThrow();
        expect(queryByRole('tooltip')).toBeNull();
    });

    it('IconButton label tooltip is visual only; a custom string tooltip is linked', () => {
        render(<IconButton icon="close" label="Close" />);
        const btn = getByRole('button');
        focus(btn);
        expect(getByRole('tooltip').textContent).toBe('Close');
        expect(btn.hasAttribute('aria-describedby')).toBe(false);
        cleanup();

        render(<IconButton icon="sync" label="Sync" tooltip="Last synced 5 min ago" />);
        const sync = getByRole('button');
        focus(sync);
        expect(sync.getAttribute('aria-describedby')).toBe(getByRole('tooltip').id);
    });
});
