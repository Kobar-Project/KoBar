import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Popover, usePopoverClose } from '../../src/ui';
import { openLayerCount } from '../../src/ui/layers';
import { cleanup, fire, getByRole, keyDown, queryByRole, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));
const press = (el: Element) => fire(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
const focus = (el: HTMLElement) => act(() => el.focus());
const trigger = () => document.querySelector<HTMLButtonElement>('#trigger')!;

function DoneButton() {
    const close = usePopoverClose();
    return (
        <button type="button" onClick={() => close()}>
            Done
        </button>
    );
}

function Basic(props: { onOpenChange?: (open: boolean, reason: string) => void }) {
    return (
        <>
            <Popover
                aria-label="Colour"
                onOpenChange={props.onOpenChange}
                trigger={
                    <button id="trigger" type="button">
                        Open
                    </button>
                }
            >
                <input aria-label="Hex" />
                <DoneButton />
            </Popover>
            <button id="other" type="button">
                Other
            </button>
        </>
    );
}

describe('Popover', () => {
    it('opens from the trigger into a portal on the popover layer with dialog semantics', () => {
        const onOpenChange = vi.fn();
        const { host } = render(<Basic onOpenChange={onOpenChange} />);
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
        expect(queryByRole('dialog')).toBeNull();

        click(trigger());
        const pop = getByRole('dialog');
        expect(onOpenChange).toHaveBeenCalledWith(true, 'trigger');
        expect(host.contains(pop)).toBe(false);
        expect(pop.parentElement).toBe(document.body);
        expect(pop.getAttribute('aria-label')).toBe('Colour');
        expect(pop.className).toContain('z-[var(--kb-z-popover)]');
        expect(pop.className).toContain('pointer-events-auto');
        expect(pop.className).toContain('no-drag-region');
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(trigger().getAttribute('aria-controls')).toBe(pop.id);
        // Initial focus: first focusable element inside.
        expect(document.activeElement).toBe(pop.querySelector('input'));
    });

    it('Escape closes it and returns focus to the trigger', () => {
        render(<Basic />);
        click(trigger());
        expect(openLayerCount()).toBe(1);
        keyDown(document.activeElement!, 'Escape');
        expect(queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(openLayerCount()).toBe(0);
    });

    it('an outside press closes it without pulling focus back; a press on the trigger does not count as outside', () => {
        const onOpenChange = vi.fn();
        render(<Basic onOpenChange={onOpenChange} />);
        click(trigger());
        press(trigger());
        expect(queryByRole('dialog')).not.toBeNull();
        click(trigger());
        expect(queryByRole('dialog')).toBeNull();
        expect(onOpenChange).toHaveBeenLastCalledWith(false, 'trigger');

        click(trigger());
        const other = document.querySelector<HTMLButtonElement>('#other')!;
        press(other);
        expect(queryByRole('dialog')).toBeNull();
        expect(onOpenChange).toHaveBeenLastCalledWith(false, 'outside');
        expect(document.activeElement).not.toBe(trigger());
    });

    it('usePopoverClose closes from inside and returns focus', () => {
        render(<Basic />);
        click(trigger());
        const done = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Done')!;
        focus(done);
        click(done);
        expect(queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('focus moving to another element of the page closes it', () => {
        const onOpenChange = vi.fn();
        render(<Basic onOpenChange={onOpenChange} />);
        click(trigger());
        focus(document.querySelector<HTMLButtonElement>('#other')!);
        expect(queryByRole('dialog')).toBeNull();
        expect(onOpenChange).toHaveBeenLastCalledWith(false, 'blur');
        expect(document.activeElement?.id).toBe('other');
    });

    it('is controllable through open/onOpenChange and restores focus on an external close', () => {
        function Controlled() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <Popover open={open} onOpenChange={setOpen} role="none" trigger={<button id="trigger">Open</button>}>
                        <button type="button">Inside</button>
                    </Popover>
                    <button id="ext" type="button" onClick={() => setOpen(false)}>
                        External
                    </button>
                </>
            );
        }
        render(<Controlled />);
        expect(trigger().hasAttribute('aria-haspopup')).toBe(false);
        click(trigger());
        const content = document.body.querySelector<HTMLElement>('[tabindex="-1"]')!;
        expect(content.hasAttribute('role')).toBe(false);
        expect(document.activeElement?.textContent).toBe('Inside');
        // Closing from outside while focus is inside the content returns focus to the trigger.
        click(document.querySelector('#ext')!);
        expect(document.body.contains(content)).toBe(false);
        expect(document.activeElement).toBe(trigger());
    });

    it('closes when a dialog opens above it and focus ends on its trigger after the dialog', () => {
        function WithDialog() {
            const [dialog, setDialog] = useState(false);
            return (
                <>
                    <Popover aria-label="Menu-like" trigger={<button id="trigger">Open</button>}>
                        <button type="button" onClick={() => setDialog(true)}>
                            Open dialog
                        </button>
                    </Popover>
                    <Dialog open={dialog} onClose={() => setDialog(false)} title="Confirm">
                        <button type="button">OK</button>
                    </Dialog>
                </>
            );
        }
        render(<WithDialog />);
        click(trigger());
        click(document.activeElement!);
        expect(document.querySelector('[aria-label="Menu-like"]')).toBeNull();
        expect(getByRole('dialog').getAttribute('aria-modal')).toBe('true');
        expect(openLayerCount()).toBe(1);
        // Closing the dialog restores focus to the popover's trigger (the removed button inside it is gone).
        keyDown(document.activeElement!, 'Escape');
        expect(queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('unmounting while open removes every listener and layer', () => {
        const { unmount } = render(<Basic />);
        click(trigger());
        expect(openLayerCount()).toBe(1);
        unmount();
        expect(openLayerCount()).toBe(0);
        expect(queryByRole('dialog')).toBeNull();
        expect(() => keyDown(document, 'Escape')).not.toThrow();
    });
});
