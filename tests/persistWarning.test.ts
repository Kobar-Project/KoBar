import { describe, expect, it, vi } from 'vitest';
import { createDebouncedStorage, type StorageLike } from '../src/store/persistStorage';
import { buildPersistWarning, classifyWriteError, createFailureStreak, isQuotaExceededError } from '../src/store/persistWarning';

// T-202: pure parts of the persist-failure warning. Synthetic data only.

describe('createFailureStreak', () => {
    it('notifies on the first failure only and re-arms after a success', () => {
        const streak = createFailureStreak();
        expect(streak.failure()).toBe(true);
        expect(streak.failure()).toBe(false);
        expect(streak.failure()).toBe(false);
        expect(streak.isActive()).toBe(true);
        streak.success();
        expect(streak.isActive()).toBe(false);
        expect(streak.failure()).toBe(true);
    });
});

describe('quota detection', () => {
    it('detects QuotaExceededError by name and legacy codes', () => {
        expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
        expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
        expect(isQuotaExceededError({ code: 22 })).toBe(true);
        expect(isQuotaExceededError({ code: 1014 })).toBe(true);
        expect(isQuotaExceededError(new Error('boom'))).toBe(false);
        expect(isQuotaExceededError(null)).toBe(false);
        expect(isQuotaExceededError('QuotaExceededError')).toBe(false);
    });

    it('classifies errors with a structured payload', () => {
        expect(classifyWriteError({ name: 'QuotaExceededError' }, 'k')).toMatchObject({ kind: 'quota', key: 'k' });
        const other = classifyWriteError(new Error('disk gone'), 'k');
        expect(other).toEqual({ kind: 'other', message: 'disk gone', key: 'k' });
    });
});

describe('buildPersistWarning', () => {
    it('uses the storage-is-full wording for quota failures and the generic one otherwise', () => {
        const quota = buildPersistWarning('en', { kind: 'quota', message: 'm', key: 'k' });
        expect(quota.body).toContain('storage is full');
        expect(quota.body).toContain('delete notes, images or other content');
        const other = buildPersistWarning('en', { kind: 'other', message: 'm', key: 'k' });
        expect(other.body).not.toContain('storage is full');
        expect(other.body).toContain('back up');
        expect(other.body).toContain('restart the app');
        expect(other.body).not.toContain('free some space');
    });
});

describe('write lock', () => {
    it('a locked storage never reports a write error', () => {
        const base: StorageLike = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException('quota', 'QuotaExceededError');
            },
            removeItem: () => {},
        };
        const onError = vi.fn();
        const storage = createDebouncedStorage(() => base, { onError });
        storage.lockWrites('hydration-failed');
        storage.setItem('k', 'v');
        storage.flush();
        expect(onError).not.toHaveBeenCalled();
    });
});

describe('success handler', () => {
    it('a throwing onSuccess is not reported as a write error and the value is still written', () => {
        const map = new Map<string, string>();
        const base: StorageLike = {
            getItem: (k) => map.get(k) ?? null,
            setItem: (k, v) => {
                map.set(k, v);
            },
            removeItem: (k) => {
                map.delete(k);
            },
        };
        const onError = vi.fn();
        const onSuccess = vi.fn(() => {
            throw new Error('handler bug');
        });
        const storage = createDebouncedStorage(() => base, { onError, onSuccess });
        storage.setItem('k', 'v');
        expect(() => storage.flush()).not.toThrow();
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(map.get('k')).toBe('v');
    });
});
