// T-616: note panel list + editor layout: list rows, selection, close/add callbacks, stale activeNoteId.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteList } from '../src/notes/NoteList';
import { filterNoteEntries, noteHueIndex, noteInitial, type NoteListEntry } from '../src/notes/noteListModel';
import { cleanup, render } from './ui/render';

const labels = {
    list: 'Notes',
    title: 'Notes heading',
    add: 'Add note',
    import: 'Import',
    changeIcon: 'Change icon',
    close: 'Close',
    resize: 'Resize',
    search: 'Search notes',
    noMatch: 'No match',
    filterAll: 'All',
    filterRecent: 'Recent',
};
const entries: NoteListEntry[] = [
    { id: 1, title: 'Ideas', icon: 'note', emoji: null, pseudo: false, text: 'launch the rocket' },
    { id: 2, title: 'Todo', icon: 'note', emoji: '📝', pseudo: false },
    { id: 3, title: 'Plugins', icon: 'extension', emoji: null, pseudo: true },
];

function setup(activeNoteId: number | null) {
    const fns = {
        onSelect: vi.fn(),
        onAdd: vi.fn(),
        onImport: vi.fn(),
        onClose: vi.fn(),
        onChangeIcon: vi.fn(),
        width: 192,
        onWidthChange: vi.fn(),
        onWidthReset: vi.fn(),
    };
    const r = render(
        <div className="flex">
            <NoteList entries={entries} activeNoteId={activeNoteId} labels={labels} {...fns} />
            <main data-testid="editor" />
        </div>
    );
    return { ...r, ...fns };
}

afterEach(cleanup);

describe('NoteList', () => {
    it('renders a labelled list with one row per note next to the editor area', () => {
        const { host } = setup(1);
        const list = host.querySelector('ul[aria-label="Notes"]');
        expect(list?.querySelectorAll('li')).toHaveLength(3);
        expect(host.querySelector('[data-testid="editor"]')).not.toBeNull();
    });

    it('marks only the active note as current and survives an activeNoteId without a note', () => {
        const { host } = setup(2);
        const current = host.querySelectorAll('[aria-current]');
        expect(current).toHaveLength(1);
        expect(current[0].closest('li')?.getAttribute('data-note-id')).toBe('2');
        cleanup();
        const stale = setup(999);
        expect(stale.host.querySelectorAll('[aria-current]')).toHaveLength(0);
        expect(stale.host.querySelectorAll('li')).toHaveLength(3);
    });

    it('selects a note on click and wires add, close and change-icon; pseudo-notes have no icon picker', () => {
        const { host, onSelect, onAdd, onClose, onChangeIcon } = setup(1);
        const row = host.querySelector('li[data-note-id="2"]')!;
        act(() => (row.querySelector('button[aria-current], button') as HTMLButtonElement).click());
        expect(onSelect).toHaveBeenCalledWith(2);
        act(() => (row.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
        expect(onClose).toHaveBeenCalledWith(2, expect.anything());
        act(() => (row.querySelector('button[aria-label="Change icon"]') as HTMLButtonElement).click());
        expect(onChangeIcon).toHaveBeenCalledWith(2, expect.anything());
        act(() => (host.querySelector('button[aria-label="Add note"]') as HTMLButtonElement).click());
        expect(onAdd).toHaveBeenCalled();
        const pseudo = host.querySelector('li[data-note-id="3"]')!;
        expect(pseudo.querySelector('button[aria-label="Change icon"]')).toBeNull();
        expect(pseudo.querySelector('button[aria-label="Close"]')).not.toBeNull();
    });

    it('shows the heading and a labelled add button in the header', () => {
        const { host } = setup(1);
        expect(host.querySelector('h2')?.textContent).toBe('Notes heading');
        expect(host.querySelector('button[aria-label="Add note"]')).not.toBeNull();
    });

    it('filters by title and by body text and shows a status when nothing matches', () => {
        const { host } = setup(1);
        const input = host.querySelector('input') as HTMLInputElement;
        const type = (value: string) =>
            act(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        type('todo');
        expect(host.querySelectorAll('li[data-note-id]')).toHaveLength(1);
        type('ROCKET');
        expect(host.querySelector('li[data-note-id="1"]')).not.toBeNull();
        expect(host.querySelectorAll('li[data-note-id]')).toHaveLength(1);
        type('zzz');
        expect(host.querySelectorAll('li[data-note-id]')).toHaveLength(0);
        expect(host.querySelector('li[role="status"]')?.textContent).toBe('No match');
    });

    it('toggles the All and Recent chips and keeps pseudo notes out of Recent', () => {
        const { host } = setup(1);
        const chip = (name: string) =>
            [...host.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement;
        expect(chip('All').getAttribute('aria-pressed')).toBe('true');
        act(() => chip('Recent').click());
        expect(chip('Recent').getAttribute('aria-pressed')).toBe('true');
        expect(chip('All').getAttribute('aria-pressed')).toBe('false');
        expect(host.querySelector('li[data-note-id="3"]')).toBeNull();
        expect(host.querySelectorAll('li[data-note-id]')).toHaveLength(2);
    });
});

describe('note list helpers', () => {
    it('picks a stable hue 1..6 and an upper-case initial', () => {
        expect(noteHueIndex(1)).toBe(noteHueIndex(1));
        for (const id of [0, 1, 7, 12345, -3]) expect(noteHueIndex(id)).toBeGreaterThanOrEqual(1);
        expect(noteHueIndex(6)).toBeLessThanOrEqual(6);
        expect(noteInitial('  ideas')).toBe('I');
        expect(noteInitial('')).toBe('·');
    });

    it('limits Recent to the newest notes and matches body text case-insensitively', () => {
        const many: NoteListEntry[] = Array.from({ length: 8 }, (_, i) => ({
            id: i + 1,
            title: 'N' + i,
            icon: 'note',
            emoji: null,
            pseudo: false,
        }));
        expect(filterNoteEntries(many, 'recent', '').map((e) => e.id)).toEqual([8, 7, 6, 5, 4]);
        expect(filterNoteEntries(entries, 'all', 'ROCKET').map((e) => e.id)).toEqual([1]);
    });
});
