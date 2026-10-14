// T-606: the main window side of the Settings window sync against the REAL app store (jsdom): every allow-listed action is a real
// store setter, the published snapshot is JSON-safe and holds only the settings keys, and src/main.tsx claims the bridge before
// any plugin can run.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IpcSettingsPublish } from '../shared/ipc-contract';
import { SETTINGS_KEYS } from '../src/store/importExport';
import {
    SETTINGS_ACTIONS,
    SETTINGS_SYNC_KEYS,
    applySettingsAction,
    claimSettingsSyncBridge,
    selectSettingsState,
    settingsSyncBridge,
    startSettingsSync,
} from '../src/store/sync';
import { useAppStore } from '../src/store/useAppStore';

describe('src/store/sync.ts with the real app store', () => {
    it('the key list is the settings export list, and every action is a real store setter', () => {
        expect(SETTINGS_SYNC_KEYS).toBe(SETTINGS_KEYS);
        const state = useAppStore.getState() as unknown as Record<string, unknown>;
        for (const [type, entry] of SETTINGS_ACTIONS) {
            expect(typeof state[type], type).toBe('function');
            expect(type).toBe(`set${entry.key.charAt(0).toUpperCase()}${entry.key.slice(1)}`);
        }
    });

    it('the snapshot is JSON-safe and holds no notes, workspaces, plugin data or tutorial / onboarding state', () => {
        const snapshot = selectSettingsState(useAppStore.getState());
        expect(Object.keys(snapshot).sort()).toEqual([...SETTINGS_SYNC_KEYS].sort());
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
        for (const key of ['notes', 'workspaces', 'legacyBackup', 'pluginData', 'tutorialState', 'onboarding', 'clipboardHistory']) {
            expect(snapshot, key).not.toHaveProperty(key);
        }
    });

    it('publishes after hydration and applies an action through the real setter', () => {
        useAppStore.setState({ isHydrated: true, theme: 'ember' });
        const published: IpcSettingsPublish[] = [];
        let deliver: ((action: unknown) => void) | null = null;
        const tasks: Array<() => void> = [];
        const sync = startSettingsSync({
            store: useAppStore,
            bridge: {
                publish: (message) => void published.push(message),
                openSettings: () => {},
                onAction: (callback) => {
                    deliver = callback as (action: unknown) => void;
                    return () => {
                        deliver = null;
                    };
                },
            },
            schedule: (run) => {
                tasks.push(run);
                return () => {};
            },
            epoch: 'dom',
        });
        tasks.splice(0).forEach((run) => run());
        expect(published).toHaveLength(1);
        deliver!({ id: 5, type: 'setTheme', payload: 'ocean' });
        tasks.splice(0).forEach((run) => run());
        expect(useAppStore.getState().theme).toBe('ocean');
        expect(published.at(-1)).toMatchObject({ epoch: 'dom', rev: 2, ack: 5, state: { theme: 'ocean' } });
        sync.stop();
        expect(deliver).toBeNull();
    });

    it('rejects a payload the import schema refuses, on the real store', () => {
        useAppStore.setState({ isHydrated: true });
        const before = useAppStore.getState().sidebarWidth;
        expect(applySettingsAction(useAppStore, { type: 'setSidebarWidth', payload: -5 }, () => {})).toEqual({
            ok: false,
            reason: 'invalid-payload',
        });
        expect(useAppStore.getState().sidebarWidth).toBe(before);
    });

    it('outside Electron there is no bridge to claim; a claimed bridge is never handed out twice', () => {
        expect(settingsSyncBridge).toBeNull();
        let claims = 0;
        const target = { __kobarSettingsSync: { claim: () => (claims++ === 0 ? { publish() {}, onAction: () => () => {} } : null) } };
        expect(claimSettingsSyncBridge(target)).not.toBeNull();
        expect(claimSettingsSyncBridge(target)).toBeNull();
        expect(claimSettingsSyncBridge({ __kobarSettingsSync: { claim: 'no' } })).toBeNull();
        expect(claimSettingsSyncBridge(null)).toBeNull();
    });
});

describe('src/main.tsx wiring', () => {
    const mainTsx = readFileSync(resolve(__dirname, '../src/main.tsx'), 'utf8');

    it('claims the settings sync bridge before the app (and so any plugin script) is loaded', () => {
        const claim = mainTsx.indexOf("import { settingsSyncBridge, startSettingsSync } from './store/sync'");
        expect(claim).toBeGreaterThan(mainTsx.indexOf("import './storage/client'"));
        for (const later of ["import App from './App.tsx'", "import { useAppStore } from './store/useAppStore'"]) {
            expect(mainTsx.indexOf(later), later).toBeGreaterThan(claim);
        }
        // T-607: the call also passes `onApplied` (the launch-at-startup re-read), so match its arguments, not the whole call.
        expect(mainTsx).toMatch(/startSettingsSync\(\{\s*store: useAppStore,\s*bridge: settingsSyncBridge,/);
    });
});
