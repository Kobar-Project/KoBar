import { describe, expect, it } from 'vitest';
import { migrateKobarStorage } from '../src/store/migrations';

// T-006 guard: the `kobar-storage` migration lives in its own module and can be
// imported and executed outside the store (no window/localStorage needed).
// Full fixture/snapshot coverage is T-007.

describe('migrateKobarStorage (moved module)', () => {
    it('migrates a tiny v20-ish state without throwing', () => {
        const input = {
            notes: [{ id: 1, content: 'hello' }],
            featureOrder: ['copypaste'],
            workspaces: [{ id: 'w1', name: 'Work' }],
        };
        const result = migrateKobarStorage(input, 20);

        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
        // migrate mutates and returns the same object (current behaviour).
        expect(result).toBe(input);
        expect(result.globalNotes).toEqual([{ id: 1, content: 'hello' }]);
        expect(result.globalPluginData).toEqual({});
        expect(result.activeWorkspaceId).toBeNull();
        expect(result.workspaces[0].isIsolated).toBe(false);
    });

    it('returns a v21 state as an object', () => {
        const input = {
            notes: [],
            globalNotes: [],
            globalPluginData: {},
            activeWorkspaceId: null,
            featureOrder: ['com.kobar.aihub.btn', 'ko-calender-plugin-btn'],
            customThemeColor: '#123456',
        };
        const result = migrateKobarStorage(input, 21);

        expect(typeof result).toBe('object');
        expect(result.customThemeColor).toBe('#123456');
        expect(result.featureOrder).toEqual(['com.kobar.aihub.btn', 'ko-calender-plugin-btn']);
    });

    it('handles an empty version-0 state', () => {
        const result = migrateKobarStorage({}, 0);

        expect(typeof result).toBe('object');
        expect(result.featureOrder).toEqual([
            'com.kobar.aihub.btn',
            'copypaste',
            'todolist-plugin-btn',
            'snippetvault-plugin-btn',
            'pininjector',
            'kobox',
            'kobar-colorpicker-plugin-btn',
            'calculator',
        ]);
        expect(result.workspaces).toEqual([]);
    });
});
