// T-616: note panel list + editor layout: list rows, selection, close/add callbacks, stale activeNoteId.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteList, type NoteListEntry } from '../src/notes/NoteList';
import { cleanup, render } from './ui/render';

const labels = { list: 'Notes', add: 'Add note', import: 'Import', changeIcon: 'Change icon', close: 'Close', resize: 'Resize' };
const entries: NoteListEntry[] = [
    { id: 1, title: 'Ideas', icon: 'note', emoji: null, pseudo: false },
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
});
