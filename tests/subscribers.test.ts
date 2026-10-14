import { describe, expect, it } from 'vitest';
import { SubscriberSet } from '../electron/lib/subscribers.cjs';

describe('SubscriberSet', () => {
    it('signals start only for the first subscriber and stop only when the last one leaves', () => {
        const set = new SubscriberSet<number>();
        expect(set.add(1)).toBe(true);
        expect(set.add(2)).toBe(false);
        expect(set.size).toBe(2);
        expect(set.remove(1)).toBe(false);
        expect(set.remove(2)).toBe(true);
        expect(set.size).toBe(0);
    });

    it('counts each window once: repeated add is idempotent and one remove releases it', () => {
        const set = new SubscriberSet<number>();
        expect(set.add(7)).toBe(true);
        expect(set.add(7)).toBe(false);
        expect(set.size).toBe(1);
        expect(set.remove(7)).toBe(true);
        expect(set.has(7)).toBe(false);
    });

    it('ignores removing an unknown or already released key', () => {
        const set = new SubscriberSet<number>();
        expect(set.remove(3)).toBe(false);
        set.add(3);
        set.add(4);
        expect(set.remove(3)).toBe(false);
        expect(set.remove(3)).toBe(false);
        expect(set.values()).toEqual([4]);
        expect(set.remove(4)).toBe(true);
        expect(set.remove(4)).toBe(false);
    });

    it('can start again after it drained', () => {
        const set = new SubscriberSet<number>();
        set.add(1);
        set.remove(1);
        expect(set.add(1)).toBe(true);
    });
});
