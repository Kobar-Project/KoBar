import { describe, expect, it } from 'vitest';
import registry, { type ExtensionButton, type ExtensionPanel } from '../src/components/extensions/extensionRegistry';
import { useAppStore } from '../src/store/useAppStore';
import {
    EXTENSIONS_USAGE,
    ISOLATION_STORE_FIELDS,
    STORE_ACTION_USAGE,
    STORE_API_USAGE,
    STORE_READ_USAGE,
    STORE_WRITE_USAGE,
} from './helpers/pluginContractV1';

// T-010: runtime half of the v1 plugin contract: the `useAppStore` fields/actions
// and the `KoBarExtensions` members official plugins use. See tests/plugin-contract-v1.test.ts for the
// source-level half.
// If this test breaks, the change breaks official plugins (CLAUDE.md rule 6).

type StoreState = ReturnType<typeof useAppStore.getState>;
type StoreKey = keyof StoreState;

// Compile-time guard: every listed field/action must exist on the store's state type.
const READ_FIELDS = Object.keys(STORE_READ_USAGE) as Array<keyof typeof STORE_READ_USAGE>;
const WRITE_FIELDS = Object.keys(STORE_WRITE_USAGE) as Array<keyof typeof STORE_WRITE_USAGE>;
const ACTIONS = Object.keys(STORE_ACTION_USAGE) as Array<keyof typeof STORE_ACTION_USAGE>;
const typeCheckedKeys: readonly StoreKey[] = [...READ_FIELDS, ...WRITE_FIELDS, ...ACTIONS, ...ISOLATION_STORE_FIELDS];
// Compile-time guard: localStorageIsolation reads workspaces[].isIsolated as a boolean.
const isolatedFlag: StoreState['workspaces'][number]['isIsolated'] = false;
void typeCheckedKeys;
void isolatedFlag;

describe('plugin contract v1: useAppStore', () => {
    it.each(READ_FIELDS)('state still has the field plugins read: %s', (field) => {
        expect(field in useAppStore.getState()).toBe(true);
    });

    it.each(ACTIONS)('state still has the action plugins call: %s', (action) => {
        expect(typeof useAppStore.getState()[action]).toBe('function');
    });

    it.each(ISOLATION_STORE_FIELDS)('state still has %s (read by localStorageIsolation)', (field) => {
        expect(field in useAppStore.getState()).toBe(true);
    });

    it('workspaces is an array (entries carry isIsolated)', () => {
        expect(Array.isArray(useAppStore.getState().workspaces)).toBe(true);
    });

    it.each(Object.keys(STORE_API_USAGE))('window.useAppStore keeps the zustand API: %s', (method) => {
        expect(typeof (useAppStore as unknown as Record<string, unknown>)[method]).toBe('function');
    });

    it('plugins can open their panel by writing activeExtensionPanelId / activeExtensionAnchorRect', () => {
        const anchorRect = { top: 1, left: 2, bottom: 3, right: 4, width: 2, height: 2 };
        // Plugins call setState with exactly these keys (see STORE_WRITE_USAGE).
        const patch: Pick<StoreState, (typeof WRITE_FIELDS)[number]> = {
            activeExtensionPanelId: 'contract-test-panel',
            activeExtensionAnchorRect: anchorRect,
        };
        useAppStore.setState(patch);
        expect(useAppStore.getState().activeExtensionPanelId).toBe('contract-test-panel');
        expect(useAppStore.getState().activeExtensionAnchorRect).toEqual(anchorRect);

        // ...and close every utility popup (including another plugin's panel) before toggling.
        useAppStore.getState().closeAllUtilityPopups();
        expect(useAppStore.getState().activeExtensionPanelId).toBeNull();
    });
});

/**
 * Runtime view of the registry including its TS-`private` fields that Clipboard Manager touches.
 * (The default export is typed `any`, so the shape is spelled out here.)
 */
type RegistryRuntime = {
    buttons: ExtensionButton[];
    panels: Map<string, ExtensionPanel>;
    registerSidebarButton: (button: ExtensionButton) => void;
    registerPanel: (panelId: string, panel: ExtensionPanel) => void;
    getButtons: () => ExtensionButton[];
    getPanel: (panelId: string) => ExtensionPanel | undefined;
    clear: () => void;
};

describe('plugin contract v1: window.KoBarExtensions', () => {
    it('the registry module installs itself on window.KoBarExtensions', () => {
        expect(window.KoBarExtensions).toBe(registry);
    });

    it.each(Object.keys(EXTENSIONS_USAGE).filter((name) => name.startsWith('register')))('%s is a function', (name) => {
        expect(typeof (registry as unknown as Record<string, unknown>)[name]).toBe('function');
    });

    it("Clipboard Manager can drop its legacy button by reassigning the 'buttons' array", () => {
        const runtime: RegistryRuntime = registry;
        runtime.clear();
        const button = (id: string): ExtensionButton => ({ id, icon: 'x', label: id, onClick: () => {} });
        runtime.registerSidebarButton(button('kobar-clipboard-manager-btn'));
        runtime.registerSidebarButton(button('other-btn'));

        expect(Array.isArray(runtime.buttons)).toBe(true);
        // Same statement the plugin runs.
        runtime.buttons = runtime.buttons.filter((b) => b.id !== 'kobar-clipboard-manager-btn');
        expect(runtime.getButtons().map((b) => b.id)).toEqual(['other-btn']);
        runtime.clear();
    });

    it("Clipboard Manager can drop its legacy panel with 'panels.delete'", () => {
        const runtime: RegistryRuntime = registry;
        runtime.clear();
        runtime.registerPanel('kobar-clipboard-manager-panel', { id: 'kobar-clipboard-manager-panel', render: () => null });

        expect(typeof runtime.panels?.delete).toBe('function');
        runtime.panels.delete('kobar-clipboard-manager-panel');
        expect(runtime.getPanel('kobar-clipboard-manager-panel')).toBeUndefined();
        runtime.clear();
    });
});
