import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_LIMITS, type BarItemChange } from '../shared/barPresentation';
import {
    barClear,
    barDropExtension,
    barOnItemChange,
    barRegisterButton,
    barRegisterManifest,
    barSetItemState,
    getBarItemSnapshot,
    manifestDefaultSize,
    mergeTileDeclaration,
    reportTileRenderError,
    resetBarPresentationForTests,
    sanitizeBarItemState,
    setBarHostContext,
    setBarItemPresentation,
    subscribeBarItem,
} from '../src/components/extensions/barPresentation';

// Canlı: host-side bar presentation store (sanitising, throttling, heartbeat, visibility, change listeners).

const state = (id: string) => getBarItemSnapshot(id).state;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    resetBarPresentationForTests();
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('sanitizeBarItemState', () => {
    it('requires a label', () => {
        expect(sanitizeBarItemState({ value: '1' })).toBeNull();
        expect(sanitizeBarItemState({ label: '  ' })).toBeNull();
        expect(sanitizeBarItemState(null)).toBeNull();
        expect(sanitizeBarItemState('x')).toBeNull();
    });

    it('cuts a label longer than 80 characters with an ellipsis', () => {
        const out = sanitizeBarItemState({ label: 'a'.repeat(120) });
        expect(Array.from(out!.label)).toHaveLength(BAR_LIMITS.labelChars);
        expect(out!.label.endsWith('…')).toBe(true);
        expect(sanitizeBarItemState({ label: 'a'.repeat(80) })!.label).toBe('a'.repeat(80));
    });

    it('replaces over-long value, caption and sub with a dash', () => {
        const out = sanitizeBarItemState({ label: 'x', value: '123456', caption: 'abcde', sub: 'abcde' });
        expect(out).toMatchObject({ value: '—', caption: '—', sub: '—' });
        const ok = sanitizeBarItemState({ label: 'x', value: '12345', caption: 'abcd', sub: 'abcd' });
        expect(ok).toMatchObject({ value: '12345', caption: 'abcd', sub: 'abcd' });
    });

    it('counts visible characters, not code units', () => {
        const five = '\u{1F600}'.repeat(5);
        expect(sanitizeBarItemState({ label: 'x', value: five })!.value).toBe(five);
    });

    it('warns once per id and field in development', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        barSetItemState('w', { label: 'x', value: '1234567' });
        vi.advanceTimersByTime(2000);
        barSetItemState('w', { label: 'x', value: '7654321' });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('clamps progress and levels, rejects bad levels', () => {
        expect(sanitizeBarItemState({ label: 'x', progress: 7 })!.progress).toBe(1);
        expect(sanitizeBarItemState({ label: 'x', progress: -1 })!.progress).toBe(0);
        expect(sanitizeBarItemState({ label: 'x', progress: NaN })!.progress).toBeUndefined();
        expect(sanitizeBarItemState({ label: 'x', levels: [2, -1, 0.5] })!.levels).toEqual([1, 0, 0.5]);
        expect(sanitizeBarItemState({ label: 'x', levels: [1, 1] })!.levels).toBeUndefined();
        expect(sanitizeBarItemState({ label: 'x', levels: [1, 1, 1, 1, 1, 1] })!.levels).toBeUndefined();
    });

    it('clamps slots', () => {
        expect(sanitizeBarItemState({ label: 'x', slots: { filled: 30, total: 30, next: 40 } })!.slots).toEqual({
            filled: 12,
            total: 12,
            next: 11,
        });
        expect(sanitizeBarItemState({ label: 'x', slots: { filled: -2, total: 4 } })!.slots).toEqual({
            filled: 0,
            total: 4,
        });
        expect(sanitizeBarItemState({ label: 'x', slots: { total: 4 } })!.slots).toBeUndefined();
    });

    it('accepts badge numbers of 0 or more and dot only', () => {
        expect(sanitizeBarItemState({ label: 'x', badge: 0 })!.badge).toBe(0);
        expect(sanitizeBarItemState({ label: 'x', badge: 120 })!.badge).toBe(120);
        expect(sanitizeBarItemState({ label: 'x', badge: 'dot' })!.badge).toBe('dot');
        expect(sanitizeBarItemState({ label: 'x', badge: -1 })!.badge).toBeUndefined();
        expect(sanitizeBarItemState({ label: 'x', badge: 'many' })!.badge).toBeUndefined();
    });

    it('checks tone, icon and playing', () => {
        expect(sanitizeBarItemState({ label: 'x', tone: 'error' })!.tone).toBe('error');
        expect(sanitizeBarItemState({ label: 'x', tone: 'loud' })!.tone).toBeUndefined();
        expect(sanitizeBarItemState({ label: 'x', icon: 'pause' })!.icon).toBe('pause');
        expect(sanitizeBarItemState({ label: 'x', icon: 3 })!.icon).toBeUndefined();
        expect(sanitizeBarItemState({ label: 'x', playing: 'yes' })!.playing).toBeUndefined();
    });

    it('drops unknown fields', () => {
        expect(Object.keys(sanitizeBarItemState({ label: 'x', evil: 1 })!)).toEqual(['label']);
    });
});

describe('throttling', () => {
    it('applies the first update at once', () => {
        barSetItemState('t', { label: 'a', value: '1' });
        expect(state('t')?.value).toBe('1');
    });

    it('limits text changes to one per second, trailing latest wins', () => {
        barSetItemState('t', { label: 'a', value: '1' });
        barSetItemState('t', { label: 'a', value: '2' });
        barSetItemState('t', { label: 'a', value: '3' });
        expect(state('t')?.value).toBe('1');
        vi.advanceTimersByTime(999);
        expect(state('t')?.value).toBe('1');
        vi.advanceTimersByTime(1);
        expect(state('t')?.value).toBe('3');
    });

    it('never drops the final state', () => {
        barSetItemState('t', { label: 'a', value: '1' });
        for (let i = 2; i <= 20; i++) {
            vi.advanceTimersByTime(30);
            barSetItemState('t', { label: 'a', value: String(i) });
        }
        vi.advanceTimersByTime(5000);
        expect(state('t')?.value).toBe('20');
    });

    it('limits progress-only changes to four per second', () => {
        barSetItemState('p', { label: 'a', progress: 0.1 });
        vi.advanceTimersByTime(300);
        barSetItemState('p', { label: 'a', progress: 0.2 });
        expect(state('p')?.progress).toBe(0.2);
        vi.advanceTimersByTime(100);
        barSetItemState('p', { label: 'a', progress: 0.3 });
        barSetItemState('p', { label: 'a', progress: 0.4 });
        expect(state('p')?.progress).toBe(0.2);
        vi.advanceTimersByTime(150);
        expect(state('p')?.progress).toBe(0.4);
    });

    it('lets a progress update through while a text change would wait', () => {
        barSetItemState('m', { label: 'a', value: '1', progress: 0 });
        vi.advanceTimersByTime(300);
        barSetItemState('m', { label: 'a', value: '1', progress: 0.5 });
        expect(state('m')?.progress).toBe(0.5);
    });

    it('does not notify subscribers when nothing changed', () => {
        barSetItemState('n', { label: 'a', value: '1' });
        const listener = vi.fn();
        subscribeBarItem('n', listener);
        vi.advanceTimersByTime(5000);
        barSetItemState('n', { label: 'a', value: '1' });
        expect(listener).not.toHaveBeenCalled();
    });

    it('keeps snapshot identity until something changes', () => {
        barSetItemState('s', { label: 'a' });
        const first = getBarItemSnapshot('s');
        expect(getBarItemSnapshot('s')).toBe(first);
    });
});

describe('heartbeat', () => {
    const live = (id: string) => barRegisterButton(id, null, { template: 'ring', live: true });

    it('marks a live tile stale after 10 s without an update and clears it on the next', () => {
        live('h');
        barSetItemState('h', { label: 'a', value: '1' });
        vi.advanceTimersByTime(BAR_LIMITS.heartbeatMs - 1);
        expect(getBarItemSnapshot('h').stale).toBe(false);
        vi.advanceTimersByTime(1);
        expect(getBarItemSnapshot('h').stale).toBe(true);
        expect(state('h')?.value).toBe('1');
        barSetItemState('h', { label: 'a', value: '1' });
        expect(getBarItemSnapshot('h').stale).toBe(false);
    });

    it('an unchanged update still counts as a heartbeat', () => {
        live('h');
        barSetItemState('h', { label: 'a', value: '1' });
        vi.advanceTimersByTime(9000);
        barSetItemState('h', { label: 'a', value: '1' });
        vi.advanceTimersByTime(9000);
        expect(getBarItemSnapshot('h').stale).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(getBarItemSnapshot('h').stale).toBe(true);
    });

    it('does not apply to tiles that are not live or not visible', () => {
        barRegisterButton('n', null, { template: 'ring' });
        barSetItemState('n', { label: 'a' });
        live('h');
        barSetItemState('h', { label: 'a' });
        setBarHostContext({ barVisible: false });
        vi.advanceTimersByTime(60_000);
        expect(getBarItemSnapshot('n').stale).toBe(false);
        expect(getBarItemSnapshot('h').stale).toBe(false);
        setBarHostContext({ barVisible: true });
        vi.advanceTimersByTime(9000);
        expect(getBarItemSnapshot('h').stale).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(getBarItemSnapshot('h').stale).toBe(true);
    });
});

describe('onBarItemChange', () => {
    it('fires once immediately with the current values', () => {
        const calls: BarItemChange[] = [];
        barOnItemChange('c', (c) => calls.push(c));
        expect(calls).toEqual([{ size: 'icon', visible: true, privacy: false, locale: 'en', autoCollapsed: false }]);
    });

    it('fires again only when a value changed', () => {
        const listener = vi.fn();
        barOnItemChange('c', listener);
        setBarItemPresentation('c', { size: 'icon' });
        setBarHostContext({ privacy: false });
        barSetItemState('c', { label: 'x' });
        expect(listener).toHaveBeenCalledTimes(1);
        setBarItemPresentation('c', { size: 'tile' });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'tile' }));
        setBarItemPresentation('c', { size: 'tile', autoCollapsed: true });
        setBarHostContext({ locale: 'tr' });
        setBarHostContext({ barVisible: false });
        expect(listener).toHaveBeenCalledTimes(5);
        expect(listener).toHaveBeenLastCalledWith({
            size: 'tile',
            visible: false,
            privacy: false,
            locale: 'tr',
            autoCollapsed: true,
        });
    });

    it('unsubscribes', () => {
        const listener = vi.fn();
        const off = barOnItemChange('c', listener);
        off();
        setBarHostContext({ locale: 'de' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('catches listener exceptions', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const bad = vi.fn(() => {
            throw new Error('boom');
        });
        const good = vi.fn();
        expect(() => barOnItemChange('c', bad)).not.toThrow();
        barOnItemChange('c', good);
        expect(() => setBarHostContext({ locale: 'fr' })).not.toThrow();
        expect(good).toHaveBeenCalledTimes(2);
        expect(err).toHaveBeenCalled();
    });
});

describe('visibility and privacy', () => {
    it('hides sensitive items in privacy mode only', () => {
        barRegisterButton('s', null, { sensitive: true });
        barRegisterButton('o', null, {});
        expect(getBarItemSnapshot('s').visible).toBe(true);
        setBarHostContext({ privacy: true });
        expect(getBarItemSnapshot('s').visible).toBe(false);
        expect(getBarItemSnapshot('o').visible).toBe(true);
        setBarHostContext({ privacy: false });
        expect(getBarItemSnapshot('s').visible).toBe(true);
    });

    it('hides everything while the bar is not visible', () => {
        barRegisterButton('o', null, {});
        setBarHostContext({ barVisible: false });
        expect(getBarItemSnapshot('o').visible).toBe(false);
    });

    it('tells a sensitive item listener about privacy mode', () => {
        barRegisterButton('s', null, { sensitive: true });
        const listener = vi.fn();
        barOnItemChange('s', listener);
        setBarHostContext({ privacy: true });
        expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, privacy: true }));
    });
});

