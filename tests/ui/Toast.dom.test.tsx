import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOAST_DURATION_MS, MAX_TOASTS, ToastRegion, toast } from '../../src/ui';
import { cleanup, fire, getByRole, render } from './render';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    act(() => toast.clear());
    vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const show = (fn: () => unknown) => act(() => void fn());
const toasts = () => Array.from(document.querySelectorAll<HTMLElement>('[data-tone]'));
const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const hover = (el: HTMLElement) => fire(el, new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
const unhover = (el: HTMLElement) => fire(el, new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));

describe('toast store', () => {
    it('queues, replaces by id, caps the stack and dismisses', () => {
        const a = toast.info('A');
        toast.show({ message: 'B', id: 'fixed' });
        toast.show({ message: 'B2', id: 'fixed', tone: 'success' });
        expect(toast.getAll().map((t) => t.message)).toEqual(['A', 'B2']);
        expect(toast.getAll()[1].tone).toBe('success');
        expect(toast.getAll()[0].duration).toBe(DEFAULT_TOAST_DURATION_MS);
        for (let i = 0; i < 5; i++) toast.show(`n${i}`);
        expect(toast.getAll()).toHaveLength(MAX_TOASTS);
        expect(toast.getAll().some((t) => t.id === a)).toBe(false);
        const listener = vi.fn();
        const off = toast.subscribe(listener);
        toast.dismiss(toast.getAll()[0].id);
        expect(listener).toHaveBeenCalledTimes(1);
        off();
        toast.clear();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(toast.getAll()).toEqual([]);
    });
});

describe('ToastRegion', () => {
    it('keeps polite and assertive live regions mounted on the toast layer', () => {
        const { host } = render(<ToastRegion dismissLabel="Dismiss" />);
        const status = getByRole('status');
        const alert = getByRole('alert');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(alert.getAttribute('aria-live')).toBe('assertive');
        const root = status.parentElement!;
        expect(host.contains(root)).toBe(false);
        expect(root.className).toContain('z-[var(--kb-z-toast)]');
        expect(root.hasAttribute('data-kb-layer-ignore')).toBe(true);

        show(() => toast.success('Saved'));
        show(() => toast.error('Sync failed', { title: 'Error' }));
        expect(status.textContent).toContain('Saved');
        expect(alert.textContent).toContain('Sync failed');
        expect(alert.textContent).toContain('Error');
        expect(toasts()[0].className).toContain('pointer-events-auto');
    });

    it('auto-dismisses after the duration; duration 0 stays', () => {
        render(<ToastRegion dismissLabel="Dismiss" />);
        show(() => toast.info('Short'));
        show(() => toast.info('Sticky', { duration: 0 }));
        advance(DEFAULT_TOAST_DURATION_MS - 1);
        expect(toasts()).toHaveLength(2);
        advance(1);
        expect(toasts().map((t) => t.textContent)).toEqual([expect.stringContaining('Sticky')]);
        advance(60_000);
        expect(toasts()).toHaveLength(1);
    });

    it('hover and focus pause the timer, which resumes with the remaining time', () => {
        render(<ToastRegion dismissLabel="Dismiss" />);
        show(() => toast.info('Paused', { duration: 1000 }));
        advance(600);
        hover(toasts()[0]);
        advance(5000);
        expect(toasts()).toHaveLength(1);
        unhover(toasts()[0]);
        advance(399);
        expect(toasts()).toHaveLength(1);
        advance(1);
        expect(toasts()).toHaveLength(0);

        show(() => toast.info('Focused', { duration: 1000 }));
        const close = toasts()[0].querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!;
        act(() => close.focus());
        advance(5000);
        expect(toasts()).toHaveLength(1);
        act(() => close.blur());
        advance(1000);
        expect(toasts()).toHaveLength(0);
    });

    it('the dismiss button and the action button remove the toast', () => {
        render(<ToastRegion dismissLabel="Dismiss" />);
        const undo = vi.fn();
        show(() => toast.info('Deleted', { action: { label: 'Undo', onClick: undo } }));
        const action = Array.from(toasts()[0].querySelectorAll('button')).find((b) => b.textContent === 'Undo')!;
        click(action);
        expect(undo).toHaveBeenCalledTimes(1);
        expect(toasts()).toHaveLength(0);

        show(() => toast.warning('Low space'));
        click(toasts()[0].querySelector('[aria-label="Dismiss"]')!);
        expect(toasts()).toHaveLength(0);
    });

    it('unmounting clears pending timers', () => {
        const { unmount } = render(<ToastRegion dismissLabel="Dismiss" />);
        const before = vi.getTimerCount();
        show(() => toast.info('Pending'));
        expect(vi.getTimerCount()).toBe(before + 1);
        unmount();
        expect(vi.getTimerCount()).toBe(before);
        expect(toast.getAll()).toHaveLength(1);
    });
});
