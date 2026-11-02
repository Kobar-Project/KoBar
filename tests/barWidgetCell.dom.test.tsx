// CNL (owner report: odd gaps in the horizontal bar): a v1 inline widget sits in a grid cell and only reports "does not fit"
// once its measurement has settled, so a first, unstyled frame no longer pushes a single-button widget out of the grid.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarWidgetCell } from '../src/sidebar/BarWidgetCell';

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function mount(onFit: (id: string, fits: boolean) => void) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
        root.render(
            <BarWidgetCell id="w" onFit={onFit}>
                <button type="button">x</button>
            </BarWidgetCell>
        )
    );
    return host;
}

describe('BarWidgetCell', () => {
    it('renders a cell-sized host and reports the fit only after the measurement settles', () => {
        vi.useFakeTimers();
        const onFit = vi.fn();
        const host = mount(onFit);
        const cell = host.querySelector<HTMLElement>('[data-bar-widget-cell]')!;
        expect(cell.className).toContain('size-[var(--kb-tile-cell)]');
        expect(cell.querySelector('button')).not.toBeNull();
        expect(onFit).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(300));
        expect(onFit).toHaveBeenCalledWith('w', true);
    });

    it('reports an oversized widget', () => {
        vi.useFakeTimers();
        const onFit = vi.fn();
        const host = mount(onFit);
        const cell = host.querySelector<HTMLElement>('[data-bar-widget-cell]')!;
        Object.defineProperty(cell, 'scrollHeight', { configurable: true, value: 120 });
        Object.defineProperty(cell, 'clientHeight', { configurable: true, value: 30 });
        act(() => vi.advanceTimersByTime(300));
        expect(onFit).toHaveBeenLastCalledWith('w', false);
    });
});
