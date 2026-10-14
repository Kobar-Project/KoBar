import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesEmptyState } from '../src/notes/EmptyState';
import { KOBAR_STORAGE_VERSION } from '../src/store/migrations';
import { cleanup, render } from './ui/render';

// T-623: no seeded welcome note on new installs; an empty state with an add button instead.
afterEach(() => {
    cleanup();
    localStorage.clear();
});

async function freshStore() {
    vi.resetModules();
    const store = await import('../src/store/useAppStore');
    await store.useAppStore.persist.rehydrate();
    return store.useAppStore;
}

describe('notes empty state', () => {
    it('renders title, description and an add button that calls onAdd', () => {
        const onAdd = vi.fn();
        const { host } = render(
            <NotesEmptyState title="No notes yet" description="Write something" addLabel="Add new note" onAdd={onAdd} />
        );
        expect(host.textContent).toContain('No notes yet');
        const btn = host.querySelector('button')!;
        expect(btn.textContent).toContain('Add new note');
        act(() => btn.click());
        expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('a new install starts with zero notes and the first added note becomes active', async () => {
        const useAppStore = await freshStore();
        expect(useAppStore.getState().notes).toEqual([]);
        expect(useAppStore.getState().globalNotes).toEqual([]);
        act(() => useAppStore.getState().addNote());
        const s = useAppStore.getState();
        expect(s.notes).toHaveLength(1);
        expect(s.activeNoteId).toBe(s.notes[0].id);
        expect(s.globalNotes).toHaveLength(1);
    });

    it('a persisted welcome note is kept as is after rehydrate', async () => {
        const note = { id: 1, title: 'Welcome to KoBar!', icon: 'waving_hand', emoji: null, content: '<p>hi</p>' };
        localStorage.setItem(
            'kobar-storage',
            JSON.stringify({
                state: { notes: [note], globalNotes: [note], activeNoteId: 1, nextNoteId: 2 },
                version: KOBAR_STORAGE_VERSION,
            })
        );
        const useAppStore = await freshStore();
        expect(useAppStore.getState().notes).toEqual([note]);
        expect(useAppStore.getState().activeNoteId).toBe(1);
    });

    it('zero notes with a stale activeNoteId does not crash the note panel', async () => {
        localStorage.setItem(
            'kobar-storage',
            JSON.stringify({ state: { notes: [], globalNotes: [], activeNoteId: 7, nextNoteId: 1 }, version: KOBAR_STORAGE_VERSION })
        );
        const useAppStore = await freshStore();
        const { default: NotePanel } = await import('../src/components/notes/NotePanel');
        const { host } = render(<NotePanel />);
        expect(host.querySelector('[role="status"]')).not.toBeNull();
        const addBtn = host.querySelector<HTMLButtonElement>('[role="status"] button')!;
        act(() => addBtn.click());
        expect(useAppStore.getState().notes).toHaveLength(1);
        expect(host.querySelector('[role="status"]')).toBeNull();
    });
});
