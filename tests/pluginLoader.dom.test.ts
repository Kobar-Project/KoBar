import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import registry from '../src/components/extensions/extensionRegistry';
import {
    createPluginLoader,
    injectExtensionScript,
    planPluginLoad,
    removeExtensionScripts,
    type LoadableExtension,
    type LoaderRegistry,
} from '../src/components/extensions/pluginLoader';

// T-409 (WS-09): plugins are loaded and unloaded by the enabled-set diff; a full reload stays for install/update/toggle
// and data namespace switches. Synthetic plugins only (no real plugin code runs; "running a script" is simulated).

const render = () => null;

/** Runs `body` as if it were the synchronous run of plugin `id`'s injected <script data-extension-id>. */
function asPlugin(id: string | null, body: () => void): void {
    const script = document.createElement('script');
    if (id !== null) script.dataset.extensionId = id;
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => (id === null ? null : script) });
    try {
        body();
    } finally {
        delete (document as unknown as { currentScript?: unknown }).currentScript;
    }
}

/** What a synthetic plugin registers when its script runs. */
function registerAll(id: string): void {
    registry.registerSidebarButton({ id: `${id}-btn`, icon: 'x', label: id, onClick: () => {} });
    registry.registerPanel(`${id}-panel`, { id: `${id}-panel`, render });
    registry.registerSettingsPanel(id, { id, render });
    registry.registerInlineWidget(`${id}-widget`, { id: `${id}-widget`, render });
}

const ext = (id: string, enabled = true, code = `/* ${id} */`): LoadableExtension => ({ id, enabled, code });

interface Harness {
    installed: LoadableExtension[];
    runs: string[];
    lists: LoadableExtension[][];
    loader: ReturnType<typeof createPluginLoader>;
}

function harness(initial: LoadableExtension[], getRegistry: () => LoaderRegistry | undefined = () => registry): Harness {
    const h = { installed: initial, runs: [] as string[], lists: [] as LoadableExtension[][] } as Harness;
    h.loader = createPluginLoader({
        getInstalledExtensions: async () => h.installed.map((e) => ({ ...e })),
        getRegistry,
        onInstalledList: (list) => h.lists.push(list),
        injectScript: async (e) => {
            const script = document.createElement('script');
            script.dataset.extensionId = e.id;
            document.head.appendChild(script);
            h.runs.push(e.id);
            asPlugin(e.id, () => registerAll(e.id));
        },
        removeScripts: removeExtensionScripts,
    });
    return h;
}

const scriptIds = () =>
    Array.from(document.querySelectorAll<HTMLScriptElement>('script[data-extension-id]')).map((s) => s.dataset.extensionId);
const buttonIds = () => registry.getButtons().map((b: { id: string }) => b.id);

