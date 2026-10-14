// R2-15: reads events of the PRIMARY Google calendar (events.list, read-only) and converts them to the small shape KoCalendar shows.
// `singleEvents=true` expands recurrences, so every returned item is one occurrence. Pure: `fetch` is injected (tests use fakes).
// Event titles are personal data: nothing here logs them, and failures are plain codes.
import type { IpcGcalEvent, IpcGcalRange } from '../../shared/ipc-contract.js' with { 'resolution-mode': 'import' };
import type { FetchLike } from './gcalOAuth.cjs';

export const GCAL_EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const PAGE_SIZE = 250;
const MAX_PAGES = 10;
export const GCAL_MAX_RANGE_DAYS = 400;

interface RawTime {
    date?: unknown;
    dateTime?: unknown;
    timeZone?: unknown;
}
export interface GoogleRawEvent {
    id?: unknown;
    status?: unknown;
    summary?: unknown;
    start?: RawTime;
    end?: RawTime;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function isoDate(ms: number): string {
    const d = new Date(ms);
    return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD` of the day before `date` (pure calendar arithmetic, no time zone involved). */
function previousDay(date: string): string | null {
    const m = DATE_ONLY.exec(date);
    if (!m) return null;
    return isoDate(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 24 * 3600 * 1000);
}

/** Offset of `timeZone` from UTC at the instant `ms` (milliseconds, east positive); null for an unknown zone. */
function zoneOffsetMs(ms: number, timeZone: string): number | null {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(new Date(ms));
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
        const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
        return asUtc - Math.floor(ms / 1000) * 1000;
    } catch {
        return null;
    }
}

function formatOffset(offsetMs: number): string {
    const sign = offsetMs < 0 ? '-' : '+';
    const minutes = Math.round(Math.abs(offsetMs) / 60000);
    return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * A local date-time without offset in `timeZone` -> ISO 8601 with that zone's offset at that moment (DST aware). For the repeated hour
 * of a fall-back change the first occurrence wins; for the skipped hour of a spring-forward change the offset before the change is used.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
    const m = LOCAL_DATE_TIME.exec(local);
    if (!m) return null;
    const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    const first = zoneOffsetMs(asUtc, timeZone);
    if (first === null) return null;
    const second = zoneOffsetMs(asUtc - first, timeZone);
    if (second === null) return null;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}${formatOffset(second)}`;
}

/** An ISO string with an explicit offset, from a Google `dateTime` (+ optional `timeZone`); null when it cannot be read. */
function timedValue(raw: RawTime | undefined): string | null {
    if (!raw || typeof raw.dateTime !== 'string') return null;
    const value = raw.dateTime;
    if (HAS_OFFSET.test(value)) return Number.isNaN(Date.parse(value)) ? null : value;
    if (typeof raw.timeZone === 'string') return zonedLocalToIso(value, raw.timeZone);
    return null;
}

/** One Google event -> KoCalendar shape; null for cancelled events and for anything malformed. */
export function convertEvent(raw: GoogleRawEvent): IpcGcalEvent | null {
    if (typeof raw !== 'object' || raw === null) return null;
    if (raw.status === 'cancelled') return null;
    if (typeof raw.id !== 'string' || raw.id === '') return null;
    const title = typeof raw.summary === 'string' ? raw.summary : '';
    const id = `google:${raw.id}`;

    const startDate = typeof raw.start?.date === 'string' ? raw.start.date : null;
    if (startDate !== null) {
        if (!DATE_ONLY.test(startDate)) return null;
        // Google's all-day `end.date` is EXCLUSIVE; KoCalendar wants the last day (inclusive).
        const endExclusive = typeof raw.end?.date === 'string' ? raw.end.date : null;
        let end = endExclusive !== null ? previousDay(endExclusive) : null;
        if (end === null || end < startDate) end = startDate;
        return { id, title, start: startDate, end, allDay: true, calendar: 'google' };
    }

    const start = timedValue(raw.start);
    if (start === null) return null;
    const end = timedValue(raw.end) ?? start;
    return { id, title, start, end, allDay: false, calendar: 'google' };
}

/** `{ from, to }` as valid ISO strings, from < to, at most GCAL_MAX_RANGE_DAYS; null otherwise. */
export function normalizeRange(range: unknown): { from: string; to: string } | null {
    if (typeof range !== 'object' || range === null) return null;
    const { from, to } = range as Partial<IpcGcalRange>;
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (Number.isNaN(a) || Number.isNaN(b) || a >= b) return null;
    if (b - a > GCAL_MAX_RANGE_DAYS * 24 * 3600 * 1000) return null;
    return { from: new Date(a).toISOString(), to: new Date(b).toISOString() };
}

export type FetchEventsResult = { ok: true; events: IpcGcalEvent[] } | { ok: false; error: 'unauthorized' | 'network' | 'failed' };

export async function fetchEvents(params: {
    fetch: FetchLike;
    accessToken: string;
    range: { from: string; to: string };
}): Promise<FetchEventsResult> {
    const events: IpcGcalEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
            timeMin: params.range.from,
            timeMax: params.range.to,
            singleEvents: 'true',
            orderBy: 'startTime',
            showDeleted: 'false',
            maxResults: String(PAGE_SIZE),
            fields: 'nextPageToken,items(id,status,summary,start,end)',
        });
        if (pageToken) query.set('pageToken', pageToken);
        let response;
        try {
            response = await params.fetch(`${GCAL_EVENTS_ENDPOINT}?${query.toString()}`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${params.accessToken}` },
            });
        } catch {
            return { ok: false, error: 'network' };
        }
        if (response.status === 401) return { ok: false, error: 'unauthorized' };
        if (!response.ok) return { ok: false, error: 'failed' };
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            return { ok: false, error: 'failed' };
        }
        const data = (typeof body === 'object' && body !== null ? body : {}) as { items?: unknown; nextPageToken?: unknown };
        if (Array.isArray(data.items)) {
            for (const item of data.items) {
                const converted = convertEvent(item as GoogleRawEvent);
                if (converted) events.push(converted);
            }
        }
        if (typeof data.nextPageToken === 'string' && data.nextPageToken !== '') pageToken = data.nextPageToken;
        else return { ok: true, events };
    }
    return { ok: true, events };
}
