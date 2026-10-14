// T-612: the main window's side of Settings > Workspaces: summary, action validation, execution-time id checks, races, and the wiring
// into startSettingsSync. The store is a small fake with the same action names as the real one.
import { describe, expect, it, vi } from 'vitest';
import type { IpcClaimedSettingsSyncBridge, IpcSettingsAction, IpcSettingsPublish } from '../shared/ipc-contract';
import { startSettingsSync } from '../src/store/sync';
import { createWorkspaceSync, WORKSPACE_ACTIONS, type WorkspaceSyncState } from '../src/store/workspaceSync';
import { sanitizeWorkspaceSummary } from '../src/store/workspaceSummary';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(opts: { backupFails?: boolean; hydrated?: boolean } = {}) {
    const calls: string[] = [];
    const listeners = new Set<(s: WorkspaceSyncState) => void>();
    const notes: string[] = [];
    let state: WorkspaceSyncState;
    const set = (patch: Partial<WorkspaceSyncState>) => {
        state = { ...state, ...patch };
        listeners.forEach((l) => l(state));
    };
    state = {
        isHydrated: opts.hydrated ?? true,
        language: 'en',
        workspaces: [
            { id: 'a', name: 'Alpha' },
            { id: 'b', name: 'Beta', isIsolated: true },
            { id: 'c', name: 'Gamma', isIsolated: false, isolatedData: { notes: [] } },
        ],
        activeWorkspaceId: 'a',
        saveCurrentAsWorkspace: (name, iso) => {
            calls.push(`create:${name}:${iso}`);
            set({ workspaces: [...state.workspaces, { id: `n${state.workspaces.length}`, name, isIsolated: iso }] });
        },
        loadWorkspace: (id) => {
            calls.push(`switch:${id}`);
            set({ activeWorkspaceId: id });
        },
        updateWorkspaceName: (id, name) => {
            calls.push(`rename:${id}:${name}`);
            set({ workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) });
        },
        deleteWorkspaceWithBackup: async (id) => {
            calls.push(`delete:${id}`);
            if (opts.backupFails) return { success: false, reason: 'backup-failed' } as never;
            set({
                workspaces: state.workspaces.filter((w) => w.id !== id),
                activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
            });
            return { success: true } as never;
        },
    };
    const store = {
        getState: () => state,
        subscribe: (l: (s: WorkspaceSyncState) => void) => (listeners.add(l), () => listeners.delete(l)),
    };
    const sync = createWorkspaceSync({ store, log: vi.fn(), notify: (message) => void notes.push(message) });
    return { sync, calls, notes, set, getState: () => state };
}
const act = (type: string, payload?: unknown) => ({ type, payload });

