import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    Badge,
    Button,
    Card,
    Chip,
    IconButton,
    IconTile,
    ListItem,
    OptionTile,
    ProgressRing,
    SlotMeter,
    Swatch,
    SwatchGroup,
} from '../../src/ui';
import { cleanup, fire, getByRole, keyDown, queryByRole, render } from './render';

afterEach(cleanup);

const noHex = (html: string) => expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);

describe('IconTile', () => {
    it('is decorative and sized by preset', () => {
        const { host } = render(<IconTile icon="settings" size="xl" />);
        const tile = host.firstElementChild as HTMLElement;
        expect(tile.getAttribute('aria-hidden')).toBe('true');
        expect(tile.textContent).toBe('settings');
        expect(tile.className).toContain('size-16');
        noHex(host.innerHTML);
    });
});

describe('Card', () => {
    it('setting variant renders icon, title, description and control', () => {
        const { host } = render(<Card icon="palette" title="Theme" description="Colours" control={<Button>Go</Button>} />);
        const card = host.querySelector('[data-kb-card]') as HTMLElement;
        expect(card.dataset.variant).toBe('setting');
        expect(card.textContent).toContain('Theme');
        expect(card.textContent).toContain('Colours');
        expect(getByRole('button', host).textContent).toBe('Go');
    });

    it.each(['stat', 'list'] as const)('%s variant renders children', (variant) => {
        const { host } = render(
            <Card variant={variant} title="T">
                <p>body</p>
            </Card>
        );
        expect((host.querySelector('[data-kb-card]') as HTMLElement).dataset.variant).toBe(variant);
        expect(host.textContent).toContain('body');
    });
});

