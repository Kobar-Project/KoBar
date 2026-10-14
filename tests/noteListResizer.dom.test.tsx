// R-11: the note list separator: ARIA values, keyboard, pointer drag with capture, double click reset.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteListResizer } from '../src/notes/NoteListResizer';
import { cleanup, render } from './ui/render';

// jsdom has no PointerEvent: plain events with the pointer fields React reads are enough.
function fire(el: Element, type: string, init: { pointerId?: number; clientX?: number; button?: number; key?: string } = {}) {
    const event = type.startsWith('key')
        ? new KeyboardEvent(type, { bubbles: true, key: init.key })
        : new MouseEvent(type, { bubbles: true, clientX: init.clientX, button: init.button ?? 0 });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
    act(() => {
        el.dispatchEvent(event);
    });
}
const fireEvent = {
    keyDown: (el: Element, init: { key: string }) => fire(el, 'keydown', init),
    pointerDown: (el: Element, init: object) => fire(el, 'pointerdown', init),
    pointerMove: (el: Element, init: object) => fire(el, 'pointermove', init),
    pointerUp: (el: Element, init: object) => fire(el, 'pointerup', init),
    doubleClick: (el: Element) => fire(el, 'dblclick'),
};

function setup(width = 200) {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const r = render(<NoteListResizer width={width} label="Resize" onChange={onChange} onReset={onReset} />);
    const sep = r.host.querySelector('[role="separator"]') as HTMLElement;
    sep.setPointerCapture = vi.fn();
    sep.releasePointerCapture = vi.fn();
    sep.hasPointerCapture = vi.fn(() => true);
    return { sep, onChange, onReset };
}

afterEach(cleanup);

describe('NoteListResizer', () => {
    it('is a focusable vertical separator with aria-value* in px', () => {
        const { sep } = setup(200);
        expect(sep.getAttribute('aria-orientation')).toBe('vertical');
        expect(sep.getAttribute('aria-valuenow')).toBe('200');
        expect(sep.getAttribute('aria-valuemin')).toBe('160');
        expect(sep.getAttribute('aria-valuemax')).toBe('420');
        expect(sep.getAttribute('aria-label')).toBe('Resize');
        expect(sep.tabIndex).toBe(0);
    });

    it('moves by 16 px with the arrow keys', () => {
        const { sep, onChange } = setup(200);
        fireEvent.keyDown(sep, { key: 'ArrowRight' });
        fireEvent.keyDown(sep, { key: 'ArrowLeft' });
        expect(onChange.mock.calls).toEqual([[216], [184]]);
    });

    it('drags with pointer capture, clamps, and stops reporting after release', () => {
        const { sep, onChange } = setup(200);
        fireEvent.pointerDown(sep, { pointerId: 1, button: 0, clientX: 100 });
        expect(sep.setPointerCapture).toHaveBeenCalledWith(1);
        fireEvent.pointerMove(sep, { pointerId: 1, clientX: 150 });
        fireEvent.pointerMove(sep, { pointerId: 1, clientX: 900 });
        fireEvent.pointerMove(sep, { pointerId: 1, clientX: -900 });
        expect(onChange.mock.calls).toEqual([[250], [420], [160]]);
        fireEvent.pointerUp(sep, { pointerId: 1 });
        expect(sep.releasePointerCapture).toHaveBeenCalledWith(1);
        fireEvent.pointerMove(sep, { pointerId: 1, clientX: 300 });
        expect(onChange).toHaveBeenCalledTimes(3);
    });

    it('double click resets', () => {
        const { sep, onReset } = setup(300);
        fireEvent.doubleClick(sep);
        expect(onReset).toHaveBeenCalledTimes(1);
    });
});
