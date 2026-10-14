import { beforeEach, describe, expect, it } from 'vitest';
import { translations } from '../src/i18n';
import { useAppStore, type WorkspaceConfig } from '../src/store/useAppStore';
import { type DeleteWorkspaceDeps, deleteWorkspaceWithBackup, findWorkspaceIsoKeys } from '../src/store/workspace/deleteWorkspace';
import { deleteResultMessageKey, workspaceConfirmMessageKeys } from '../src/components/plugins/workspaceConfirm';
import { installWindowApiMock } from './helpers/windowApi';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig. Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// T-214 (WS-05): workspace delete = confirmation, automatic backup, delete, then the workspace's own `_iso_<id>` keys.
// Synthetic data only.

function ws(id: string, over: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
    return {
        id,
        name: `ws-${id}`,
        isIsolated: false,
        enabledExtensions: {},
        isPinInjectorEnabled: false,
        isKoBoxEnabled: false,
        koBoxCleanupMode: '24h',
        toggleWidth: 22,
        sidebarWidth: 46,
        iconScale: 0.8,
        featureSpacing: 8,
        showTooltips: true,
        theme: 'midnight',
        customThemeColor: '#f4a125',
        design: 'style1',
        glassOpacity: 60,
        featureOrder: [],
        edgePosition: 'right',
        isPopupSmartPositioning: false,
        enableEyeAnimation: true,
        orientation: 'vertical',
        ...over,
    };
}

function rawKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)!);
    return keys.sort();
}

describe('findWorkspaceIsoKeys', () => {
    const keys = [
        'todo_iso_1',
        'notes.v2_iso_1',
        'todo_iso_11',
        'todo_iso_x1',
        'todo_iso_1_extra',
        '_iso_1',
        'todo',
        'my_iso_settings',
        'kobar-storage',
        'k_iso_a_iso_1',
    ];

    it('matches only `<non-empty base>_iso_<id>` exactly, never another id or a non-iso key', () => {
        expect(findWorkspaceIsoKeys(keys, '1', ['11', 'x1'])).toEqual(['todo_iso_1', 'notes.v2_iso_1', 'k_iso_a_iso_1']);
        expect(findWorkspaceIsoKeys(keys, '11', ['1'])).toEqual(['todo_iso_11']);
    });

    it('keeps a key that could also belong to another existing workspace', () => {
        expect(findWorkspaceIsoKeys(keys, '1', ['a_iso_1'])).toEqual(['todo_iso_1', 'notes.v2_iso_1']);
    });

    it('selects nothing for an empty id', () => {
        expect(findWorkspaceIsoKeys(keys, '', [])).toEqual([]);
    });
});

