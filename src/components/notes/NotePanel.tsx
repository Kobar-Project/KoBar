import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useT } from '../../i18n/useT';
import { useAppStore } from '../../store/useAppStore';
import NoteEditor from './NoteEditor';
import { NoteList, type NoteListEntry } from '../../notes/NoteList';
import { NOTE_LIST_WIDTH_DEFAULT } from '../../notes/noteListWidth';
import { NotesEmptyState } from '../../notes/EmptyState';
import { ConfirmDialog, IconButton } from '../../ui';
import PluginSettingsHost from '../plugins/PluginSettingsHost';
import ResizerHandle from './ResizerHandle';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { resolveScheme } from '../../theme';
import { finishTextImport, importTextFilesFromDialog, readDroppedTextFiles } from '../../notes/importTextFiles';

/** Strips tags from a note's HTML for searching (search only; the content itself is never rewritten). */
const htmlToPlainText = (html: string | undefined): string =>
    (html ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const NotePanel: React.FC = () => {
    const isNotePanelOpen = useAppStore((state) => state.isNotePanelOpen);
    const notePanelWidth = useAppStore((state) => state.notePanelWidth);
    const notePanelHeight = useAppStore((state) => state.notePanelHeight);
    const notes = useAppStore((state) => state.notes);
    const activeNoteId = useAppStore((state) => state.activeNoteId);
    const setActiveNoteId = useAppStore((state) => state.setActiveNoteId);
    const addNote = useAppStore((state) => state.addNote);
    const deleteNote = useAppStore((state) => state.deleteNote);
    const updateNoteEmoji = useAppStore((state) => state.updateNoteEmoji);
    const t = useT();
    const isHighlightingSettingsBtn = useAppStore((state) => state.isHighlightingSettingsBtn);
    const isHighlightingPluginsBtn = useAppStore((state) => state.isHighlightingPluginsBtn);
    const openSettingsTab = useAppStore((state) => state.openSettingsTab);
    const openPluginsTab = useAppStore((state) => state.openPluginsTab);
    const scheme = useAppStore((state) => state.scheme);
    const noteListWidth = useAppStore((state) => state.noteListWidth);
    const setNoteListWidth = useAppStore((state) => state.setNoteListWidth);

    const activeNote = notes.find((n) => n.id === activeNoteId);
    // Plain text of each note for the search; recomputed only when the notes change.
    const textById = useMemo(() => new Map(notes.map((n) => [n.id, htmlToPlainText(n.content)])), [notes]);
    const listEntries: NoteListEntry[] = notes.map((n) => ({
        id: n.id,
        title: n.isSettings ? t('settings') : n.title,
        icon: n.icon,
        emoji: n.emoji,
        pseudo: Boolean(n.isSettings || n.isPlugins),
        text: textById.get(n.id),
    }));

    // T-615d: an activeNoteId that points to no note (a removed pseudo-note, a stale id) falls back to the first note.
    useEffect(() => {
        if (!activeNote && notes.length > 0) setActiveNoteId(notes[0].id);
    }, [activeNote, notes, setActiveNoteId]);

    // Direct DOM access for zero-latency resizing
    const panelRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useState(false);

    // Sync panel dimensions when store changes externally (double-click reset, tab switch, etc.)
    useEffect(() => {
        if (panelRef.current && !isResizing) {
            panelRef.current.style.width = `${notePanelWidth}px`;
            panelRef.current.style.height = `${notePanelHeight}px`;
        }
    }, [notePanelWidth, notePanelHeight, isResizing]);

    // Callback for resizer handles to update DOM directly
    const handleResizeTemp = useCallback(
        (w: number, h: number) => {
            if (panelRef.current) {
                panelRef.current.style.width = `${w}px`;
                panelRef.current.style.height = `${h}px`;
            }
            if (!isResizing) setIsResizing(true);
        },
        [isResizing]
    );

    const [emojiPickerTabId, setEmojiPickerTabId] = useState<number | null>(null);
    const [emojiPickerX, setEmojiPickerX] = useState<number>(0);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: number } | null>(null);

    // Close emoji picker on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Don't close if they clicked the trigger icon itself or the picker
            if (target.closest('.emoji-trigger')) return;

            if (emojiPickerRef.current && !emojiPickerRef.current.contains(target)) {
                setEmojiPickerTabId(null);
            }
        };
        if (emojiPickerTabId !== null) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [emojiPickerTabId]);

    const handleDelete = (id: number) => {
        const noteToDelete = notes.find((n) => n.id === id);
        if (noteToDelete?.isSettings || noteToDelete?.isPlugins) {
            deleteNote(id);
            return;
        }
        setDeleteConfirm({ id });
    };

    const confirmDelete = () => {
        if (deleteConfirm) {
            deleteNote(deleteConfirm.id);
            setDeleteConfirm(null);
        }
    };

    const cancelDelete = () => {
        setDeleteConfirm(null);
    };

    const handleEmojiSelect = (emojiData: EmojiClickData) => {
        if (emojiPickerTabId === null) return;
        updateNoteEmoji(emojiPickerTabId, emojiData.emoji);
        setEmojiPickerTabId(null);
    };

    const toggleEmojiPicker = (tabId: number) => {
        if (emojiPickerTabId === tabId) {
            setEmojiPickerTabId(null);
            return;
        }
        // The picker (300 px) opens beside the list column, clamped to the panel width.
        const currentWidth = panelRef.current?.offsetWidth || 400;
        setEmojiPickerX(Math.max(20, Math.min(200, currentWidth - 320)));
        setEmojiPickerTabId(tabId);
    };

    // Dropping .txt / .md files on the panel imports them as notes. During the drag only the MIME type is visible, so the panel accepts a
    // drag that carries a text/markdown/unknown-type file (a .md file has no type on Windows); a drag of images, ZIPs etc. is not accepted.
    const draggedFilesLookLikeText = (e: React.DragEvent): boolean =>
        Array.from(e.dataTransfer?.items ?? []).some(
            (item) => item.kind === 'file' && ['', 'text/plain', 'text/markdown'].includes(item.type)
        );
    const handleDragOver = (e: React.DragEvent) => {
        if (e.defaultPrevented || !draggedFilesLookLikeText(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };
    const handleDrop = (e: React.DragEvent) => {
        if (e.defaultPrevented || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        void readDroppedTextFiles(Array.from(e.dataTransfer.files)).then(({ files, rejected }) => finishTextImport(t, files, rejected));
    };

    return (
        <div
            ref={panelRef}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={`relative z-30 flex shrink-0 flex-col rounded-2xl border border-stroke bg-[var(--kb-material-bg)] p-3 text-fg-1 shadow-e3 [backdrop-filter:var(--kb-material-blur)] pointer-events-auto ${isNotePanelOpen ? 'opacity-100' : 'pointer-events-none border-none opacity-0'}
                ${isResizing ? '' : 'transition-all duration-500'}`}
            style={{
                width: `${notePanelWidth}px`,
                height: `${notePanelHeight}px`,
                willChange: 'width, height',
            }}
        >
            {/* Side Resizer */}
            <ResizerHandle direction="side" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />
            {/* Bottom Resizer */}
            <ResizerHandle direction="bottom" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />
            {/* Corner Resizer */}
            <ResizerHandle direction="corner" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />

            <div className="flex min-h-0 flex-1 gap-3">
                <NoteList
                    entries={listEntries}
                    activeNoteId={activeNote ? activeNote.id : null}
                    labels={{
                        list: t('notesList'),
                        title: t('notesList'),
                        search: t('notesSearch'),
                        noMatch: t('notesNoMatch'),
                        filterAll: t('notesFilterAll'),
                        filterRecent: t('notesFilterRecent'),
                        add: t('addNewNote'),
                        import: t('noteImport'),
                        changeIcon: t('changeIcon'),
                        close: t('closeTab'),
                        resize: t('resizeNoteList'),
                    }}
                    width={noteListWidth}
                    onWidthChange={setNoteListWidth}
                    onWidthReset={() => setNoteListWidth(NOTE_LIST_WIDTH_DEFAULT)}
                    onSelect={setActiveNoteId}
                    onAdd={addNote}
                    onImport={() => void importTextFilesFromDialog(t)}
                    onClose={(id) => handleDelete(id)}
                    onChangeIcon={(id) => toggleEmojiPicker(id)}
                    footer={
                        <>
                            <span className="flex-1" />
                            <IconButton
                                icon="extension"
                                label={t('plugins')}
                                pressed={isHighlightingPluginsBtn}
                                tooltip={false}
                                onClick={openPluginsTab}
                            />
                            <IconButton
                                icon="settings"
                                label={t('settings')}
                                pressed={isHighlightingSettingsBtn}
                                tooltip={false}
                                onClick={openSettingsTab}
                            />
                        </>
                    }
                />
                <div className={`flex min-w-0 flex-1 flex-col ${notes.length === 0 ? '' : 'overflow-hidden rounded-xl bg-surface'}`}>
                    {/* Editor or plugin host area */}
                    {notes.length === 0 ? (
                        <NotesEmptyState
                            title={t('notesEmptyTitle')}
                            description={t('notesEmptyBody')}
                            addLabel={t('notesNew')}
                            onAdd={addNote}
                        />
                    ) : activeNote?.isPlugins ? (
                        <PluginSettingsHost />
                    ) : (
                        <NoteEditor />
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={deleteConfirm !== null}
                danger
                title={t('deleteConfirmMsg')}
                confirmLabel={t('deleteTitle')}
                cancelLabel={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={cancelDelete}
            />

            {/* Emoji Picker Popover - Absolutely positioned within NotePanel */}
            {emojiPickerTabId !== null && (
                <div
                    ref={emojiPickerRef}
                    className="no-drag-region pointer-events-auto absolute z-[100] overflow-hidden rounded-xl border border-stroke bg-surface shadow-e3"
                    style={{ top: '80px', left: `${emojiPickerX}px` }}
                >
                    <EmojiPicker
                        onEmojiClick={handleEmojiSelect}
                        theme={resolveScheme(scheme) === 'light' ? Theme.LIGHT : Theme.DARK}
                        width={300}
                        height={350}
                        searchPlaceholder="Search emoji..."
                        lazyLoadEmojis
                    />
                </div>
            )}
        </div>
    );
};

export default NotePanel;
