import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from '../../src/ui';
import { cleanup, render } from './render';

afterEach(cleanup);

const span = (host: HTMLElement) => host.querySelector<HTMLSpanElement>('span')!;

describe('Icon', () => {
    it('is decorative by default: aria-hidden, no role, ligature text not translated', () => {
        const { host } = render(<Icon name="settings" />);
        const el = span(host);
        expect(el.textContent).toBe('settings');
        expect(el.classList.contains('material-symbols-outlined')).toBe(true);
        expect(el.getAttribute('aria-hidden')).toBe('true');
        expect(el.hasAttribute('role')).toBe(false);
        expect(el.getAttribute('translate')).toBe('no');
    });

    it('with a label becomes role="img" with an accessible name', () => {
        const { host } = render(<Icon name="warning" label="Warning" />);
        const el = span(host);
        expect(el.getAttribute('role')).toBe('img');
        expect(el.getAttribute('aria-label')).toBe('Warning');
        expect(el.hasAttribute('aria-hidden')).toBe(false);
    });

    it('filled sets FILL 1 through font-variation-settings, default is FILL 0', () => {
        const { host, rerender } = render(<Icon name="star" />);
        expect(span(host).style.fontVariationSettings).toContain("'FILL' 0");
        rerender(<Icon name="star" filled />);
        expect(span(host).style.fontVariationSettings).toContain("'FILL' 1");
        expect(span(host).style.fontVariationSettings).toContain("'wght' 300");
    });

    it('maps the allowed sizes 16/20/24 to token classes', () => {
        const { host, rerender } = render(<Icon name="add" size={16} />);
        expect(span(host).className).toContain('size-4');
        rerender(<Icon name="add" />);
        expect(span(host).className).toContain('size-5');
        rerender(<Icon name="add" size={24} />);
        expect(span(host).className).toContain('size-6');
        expect(span(host).style.fontVariationSettings).toContain("'opsz' 24");
    });
});
