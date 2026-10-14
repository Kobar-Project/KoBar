import { act, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, IconButton, PanelShell, Popover, type PanelShellProps } from '../../src/ui';
import { openLayerCount } from '../../src/ui/layers';
import { cleanup, fire, getByRole, keyDown, queryByRole, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const press = (el: Element) => fire(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
const focus = (el: HTMLElement) => act(() => el.focus());
const tab = (shiftKey = false) =>
    act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
    });
const active = () => document.activeElement as HTMLElement;
const label = () => active().getAttribute('aria-label') ?? active().textContent;
const panel = () => getByRole('dialog');

function Harness(props: Partial<PanelShellProps>) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button id="opener" type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            {open && (
                <PanelShell
                    title="To-do"
                    icon="checklist"
                    closeLabel="Close panel"
                    actions={<IconButton icon="add" label="Add task" tooltip={false} />}
                    {...props}
                    onClose={(reason) => {
                        props.onClose?.(reason);
                        setOpen(false);
                    }}
                >
                    {props.children ?? (
                        <>
                            <input aria-label="Task" />
                            <button type="button">Done</button>
                        </>
                    )}
                </PanelShell>
            )}
        </>
    );
}

function openHarness(props: Partial<PanelShellProps> = {}) {
    render(<Harness {...props} />);
    const opener = document.querySelector<HTMLButtonElement>('#opener')!;
    focus(opener);
    click(opener);
    return opener;
}

