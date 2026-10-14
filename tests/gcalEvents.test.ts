// R2-15: Google events -> KoCalendar shape (all-day inclusive end, time zones, DST, cancelled events, paging). No network.
import { describe, expect, it } from 'vitest';
import { convertEvent, fetchEvents, normalizeRange, zonedLocalToIso } from '../electron/lib/gcalEvents.cjs';
import type { FetchLike } from '../electron/lib/gcalOAuth.cjs';

describe('convertEvent', () => {
    it('makes the exclusive all-day end inclusive', () => {
        expect(convertEvent({ id: 'a', summary: 'Trip', start: { date: '2026-03-10' }, end: { date: '2026-03-13' } })).toEqual({
            id: 'google:a',
            title: 'Trip',
            start: '2026-03-10',
            end: '2026-03-12',
            allDay: true,
            calendar: 'google',
        });
        // a one-day event: end.date is the next day, so start == end
        expect(convertEvent({ id: 'b', start: { date: '2026-12-31' }, end: { date: '2027-01-01' } })).toMatchObject({
            start: '2026-12-31',
            end: '2026-12-31',
            title: '',
        });
    });

    it('keeps an explicit offset as is', () => {
        expect(
            convertEvent({
                id: 'c',
                summary: 'x',
                start: { dateTime: '2026-05-01T10:00:00+03:00' },
                end: { dateTime: '2026-05-01T11:00:00+03:00' },
            })
        ).toMatchObject({ start: '2026-05-01T10:00:00+03:00', end: '2026-05-01T11:00:00+03:00', allDay: false });
    });

    it('resolves a zone-only date-time with the offset of that zone', () => {
        expect(
            convertEvent({
                id: 'd',
                start: { dateTime: '2026-07-01T09:00:00', timeZone: 'Europe/Istanbul' },
                end: { dateTime: '2026-07-01T10:00:00', timeZone: 'Europe/Istanbul' },
            })
        ).toMatchObject({ start: '2026-07-01T09:00:00+03:00', end: '2026-07-01T10:00:00+03:00' });
    });

    it('drops cancelled and malformed events', () => {
        expect(convertEvent({ id: 'e', status: 'cancelled', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } })).toBeNull();
        expect(convertEvent({ start: { date: '2026-01-01' } })).toBeNull();
        expect(convertEvent({ id: 'f' })).toBeNull();
        expect(convertEvent({ id: 'g', start: { dateTime: 'garbage', timeZone: 'Nowhere/Land' } })).toBeNull();
    });
});

describe('zonedLocalToIso (DST)', () => {
    it('uses the standard offset before the spring-forward change and the daylight offset after it', () => {
        // America/New_York 2026-03-08 02:00 EST -> 03:00 EDT
        expect(zonedLocalToIso('2026-03-08T01:30:00', 'America/New_York')).toBe('2026-03-08T01:30:00-05:00');
        expect(zonedLocalToIso('2026-03-08T03:30:00', 'America/New_York')).toBe('2026-03-08T03:30:00-04:00');
        expect(zonedLocalToIso('2026-03-08T12:00:00', 'America/New_York')).toBe('2026-03-08T12:00:00-04:00');
    });

    it('handles the fall-back change (first occurrence of the repeated hour wins)', () => {
        // America/New_York 2026-11-01 02:00 EDT -> 01:00 EST
        expect(zonedLocalToIso('2026-11-01T00:30:00', 'America/New_York')).toBe('2026-11-01T00:30:00-04:00');
        expect(zonedLocalToIso('2026-11-01T01:30:00', 'America/New_York')).toBe('2026-11-01T01:30:00-04:00');
        expect(zonedLocalToIso('2026-11-01T03:00:00', 'America/New_York')).toBe('2026-11-01T03:00:00-05:00');
    });

    it('returns null for an unknown zone or a bad date', () => {
        expect(zonedLocalToIso('2026-03-08T01:30:00', 'Nowhere/Land')).toBeNull();
        expect(zonedLocalToIso('nope', 'UTC')).toBeNull();
    });
});

describe('normalizeRange', () => {
    it('accepts a sane range and rejects reversed, huge and malformed ones', () => {
        expect(normalizeRange({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })).toEqual({
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-02-01T00:00:00.000Z',
        });
        expect(normalizeRange({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })).toBeNull();
        expect(normalizeRange({ from: '2020-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })).toBeNull();
        expect(normalizeRange({ from: 'x', to: 'y' })).toBeNull();
        expect(normalizeRange(null)).toBeNull();
    });
});

describe('fetchEvents', () => {
    const range = { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' };

    it('follows pages, asks for the primary calendar with singleEvents and drops cancelled items', async () => {
        const urls: string[] = [];
        const fetchFn: FetchLike = async (url, init) => {
            urls.push(url);
            expect(init?.headers?.Authorization).toBe('Bearer tok');
            const page2 = new URL(url).searchParams.get('pageToken') === 'p2';
            return {
                ok: true,
                status: 200,
                json: async () =>
                    page2
                        ? { items: [{ id: '3', summary: 'C', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }] }
                        : {
                              nextPageToken: 'p2',
                              items: [
                                  {
                                      id: '1',
                                      summary: 'A',
                                      start: { dateTime: '2026-01-02T10:00:00Z' },
                                      end: { dateTime: '2026-01-02T11:00:00Z' },
                                  },
                                  { id: '2', status: 'cancelled', start: { date: '2026-01-03' }, end: { date: '2026-01-04' } },
                              ],
                          },
            };
        };
        const result = await fetchEvents({ fetch: fetchFn, accessToken: 'tok', range });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.events.map((e) => e.id)).toEqual(['google:1', 'google:3']);
        expect(urls).toHaveLength(2);
        const first = new URL(urls[0]);
        expect(first.pathname).toBe('/calendar/v3/calendars/primary/events');
        expect(first.searchParams.get('singleEvents')).toBe('true');
        expect(first.searchParams.get('orderBy')).toBe('startTime');
    });

    it('reports 401 as unauthorized and network errors as network', async () => {
        expect(
            await fetchEvents({ fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }), accessToken: 't', range })
        ).toEqual({
            ok: false,
            error: 'unauthorized',
        });
        expect(
            await fetchEvents({
                fetch: async () => {
                    throw new Error('offline');
                },
                accessToken: 't',
                range,
            })
        ).toEqual({ ok: false, error: 'network' });
    });
});
