import { afterEach, describe, expect, it } from 'vitest';
import { Surface } from '../../src/ui';
import { cleanup, render } from './render';

afterEach(cleanup);

const first = (host: HTMLElement) => host.firstElementChild as HTMLElement;

describe('Surface', () => {
    it('defaults to a div on the surface level without elevation', () => {
        const { host } = render(<Surface>content</Surface>);
        const el = first(host);
        expect(el.tagName).toBe('DIV');
        expect(el.className).toContain('bg-surface');
        expect(el.className).toContain('pointer-events-auto');
        expect(el.className).not.toContain('shadow-');
        expect(el.dataset.level).toBe('surface');
    });

    it.each([
        ['shell', 'bg-shell'],
        ['surface', 'bg-surface'],
        ['inset', 'bg-inset'],
    ] as const)('level %s uses %s', (level, cls) => {
        const { host } = render(<Surface level={level} />);
        expect(first(host).className).toContain(cls);
    });

    it.each(['e1', 'e2', 'e3'] as const)('elevation %s adds the shadow token and the subtle stroke', (elevation) => {
        const { host } = render(<Surface elevation={elevation} />);
        const cls = first(host).className;
        expect(cls).toContain(`shadow-${elevation}`);
        expect(cls).toContain('border-stroke');
    });

    it('material applies to the shell level only', () => {
        const { host, rerender } = render(<Surface level="shell" material />);
        expect(first(host).className).toContain('bg-[var(--kb-material-bg)]');
        rerender(<Surface level="surface" material />);
        expect(first(host).className).not.toContain('--kb-material-bg');
        expect(first(host).className).toContain('bg-surface');
    });

    it('renders the requested element, forwards attributes and refs', () => {
        const ref = { current: null as HTMLElement | null };
        const { host } = render(
            <Surface as="section" aria-label="Panel" ref={ref} radius="lg">
                x
            </Surface>
        );
        const el = first(host);
        expect(el.tagName).toBe('SECTION');
        expect(el.getAttribute('aria-label')).toBe('Panel');
        expect(el.className).toContain('rounded-lg');
        expect(ref.current).toBe(el);
    });
});
