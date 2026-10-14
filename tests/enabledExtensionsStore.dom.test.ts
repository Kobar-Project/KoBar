import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appPersistStorage } from '../src/store/persistStorage';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { installWindowApiMock } from './helpers/windowApi';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-409 (PROD-19, WS-09): the enabled-plugin set through the real workspace actions. The Default workspace's list
// (extensions-config.json, mirrored in currentExtensionsConfig) survives a workspace session; the file is derived
// from the active context; plugins reload fully only when their data namespace changes. Synthetic data only.

const store = useAppStore;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function ws(id: string, enabledExtensions?: Record<string, boolean>, isIsolated = false): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated,
        isolatedData: isIsolated ? { notes: [], activeNoteId: 1, nextNoteId: 2, pluginData: {} } : undefined,
        enabledExtensions,
    } as unknown as WorkspaceConfig;
}

let api: ReturnType<typeof installWindowApiMock>;
let full0 = 0;
let any0 = 0;
const fullReloads = () => store.getState().extensionFullReloadTrigger - full0;
const loads = () => store.getState().extensionReloadTrigger - any0;

const DEFAULT_LIST = { clip: true, calc: false, ai: true };

beforeEach(() => {
    api = installWindowApiMock();
    // Main reports a successful write (set-extensions-config resolves false when saving the file failed).
    api.setExtensionsConfig.mockResolvedValue(true);
    store.setState({
        workspaces: [ws('A', { clip: false, calc: true }), ws('B', { ai: false }), ws('I', { calc: true }, true)],
        activeWorkspaceId: null,
        currentExtensionsConfig: { ...DEFAULT_LIST },
        defaultExtensionsConfig: null,
    });
    full0 = store.getState().extensionFullReloadTrigger;
    any0 = store.getState().extensionReloadTrigger;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('T-409: the Default list survives a workspace session', () => {
    it('Default -> A -> B -> Default: the file follows the active context and the Default list comes back', async () => {
        store.getState().loadWorkspace('A');
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        expect(store.getState().currentExtensionsConfig).toEqual({ clip: false, calc: true, ai: true });
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith({ clip: false, calc: true, ai: true });
        await flush();

        store.getState().loadWorkspace('B');
        // A was snapshotted from the mirror; B's record over the mirror.
        expect(store.getState().currentExtensionsConfig).toEqual({ clip: false, calc: true, ai: false });
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        await flush();

        store.getState().setActiveWorkspaceId(null);
        expect(store.getState().currentExtensionsConfig).toEqual(DEFAULT_LIST);
        // The saved copy stays until main confirmed writing the restored list.
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith(DEFAULT_LIST);
        await flush();
        expect(store.getState().defaultExtensionsConfig).toBeNull();

        // Shared contexts only: the plugins were never re-run, only the enabled-set diff was loaded.
        expect(loads()).toBe(3);
        expect(fullReloads()).toBe(0);
        // The workspace records still hold their own sets.
        const byId = (id: string) => store.getState().workspaces.find((w) => w.id === id)!;
        expect(byId('A').enabledExtensions).toEqual({ clip: false, calc: true, ai: true });
        expect(byId('B').enabledExtensions).toEqual({ ai: false });
    });

    it('a toggle inside a workspace changes the workspace set, not the saved Default list', async () => {
        store.getState().loadWorkspace('A');
        store.getState().setExtensionEnabledInWorkspace('ai', false);
        expect(store.getState().workspaces.find((w) => w.id === 'A')!.enabledExtensions).toEqual({ clip: false, calc: true, ai: false });
        store.getState().setActiveWorkspaceId(null);
        expect(store.getState().currentExtensionsConfig).toEqual(DEFAULT_LIST);
        await flush();
    });

    it('deleting the active workspace restores the Default list', async () => {
        store.getState().loadWorkspace('B');
        await flush();
        store.getState().deleteWorkspace('B');
        expect(store.getState().activeWorkspaceId).toBeNull();
        expect(store.getState().currentExtensionsConfig).toEqual(DEFAULT_LIST);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith(DEFAULT_LIST);
        await flush();
        expect(store.getState().defaultExtensionsConfig).toBeNull();
    });

    it('saving the current set as a workspace sends nothing (the set does not change) but saves the Default list', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(4242);
        store.getState().saveCurrentAsWorkspace('S', false);
        expect(store.getState().activeWorkspaceId).toBe('4242');
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        expect(api.setExtensionsConfig).not.toHaveBeenCalled();
        await flush();
        expect(loads()).toBe(1);
        expect(fullReloads()).toBe(0);
    });

    it('a state from before v25 (no saved list) keeps the current set when returning to Default, as 1.2.x did', async () => {
        store.setState({
            activeWorkspaceId: 'B',
            currentExtensionsConfig: { clip: true, calc: false, ai: false },
            defaultExtensionsConfig: null,
        });
        store.getState().setActiveWorkspaceId(null);
        expect(store.getState().currentExtensionsConfig).toEqual({ clip: true, calc: false, ai: false });
        expect(api.setExtensionsConfig).not.toHaveBeenCalled();
        await flush();
    });

    it('re-loading the active workspace changes nothing and re-runs no plugin', async () => {
        store.setState({
            activeWorkspaceId: 'B',
            currentExtensionsConfig: { clip: true, calc: false, ai: false },
            defaultExtensionsConfig: DEFAULT_LIST,
        });
        store.getState().loadWorkspace('B');
        expect(api.setExtensionsConfig).not.toHaveBeenCalled();
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        await flush();
        expect(loads()).toBe(1);
        expect(fullReloads()).toBe(0);
    });
});

describe('T-409: the saved Default list is never lost to a failed or late write', () => {
    it('Default -> workspace flushes the saved list to disk before main overwrites the file', async () => {
        const order: string[] = [];
        vi.spyOn(appPersistStorage, 'flush').mockImplementation(() => {
            order.push('flush');
        });
        api.setExtensionsConfig.mockImplementation(async () => {
            order.push('ipc');
            return true;
        });
        store.getState().loadWorkspace('A');
        expect(order).toEqual(['flush', 'ipc']);
        await flush();
        // Workspace -> workspace saves nothing new: no extra flush.
        store.getState().loadWorkspace('B');
        expect(order).toEqual(['flush', 'ipc', 'ipc']);
        await flush();
    });

    it.each([
        ['resolves false', () => api.setExtensionsConfig.mockResolvedValue(false)],
        ['rejects', () => api.setExtensionsConfig.mockRejectedValue(new Error('ipc down'))],
    ])('a restore whose write %s keeps the saved list; toggles keep it in sync and the next departure keeps it', async (_label, fail) => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        store.getState().loadWorkspace('B');
        await flush();
        fail();
        store.getState().setActiveWorkspaceId(null);
        await flush();
        expect(err).toHaveBeenCalled();
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        // The plugin load still ran (switch + restore): loads B, then Default.
        expect(loads()).toBe(2);

        // main never wrote the list, so the loader mirrors the old file (B's set) ...
        store.setState({ currentExtensionsConfig: { clip: true, calc: false, ai: false } });
        // ... and the user toggles something in the Default meanwhile.
        store.getState().setExtensionEnabledInWorkspace('calc', true);
        expect(store.getState().defaultExtensionsConfig).toEqual({ clip: true, calc: true, ai: true });

        api.setExtensionsConfig.mockResolvedValue(true);
        store.getState().loadWorkspace('A');
        expect(store.getState().defaultExtensionsConfig).toEqual({ clip: true, calc: true, ai: true });
        await flush();
        store.getState().setActiveWorkspaceId(null);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith({ clip: true, calc: true, ai: true });
        await flush();
        expect(store.getState().defaultExtensionsConfig).toBeNull();
    });

    it('a confirmation that arrives after the user left the Default again does not drop the saved list', async () => {
        store.getState().loadWorkspace('B');
        await flush();
        let confirm!: (ok: boolean) => void;
        api.setExtensionsConfig.mockImplementationOnce(() => new Promise<boolean>((resolve) => (confirm = resolve)));
        store.getState().setActiveWorkspaceId(null);
        store.getState().loadWorkspace('A');
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        confirm(true);
        await flush();
        expect(store.getState().activeWorkspaceId).toBe('A');
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
    });
});