describe('PanelShell', () => {
    it('is a labelled, non-modal dialog region with header, body and token classes', () => {
        openHarness({ footer: <button type="button">Clear</button> });
        const el = panel();
        expect(el.tagName).toBe('SECTION');
        expect(el.hasAttribute('aria-modal')).toBe(false);
        const heading = document.getElementById(el.getAttribute('aria-labelledby')!)!;
        expect(heading.tagName).toBe('H2');
        expect(heading.textContent).toBe('To-do');
        expect(el.querySelector('.material-symbols-outlined')!.textContent).toBe('checklist');
        expect(el.querySelector('[aria-label="Add task"]')).not.toBeNull();
        expect(el.querySelector('[aria-label="Close panel"]')).not.toBeNull();
        expect(el.textContent).toContain('Clear');
        for (const cls of [
            'kb-slide',
            'z-[var(--kb-z-panel)]',
            'no-drag-region',
            'pointer-events-auto',
            'rounded-lg',
            'shadow-e3',
            'bg-[var(--kb-material-bg)]',
        ]) {
            expect(el.className).toContain(cls);
        }
        // Not portalled: the host positions it.
        expect(el.parentElement!.querySelector('#opener')).not.toBeNull();
        expect(el.querySelector('.overflow-y-auto')!.contains(el.querySelector('[aria-label="Task"]'))).toBe(true);
    });

    it('moves focus to the first body element and restores it to the opener on close', () => {
        const opener = openHarness();
        expect(label()).toBe('Task');
        click(document.querySelector('[aria-label="Close panel"]')!);
        expect(queryByRole('dialog')).toBeNull();
        expect(active()).toBe(opener);
        expect(openLayerCount()).toBe(0);
    });

    it('does not steal focus back when the user already moved it outside', () => {
        render(<Harness />);
        const opener = document.querySelector<HTMLButtonElement>('#opener')!;
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        focus(opener);
        click(opener);
        focus(outside);
        expect(panel()).toBeTruthy();
        keyDown(outside, 'Escape');
        expect(queryByRole('dialog')).toBeNull();
        expect(active()).toBe(outside);
        outside.remove();
    });

    it('falls back to header actions, then the panel itself, never the close button', () => {
        const { rerender } = render(
            <PanelShell title="A" closeLabel="Close" onClose={() => {}} actions={<button type="button">Act</button>} />
        );
        expect(label()).toBe('Act');
        rerender(<></>);
        render(<PanelShell title="B" closeLabel="Close" onClose={() => {}} />);
        expect(active()).toBe(panel());
    });

    it('honours initialFocus', () => {
        function WithInitial() {
            const ref = useRef<HTMLButtonElement>(null);
            return (
                <PanelShell title="T" closeLabel="Close" onClose={() => {}} initialFocus={ref}>
                    <button type="button">First</button>
                    <button ref={ref} type="button">
                        Second
                    </button>
                </PanelShell>
            );
        }
        render(<WithInitial />);
        expect(active().textContent).toBe('Second');
    });

    it('traps Tab and Shift+Tab inside the panel', () => {
        openHarness();
        const order = ['Add task', 'Close panel', 'Task', 'Done'];
        focus(Array.from(panel().querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === 'Done')!);
        expect(label()).toBe('Done');
        tab();
        expect(label()).toBe(order[0]);
        tab(true);
        expect(label()).toBe('Done');
    });

    it('Esc and the close button request a close with a reason; outside presses do nothing', () => {
        const onClose = vi.fn();
        openHarness({ onClose });
        press(document.body);
        click(document.body);
        expect(queryByRole('dialog')).not.toBeNull();
        keyDown(active(), 'Escape');
        expect(onClose).toHaveBeenLastCalledWith('escape');

        click(document.querySelector('#opener')!);
        click(document.querySelector('[aria-label="Close panel"]')!);
        expect(onClose).toHaveBeenLastCalledWith('close-button');
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('closeOnEscape = false keeps it open', () => {
        const onClose = vi.fn();
        openHarness({ onClose, closeOnEscape: false });
        keyDown(active(), 'Escape');
        expect(onClose).not.toHaveBeenCalled();
        expect(queryByRole('dialog')).not.toBeNull();
    });

    it('Escape closes a popover inside the panel first, then the panel', () => {
        const onClose = vi.fn();
        render(
            <PanelShell title="Colors" closeLabel="Close" onClose={onClose}>
                <Popover aria-label="Picker" trigger={<button id="pick">Pick</button>}>
                    <button type="button">Red</button>
                </Popover>
            </PanelShell>
        );
        click(document.querySelector('#pick')!);
        expect(active().textContent).toBe('Red');
        expect(openLayerCount()).toBe(2);
        keyDown(active(), 'Escape');
        expect(document.querySelector('[aria-label="Picker"]')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(active().id).toBe('pick');
        keyDown(active(), 'Escape');
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it('Escape closes a dialog opened from the panel first and focus returns into the panel', () => {
        const onClose = vi.fn();
        function Nested() {
            const [dialog, setDialog] = useState(false);
            return (
                <PanelShell title="Notes" closeLabel="Close" onClose={onClose}>
                    <button id="rename" type="button" onClick={() => setDialog(true)}>
                        Rename
                    </button>
                    <Dialog open={dialog} title="Rename" onClose={() => setDialog(false)}>
                        <input aria-label="Name" />
                    </Dialog>
                </PanelShell>
            );
        }
        render(<Nested />);
        click(document.querySelector('#rename')!);
        expect(label()).toBe('Name');
        keyDown(active(), 'Escape');
        expect(document.querySelector('[aria-modal="true"]')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(active().id).toBe('rename');
        keyDown(active(), 'Escape');
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it.each([
        ['s', 'w-80', 'max-h-110'],
        ['m', 'w-100', 'max-h-140'],
        ['l', 'w-120', 'max-h-160'],
    ] as const)('size %s maps to %s / %s', (size, width, height) => {
        render(<PanelShell title="T" closeLabel="Close" onClose={() => {}} size={size} />);
        expect(panel().dataset.size).toBe(size);
        expect(panel().className).toContain(width);
        expect(panel().className).toContain(height);
    });

    it('defaults to size m docked right', () => {
        render(<PanelShell title="T" closeLabel="Close" onClose={() => {}} />);
        expect(panel().dataset.size).toBe('m');
        expect(panel().dataset.position).toBe('right');
        expect(panel().className).toContain('[--kb-slide-x:8px]');
    });

    it.each([
        ['right', '[--kb-slide-x:8px]', '[--kb-slide-y:0px]'],
        ['left', '[--kb-slide-x:-8px]', '[--kb-slide-y:0px]'],
        ['top', '[--kb-slide-x:0px]', '[--kb-slide-y:-8px]'],
        ['bottom', '[--kb-slide-x:0px]', '[--kb-slide-y:8px]'],
    ] as const)('position %s slides in from that side', (position, x, y) => {
        render(<PanelShell title="T" closeLabel="Close" onClose={() => {}} position={position} />);
        const cls = panel().className.split(' ');
        expect(panel().dataset.position).toBe(position);
        expect(cls).toContain(x);
        expect(cls).toContain(y);
    });

    it('padded = false drops the body padding; className and style pass through for host positioning', () => {
        render(
            <PanelShell title="T" closeLabel="Close" onClose={() => {}} padded={false} className="fixed" style={{ left: 10 }}>
                <p>Body</p>
            </PanelShell>
        );
        expect(panel().querySelector('.overflow-y-auto')!.className).not.toContain('px-4');
        const cls = panel().className.split(' ');
        // The shell sets no position class of its own, so the host's choice is the only one.
        expect(cls.filter((c) => ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(c))).toEqual(['fixed']);
        expect(panel().style.left).toBe('10px');
    });

    it('sets no position class without a host className', () => {
        render(<PanelShell title="T" closeLabel="Close" onClose={() => {}} />);
        const cls = panel().className.split(' ');
        expect(cls.some((c) => ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(c))).toBe(false);
    });

    it('unmounting cleans up the layer', () => {
        const { unmount } = render(<PanelShell title="T" closeLabel="Close" onClose={() => {}} />);
        expect(openLayerCount()).toBe(1);
        unmount();
        expect(openLayerCount()).toBe(0);
    });
});
