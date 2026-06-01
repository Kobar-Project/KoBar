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

export interface ExtensionSettingsPanel {
    id: string;
    render: () => React.ReactNode;
}

export interface ExtensionInlineWidget {
    id: string;
    render: () => React.ReactNode;
}

class ExtensionRegistry {
    private buttons: ExtensionButton[] = [];
    private panels: Map<string, ExtensionPanel> = new Map();
    private settingsPanels: Map<string, ExtensionSettingsPanel> = new Map();
    private inlineWidgets: Map<string, ExtensionInlineWidget> = new Map();
    private manifests: Map<string, any> = new Map();
    private listeners: Set<() => void> = new Set();

    registerManifest(id: string, manifest: any) {
        this.manifests.set(id, manifest);
    }

    getManifest(id: string) {
        return this.manifests.get(id);
    }

    registerSidebarButton(button: ExtensionButton) {
        this.buttons = this.buttons.filter(b => b.id !== button.id);
        this.buttons.push(button);
        this.notify();
    }

    registerPanel(panelId: string, panel: ExtensionPanel) {
        this.panels.set(panelId, panel);
        this.notify();
    }

    registerSettingsPanel(panelId: string, panel: ExtensionSettingsPanel) {
        this.settingsPanels.set(panelId, panel);
        this.notify();
    }

    getButtons() {
        return this.buttons;
    }

    getPanel(panelId: string) {
        return this.panels.get(panelId);
    }

    getSettingsPanel(panelId: string) {
        return this.settingsPanels.get(panelId);
    }

    registerInlineWidget(widgetId: string, widget: ExtensionInlineWidget) {
        this.inlineWidgets.set(widgetId, widget);
        this.notify();
    }

    getInlineWidgets() {
        return Array.from(this.inlineWidgets.values());
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
        this.settingsPanels.clear();
        this.inlineWidgets.clear();
        this.manifests.clear();
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

const registry = (window as any).KoBarExtensions || new ExtensionRegistry();
(window as any).KoBarExtensions = registry;

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
