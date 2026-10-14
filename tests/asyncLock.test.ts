// T-318: the single-flight queue behind the plugin install lock (electron/lib/asyncLock.cts).
import { describe, expect, it } from 'vitest';
import { createAsyncLock } from '../electron/lib/asyncLock.cjs';

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createAsyncLock', () => {
    it('runs critical sections one at a time, in call order, even when they await', async () => {
        const lock = createAsyncLock();
        const events: string[] = [];
        let active = 0;
        let maxActive = 0;
        const section = (name: string, waits: number) =>
            lock.run(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                events.push(`${name}:start`);
                for (let i = 0; i < waits; i++) await tick();
                events.push(`${name}:end`);
                active -= 1;
                return name;
            });
        const results = await Promise.all([section('a', 3), section('b', 1), section('c', 0)]);
        expect(results).toEqual(['a', 'b', 'c']);
        expect(maxActive).toBe(1);
        expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
        expect(lock.pending()).toBe(0);
    });

    it('a waiting section does not start before the holder finishes', async () => {
        const lock = createAsyncLock();
        const gate = deferred();
        let secondStarted = false;
        const first = lock.run(() => gate.promise);
        const second = lock.run(() => {
            secondStarted = true;
        });
        await tick();
        expect(secondStarted).toBe(false);
        expect(lock.pending()).toBe(2);
        gate.resolve();
        await first;
        await second;
        expect(secondStarted).toBe(true);
        expect(lock.pending()).toBe(0);
    });

    it('releases the lock when a section throws synchronously or rejects, and passes the error through', async () => {
        const lock = createAsyncLock();
        const thrown = lock.run(() => {
            throw new Error('sync boom');
        });
        const rejected = lock.run(async () => {
            await tick();
            throw new Error('async boom');
        });
        const after = lock.run(() => 'still runs');
        await expect(thrown).rejects.toThrow('sync boom');
        await expect(rejected).rejects.toThrow('async boom');
        await expect(after).resolves.toBe('still runs');
        expect(lock.pending()).toBe(0);
    });

    it('passes plain and promised results through unchanged', async () => {
        const lock = createAsyncLock();
        const shape = { success: false, reason: 'x' };
        await expect(lock.run(() => shape)).resolves.toBe(shape);
        await expect(lock.run(async () => shape)).resolves.toBe(shape);
        await expect(lock.run(() => Promise.resolve(42))).resolves.toBe(42);
    });

    it('separate locks do not wait for each other', async () => {
        const a = createAsyncLock();
        const b = createAsyncLock();
        const gate = deferred();
        const held = a.run(() => gate.promise);
        await expect(b.run(() => 'free')).resolves.toBe('free');
        gate.resolve();
        await held;
    });

    it('the destructured run function works on its own (as bootstrap uses it)', async () => {
        const { run } = createAsyncLock();
        const order: number[] = [];
        await Promise.all([
            run(async () => {
                await tick();
                order.push(1);
            }),
            run(() => {
                order.push(2);
            }),
        ]);
        expect(order).toEqual([1, 2]);
    });
});
