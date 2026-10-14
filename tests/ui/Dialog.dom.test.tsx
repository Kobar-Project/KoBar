import { act, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Dialog, Popover, type DialogProps } from '../../src/ui';
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
const byText = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === text)!;
const backdrop = () => getByRole('dialog').parentElement!;

function Harness(props: Partial<DialogProps>) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button id="opener" type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <Dialog
                title="Rename note"
                description="Pick a short name."
                closeLabel="Close"
                {...props}
                open={open}
                onClose={(reason) => {
                    props.onClose?.(reason);
                    setOpen(false);
                }}
                footer={
                    <>
                        <button type="button">Cancel</button>
                        <button type="button">Save</button>
                    </>
                }
            >
                <input aria-label="Name" />
            </Dialog>
        </>
    );
}

function openHarness(props: Partial<DialogProps> = {}) {
    render(<Harness {...props} />);
    const opener = document.querySelector<HTMLButtonElement>('#opener')!;
    focus(opener);
    click(opener);
    return opener;
}

describe('Dialog', () => {
    it('is a labelled modal dialog in a portal on the dialog layer', () => {
        openHarness();
        const dialog = getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Rename note');
        expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe('Pick a short name.');
        expect(dialog.className).toContain('kb-pop');
        const scrim = backdrop();
        expect(scrim.parentElement).toBe(document.body);
        expect(scrim.className).toContain('z-[var(--kb-z-dialog)]');
        expect(scrim.className).toContain('bg-[var(--kb-scrim)]');
        expect(scrim.className).toContain('pointer-events-auto');
        expect(scrim.className).toContain('no-drag-region');
    });

    it('focuses the first field (not the close button) and restores focus to the opener on close', () => {
        const opener = openHarness();
        expect(active().getAttribute('aria-label')).toBe('Name');
        keyDown(active(), 'Escape');
        expect(queryByRole('dialog')).toBeNull();
        expect(active()).toBe(opener);
        expect(openLayerCount()).toBe(0);
    });

    it('traps Tab and Shift+Tab inside the dialog', () => {
        openHarness();
        const order = ['Close', 'Name', 'Cancel', 'Save'];
        const label = () => active().getAttribute('aria-label') ?? active().textContent;
        expect(label()).toBe('Name');
        focus(byText('Save'));
        tab();
        expect(label()).toBe(order[0]);
        tab(true);
        expect(label()).toBe('Save');
    });

    it('pulls focus back when it escapes to the page behind', () => {
        openHarness();
        focus(document.querySelector<HTMLButtonElement>('#opener')!);
        expect(getByRole('dialog').contains(active())).toBe(true);
    });

    it('Escape, backdrop click and the close button request a close with a reason', () => {
        const onClose = vi.fn();
        openHarness({ onClose });
        keyDown(active(), 'Escape');
        expect(onClose).toHaveBeenLastCalledWith('escape');

        click(document.querySelector('#opener')!);
        // A press inside the panel that ends on the backdrop is not a backdrop click.
        press(getByRole('dialog'));
        click(backdrop());
        expect(queryByRole('dialog')).not.toBeNull();
        press(backdrop());
        click(backdrop());
        expect(onClose).toHaveBeenLastCalledWith('backdrop');

        click(document.querySelector('#opener')!);
        click(document.querySelector('[aria-label="Close"]')!);
        expect(onClose).toHaveBeenLastCalledWith('close-button');
        expect(onClose).toHaveBeenCalledTimes(3);
    });

    it('closeOnEscape / closeOnBackdrop = false keep it open', () => {
        const onClose = vi.fn();
        openHarness({ onClose, closeOnEscape: false, closeOnBackdrop: false });
        keyDown(active(), 'Escape');
        press(backdrop());
        click(backdrop());
        expect(onClose).not.toHaveBeenCalled();
        expect(queryByRole('dialog')).not.toBeNull();
    });

    it('restores focus to the opener even when a child autoFocuses during commit', () => {
        function AutoFocusHarness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button id="opener" type="button" onClick={() => setOpen(true)}>
                        Open
                    </button>
                    <Dialog open={open} title="Search" onClose={() => setOpen(false)}>
                        <input aria-label="Query" autoFocus />
                    </Dialog>
                </>
            );
        }
        render(<AutoFocusHarness />);
        const opener = document.querySelector<HTMLButtonElement>('#opener')!;
        focus(opener);
        click(opener);
        expect(active().getAttribute('aria-label')).toBe('Query');
        keyDown(active(), 'Escape');
        expect(queryByRole('dialog')).toBeNull();
        expect(active()).toBe(opener);
    });

    it('honours initialFocus', () => {
        function WithInitial() {
            const ref = useRef<HTMLButtonElement>(null);
            return (
                <Dialog open title="T" onClose={() => {}} initialFocus={ref}>
                    <button type="button">First</button>
                    <button ref={ref} type="button">
                        Second
                    </button>
                </Dialog>
            );
        }
        render(<WithInitial />);
        expect(active().textContent).toBe('Second');
    });

    it('Escape closes a popover inside the dialog first, then the dialog', () => {
        const onClose = vi.fn();
        render(
            <Dialog open title="Settings" onClose={onClose}>
                <Popover aria-label="Picker" trigger={<button id="pick">Pick</button>}>
                    <button type="button">Red</button>
                </Popover>
            </Dialog>
        );
        click(document.querySelector('#pick')!);
        expect(document.querySelector('[aria-label="Picker"]')).not.toBeNull();
        expect(active().textContent).toBe('Red');
        keyDown(active(), 'Escape');
        expect(document.querySelector('[aria-label="Picker"]')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(active().id).toBe('pick');
        keyDown(active(), 'Escape');
        expect(onClose).toHaveBeenCalledWith('escape');
    });

    it('unmounting while open cleans up listeners and layers', () => {
        const { unmount } = render(
            <Dialog open title="T" onClose={() => {}}>
                <button type="button">A</button>
            </Dialog>
        );
        expect(openLayerCount()).toBe(1);
        unmount();
        expect(openLayerCount()).toBe(0);
        expect(queryByRole('dialog')).toBeNull();
    });
});

describe('ConfirmDialog', () => {
    function renderConfirm(props: { danger?: boolean; loading?: boolean } = {}) {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                open
                title="Delete workspace?"
                description="This cannot be undone."
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={onConfirm}
                onCancel={onCancel}
                {...props}
            />
        );
        return { onConfirm, onCancel };
    }

    it('is an alertdialog; confirm and cancel call back', () => {
        const { onConfirm, onCancel } = renderConfirm();
        const dialog = getByRole('alertdialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(active().textContent).toBe('Delete');
        click(byText('Delete'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        click(byText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        keyDown(active(), 'Escape');
        expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('danger variant: danger confirm button, initial focus on Cancel', () => {
        renderConfirm({ danger: true });
        expect(active().textContent).toBe('Cancel');
        expect(byText('Delete').className).toContain('bg-[var(--kb-danger)]');
    });

    it('while loading, Cancel/Esc/backdrop do not cancel and confirm is busy', () => {
        const { onConfirm, onCancel } = renderConfirm({ loading: true });
        keyDown(active(), 'Escape');
        const scrim = getByRole('alertdialog').parentElement!;
        press(scrim);
        click(scrim);
        const cancel = byText('Cancel');
        expect(cancel.getAttribute('aria-disabled')).toBe('true');
        click(cancel);
        expect(onCancel).not.toHaveBeenCalled();
        const confirm = getByRole('alertdialog').querySelector<HTMLButtonElement>('[aria-busy="true"]')!;
        click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
