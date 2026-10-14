import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, serializeBackup } from '../src/backup/buildBackup';
import { CHAT_STORE_VERSION } from '../src/backup/coreValues';
import { parseBackup } from '../src/backup/parseBackup';
import { useChatStore } from '../src/store/useChatStore';

// T-212: parsing and previewing a backup must not write anything (localStorage, window.api).

const HOSTILE = readFileSync(resolve(__dirname, 'fixtures/backup/hostile-backup.json'), 'utf8');

function snapshot(storage: Storage): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null) out[key] = Storage.prototype.getItem.call(storage, key);
    }
    return out;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseBackup writes nothing', () => {
    it('leaves localStorage and window.api untouched for a hostile and a valid backup', () => {
        localStorage.setItem('kobar-storage', JSON.stringify({ state: { language: 'en' }, version: 23 }));
        localStorage.setItem('kobar_plugin_todos', '[{"id":1,"text":"local"}]');
        const before = snapshot(localStorage);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
        const clear = vi.spyOn(Storage.prototype, 'clear');
        const apiCalls: string[] = [];
        const api = window.api as unknown as Record<string, unknown>;
        for (const name of Object.keys(api)) {
            // The mock is reinstalled before every test (tests/setup.ts), so replacing its methods here is local.
            if (typeof api[name] === 'function') api[name] = () => apiCalls.push(name);
        }

        const valid = serializeBackup(
            buildBackup({
                localStorage: { kobar_plugin_todos: '[{"id":1,"text":"from backup"}]' },
                extensionsConfig: { 'todolist-plugin': false },
                plugins: [],
                appVersion: '1.1.4',
                now: new Date('2026-10-12T10:00:00.000Z'),
            })
        );
        const options = { installedPluginIds: ['todolist-plugin'], currentAppVersion: '1.1.4' };
        expect(parseBackup(HOSTILE, options).ok).toBe(true);
        expect(parseBackup(valid, options).ok).toBe(true);

        expect(setItem).not.toHaveBeenCalled();
        expect(removeItem).not.toHaveBeenCalled();
        expect(clear).not.toHaveBeenCalled();
        expect(apiCalls).toEqual([]);
        expect(snapshot(localStorage)).toEqual(before);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('uses the same chat store version as useChatStore', () => {
        expect(useChatStore.persist.getOptions().version).toBe(CHAT_STORE_VERSION);
    });
});