describe('deleteWorkspaceWithBackup (ordering)', () => {
    function harness(saveResult: { success: boolean; reason?: string } | Error) {
        const order: string[] = [];
        const map = new Map<string, string>([
            ['todo_iso_1', 'a'],
            ['todo_iso_2', 'b'],
            ['todo', 'shared'],
            ['kobar-storage', '{"state":{},"version":23}'],
        ]);
        let ids = ['1', '2'];
        const texts: string[] = [];
        const deps: DeleteWorkspaceDeps = {
            api: {
                getBackupSources: async () => ({ extensionsConfig: {}, plugins: [] }),
                getAppVersion: async () => '2.0.0',
                createPreDeleteBackup: async (text: string) => {
                    order.push('backup');
                    texts.push(text);
                    if (saveResult instanceof Error) throw saveResult;
                    return saveResult;
                },
            },
            storage: {
                get length() {
                    return map.size;
                },
                key: (i: number) => [...map.keys()][i] ?? null,
                getItem: (k: string) => map.get(k) ?? null,
                removeItem: (k: string) => {
                    order.push(`remove:${k}`);
                    map.delete(k);
                },
            },
            flush: () => order.push('flush'),
            now: () => new Date(Date.UTC(2026, 0, 1)),
            getWorkspaceIds: () => ids,
            deleteWorkspace: (id: string) => {
                order.push(`delete:${id}`);
                ids = ids.filter((x) => x !== id);
            },
        };
        return { order, map, deps, texts, ids: () => ids };
    }

    it('flushes, backs up (without secrets), deletes, then removes only that workspace iso keys', async () => {
        const h = harness({ success: true });
        await expect(deleteWorkspaceWithBackup('1', h.deps)).resolves.toEqual({ success: true, removedKeys: 1 });
        expect(h.order).toEqual(['flush', 'backup', 'delete:1', 'remove:todo_iso_1']);
        expect([...h.map.keys()].sort()).toEqual(['kobar-storage', 'todo', 'todo_iso_2']);
        expect(JSON.parse(h.texts[0]).includesSecrets).toBe(false);
    });

    it.each([[{ success: false, reason: 'write-failed' }], [new Error('ipc')]])(
        'aborts when the backup fails (%j): nothing is deleted',
        async (result) => {
            const h = harness(result);
            const out = await deleteWorkspaceWithBackup('1', h.deps);
            expect(out).toMatchObject({ success: false, reason: 'backup-failed' });
            expect(h.order).not.toContain('delete:1');
            expect(h.order.some((step) => step.startsWith('remove:'))).toBe(false);
            expect(h.ids()).toEqual(['1', '2']);
            expect(h.map.size).toBe(4);
        }
    );

    it('reports delete-failed (and releases the busy guard) when the store delete throws after the backup', async () => {
        const h = harness({ success: true });
        h.deps.deleteWorkspace = () => {
            throw new Error('boom');
        };
        await expect(deleteWorkspaceWithBackup('1', h.deps)).resolves.toEqual({ success: false, reason: 'delete-failed' });
        expect(h.order.some((step) => step.startsWith('remove:'))).toBe(false);
        expect(h.map.has('todo_iso_1')).toBe(true);
        h.deps.deleteWorkspace = (id: string) => h.order.push(`delete:${id}`);
        await expect(deleteWorkspaceWithBackup('1', h.deps)).resolves.toEqual({ success: false, reason: 'delete-failed' });
    });

    it('reports delete-failed when reading the storage keys throws', async () => {
        const h = harness({ success: true });
        let broken = false;
        const storage = h.deps.storage;
        h.deps.storage = {
            get length() {
                if (broken) throw new Error('storage');
                return storage.length;
            },
            key: (i: number) => storage.key(i),
            getItem: (k: string) => storage.getItem(k),
            removeItem: (k: string) => storage.removeItem(k),
        };
        const remove = h.deps.deleteWorkspace;
        h.deps.deleteWorkspace = (id: string) => {
            remove(id);
            broken = true;
        };
        await expect(deleteWorkspaceWithBackup('1', h.deps)).resolves.toEqual({ success: false, reason: 'delete-failed' });
        expect(h.ids()).toEqual(['2']);
    });

    it('does nothing for an unknown workspace and refuses a second delete while one runs', async () => {
        const h = harness({ success: true });
        await expect(deleteWorkspaceWithBackup('nope', h.deps)).resolves.toEqual({ success: false, reason: 'not-found' });
        const first = deleteWorkspaceWithBackup('1', h.deps);
        await expect(deleteWorkspaceWithBackup('2', h.deps)).resolves.toEqual({ success: false, reason: 'busy' });
        await first;
        expect(h.ids()).toEqual(['2']);
    });
});

