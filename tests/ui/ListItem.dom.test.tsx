import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListItem, Toggle } from '../../src/ui';
import { cleanup, fire, getByRole, queryByRole, render } from './render';

afterEach(cleanup);

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('ListItem', () => {
    it('static row: no button, title and description rendered', () => {
        const { host } = render(<ListItem title="Language" description="English" />);
        expect(queryByRole('button')).toBeNull();
        expect(host.textContent).toBe('LanguageEnglish');
        const root = host.firstElementChild as HTMLElement;
        expect(root.tagName).toBe('DIV');
        expect(root.className).toContain('min-h-[var(--kb-row-h)]');
        expect(root.className).toContain('no-drag-region');
        expect(root.className).toContain('pointer-events-auto');
    });

    it('interactive row: native button with focus ring that calls onClick', () => {
        const onClick = vi.fn();
        render(<ListItem title="General" onClick={onClick} />);
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.type).toBe('button');
        expect(btn.tabIndex).toBe(0);
        expect(btn.textContent).toBe('General');
        expect(btn.className).toContain('focus-visible:shadow-[var(--kb-focus-ring)]');
        click(btn);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('selected: aria-current on the button, accent-subtle fill and accent bar, filled icon', () => {
        const { host } = render(<ListItem title="General" leading="settings" selected current="page" onClick={() => {}} />);
        const btn = getByRole('button');
        expect(btn.getAttribute('aria-current')).toBe('page');
        const root = host.firstElementChild as HTMLElement;
        expect(root.className).toContain('bg-[var(--kb-accent-subtle)]');
        expect(root.className).toContain('before:bg-[var(--kb-accent)]');
        expect(root.hasAttribute('aria-current')).toBe(false);
        const icon = btn.querySelector('.material-symbols-outlined')!;
        expect(icon.textContent).toBe('settings');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(icon.hasAttribute('data-filled')).toBe(true);
    });

    it('not selected: no aria-current; static selected row puts aria-current="true" on the root', () => {
        const { rerender, host } = render(<ListItem title="General" onClick={() => {}} />);
        expect(getByRole('button').hasAttribute('aria-current')).toBe(false);
        rerender(<ListItem title="General" selected />);
        expect((host.firstElementChild as HTMLElement).getAttribute('aria-current')).toBe('true');
    });

    it('trailing slot sits outside the row button so controls are not nested', () => {
        const onClick = vi.fn();
        const onChange = vi.fn();
        render(
            <ListItem
                title="Autostart"
                onClick={onClick}
                trailing={<Toggle checked={false} onChange={onChange} label="Autostart" hideLabel />}
            />
        );
        const btn = getByRole('button');
        const sw = getByRole('switch');
        expect(btn.contains(sw)).toBe(false);
        click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('custom leading node and "li" root', () => {
        const { host } = render(
            <ul>
                <ListItem as="li" title="Plugin" leading={<img alt="" src="data:," />} />
            </ul>
        );
        expect(host.querySelector('ul > li')).not.toBeNull();
        expect(host.querySelector('li img')).not.toBeNull();
    });

    it('disabled: native disabled button, no clicks, aria-disabled on static rows', () => {
        const onClick = vi.fn();
        const { rerender, host } = render(<ListItem title="x" onClick={onClick} disabled />);
        const btn = getByRole<HTMLButtonElement>('button');
        expect(btn.disabled).toBe(true);
        click(btn);
        expect(onClick).not.toHaveBeenCalled();
        rerender(<ListItem title="x" disabled />);
        expect((host.firstElementChild as HTMLElement).getAttribute('aria-disabled')).toBe('true');
    });

    it('uses token utilities only', () => {
        const { host } = render(<ListItem title="x" description="y" leading="home" trailing="z" selected onClick={() => {}} />);
        expect(host.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    });

    it.each([false, '', null])('empty description %j renders no description span', (description) => {
        const { host } = render(<ListItem title="x" description={description} />);
        expect(host.textContent).toBe('x');
        expect(host.querySelectorAll('span.leading-4')).toHaveLength(0);
    });

    it('description 0 is rendered inside the description span', () => {
        const { host } = render(<ListItem title="x" description={0} />);
        expect(host.querySelector('span.leading-4')?.textContent).toBe('0');
    });
});
