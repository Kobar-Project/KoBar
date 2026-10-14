import { describe, expect, it } from 'vitest';
import {
    clampNoteListWidth,
    noteListWidthForKey,
    NOTE_LIST_WIDTH_DEFAULT,
    NOTE_LIST_WIDTH_MAX,
    NOTE_LIST_WIDTH_MIN,
} from '../src/notes/noteListWidth';

// R-11: clamp and keyboard logic of the note list resizer.

describe('clampNoteListWidth', () => {
    it('keeps the former fixed width as the default and inside the bounds', () => {
        expect(NOTE_LIST_WIDTH_DEFAULT).toBe(192);
        expect(clampNoteListWidth(NOTE_LIST_WIDTH_DEFAULT)).toBe(192);
    });

    it('clamps to 160..420 and rounds', () => {
        expect(clampNoteListWidth(0)).toBe(NOTE_LIST_WIDTH_MIN);
        expect(clampNoteListWidth(1000)).toBe(NOTE_LIST_WIDTH_MAX);
        expect(clampNoteListWidth(200.6)).toBe(201);
    });

    it('falls back to the default for non-numbers and non-finite numbers', () => {
        for (const bad of [NaN, Infinity, -Infinity, '200', null, undefined, {}])
            expect(clampNoteListWidth(bad)).toBe(NOTE_LIST_WIDTH_DEFAULT);
    });
});

describe('noteListWidthForKey', () => {
    it('moves by 16 px with the arrow keys and never leaves the bounds', () => {
        expect(noteListWidthForKey('ArrowRight', 200)).toBe(216);
        expect(noteListWidthForKey('ArrowLeft', 200)).toBe(184);
        expect(noteListWidthForKey('ArrowLeft', NOTE_LIST_WIDTH_MIN)).toBe(NOTE_LIST_WIDTH_MIN);
        expect(noteListWidthForKey('ArrowRight', NOTE_LIST_WIDTH_MAX)).toBe(NOTE_LIST_WIDTH_MAX);
    });

    it('flips the arrows in RTL and jumps with Home/End', () => {
        expect(noteListWidthForKey('ArrowLeft', 200, true)).toBe(216);
        expect(noteListWidthForKey('ArrowRight', 200, true)).toBe(184);
        expect(noteListWidthForKey('Home', 300)).toBe(NOTE_LIST_WIDTH_MIN);
        expect(noteListWidthForKey('End', 300)).toBe(NOTE_LIST_WIDTH_MAX);
    });

    it('ignores other keys', () => {
        expect(noteListWidthForKey('Enter', 200)).toBeNull();
        expect(noteListWidthForKey('ArrowUp', 200)).toBeNull();
    });
});