describe('workspace summary', () => {
    it('is null before hydration and has no notes or data, only flags', () => {
        expect(harness({ hydrated: false }).sync.getSummary()).toBeNull();
        const s = harness().sync.getSummary()!;
        expect(s.items.map((i) => [i.id, i.isolated, i.hasIsolatedData, i.active])).toEqual([
            ['a', false, false, true],
            ['b', true, true, false],
            ['c', false, true, false],
        ]);
        expect(JSON.stringify(s)).not.toContain('notes');
    });

    it('sanitizeWorkspaceSummary drops invalid and duplicate items', () => {
        const raw = {
            items: [{ id: 'a', name: 'A' }, { id: 'a', name: 'dup' }, { id: '', name: 'x' }, 5, { id: 'b', name: 7, active: true }],
        };
        expect(sanitizeWorkspaceSummary(raw)!.items.map((i) => [i.id, i.name, i.active])).toEqual([
            ['a', 'A', false],
            ['b', 'b', true],
        ]);
        expect(sanitizeWorkspaceSummary('x')).toBeNull();
    });

    it('subscribe fires only for list, active workspace or hydration changes', () => {
        const h = harness();
        const listener = vi.fn();
        h.sync.subscribe(listener);
        h.set({ language: 'tr' });
        expect(listener).not.toHaveBeenCalled();
        h.set({ activeWorkspaceId: 'b' });
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('workspace actions: validation', () => {
    it('owns only the allow-listed types', () => {
        const { sync } = harness();
        expect([...WORKSPACE_ACTIONS.keys()].sort()).toEqual([
            'workspace.create',
            'workspace.delete',
            'workspace.rename',
            'workspace.switch',
        ]);
        expect(sync.owns('workspace.create')).toBe(true);
        expect(sync.owns('workspace.__proto__')).toBe(false);
        expect(sync.owns('plugin.toggle')).toBe(false);
    });

    it('rejects unknown actions, bad payloads, empty or long names and control characters', async () => {
        const h = harness();
        const bad: [string, unknown][] = [
            ['workspace.nope', {}],
            ['__proto__', {}],
            ['workspace.create', { name: '', isolated: false }],
            ['workspace.create', { name: '   ', isolated: false }],
            ['workspace.create', { name: 'x'.repeat(201), isolated: false }],
            ['workspace.create', { name: 'ok', isolated: 'yes' }],
            ['workspace.create', { name: 'ok', isolated: false, extra: 1 }],
            ['workspace.create', { name: `a${String.fromCharCode(0)}b`, isolated: false }],
            ['workspace.rename', { id: 'a', name: 'a\nb' }],
            ['workspace.rename', { id: 5, name: 'ok' }],
            ['workspace.rename', { id: '', name: 'ok' }],
            ['workspace.delete', {}],
            ['workspace.delete', { id: 'a', force: true }],
            ['workspace.switch', null],
        ];
        for (const [type, payload] of bad) expect((await h.sync.handle(act(type, payload))).ok).toBe(false);
        expect(await h.sync.handle(null)).toEqual({ ok: false, reason: 'unknown-action' });
        expect(h.calls).toEqual([]);
    });

    it('trims names and the cap is inclusive', async () => {
        const h = harness();
        expect((await h.sync.handle(act('workspace.create', { name: `  ${'x'.repeat(200)}  `, isolated: true }))).ok).toBe(true);
        expect(h.calls).toEqual([`create:${'x'.repeat(200)}:true`]);
        expect(h.notes).toHaveLength(1);
    });

    it('rejects actions before hydration', async () => {
        const h = harness({ hydrated: false });
        expect(await h.sync.handle(act('workspace.create', { name: 'x', isolated: false }))).toEqual({ ok: false, reason: 'unavailable' });
        expect(h.calls).toEqual([]);
    });
});

describe('workspace actions: execution', () => {
    it('rename and switch run the store actions; unknown ids do nothing', async () => {
        const h = harness();
        expect((await h.sync.handle(act('workspace.rename', { id: 'b', name: ' Bee ' }))).ok).toBe(true);
        expect((await h.sync.handle(act('workspace.switch', { id: 'c' }))).ok).toBe(true);
        expect(await h.sync.handle(act('workspace.rename', { id: 'ghost', name: 'x' }))).toEqual({
            ok: false,
            reason: 'unknown-workspace',
        });
        expect(await h.sync.handle(act('workspace.switch', { id: 'ghost' }))).toEqual({ ok: false, reason: 'unknown-workspace' });
        expect(await h.sync.handle(act('workspace.delete', { id: '__proto__' }))).toEqual({ ok: false, reason: 'unknown-workspace' });
        expect(h.calls).toEqual(['rename:b:Bee', 'switch:c']);
    });

    it('delete uses the backup path, announces, and deleting the active workspace falls back to shared', async () => {
        const h = harness();
        expect((await h.sync.handle(act('workspace.delete', { id: 'a' }))).ok).toBe(true);
        expect(h.calls).toEqual(['delete:a']);
        expect(h.getState().activeWorkspaceId).toBeNull();
        expect(h.notes).toHaveLength(1);
    });

    it('a failed backup deletes nothing and reports failure', async () => {
        const h = harness({ backupFails: true });
        expect(await h.sync.handle(act('workspace.delete', { id: 'b' }))).toEqual({ ok: false, reason: 'failed' });
        expect(h.getState().workspaces).toHaveLength(3);
        expect(h.notes).toHaveLength(1);
    });

    it('deleting the last workspace is allowed (the list just becomes empty)', async () => {
        const h = harness();
        for (const id of ['a', 'b', 'c']) expect((await h.sync.handle(act('workspace.delete', { id }))).ok).toBe(true);
        expect(h.sync.getSummary()).toEqual({ items: [] });
    });

    it('races: a rename queued behind a delete of the same id is rejected, a double delete runs once', async () => {
        const h = harness();
        const results = await Promise.all([
            h.sync.handle(act('workspace.delete', { id: 'b' })),
            h.sync.handle(act('workspace.rename', { id: 'b', name: 'late' })),
            h.sync.handle(act('workspace.delete', { id: 'b' })),
        ]);
        expect(results.map((r) => r.ok)).toEqual([true, false, false]);
        expect(h.calls).toEqual(['delete:b']);
    });

    it('refuses to create beyond the 200 cap', async () => {
        const h = harness();
        h.set({ workspaces: Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, name: `W${i}` })) });
        expect(await h.sync.handle(act('workspace.create', { name: 'x', isolated: false }))).toEqual({
            ok: false,
            reason: 'limit-reached',
        });
    });
});

describe('startSettingsSync with workspaces', () => {
    it('publishes the summary, republishes on change and acks after the action finished', async () => {
        const published: IpcSettingsPublish[] = [];
        let onAction: (action: IpcSettingsAction) => void = () => {};
        const bridge = {
            publish: (m: IpcSettingsPublish) => void published.push(m),
            onAction: (l: (a: IpcSettingsAction) => void) => ((onAction = l), () => {}),
        } as unknown as IpcClaimedSettingsSyncBridge;
        const h = harness();
        const state = { isHydrated: true, theme: 'ocean' };
        const pending: (() => void)[] = [];
        const handle = startSettingsSync({
            store: { getState: () => state, subscribe: () => () => {} } as never,
            bridge,
            workspaces: h.sync,
            schedule: (run) => (pending.push(run), () => {}),
            epoch: 'E',
            log: vi.fn(),
        });
        const flush = () => pending.splice(0).forEach((run) => run());
        flush();
        expect(published[0].workspaces!.items).toHaveLength(3);
        onAction({ id: 7, type: 'workspace.rename', payload: { id: 'a', name: 'Z' } });
        await tick();
        flush();
        expect(published.at(-1)!.ack).toBe(7);
        expect(published.at(-1)!.workspaces!.items[0].name).toBe('Z');
        onAction({ id: 8, type: 'workspace.delete', payload: { id: 'ghost' } });
        await tick();
        flush();
        expect(published.at(-1)!.ack).toBe(8);
        expect(h.calls).toEqual(['rename:a:Z']);
        handle.stop();
    });
});
