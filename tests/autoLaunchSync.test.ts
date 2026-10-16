import { describe, expect, it } from 'vitest';
import { type LoginItem, syncAutoLaunch } from '../electron/lib/autoLaunchSync.cjs';
import { startAutoLaunchBootSync } from '../src/store/autoLaunchBootSync';

const NAME = 'com.eedali.kobar';
const EXE = 'C:\\Program Files\\KoBar\\KoBar.exe';
const ARGS = ['--hidden'];
const OLD = 'C:\\Users\\u\\AppData\\Local\\Programs\\kobar\\KoBar.exe';

function item(over: Partial<LoginItem>): LoginItem {
    return { name: NAME, path: EXE, args: ARGS, scope: 'user', enabled: true, ...over };
}

function run(desired: boolean, items: LoginItem[], explicit = false) {
    const calls: string[] = [];
    const result = syncAutoLaunch({
        desired,
        explicit,
        items,
        name: NAME,
        execPath: EXE,
        args: ARGS,
        register: () => calls.push('register'),
        remove: (n) => calls.push(`remove:${n}`),
    });
    return { result, calls };
}

describe('syncAutoLaunch', () => {
    it('does nothing when setting and OS agree', () => {
        const { result, calls } = run(true, [item({})]);
        expect(calls).toEqual([]);
        expect(result).toMatchObject({ enabled: true, action: 'none' });
        expect(run(false, []).result).toMatchObject({ enabled: false, action: 'none' });
    });

    it('registers when the setting is on but no entry exists (the 1.4.2 upgrade case)', () => {
        const stale = item({ name: 'electron.app.KoBar', path: OLD, args: ['--processStart'] });
        const { result, calls } = run(true, [stale]);
        expect(calls).toEqual(['remove:electron.app.KoBar', 'register']);
        expect(result).toMatchObject({ enabled: true, action: 'registered', removedStale: ['electron.app.KoBar'] });
    });

    it('repairs our entry when it points at another exe or has other arguments', () => {
        expect(run(true, [item({ path: OLD })]).calls).toEqual(['register']);
        expect(run(true, [item({ args: [] })]).calls).toEqual(['register']);
        expect(run(true, [item({ path: `"${EXE.toLowerCase()}"` })]).calls).toEqual([]);
    });

    it('removes duplicates of KoBar but never other apps', () => {
        const other = item({ name: 'Discord', path: 'C:\\Discord\\Update.exe', args: [] });
        const dup = item({ name: 'KoBarOld', path: OLD });
        const { calls } = run(true, [item({}), other, dup]);
        expect(calls).toEqual(['remove:KoBarOld']);
    });

    it('removes our entry and stale ones when the setting is off', () => {
        const { result, calls } = run(false, [item({}), item({ name: 'electron.app.KoBar', path: OLD })]);
        expect(calls).toEqual(['remove:electron.app.KoBar', `remove:${NAME}`]);
        expect(result).toMatchObject({ enabled: false, action: 'removed' });
    });

    it('follows a Task Manager switch-off instead of re-enabling it', () => {
        const { result, calls } = run(true, [item({ enabled: false })]);
        expect(calls).toEqual([]);
        expect(result).toMatchObject({ enabled: false, action: 'user-disabled' });
        const legacyOff = item({ name: 'electron.app.KoBar', path: OLD, enabled: false });
        expect(run(true, [legacyOff]).result).toMatchObject({ enabled: false, action: 'user-disabled' });
    });

    it('an explicit toggle re-enables a switched-off entry', () => {
        const { result, calls } = run(true, [item({ enabled: false })], true);
        expect(calls).toEqual(['register']);
        expect(result).toMatchObject({ enabled: true, action: 'repaired' });
    });
});

describe('startAutoLaunchBootSync', () => {
    function setup(hydrated: boolean, answer: { enabled: boolean } | null, desired = true) {
        let listener: (() => void) | undefined;
        const applied: boolean[] = [];
        const asked: boolean[] = [];
        startAutoLaunchBootSync({
            persist: { hasHydrated: () => hydrated, onFinishHydration: (l) => ((listener = l), () => undefined) },
            getDesired: () => desired,
            sync: async (d) => (asked.push(d), answer),
            apply: (e) => applied.push(e),
        });
        return { applied, asked, finish: () => listener?.() };
    }

    it('syncs once hydrated and applies a differing answer', async () => {
        const s = setup(false, { enabled: false });
        expect(s.asked).toEqual([]);
        s.finish();
        s.finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(s.asked).toEqual([true]);
        expect(s.applied).toEqual([false]);
    });

    it('ignores a null answer, an agreeing answer and a missing API', async () => {
        const a = setup(true, null);
        const b = setup(true, { enabled: true });
        await Promise.resolve();
        await Promise.resolve();
        expect(a.applied).toEqual([]);
        expect(b.applied).toEqual([]);
        expect(() =>
            startAutoLaunchBootSync({
                persist: { hasHydrated: () => true, onFinishHydration: () => () => undefined },
                getDesired: () => true,
                sync: undefined,
                apply: () => undefined,
            })
        ).not.toThrow();
    });
});