describe('custom render error budget', () => {
    it('disables custom render after 3 errors within 60 s', () => {
        reportTileRenderError('r');
        reportTileRenderError('r');
        expect(getBarItemSnapshot('r').customDisabled).toBe(false);
        reportTileRenderError('r');
        expect(getBarItemSnapshot('r').customDisabled).toBe(true);
    });

    it('forgets errors older than 60 s', () => {
        reportTileRenderError('r');
        reportTileRenderError('r');
        vi.advanceTimersByTime(61_000);
        reportTileRenderError('r');
        expect(getBarItemSnapshot('r').customDisabled).toBe(false);
    });
});

describe('cleanup', () => {
    it('barDropExtension removes state, timers and listeners of its items', () => {
        barRegisterManifest('plug', { bar: { defaultSize: 'tile' } });
        barRegisterButton('b', 'plug', { template: 'ring', live: true });
        barSetItemState('b', { label: 'a', value: '1' });
        barSetItemState('b', { label: 'a', value: '2' });
        const listener = vi.fn();
        barOnItemChange('b', listener);
        barDropExtension('plug');
        vi.advanceTimersByTime(60_000);
        setBarHostContext({ locale: 'ja' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getBarItemSnapshot('b').state).toBeNull();
        expect(manifestDefaultSize('b')).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('barClear drops everything but keeps a mounted subscription usable', () => {
        barRegisterButton('b', null, { template: 'ring' });
        barSetItemState('b', { label: 'a' });
        const sub = vi.fn();
        subscribeBarItem('b', sub);
        barClear();
        expect(sub).toHaveBeenCalled();
        expect(getBarItemSnapshot('b').state).toBeNull();
        sub.mockClear();
        barSetItemState('b', { label: 'again' });
        expect(sub).toHaveBeenCalled();
    });
});

describe('declaration merge and default size', () => {
    it('registration tile wins over the manifest, unknown fields are dropped', () => {
        const merged = mergeTileDeclaration(
            { template: 'ring', sensitive: true, live: true, junk: 1 },
            { template: 'badge', pinnable: true, junk: 2 }
        );
        expect(merged).toEqual({ template: 'badge', sensitive: true, live: true, pinnable: true });
    });

    it('an invalid template falls back to the label template', () => {
        expect(mergeTileDeclaration(undefined, { template: 'sparkle', live: true })).toEqual({ live: true });
        expect(mergeTileDeclaration({ template: 'custom' }, undefined)).toEqual({});
    });

    it('keeps render only for the custom template', () => {
        const render = () => null;
        expect(mergeTileDeclaration(undefined, { template: 'custom', render }).render).toBe(render);
        expect(mergeTileDeclaration(undefined, { template: 'ring', render }).render).toBeUndefined();
    });

    it('uses the owner plugin manifest and answers manifestDefaultSize', () => {
        barRegisterManifest('plug', { bar: { tile: { template: 'meter', sensitive: true }, defaultSize: 'tile' } });
        barRegisterButton('b', 'plug', undefined);
        expect(getBarItemSnapshot('b').declaration).toEqual({ template: 'meter', sensitive: true });
        expect(manifestDefaultSize('b')).toBe('tile');
        expect(manifestDefaultSize('unknown')).toBeUndefined();
    });

    it('ignores an invalid manifest bar block', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        barRegisterManifest('plug', { bar: 'nope' });
        barRegisterButton('b', 'plug', undefined);
        expect(getBarItemSnapshot('b').declaration).toEqual({});
        expect(manifestDefaultSize('b')).toBeUndefined();
    });

    it('applies a manifest registered after the button', () => {
        barRegisterButton('b', 'plug', undefined);
        barRegisterManifest('plug', { bar: { tile: { template: 'ring' } } });
        expect(getBarItemSnapshot('b').declaration.template).toBe('ring');
    });
});

describe('hostile input (review CNL-06)', () => {
    it('a tile with a throwing getter never makes registration throw', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const tile = {
            get template(): string {
                throw new Error('boom');
            },
        };
        expect(() => barRegisterButton('hostile-btn', null, tile)).not.toThrow();
        expect(() =>
            barRegisterManifest('hostile', {
                bar: new Proxy(
                    {},
                    {
                        ownKeys: () => {
                            throw new Error('boom');
                        },
                    }
                ),
            })
        ).not.toThrow();
    });

    it('rejects huge values before segmenting and cuts huge labels', () => {
        barSetItemState('big-btn', { label: 'x'.repeat(5_000_000), value: 'y'.repeat(5_000_000) });
        const s = state('big-btn')!;
        expect(Array.from(s.label).length).toBe(BAR_LIMITS.labelChars);
        expect(s.value).toBe('—');
    });

    it('arbitrary ids without a button cannot grow the store without bound', () => {
        for (let i = 0; i < 1000; i++) barSetItemState(`junk-${i}`, { label: 'x' });
        expect(getBarItemSnapshot('junk-999').state).toBeNull();
        expect(getBarItemSnapshot('junk-0').state).not.toBeNull();
        // A registered button always gets its state, even past the cap.
        barRegisterButton('real-btn', null, undefined);
        barSetItemState('real-btn', { label: 'Real' });
        expect(state('real-btn')?.label).toBe('Real');
    });
});
