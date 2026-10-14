import { describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { NOTE_LIST_WIDTH_DEFAULT } from '../src/notes/noteListWidth';
// Type-only: brings the global `Window.KoBarExtensions` declaration into the test tsconfig. Erased at runtime.
import type {} from '../src/components/extensions/extensionRegistry';

// R-11: store field, setter clamping and persistence (partialize).

describe('noteListWidth in the store', () => {
    it('defaults to the former fixed width and clamps the setter', () => {
        expect(useAppStore.getState().noteListWidth).toBe(NOTE_LIST_WIDTH_DEFAULT);
        useAppStore.getState().setNoteListWidth(5000);
        expect(useAppStore.getState().noteListWidth).toBe(420);
        useAppStore.getState().setNoteListWidth(1);
        expect(useAppStore.getState().noteListWidth).toBe(160);
        useAppStore.getState().setNoteListWidth(NOTE_LIST_WIDTH_DEFAULT);
    });

    it('is part of the persisted state', () => {
        const partialize = useAppStore.persist.getOptions().partialize!;
        useAppStore.getState().setNoteListWidth(260);
        expect((partialize(useAppStore.getState()) as Record<string, unknown>).noteListWidth).toBe(260);
        useAppStore.getState().setNoteListWidth(NOTE_LIST_WIDTH_DEFAULT);
    });
});
