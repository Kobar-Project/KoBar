import React from 'react';

export interface ExtensionButton {
    id: string;
    icon: string;
    label: string;
    onClick: (e: React.MouseEvent<HTMLButtonElement>, anchorRect: { top: number; left: number; bottom: number; right: number; width: number; height: number; } | null) => void;
    isActive?: boolean;
}

export interface ExtensionPanel {
    id: string;
    render: (props: { onClose: () => void; anchorRect: { top: number; left: number; bottom: number; right: number; width: number; height: number; } | null }) => React.ReactNode;
}

class ExtensionRegistry {
    private buttons: ExtensionButton[] = [];
    private panels: Map<string, ExtensionPanel> = new Map();
    private listeners: Set<() => void> = new Set();

    registerSidebarButton(button: ExtensionButton) {
        this.buttons = this.buttons.filter(b => b.id !== button.id);
        this.buttons.push(button);
        this.notify();
    }

    registerPanel(panelId: string, panel: ExtensionPanel) {
        this.panels.set(panelId, panel);
        this.notify();
    }

    getButtons() {
        return this.buttons;
    }

    getPanel(panelId: string) {
        return this.panels.get(panelId);
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    notify() {
        this.listeners.forEach(l => l());
    }

    clear() {
        this.buttons = [];
        this.panels.clear();
        this.notify();
    }
}

declare global {
    interface Window {
        KoBarExtensions: ExtensionRegistry;
        React: typeof React;
        useAppStore: any;
    }
}

const registry = new ExtensionRegistry();
window.KoBarExtensions = registry;

export function useExtensionRegistry() {
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
        return registry.subscribe(() => {
            setTick(t => t + 1);
        });
    }, []);
    return registry;
}

export default registry;
