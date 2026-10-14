// Logo update: the KoBar head mark must cost nothing while idle (no global listeners, no frame loop, no timers).
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KoBarHead from '../src/components/layout/KoBarHead';
import { cleanup, render } from './ui/render';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('KoBarHead', () => {
    it('is decorative and idle by default: no mousemove listener, no frame loop', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const raf = vi.spyOn(window, 'requestAnimationFrame');
        const { host } = render(<KoBarHead />);
        const svg = host.querySelector('svg')!;
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(add.mock.calls.some(([type]) => type === 'mousemove')).toBe(false);
        expect(raf).not.toHaveBeenCalled();
    });

    it('listens for the cursor only while the setting is on, and stops on unmount', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<KoBarHead follow />);
        expect(add.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);
        unmount();
        expect(remove.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);
    });

    it('listens only while the pointer is over the anchor when the setting is off', () => {
        const add = vi.spyOn(window, 'addEventListener');
        const { host } = render(<KoBarHead />);
        const svg = host.querySelector('svg')!;
        act(() => {
            svg.dispatchEvent(new Event('pointerenter'));
        });
        expect(add.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);
    });

    it('blinks once on attention and then reopens without a running timer', () => {
        vi.useFakeTimers();
        const { host, rerender } = render(<KoBarHead attention={false} />);
        const eye = host.querySelector('mask rect:nth-of-type(2)') as SVGRectElement;
        rerender(<KoBarHead attention />);
        expect(eye.style.transform).toBe('scaleY(0.12)');
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(eye.style.transform).toBe('scaleY(1)');
        expect(vi.getTimerCount()).toBe(0);
    });
});
