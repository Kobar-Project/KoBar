import { describe, expect, it } from 'vitest';
import { migratePersistedKobarStorage } from '../src/store/migrations';
import { KOBAR_STORAGE_VERSION } from './chain/runChain';
import { useAppStore } from '../src/store/useAppStore';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test
// tsconfig (useAppStore.ts references it). Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// T-006 guard: the store's persist options still point at the same key/version
// and use the moved migration function.

describe('useAppStore persist options', () => {
    it('keeps the kobar-storage key, version 32 and the persisted-state migrate (T-601, T-602, T-603, T-604, T-615d, R-11)', () => {
        const options = useAppStore.persist.getOptions();

        expect(options.name).toBe('kobar-storage');
        expect(options.version).toBe(32);
        expect(options.migrate).toBe(migratePersistedKobarStorage);
    });

    it('matches the version the fixture chain assumes (update tests/chain/runChain.ts when bumping)', () => {
        expect(useAppStore.persist.getOptions().version).toBe(KOBAR_STORAGE_VERSION);
    });
});