describe('store.deleteWorkspaceWithBackup', () => {
    beforeEach(() => {
        useAppStore.setState({
            workspaces: [
                ws('1', { isIsolated: true, isolatedData: { notes: [], activeNoteId: 1, nextNoteId: 1, pluginData: {} } }),
                ws('11'),
            ],
            activeWorkspaceId: '1',
        });
    });

    it('deletes the active isolated workspace after the backup, switches to shared data and removes only its keys', async () => {
        const api = installWindowApiMock();
        api.getBackupSources.mockResolvedValue({ extensionsConfig: {}, plugins: [] });
        api.getAppVersion.mockResolvedValue('2.0.0');
        api.createPreDeleteBackup.mockResolvedValue({ success: true });
        Storage.prototype.setItem.call(localStorage, 'todo_iso_1', 'mine');
        Storage.prototype.setItem.call(localStorage, 'todo_iso_11', 'other');
        Storage.prototype.setItem.call(localStorage, 'todo', 'shared');
        const contextBefore = useAppStore.getState().dataContextId;

        const result = await useAppStore.getState().deleteWorkspaceWithBackup('1');

        expect(result).toEqual({ success: true, removedKeys: 1 });
        expect(api.createPreDeleteBackup).toHaveBeenCalledTimes(1);
        expect(api.createPreRestoreBackup).not.toHaveBeenCalled();
        const state = useAppStore.getState();
        expect(state.workspaces.map((w) => w.id)).toEqual(['11']);
        expect(state.activeWorkspaceId).toBeNull();
        expect(state.dataContextId).toBe(contextBefore + 1);
        expect(rawKeys().filter((k) => k !== 'kobar-storage')).toEqual(['todo', 'todo_iso_11']);
    });

    it('keeps the workspace and its keys when the backup fails', async () => {
        const api = installWindowApiMock();
        api.getBackupSources.mockResolvedValue({ extensionsConfig: {}, plugins: [] });
        api.getAppVersion.mockResolvedValue('2.0.0');
        api.createPreDeleteBackup.mockResolvedValue({ success: false, reason: 'write-failed' });
        Storage.prototype.setItem.call(localStorage, 'todo_iso_1', 'mine');

        const result = await useAppStore.getState().deleteWorkspaceWithBackup('1');

        expect(result).toMatchObject({ success: false, reason: 'backup-failed' });
        expect(useAppStore.getState().workspaces.map((w) => w.id)).toEqual(['1', '11']);
        expect(useAppStore.getState().activeWorkspaceId).toBe('1');
        expect(Storage.prototype.getItem.call(localStorage, 'todo_iso_1')).toBe('mine');
    });
});

describe('confirmation copy', () => {
    const KEYS = [
        'workspaceDeleteConfirm',
        'workspaceDeleteIsoNote',
        'workspaceDeleteActiveNote',
        'workspaceDeleting',
        'workspaceDeletedMsg',
        'workspaceDeleteBackupFailed',
        'workspaceDeleteFailed',
        'workspaceIsolateConfirm',
        'workspaceShareConfirm',
        'workspaceToggleActiveNote',
        'workspaceConfirmChange',
    ];

    it('exists in every language', () => {
        const all = translations as unknown as Record<string, Record<string, unknown>>;
        for (const lang of Object.keys(all)) {
            for (const key of KEYS) {
                expect(typeof all[lang][key], `${lang}.${key}`).toBe('string');
                expect((all[lang][key] as string).length, `${lang}.${key}`).toBeGreaterThan(0);
            }
            for (const key of [
                'workspaceDeleteConfirm',
                'workspaceIsolateConfirm',
                'workspaceShareConfirm',
                'workspaceDeleteBackupFailed',
            ]) {
                expect(all[lang][key], `${lang}.${key}`).toContain('{name}');
            }
        }
    });

    it('names chat history among the deleted isolated data', () => {
        expect(translations.en.workspaceDeleteIsoNote).toMatch(/chat history/);
        expect(translations.tr.workspaceDeleteIsoNote).toMatch(/sohbet geçmişi/);
    });

    it('states what is affected', () => {
        const iso = { id: '1', name: 'A', isIsolated: true };
        const shared = { id: '2', name: 'B', isIsolated: false };
        expect(workspaceConfirmMessageKeys({ kind: 'delete', preset: iso }, '1')).toEqual([
            'workspaceDeleteConfirm',
            'workspaceDeleteIsoNote',
            'workspaceDeleteActiveNote',
        ]);
        expect(workspaceConfirmMessageKeys({ kind: 'delete', preset: shared }, '1')).toEqual(['workspaceDeleteConfirm']);
        expect(workspaceConfirmMessageKeys({ kind: 'isolation', preset: shared }, '2')).toEqual([
            'workspaceIsolateConfirm',
            'workspaceToggleActiveNote',
        ]);
        expect(workspaceConfirmMessageKeys({ kind: 'isolation', preset: iso }, null)).toEqual(['workspaceShareConfirm']);
        expect(deleteResultMessageKey({ success: false, reason: 'backup-failed' })).toBe('workspaceDeleteBackupFailed');
        expect(deleteResultMessageKey({ success: true, removedKeys: 0 })).toBe('workspaceDeletedMsg');
    });
});
