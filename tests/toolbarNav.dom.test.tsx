import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextToolbarIndex, useRovingToolbar } from '../src/sidebar/useRovingToolbar';
import { openLayerCount, registerLayer } from '../src/ui/layers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Bar({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
    const ref = useRef<HTMLDivElement>(null);
    const h = useRovingToolbar(ref, orientation);
    return (
        <div ref={ref} role="toolbar" aria-orientation={orientation} onKeyDown={h.onKeyDown} onFocus={h.onFocus}>
            <button data-bar-item="">a</button>
            <button data-bar-item="">b</button>
            <button data-bar-item="">c</button>
        </div>
    );
}

let host: HTMLDivElement;
let root: Root;
function mount(orientation: 'vertical' | 'horizontal') {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Bar orientation={orientation} />));
    return Array.from(host.querySelectorAll('button'));
}
const press = (el: Element, key: string) =>
    act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });

afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
});

describe('toolbar keyboard navigation', () => {
    it('maps keys per orientation', () => {
        expect(nextToolbarIndex('ArrowDown', 'vertical', 0, 3)).toBe(1);
        expect(nextToolbarIndex('ArrowRight', 'vertical', 0, 3)).toBeNull();
        expect(nextToolbarIndex('ArrowLeft', 'horizontal', 0, 3)).toBe(2);
        expect(nextToolbarIndex('End', 'horizontal', 0, 3)).toBe(2);
        expect(nextToolbarIndex('Home', 'vertical', 2, 3)).toBe(0);
    });

    it('keeps one tab stop and moves focus with arrows', () => {
        const [a, b, c] = mount('vertical');
        expect([a, b, c].map((x) => x.tabIndex)).toEqual([0, -1, -1]);
        act(() => a.focus());
        press(a, 'ArrowDown');
        expect(document.activeElement).toBe(b);
        expect([a, b, c].map((x) => x.tabIndex)).toEqual([-1, 0, -1]);
        press(b, 'End');
        expect(document.activeElement).toBe(c);
        press(c, 'ArrowDown');
        expect(document.activeElement).toBe(a);
        press(a, 'ArrowRight');
        expect(document.activeElement).toBe(a);
    });

    it('uses left/right when horizontal', () => {
        const [a, b] = mount('horizontal');
        act(() => a.focus());
        press(a, 'ArrowRight');
        expect(document.activeElement).toBe(b);
    });
});

describe('layer stack Esc', () => {
    it('closes only the topmost layer per Esc', () => {
        const low = vi.fn();
        const top = vi.fn();
        const offLow = registerLayer({ kind: 'panel', contains: () => false, onEscape: low });
        const offTop = registerLayer({ kind: 'popover', contains: () => false, onEscape: top });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(top).toHaveBeenCalledTimes(1);
        expect(low).not.toHaveBeenCalled();
        offTop();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(low).toHaveBeenCalledTimes(1);
        offLow();
        expect(openLayerCount()).toBe(0);
    });
});
