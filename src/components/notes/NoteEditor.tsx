import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import TiptapEditor from './TiptapEditor';
import EditorJsEditor from './EditorJsEditor';

/**
 * NoteEditor Switcher
 * Conditionally renders TiptapEditor or EditorJsEditor based on the active note's editorType.
 * This component owns zero editor logic — it simply delegates to the correct editor.
 */
const NoteEditor: React.FC = React.memo(() => {
    const activeNoteId = useAppStore((state) => state.activeNoteId);
    const activeNote = useAppStore((state) => state.notes.find(n => n.id === activeNoteId));

    if (!activeNote || activeNote.isSettings) return null;

    if (activeNote.editorType === 'editorjs') {
        return <EditorJsEditor />;
    }

    // Default: Tiptap (also handles legacy notes without editorType)
    return <TiptapEditor />;
});

export default NoteEditor;
