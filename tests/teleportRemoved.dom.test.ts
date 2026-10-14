import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useAppStore } from '../src/store/useAppStore';
import { translations } from '../src/i18n';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig.
import type {} from '../src/components/extensions/extensionRegistry';

// T-144: the Teleport feature is dead end to end (main has no handler and never emits the event).
// The listener and the i18n keys are gone; the preload stubs stay (plugin contract v1). The persisted
// `teleportShortcut` field and its setter were removed with the v26 kobar-storage migration (T-601).

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('teleport removal (T-144)', () => {
    it('App.tsx no longer subscribes to teleport-triggered', () => {
        const app = read('../src/App.tsx');
        expect(app).not.toContain('onTeleportTriggered');
        expect(app).not.toContain('teleport-triggered');
    });

    it('the store no longer calls the registerTeleportShortcut IPC stub', () => {
        expect(read('../src/store/useAppStore.ts')).not.toContain('registerTeleportShortcut');
    });

    it('preload keeps the plugin-contract v1 teleport stubs', () => {
        const preload = read('../electron/preload.cts');
        expect(preload).toContain('registerTeleportShortcut');
        expect(preload).toContain('onTeleportTriggered');
    });

    it('the persisted field and its setter are gone since v26 (T-601)', () => {
        const state = useAppStore.getState() as unknown as Record<string, unknown>;
        expect(state).not.toHaveProperty('teleportShortcut');
        expect(state).not.toHaveProperty('setTeleportShortcut');
        const partialize = useAppStore.persist.getOptions().partialize!;
        expect(Object.keys(partialize(useAppStore.getState()) as Record<string, unknown>)).not.toContain('teleportShortcut');
        expect(useAppStore.persist.getOptions().version).toBe(KOBAR_STORAGE_VERSION);
        expect(KOBAR_STORAGE_VERSION).toBeGreaterThanOrEqual(26);
    });

    it('the unused teleport i18n keys are gone from every language', () => {
        const all = translations as unknown as Record<string, Record<string, unknown>>;
        for (const lang of Object.keys(all)) {
            expect(all[lang], lang).not.toHaveProperty('teleportShortcut');
            expect(all[lang], lang).not.toHaveProperty('teleportShortcutDesc');
        }
    });
});
