import { describe, expect, it } from 'vitest';
import { createChangeFilter } from '../electron/lib/dedupe.cjs';

const track = { title: 'A', artist: 'B', albumArt: null, isPlaying: true, sourceAppId: 'spotify.exe' };

describe('createChangeFilter', () => {
    it('sends the first payload of a channel', () => {
        const f = createChangeFilter();
        expect(f.shouldSend('media-update', track)).toBe(true);
    });

    it('skips an identical payload (structurally equal, different object)', () => {
        const f = createChangeFilter();
        f.shouldSend('media-update', track);
        expect(f.shouldSend('media-update', { ...track })).toBe(false);
    });

    it('sends again when any field changes', () => {
        const f = createChangeFilter();
        f.shouldSend('media-update', track);
        expect(f.shouldSend('media-update', { ...track, isPlaying: false })).toBe(true);
        expect(f.shouldSend('media-update', { ...track, isPlaying: false, albumArt: 'data:x' })).toBe(true);
        expect(f.shouldSend('media-update', { ...track, isPlaying: false, albumArt: 'data:x', sourceAppId: 'chrome' })).toBe(true);
    });

    it('sends null (media stopped) once, and again after real media', () => {
        const f = createChangeFilter();
        f.shouldSend('media-update', track);
        expect(f.shouldSend('media-update', null)).toBe(true);
        expect(f.shouldSend('media-update', null)).toBe(false);
        expect(f.shouldSend('media-update', track)).toBe(true);
    });

    it('sends an empty list once, not every tick', () => {
        const f = createChangeFilter();
        expect(f.shouldSend('video-urls-update', [])).toBe(true);
        expect(f.shouldSend('video-urls-update', [])).toBe(false);
        expect(f.shouldSend('video-urls-update', ['https://a'])).toBe(true);
        expect(f.shouldSend('video-urls-update', ['https://a'])).toBe(false);
        expect(f.shouldSend('video-urls-update', [])).toBe(true);
    });

    it('tracks channels independently', () => {
        const f = createChangeFilter();
        f.shouldSend('a', 1);
        expect(f.shouldSend('b', 1)).toBe(true);
        expect(f.shouldSend('a', 1)).toBe(false);
    });

    it('reset makes every channel resend its current payload', () => {
        const f = createChangeFilter();
        f.shouldSend('media-update', track);
        f.shouldSend('video-urls-update', []);
        f.reset();
        expect(f.shouldSend('media-update', track)).toBe(true);
        expect(f.shouldSend('video-urls-update', [])).toBe(true);
        expect(f.shouldSend('media-update', track)).toBe(false);
    });
});

describe('ChangeFilter last()', () => {
    it('returns nothing before a send and the last payload after', () => {
        const f = createChangeFilter();
        expect(f.last('c')).toBeUndefined();
        f.shouldSend('c', track);
        f.shouldSend('c', { ...track, isPlaying: false });
        expect(f.last('c')).toEqual({ payload: { ...track, isPlaying: false } });
    });

    it('distinguishes a stored null / empty list from nothing, and clears on reset', () => {
        const f = createChangeFilter();
        f.shouldSend('m', null);
        f.shouldSend('v', []);
        expect(f.last('m')).toEqual({ payload: null });
        expect(f.last('v')).toEqual({ payload: [] });
        f.reset();
        expect(f.last('m')).toBeUndefined();
    });

    it('normalises undefined to null', () => {
        const f = createChangeFilter();
        expect(f.shouldSend('k', undefined)).toBe(true);
        expect(f.shouldSend('k', null)).toBe(false);
        expect(f.last('k')).toEqual({ payload: null });
    });
});
