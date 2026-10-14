// R-15: PluginPanelHost: drag along the bar's free axis only, threshold, interactive controls, clamp, reset, keyboard.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginPanelHost, type PanelArea } from '../src/components/plugins/PluginPanelHost';
import { isInteractiveTarget } from '../src/components/plugins/panelPosition';
import { useAppStore } from '../src/store/useAppStore';
import { cleanup, render } from './ui/render';

// jsdom has no layout: the panel root reports a fixed default rect shifted by the CSS `translate` the host applies.
const BASE = { left: 100, top: 50, width: 200, height: 100 };
function Panel() {
    return (
        <div
            data-testid="panel"
            ref={(el) => {
                if (!el) return;
                el.getBoundingClientRect = () => {
                    const m = /(-?\d+)px (-?\d+)px/.exec((el.style as unknown as { translate?: string }).translate ?? '');
                    const dx = m ? Number(m[1]) : 0;
                    const dy = m ? Number(m[2]) : 0;
                    const left = BASE.left + dx;
                    const top = BASE.top + dy;
                    return {
                        left,
                        top,
                        right: left + BASE.width,
                        bottom: top + BASE.height,
                        width: BASE.width,
                        height: BASE.height,
                        x: left,
                        y: top,
                        toJSON: () => ({}),
                    };
                };
            }}
        >
            <h2 data-testid="title">Title</h2>
            <button data-testid="btn">Close</button>
            <p data-testid="body">Body</p>
        </div>
    );
}

const AREA: PanelArea = { left: 0, top: 0, right: 1000, bottom: 800 };