describe('T-418: a failed extensions-config write of a switch is retried, guarded by the switch counter', () => {
    const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** Default -> B (written), then back to Default with a first write that fails. */
    async function failedReturnToDefault(): Promise<void> {
        store.getState().loadWorkspace('B');
        await tick();
        api.setExtensionsConfig.mockClear();
        api.setExtensionsConfig.mockResolvedValueOnce(false);
        store.getState().setActiveWorkspaceId(null);
        await tick();
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(1);
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
    }

    it('a retry that succeeds writes the Default list, drops the saved copy and syncs the plugins', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await failedReturnToDefault();
        const before = loads();
        await tick(500);
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(2);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith(DEFAULT_LIST);
        expect(store.getState().defaultExtensionsConfig).toBeNull();
        expect(loads()).toBe(before + 1);
    });

    it('the retry sends the set of the active context at that time (a toggle made meanwhile is kept)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await failedReturnToDefault();
        // The loader mirrored the old file (B's set) ...
        store.setState({ currentExtensionsConfig: { clip: true, calc: false, ai: false } });
        // ... and the user turns calc on in the Default meanwhile.
        store.getState().setExtensionEnabledInWorkspace('calc', true);
        await tick(500);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith({ clip: true, calc: true, ai: true });
    });

    it('a newer switch cancels the pending retry: it never overwrites the newer set', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await failedReturnToDefault();
        store.getState().loadWorkspace('A');
        await tick();
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(2);
        await tick(5000);
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(2);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith({ clip: false, calc: true, ai: true });
        expect(store.getState().activeWorkspaceId).toBe('A');
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
    });

    it('retries at most twice; the saved Default list is kept when every attempt fails', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        store.getState().loadWorkspace('B');
        await tick();
        api.setExtensionsConfig.mockClear();
        api.setExtensionsConfig.mockRejectedValue(new Error('disk busy'));
        store.getState().setActiveWorkspaceId(null);
        await tick(10_000);
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(3);
        expect(store.getState().defaultExtensionsConfig).toEqual(DEFAULT_LIST);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('retries failed'));
    });

    it('does not retry while the persist storage is locked (a backup restore is writing)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await failedReturnToDefault();
        vi.spyOn(appPersistStorage, 'lockReason').mockReturnValue('restore-in-progress');
        await tick(5000);
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(1);
    });

    it('a failed workspace -> workspace write is retried as well', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        store.getState().loadWorkspace('A');
        await tick();
        api.setExtensionsConfig.mockClear();
        api.setExtensionsConfig.mockRejectedValueOnce(new Error('ipc down'));
        store.getState().loadWorkspace('B');
        await tick(500);
        expect(api.setExtensionsConfig).toHaveBeenCalledTimes(2);
        expect(api.setExtensionsConfig).toHaveBeenLastCalledWith({ clip: false, calc: true, ai: false });
    });
});

describe('T-409: full reload only when the data namespace changes', () => {
    it('into and out of an isolated workspace, and toggling isolation of the active one', async () => {
        store.getState().loadWorkspace('I');
        await flush();
        expect(fullReloads()).toBe(1);
        store.getState().loadWorkspace('A');
        await flush();
        expect(fullReloads()).toBe(2);
        store.getState().toggleWorkspaceIsolation('A');
        await flush();
        expect(fullReloads()).toBe(3);
        // The isolation toggle keeps the owner (same record): the set is not touched.
        expect(store.getState().currentExtensionsConfig).toEqual({ clip: false, calc: true, ai: true });
        expect(loads()).toBe(3);
    });

    it('the plugin load still runs when setExtensionsConfig rejects', async () => {
        api.setExtensionsConfig.mockRejectedValue(new Error('ipc down'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        store.getState().loadWorkspace('A');
        expect(loads()).toBe(0);
        await flush();
        expect(loads()).toBe(1);
        expect(err).toHaveBeenCalledWith('setExtensionsConfig failed during workspace switch', expect.any(Error));
    });
});
