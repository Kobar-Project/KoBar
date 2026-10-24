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

type RegistrationKind = 'button' | 'panel' | 'settingsPanel' | 'inlineWidget';

/**
 * T-409: the plugin whose script is running right now (the host injects every plugin as a <script data-extension-id>).
 * null outside a plugin's synchronous script run (e.g. a registration made later from a timer or a promise).
 */
function currentExtensionId(): string | null {
    if (typeof document === 'undefined') return null;
    const script = document.currentScript;
    const id = script instanceof HTMLScriptElement ? script.dataset.extensionId : undefined;
    return typeof id === 'string' && id !== '' ? id : null;
}

class ExtensionRegistry {
    private buttons: ExtensionButton[] = [];
    private panels: Map<string, ExtensionPanel> = new Map();
    private settingsPanels: Map<string, ExtensionSettingsPanel> = new Map();
    private inlineWidgets: Map<string, ExtensionInlineWidget> = new Map();
    private manifests: Map<string, any> = new Map();
    private listeners: Set<() => void> = new Set();
    private isSuspended = false;
    /** T-409: owner (extension id, or null = unknown) of every registered entry, per kind and entry id. */
    private owners: Record<RegistrationKind, Map<string, string | null>> = {
        button: new Map(),
        panel: new Map(),
        settingsPanel: new Map(),
        inlineWidget: new Map(),
    };

    private trackOwner(kind: RegistrationKind, id: string) {
        this.owners[kind].set(id, currentExtensionId());
    }

    registerManifest(id: string, manifest: any) {
        this.manifests.set(id, manifest);
    }

    getManifest(id: string) {
        return this.manifests.get(id);
    }

    registerSidebarButton(button: ExtensionButton) {
        this.buttons = this.buttons.filter(b => b.id !== button.id);
        this.buttons.push(button);
        this.trackOwner('button', button.id);
        this.notify();
    }

    registerPanel(panelId: string, panel: ExtensionPanel) {
        this.panels.set(panelId, panel);
        this.trackOwner('panel', panelId);
        this.notify();
    }

    registerSettingsPanel(panelId: string, panel: ExtensionSettingsPanel) {
        this.settingsPanels.set(panelId, panel);
        this.trackOwner('settingsPanel', panelId);
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
        this.trackOwner('inlineWidget', widgetId);
        this.notify();
    }

    /**
     * T-409: removes everything `extensionId` registered (sidebar buttons, panels, settings panels, inline widgets and
     * its manifest), so a disabled plugin can be unloaded without re-running the other plugins. Changes nothing and
     * returns false when some entry has no known owner (it was registered outside a plugin's synchronous script run and
     * may belong to this plugin): the host then reloads every plugin, as before.
     */
    unregisterExtension(extensionId: string): boolean {
        const kinds = Object.keys(this.owners) as RegistrationKind[];
        if (kinds.some((kind) => Array.from(this.owners[kind].values()).includes(null))) return false;
        const owned = (kind: RegistrationKind, id: string) => this.owners[kind].get(id) === extensionId;
        this.buttons = this.buttons.filter((b) => !owned('button', b.id));
        for (const [map, kind] of [
            [this.panels, 'panel'],
            [this.settingsPanels, 'settingsPanel'],
            [this.inlineWidgets, 'inlineWidget'],
        ] as const) {
            for (const id of Array.from(map.keys())) {
                if (owned(kind, id)) map.delete(id);
            }
        }
        for (const kind of kinds) {
            for (const [id, owner] of Array.from(this.owners[kind])) {
                if (owner === extensionId) this.owners[kind].delete(id);
            }
        }
        this.manifests.delete(extensionId);
        this.notify();
        return true;
    }

    getInlineWidgets() {
        return Array.from(this.inlineWidgets.values());
    }

    /**
     * Host addition (not used by plugins): the sidebar button the bar marks active while panel `panelId` is open. The
     * button with the panel's own id when there is one (the v1 rule), otherwise the only button registered by the plugin
     * that registered the panel. null when the panel's owner is unknown or that plugin has no button or several.
     */
    buttonIdForPanel(panelId: string | null): string | null {
        if (!panelId) return null;
        if (this.buttons.some((b) => b.id === panelId)) return panelId;
        const owner = this.owners.panel.get(panelId);
        if (!owner) return null;
        const own = this.buttons.filter((b) => this.owners.button.get(b.id) === owner);
        return own.length === 1 ? own[0].id : null;
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    notify() {
        if (!this.isSuspended) {
            this.listeners.forEach(l => l());
        }
    }

    suspendNotifications() {
        this.isSuspended = true;
    }

    resumeNotifications() {
        this.isSuspended = false;
        this.notify();
    }

    getData<T = any>(pluginId: string, defaultValue?: T): T {
        if (typeof window !== 'undefined' && window.useAppStore) {
            return window.useAppStore.getState().getPluginData(pluginId, defaultValue);
        }
        return defaultValue as T;
    }

    setData(pluginId: string, data: any) {
        if (typeof window !== 'undefined' && window.useAppStore) {
            window.useAppStore.getState().setPluginData(pluginId, data);
            this.notify();
        }
    }

    clear() {
        this.buttons = [];
        this.panels.clear();
        this.settingsPanels.clear();
        this.inlineWidgets.clear();
        this.manifests.clear();
        for (const owners of Object.values(this.owners)) owners.clear();
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

/**
 * Custom React hook for plugin authors to seamlessly access and mutate workspace-isolated or global data.
 */
export function usePluginData<T = any>(pluginId: string, defaultValue?: T): [T, (data: T | ((prev: T) => T)) => void] {
    const getStore = () => (typeof window !== 'undefined' && window.useAppStore ? window.useAppStore.getState() : null);
    
    // Subscribe to workspace switches and plugin data changes
    const [data, setDataState] = React.useState<T>(() => {
        const store = getStore();
        return store ? store.getPluginData(pluginId, defaultValue) : defaultValue;
    });

    React.useEffect(() => {
        if (typeof window === 'undefined' || !window.useAppStore) return;

        const handleWsChange = () => {
            const currentStore = getStore();
            if (currentStore) {
                setDataState(currentStore.getPluginData(pluginId, defaultValue));
            }
        };
        window.addEventListener('kobar:workspace-changed', handleWsChange);

        const unsubscribe = window.useAppStore.subscribe((state: any, prevState: any) => {
            // If active workspace changed or workspace isolation updated or plugin data updated
            if (
                state.activeWorkspaceId !== prevState?.activeWorkspaceId ||
                state.workspaces !== prevState?.workspaces ||
                state.globalPluginData !== prevState?.globalPluginData
            ) {
                const current = state.getPluginData(pluginId, defaultValue);
                setDataState(current);
            }
        });

        return () => {
            window.removeEventListener('kobar:workspace-changed', handleWsChange);
            unsubscribe();
        };
    }, [pluginId, defaultValue]);

    const setPluginData = React.useCallback((nextValueOrUpdater: T | ((prev: T) => T)) => {
        const store = getStore();
        if (!store) return;

        const current = store.getPluginData(pluginId, defaultValue);
        const resolvedValue = typeof nextValueOrUpdater === 'function'
            ? (nextValueOrUpdater as (prev: T) => T)(current)
            : nextValueOrUpdater;

        store.setPluginData(pluginId, resolvedValue);
        setDataState(resolvedValue);
    }, [pluginId, defaultValue]);

    return [data, setPluginData];
}

export default registry;
