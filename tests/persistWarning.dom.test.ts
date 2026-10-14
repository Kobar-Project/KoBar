import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPersistStorage } from '../src/store/persistStorage';
import {
    PERSIST_WARNING_BANNER_ID,
    hidePersistWarningBanner,
    installPersistWarning,
    showPersistWarningBanner,
    type PersistWriteFailure,
} from '../src/store/persistWarning';

// T-202: failure streak wired to the real debounced storage. Synthetic data only.
// Map-backed fake localStorage, same approach as tests/persistStorage.dom.test.ts.
const fake = vi.hoisted(() => {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string): void => {
            map.set(k, String(v));
        },
        removeItem: (k: string): void => {
            map.delete(k);
        },
        clear: (): void => map.clear(),
        key: (i: number): string | null => [...map.keys()][i] ?? null,
        get length(): number {
            return map.size;
        },
    };
    vi.stubGlobal('localStorage', storage);
    return { storage };
});

describe('persist write failure warning', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        appPersistStorage.unlockWrites();
    });

    it('notifies once per failure streak and again after a successful write', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const show = vi.fn<(failure: PersistWriteFailure) => void>();
        const off = installPersistWarning(show);
        const setItem = vi.spyOn(fake.storage, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });

        for (let i = 0; i < 4; i++) {
            appPersistStorage.setItem('t202-key', `v${i}`);
            appPersistStorage.flush();
        }
        expect(setItem).toHaveBeenCalledTimes(4);
        expect(show).toHaveBeenCalledTimes(1);
        expect(show.mock.calls[0][0]).toMatchObject({ kind: 'quota', key: 't202-key' });

        setItem.mockRestore();
        appPersistStorage.setItem('t202-key', 'ok');
        appPersistStorage.flush();
        expect(fake.storage.getItem('t202-key')).toBe('ok');
        expect(show).toHaveBeenCalledTimes(1);

        vi.spyOn(fake.storage, 'setItem').mockImplementation(() => {
            throw new Error('disk error');
        });
        appPersistStorage.setItem('t202-key', 'again');
        appPersistStorage.flush();
        expect(show).toHaveBeenCalledTimes(2);
        expect(show.mock.calls[1][0].kind).toBe('other');
        off();
    });

    it('does not notify while the storage is write-locked', () => {
        const show = vi.fn();
        const off = installPersistWarning(show);
        vi.spyOn(fake.storage, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        appPersistStorage.lockWrites('hydration-failed');
        appPersistStorage.setItem('t202-key', 'x');
        appPersistStorage.flush();
        expect(show).not.toHaveBeenCalled();
        off();
    });
});

describe('persist warning banner', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        hidePersistWarningBanner();
    });

    it('shows one banner for a failure streak and removes it on the first successful write', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const off = installPersistWarning((failure) => showPersistWarningBanner('en', failure), hidePersistWarningBanner);
        const setItem = vi.spyOn(fake.storage, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        for (let i = 0; i < 3; i++) {
            appPersistStorage.setItem('t202-key', `v${i}`);
            appPersistStorage.flush();
        }
        expect(document.querySelectorAll(`#${PERSIST_WARNING_BANNER_ID}`)).toHaveLength(1);
        expect(document.getElementById(PERSIST_WARNING_BANNER_ID)?.textContent).toContain('storage is full');

        setItem.mockRestore();
        appPersistStorage.setItem('t202-key', 'ok');
        appPersistStorage.flush();
        expect(document.getElementById(PERSIST_WARNING_BANNER_ID)).toBeNull();
        off();
    });
});