beforeEach(() => {
    registry.resumeNotifications();
    registry.clear();
    removeExtensionScripts();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('extensionRegistry: owners (T-409)', () => {
    it('unregisterExtension removes everything one plugin registered, and its manifest only', () => {
        registry.registerManifest('p1', { id: 'p1' });
        registry.registerManifest('p2', { id: 'p2' });
        asPlugin('p1', () => registerAll('p1'));
        asPlugin('p2', () => registerAll('p2'));
        const listener = vi.fn();
        const off = registry.subscribe(listener);
        expect(registry.unregisterExtension('p1')).toBe(true);
        off();
        expect(listener).toHaveBeenCalled();
        expect(buttonIds()).toEqual(['p2-btn']);
        expect(registry.getPanel('p1-panel')).toBeUndefined();
        expect(registry.getSettingsPanel('p1')).toBeUndefined();
        expect(registry.getInlineWidgets().map((w: { id: string }) => w.id)).toEqual(['p2-widget']);
        expect(registry.getManifest('p1')).toBeUndefined();
        expect(registry.getPanel('p2-panel')?.id).toBe('p2-panel');
        expect(registry.getSettingsPanel('p2')?.id).toBe('p2');
        expect(registry.getManifest('p2')).toEqual({ id: 'p2' });
    });

    it('refuses (and changes nothing) while any entry has no known owner', () => {
        asPlugin('p1', () => registerAll('p1'));
        // e.g. registered later from a timer: document.currentScript is null then.
        asPlugin(null, () => registry.registerPanel('late-panel', { id: 'late-panel', render }));
        expect(registry.unregisterExtension('p1')).toBe(false);
        expect(buttonIds()).toEqual(['p1-btn']);
        expect(registry.getPanel('late-panel')).toBeDefined();
        // A clear() forgets every owner, after which unloading works again.
        registry.clear();
        asPlugin('p1', () => registerAll('p1'));
        expect(registry.unregisterExtension('p1')).toBe(true);
        expect(buttonIds()).toEqual([]);
    });

    it('a re-registration by another plugin moves the owner', () => {
        asPlugin('p1', () => registry.registerPanel('shared', { id: 'from-p1', render }));
        asPlugin('p2', () => registry.registerPanel('shared', { id: 'from-p2', render }));
        expect(registry.unregisterExtension('p1')).toBe(true);
        expect(registry.getPanel('shared')?.id).toBe('from-p2');
    });
});

describe('extensionRegistry: buttonIdForPanel (active bar marker)', () => {
    const button = (id: string) => registry.registerSidebarButton({ id, icon: 'x', label: id, onClick: () => {} });

    it('no open panel: no active button', () => {
        asPlugin('p1', () => registerAll('p1'));
        expect(registry.buttonIdForPanel(null)).toBeNull();
    });

    it('a button with the panel id wins (v1 rule), also without a known owner', () => {
        asPlugin(null, () => {
            button('same');
            registry.registerPanel('same', { id: 'same', render });
        });
        expect(registry.buttonIdForPanel('same')).toBe('same');
    });

    it('different ids: the only button of the plugin that registered the panel', () => {
        asPlugin('p1', () => registerAll('p1'));
        asPlugin('p2', () => registerAll('p2'));
        expect(registry.buttonIdForPanel('p1-panel')).toBe('p1-btn');
        expect(registry.buttonIdForPanel('p2-panel')).toBe('p2-btn');
    });

    it('null when the owner is unknown, has no button, or has several', () => {
        asPlugin(null, () => {
            button('late-btn');
            registry.registerPanel('late-panel', { id: 'late-panel', render });
        });
        asPlugin('nobutton', () => registry.registerPanel('nobutton-panel', { id: 'nobutton-panel', render }));
        asPlugin('two', () => {
            button('two-a');
            button('two-b');
            registry.registerPanel('two-panel', { id: 'two-panel', render });
        });
        expect(registry.buttonIdForPanel('late-panel')).toBeNull();
        expect(registry.buttonIdForPanel('nobutton-panel')).toBeNull();
        expect(registry.buttonIdForPanel('two-panel')).toBeNull();
        expect(registry.buttonIdForPanel('missing-panel')).toBeNull();
    });

    it('follows a button list replaced from outside (Clipboard Manager reassigns `buttons`)', () => {
        asPlugin('p1', () => registerAll('p1'));
        (registry as unknown as { buttons: Array<{ id: string }> }).buttons = [];
        expect(registry.buttonIdForPanel('p1-panel')).toBeNull();
    });
});

describe('injectExtensionScript', () => {
    it('tags the script with data-extension-id (plugins read their own id from document.currentScript)', () => {
        // jsdom has no URL.createObjectURL: add the two statics for this test only, leave the URL constructor alone.
        const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:kobar-test');
        const statics = URL as unknown as Record<string, unknown>;
        const before = { create: statics.createObjectURL, revoke: statics.revokeObjectURL };
        statics.createObjectURL = createObjectURL;
        statics.revokeObjectURL = vi.fn();
        try {
            void injectExtensionScript({ id: 'dev-com.example.demo', enabled: true, code: 'return;' });
            expect(scriptIds()).toEqual(['dev-com.example.demo']);
            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(createObjectURL.mock.calls[0][0].type).toBe('application/javascript');
        } finally {
            statics.createObjectURL = before.create;
            statics.revokeObjectURL = before.revoke;
            removeExtensionScripts();
        }
    });
});

describe('planPluginLoad', () => {
    const installed = [ext('a'), ext('b', false), ext('c'), ext('nocode', true, '')];

    it('full: unload everything loaded, inject every enabled plugin with code', () => {
        const plan = planPluginLoad(new Set(['a', 'x']), installed, true);
        expect(plan.full).toBe(true);
        expect(plan.unload).toEqual(['a', 'x']);
        expect(plan.load.map((e) => e.id)).toEqual(['a', 'c']);
    });

    it('diff: only the enabled-set difference', () => {
        const plan = planPluginLoad(new Set(['a', 'b', 'gone']), installed, false);
        expect(plan.full).toBe(false);
        expect(plan.unload).toEqual(['b', 'gone']);
        expect(plan.load.map((e) => e.id)).toEqual(['c']);
        expect(planPluginLoad(new Set(['a', 'c']), installed, false)).toEqual({ full: false, unload: [], load: [] });
    });
});

describe('createPluginLoader', () => {
    it('the first request is a full load; a request with the same full sequence is a diff', async () => {
        const h = harness([ext('a'), ext('b'), ext('off', false)]);
        await h.loader.request(0);
        expect(h.runs).toEqual(['a', 'b']);
        expect(scriptIds()).toEqual(['a', 'b']);
        expect(h.lists).toHaveLength(1);

        // Nothing changed: no plugin runs again (a running plugin keeps its in-memory state).
        await h.loader.request(0);
        expect(h.runs).toEqual(['a', 'b']);
        expect(buttonIds()).toEqual(['a-btn', 'b-btn']);
        expect(h.lists).toHaveLength(2);
    });

    it('diff: enabling injects only that plugin; disabling unloads only that plugin', async () => {
        const h = harness([ext('a'), ext('b'), ext('c', false)]);
        await h.loader.request(0);

        h.installed = [ext('a'), ext('b'), ext('c')];
        await h.loader.request(0);
        expect(h.runs).toEqual(['a', 'b', 'c']);

        h.installed = [ext('a'), ext('b', false), ext('c')];
        await h.loader.request(0);
        expect(h.runs).toEqual(['a', 'b', 'c']);
        expect(scriptIds()).toEqual(['a', 'c']);
        expect(buttonIds()).toEqual(['a-btn', 'c-btn']);
        expect(registry.getSettingsPanel('b')).toBeUndefined();
        expect(h.loader.loadedIds().sort()).toEqual(['a', 'c']);

        // An uninstalled plugin is unloaded the same way.
        h.installed = [ext('a')];
        await h.loader.request(0);
        expect(scriptIds()).toEqual(['a']);
        expect(buttonIds()).toEqual(['a-btn']);
    });

    it('a new full sequence re-runs every enabled plugin (install, update, namespace switch)', async () => {
        const h = harness([ext('a'), ext('b')]);
        const clear = vi.spyOn(registry, 'clear');
        await h.loader.request(0);
        await h.loader.request(1);
        expect(h.runs).toEqual(['a', 'b', 'a', 'b']);
        expect(clear).toHaveBeenCalledTimes(2);
        expect(scriptIds()).toEqual(['a', 'b']);
    });

    it('falls back to a full load when a disabled plugin cannot be unloaded on its own', async () => {
        const h = harness([ext('a'), ext('b')]);
        await h.loader.request(0);
        asPlugin(null, () => registry.registerInlineWidget('anonymous', { id: 'anonymous', render }));
        h.installed = [ext('a'), ext('b', false)];
        await h.loader.request(0);
        expect(h.runs).toEqual(['a', 'b', 'a']);
        expect(scriptIds()).toEqual(['a']);
        expect(buttonIds()).toEqual(['a-btn']);
        expect(registry.getInlineWidgets().map((w: { id: string }) => w.id)).toEqual(['a-widget']);
    });

    it('falls back to a full load with a registry that cannot unregister (older instance kept by dev HMR)', async () => {
        const old: LoaderRegistry = {
            clear: vi.fn(),
            registerManifest: vi.fn(),
            suspendNotifications: vi.fn(),
            resumeNotifications: vi.fn(),
        };
        const h = harness([ext('a'), ext('b')], () => old);
        await h.loader.request(0);
        h.installed = [ext('a'), ext('b', false)];
        await h.loader.request(0);
        expect(old.clear).toHaveBeenCalledTimes(2);
        expect(h.runs).toEqual(['a', 'b', 'a']);
    });

    it('loads never interleave: a request waits for the one before it', async () => {
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let call = 0;
        const loader = createPluginLoader({
            getInstalledExtensions: async () => {
                const n = ++call;
                order.push(`start-${n}`);
                if (n === 1) await gate;
                order.push(`end-${n}`);
                return [ext('a')];
            },
            getRegistry: () => registry,
            onInstalledList: () => {},
            injectScript: async () => {},
            removeScripts: removeExtensionScripts,
        });
        const first = loader.request(0);
        const second = loader.request(0);
        await Promise.resolve();
        expect(order).toEqual(['start-1']);
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });

    it('a failing plugin list resumes notifications and never rejects', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const resume = vi.spyOn(registry, 'resumeNotifications');
        const loader = createPluginLoader({
            getInstalledExtensions: () => Promise.reject(new Error('ipc down')),
            getRegistry: () => registry,
            onInstalledList: () => {},
            injectScript: async () => {},
            removeScripts: removeExtensionScripts,
        });
        await expect(loader.request(0)).resolves.toBeUndefined();
        expect(resume).toHaveBeenCalled();
        expect(err).toHaveBeenCalledWith('Failed to query extensions:', expect.any(Error));
    });

    it('a failed full load is retried as a full one', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = true;
        const h = harness([ext('a')]);
        const clear = vi.spyOn(registry, 'clear');
        const loader = createPluginLoader({
            getInstalledExtensions: async () => {
                if (fail) throw new Error('ipc down');
                return [ext('a')];
            },
            getRegistry: () => registry,
            onInstalledList: () => {},
            injectScript: async (e) => {
                h.runs.push(e.id);
            },
            removeScripts: removeExtensionScripts,
        });
        await loader.request(0);
        fail = false;
        await loader.request(0);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(h.runs).toEqual(['a']);
    });

    it('a plugin whose manifest could not be registered is not counted as loaded and is tried again', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const h = harness([ext('a'), ext('b')]);
        const register = vi.spyOn(registry, 'registerManifest').mockImplementationOnce(() => {
            throw new Error('bad manifest');
        });
        await h.loader.request(0);
        expect(h.runs).toEqual(['b']);
        expect(h.loader.loadedIds()).toEqual(['b']);
        await h.loader.request(0);
        expect(h.runs).toEqual(['b', 'a']);
        expect(register).toHaveBeenCalledTimes(3);
    });
});