describe('Chip', () => {
    it('is a toggle button reflecting selected', () => {
        const onClick = vi.fn();
        const { rerender } = render(<Chip onClick={onClick}>Work</Chip>);
        const chip = getByRole('button');
        expect(chip.getAttribute('aria-pressed')).toBe('false');
        expect(chip.querySelector('.kb-icon')).toBeNull();
        fire(chip, new MouseEvent('click', { bubbles: true }));
        expect(onClick).toHaveBeenCalledTimes(1);
        rerender(<Chip selected>Work</Chip>);
        expect(getByRole('button').getAttribute('aria-pressed')).toBe('true');
        expect(getByRole('button').querySelector('.kb-icon')!.textContent).toBe('check');
        expect(getByRole('button').className).toContain('bg-container');
    });

    it('disabled chip is disabled', () => {
        render(<Chip disabled>x</Chip>);
        expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('OptionTile', () => {
    it('is a named radio with a check badge when selected', () => {
        const { rerender, host } = render(<OptionTile label="Dark" art={<i />} />);
        const tile = getByRole('radio');
        expect(tile.getAttribute('aria-checked')).toBe('false');
        expect(tile.textContent).toContain('Dark');
        expect(tile.hasAttribute('data-kb-choice')).toBe(true);
        expect(host.querySelector('.kb-icon')).toBeNull();
        rerender(<OptionTile label="Dark" selected />);
        expect(getByRole('radio').getAttribute('aria-checked')).toBe('true');
        expect(getByRole('radio').querySelector('.kb-icon')!.textContent).toBe('check');
    });
});

describe('Swatch and SwatchGroup', () => {
    it('Swatch is a radio named by label, colour via style', () => {
        const { host } = render(<Swatch color="var(--kb-accent)" label="Teal" selected />);
        const radio = getByRole('radio', host);
        expect(radio.getAttribute('aria-label')).toBe('Teal');
        expect(radio.getAttribute('aria-checked')).toBe('true');
        expect(radio.style.backgroundColor).toBe('var(--kb-accent)');
        expect(radio.querySelector('.kb-icon')!.textContent).toBe('check');
    });

    it('SwatchGroup has roving tabindex and arrow-key selection', () => {
        const onChange = vi.fn();
        render(
            <SwatchGroup
                aria-label="Accent"
                value="a"
                onChange={onChange}
                options={[
                    { value: 'a', label: 'A', color: 'red' },
                    { value: 'b', label: 'B', color: 'blue' },
                ]}
            />
        );
        expect(getByRole('radiogroup').getAttribute('aria-label')).toBe('Accent');
        const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]'));
        expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
        radios[0].focus();
        keyDown(radios[0], 'ArrowRight');
        expect(onChange).toHaveBeenCalledWith('b');
        fire(radios[1], new MouseEvent('click', { bubbles: true }));
        expect(onChange).toHaveBeenCalledTimes(2);
    });
});

describe('Badge', () => {
    it('renders a count, caps at 99+, and hides at zero', () => {
        const { host, rerender } = render(<Badge count={4} />);
        expect(host.textContent).toBe('4');
        rerender(<Badge count={150} />);
        expect(host.textContent).toBe('99+');
        rerender(<Badge count={0} />);
        expect(host.textContent).toBe('');
        expect(host.querySelector('[data-badge]')).toBeNull();
    });

    it('dot variant has no text', () => {
        const { host } = render(<Badge dot />);
        expect((host.querySelector('[data-badge]') as HTMLElement).dataset.badge).toBe('dot');
        expect(host.textContent).toBe('');
    });
});

describe('ProgressRing', () => {
    it('is decorative without a label and an img with one', () => {
        const { host, rerender } = render(<ProgressRing value={0.5} />);
        expect(host.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
        expect(queryByRole('img', host)).toBeNull();
        rerender(<ProgressRing value={0.5} label="50 percent" size="panel" />);
        expect(getByRole('img', host).getAttribute('aria-label')).toBe('50 percent');
        expect(host.querySelector('svg')!.getAttribute('width')).toBe('200');
    });

    it('clamps the arc length to the circumference', () => {
        const { host } = render(<ProgressRing value={3} />);
        const dash = host.querySelector('[data-ring-arc]')!.getAttribute('stroke-dasharray')!.split(' ');
        expect(dash[0]).toBe(dash[1]);
        noHex(host.innerHTML);
    });
});

describe('SlotMeter', () => {
    it('marks filled, next and empty segments', () => {
        const { host } = render(<SlotMeter total={5} filled={2} showNext label="2 of 5" />);
        expect(getByRole('img', host).getAttribute('aria-label')).toBe('2 of 5');
        const kinds = Array.from(host.querySelectorAll('[data-slot]')).map((n) => n.getAttribute('data-slot'));
        expect(kinds).toEqual(['filled', 'filled', 'next', 'empty', 'empty']);
    });

    it('clamps total to 12 and is decorative without a label', () => {
        const { host } = render(<SlotMeter total={40} filled={99} />);
        expect(host.querySelectorAll('[data-slot]')).toHaveLength(12);
        expect(queryByRole('img', host)).toBeNull();
    });
});

describe('Restyled primitives: additive API', () => {
    it('Button keeps legacy variant names as aliases', () => {
        const { host, rerender } = render(<Button variant="primary">x</Button>);
        expect(getByRole('button', host).className).toContain('bg-[var(--kb-accent)]');
        rerender(<Button variant="filled">x</Button>);
        expect(getByRole('button', host).className).toContain('bg-[var(--kb-accent)]');
        rerender(<Button variant="secondary">x</Button>);
        expect(getByRole('button', host).className).not.toContain('bg-[var(--kb-accent)]');
    });

    it('IconButton variants keep the accessible name', () => {
        const { host } = render(<IconButton icon="add" label="Add" variant="filled" />);
        expect(getByRole('button', host).getAttribute('aria-label')).toBe('Add');
    });

    it('ListItem nav variant is a pill and marks the current page', () => {
        const { host } = render(<ListItem variant="nav" title="General" leading="settings" selected current="page" onClick={() => {}} />);
        const root = host.firstElementChild as HTMLElement;
        expect(root.className).toContain('rounded-full');
        expect(root.className).toContain('bg-container');
        expect(getByRole('button', host).getAttribute('aria-current')).toBe('page');
    });
});