function fire(el: Element | Window, type: string, init: { x?: number; y?: number; button?: number; key?: string; altKey?: boolean } = {}) {
    const event = type.startsWith('key')
        ? new KeyboardEvent(type, { bubbles: true, key: init.key, altKey: init.altKey })
        : new MouseEvent(type, { bubbles: true, clientX: init.x ?? 0, clientY: init.y ?? 0, button: init.button ?? 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => {
        el.dispatchEvent(event);
    });
}

function setup(orientation: 'horizontal' | 'vertical', area: PanelArea = AREA) {
    const r = render(
        <PluginPanelHost pluginId="demo" orientation={orientation} area={area}>
            <Panel />
        </PluginPanelHost>
    );
    const panel = r.host.querySelector('[data-testid="panel"]') as HTMLElement;
    const handle = () => r.host.querySelector('[data-plugin-panel-handle]') as HTMLElement;
    const translate = () => (panel.style as unknown as { translate?: string }).translate ?? '';
    return { r, handle, translate, q: (id: string) => r.host.querySelector(`[data-testid="${id}"]`) as HTMLElement };
}

const offsets = () => useAppStore.getState().pluginPanelOffsets;

beforeEach(() => useAppStore.setState({ pluginPanelOffsets: {} }));
afterEach(() => {
    cleanup();
    document.body.style.userSelect = '';
});

describe('PluginPanelHost', () => {
    it('renders an accessible keyboard-focusable grip', () => {
        const { handle } = setup('horizontal');
        expect(handle().getAttribute('aria-label')).toBeTruthy();
        expect(handle().tabIndex).toBe(0);
    });

    it('horizontal bar: dragging the top strip moves the panel along x only and saves per plugin id', () => {
        const { q, translate } = setup('horizontal');
        fire(q('title'), 'pointerdown', { x: 150, y: 60 });
        fire(window, 'pointermove', { x: 190, y: 300 });
        expect(translate()).toBe('40px 0px');
        fire(window, 'pointerup', { x: 190, y: 300 });
        expect(offsets()).toStrictEqual({ demo: { x: 40 } });
    });

    it('vertical bar: moves along y only and stores the y axis', () => {
        const { q, translate } = setup('vertical');
        fire(q('title'), 'pointerdown', { x: 150, y: 60 });
        fire(window, 'pointermove', { x: 400, y: 90 });
        expect(translate()).toBe('0px 30px');
        fire(window, 'pointerup', { x: 400, y: 90 });
        expect(offsets()).toStrictEqual({ demo: { y: 30 } });
    });

    it('does not drag below the 4px threshold (a click stays a click)', () => {
        const { q, translate } = setup('horizontal');
        fire(q('title'), 'pointerdown', { x: 150, y: 60 });
        fire(window, 'pointermove', { x: 152, y: 61 });
        fire(window, 'pointerup', { x: 152, y: 61 });
        expect(translate()).toBe('');
        expect(offsets()).toStrictEqual({});
    });

    it('does not hijack buttons, or presses below the top strip', () => {
        const { q, translate } = setup('horizontal');
        fire(q('btn'), 'pointerdown', { x: 150, y: 60 });
        fire(window, 'pointermove', { x: 250, y: 60 });
        fire(window, 'pointerup', { x: 250, y: 60 });
        fire(q('body'), 'pointerdown', { x: 150, y: 140 });
        fire(window, 'pointermove', { x: 250, y: 140 });
        fire(window, 'pointerup', { x: 250, y: 140 });
        expect(translate()).toBe('');
        expect(offsets()).toStrictEqual({});
    });

    it('can be dragged from the host grip too', () => {
        const { handle, translate } = setup('horizontal');
        fire(handle(), 'pointerdown', { x: 200, y: 40 });
        fire(window, 'pointermove', { x: 230, y: 40 });
        fire(window, 'pointerup', { x: 230, y: 40 });
        expect(translate()).toBe('30px 0px');
        expect(offsets().demo?.x).toBe(30);
    });

    it('clamps to the usable area on both sides', () => {
        const { q, translate } = setup('horizontal');
        fire(q('title'), 'pointerdown', { x: 150, y: 60 });
        fire(window, 'pointermove', { x: 5000, y: 60 });
        expect(translate()).toBe('700px 0px');
        fire(window, 'pointermove', { x: -5000, y: 60 });
        expect(translate()).toBe('-100px 0px');
        fire(window, 'pointerup', { x: -5000, y: 60 });
        expect(offsets().demo?.x).toBe(-100);
    });

    it('re-clamps a saved offset when the area shrinks (display change)', () => {
        useAppStore.setState({ pluginPanelOffsets: { demo: { x: 600 } } });
        const { r, translate } = setup('horizontal');
        expect(translate()).toBe('600px 0px');
        r.rerender(
            <PluginPanelHost pluginId="demo" orientation="horizontal" area={{ left: 0, top: 0, right: 500, bottom: 800 }}>
                <Panel />
            </PluginPanelHost>
        );
        expect(translate()).toBe('200px 0px');
        // the saved value itself is not rewritten by clamping
        expect(offsets().demo?.x).toBe(600);
    });

    it('uses the saved offset of the axis the current edge needs (edge change re-applies)', () => {
        useAppStore.setState({ pluginPanelOffsets: { demo: { x: 40, y: 20 } } });
        const { r, translate } = setup('horizontal');
        expect(translate()).toBe('40px 0px');
        r.rerender(
            <PluginPanelHost pluginId="demo" orientation="vertical" area={AREA}>
                <Panel />
            </PluginPanelHost>
        );
        expect(translate()).toBe('0px 20px');
    });

    it('double click on the grip or the top strip resets to the default position', () => {
        useAppStore.setState({ pluginPanelOffsets: { demo: { x: 40 }, other: { x: 5 } } });
        const { handle, q, translate } = setup('horizontal');
        fire(handle(), 'dblclick');
        expect(translate()).toBe('');
        expect(offsets()).toStrictEqual({ other: { x: 5 } });
        act(() => useAppStore.getState().setPluginPanelOffset('demo', 'x', 25));
        expect(translate()).toBe('25px 0px');
        fire(q('title'), 'dblclick', { x: 150, y: 60 });
        expect(translate()).toBe('');
    });

    it('Alt+Arrow on the grip moves along the free axis only', () => {
        const { handle, translate } = setup('horizontal');
        fire(handle(), 'keydown', { key: 'ArrowRight', altKey: true });
        expect(translate()).toBe('16px 0px');
        fire(handle(), 'keydown', { key: 'ArrowDown', altKey: true });
        expect(translate()).toBe('16px 0px');
        fire(handle(), 'keydown', { key: 'ArrowRight' });
        expect(translate()).toBe('16px 0px');
        expect(offsets().demo?.x).toBe(16);
    });
});

describe('isInteractiveTarget', () => {
    it('is true for controls inside the panel and false for plain content', () => {
        const panel = document.createElement('div');
        panel.innerHTML = '<h2>Title</h2><button><span id="i">x</span></button><input />';
        document.body.appendChild(panel);
        expect(isInteractiveTarget(panel.querySelector('#i'), panel)).toBe(true);
        expect(isInteractiveTarget(panel.querySelector('input'), panel)).toBe(true);
        expect(isInteractiveTarget(panel.querySelector('h2'), panel)).toBe(false);
        expect(isInteractiveTarget(null, panel)).toBe(false);
        panel.remove();
    });
});
