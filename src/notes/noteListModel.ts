export interface NoteListEntry {
    id: number;
    title: string;
    icon: string;
    emoji: string | null;
    /** Pseudo-notes (the plugin host) have no emoji picker. */
    pseudo: boolean;
    /** Plain text of the note body, used by the search only. */
    text?: string;
}

/** Number of notes the "Recent" filter shows (the newest by id; ids only grow, so id order is creation order). */
export const RECENT_NOTE_COUNT = 5;

const HUE_COUNT = 6;

/** Stable tonal hue (1..6) of a note id: `--kb-note-hue-N` in src/theme/canli.css. */
export function noteHueIndex(id: number): number {
    return (((Math.trunc(id) % HUE_COUNT) + HUE_COUNT) % HUE_COUNT) + 1;
}

/** First visible character of a title (code point aware), in upper case. */
export function noteInitial(title: string): string {
    const first = Array.from(title.trim())[0];
    return first ? first.toLocaleUpperCase() : '·';
}

export type NoteFilter = 'all' | 'recent';

/** Applies the filter chip, then the search (case-insensitive, title and body text). Pure; exported for tests. */
export function filterNoteEntries(entries: readonly NoteListEntry[], filter: NoteFilter, query: string): NoteListEntry[] {
    let result: NoteListEntry[] = [...entries];
    if (filter === 'recent') {
        result = result
            .filter((e) => !e.pseudo)
            .sort((a, b) => b.id - a.id)
            .slice(0, RECENT_NOTE_COUNT);
    }
    const q = query.trim().toLocaleLowerCase();
    if (q) result = result.filter((e) => e.title.toLocaleLowerCase().includes(q) || (e.text ?? '').toLocaleLowerCase().includes(q));
    return result;
}
