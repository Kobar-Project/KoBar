import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Minimal Testing-Library-style harness for the src/ui primitives (react-dom + act, no extra dependency).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
    host: HTMLDivElement;
    rerender: (ui: ReactNode) => void;
    unmount: () => void;
}

const mounted = new Set<{ root: Root; host: HTMLDivElement }>();

export function render(ui: ReactNode): Rendered {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const entry = { root, host };
    mounted.add(entry);
    act(() => root.render(ui));
    return {
        host,
        rerender: (next) => act(() => root.render(next)),
        unmount: () => {
            act(() => root.unmount());
            host.remove();
            mounted.delete(entry);
        },
    };
}

export function cleanup(): void {
    for (const { root, host } of mounted) {
        act(() => root.unmount());
        host.remove();
    }
    mounted.clear();
}

export function getByRole<T extends HTMLElement = HTMLElement>(role: string, container: ParentNode = document.body): T {
    const implicit: Record<string, string> = { button: 'button' };
    const selector = implicit[role] ? `[role="${role}"], ${implicit[role]}:not([role])` : `[role="${role}"]`;
    const el = container.querySelector<T>(selector);
    if (!el) throw new Error(`No element with role "${role}"`);
    return el;
}

export function queryByRole<T extends HTMLElement = HTMLElement>(role: string, container: ParentNode = document.body): T | null {
    try {
        return getByRole<T>(role, container);
    } catch {
        return null;
    }
}

export function keyDown(target: EventTarget, key: string): void {
    act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
}

export function fire(target: EventTarget, event: Event): void {
    act(() => {
        target.dispatchEvent(event);
    });
}
