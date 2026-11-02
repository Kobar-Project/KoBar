import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isSaveShortcut } from './saveShortcut';
import { Icon, IconButton, Menu } from '../../ui';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';
import { formatShortcut, modifierLabel } from '../../utils/formatShortcut';

const NoteEditor: React.FC = React.memo(() => {
    const activeNoteId = useAppStore((s) => s.activeNoteId);
    const updateNoteTitle = useAppStore((s) => s.updateNoteTitle);
    const t = useT();
    const activeNote = useAppStore((state) => state.notes.find((n) => n.id === activeNoteId));
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isUpdatingFromStore = useRef(false);
    const [, setTick] = useState(0);

    const editor = useEditor(
        {
            extensions: [
                StarterKit.configure({
                    bulletList: { keepMarks: true },
                    orderedList: { keepMarks: true },
                    link: {
                        openOnClick: false, // clicks are routed to the default browser in handleClick below
                        autolink: true,
                        linkOnPaste: true,
                        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
                    },
                }),
                Image.configure({
                    inline: false,
                    allowBase64: true,
                }),
                Placeholder.configure({
                    placeholder: t('noteEditorPlaceholder'),
                }),
            ],
            content: activeNote?.content || '',
            editorProps: {
                handleClick: (_view, _pos, event) => {
                    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
                    if (!anchor) return false;
                    // Plain click: let ProseMirror place the caret inside the link text.
                    // Mac: Cmd+click only (Ctrl+click is the context menu there); elsewhere Ctrl+click only.
                    if (!(useAppStore.getState().isMac ? event.metaKey : event.ctrlKey)) return false;
                    event.preventDefault();
                    const href = anchor.getAttribute('href') || '';
                    if (/^(https?:\/\/|mailto:)/i.test(href)) window.api.openExternal(href);
                    return true;
                },
                handleDOMEvents: {
                    mouseover: (_view, event) => {
                        const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
                        if (!anchor) return false;
                        // Read the translation at event time: the editor config is created once.
                        const st = useAppStore.getState();
                        const mod = modifierLabel('mod', { mac: st.isMac, language: st.language }); // MAC-023
                        const hint = st.t('noteLinkHint').replace('{mod}', mod);
                        if (anchor.title !== hint) anchor.title = hint;
                        return false;
                    },
                },
                attributes: {
                    class: 'kobar-note-editor flex-1 text-fg-1 outline-none no-drag-region overflow-y-auto max-w-none',
                    spellcheck: 'false',
                },
                clipboardTextSerializer: (slice) => {
                    const serializeNode = (node: any, listType: 'bullet' | 'ordered' | null = null, index: number = 0): string => {
                        if (node.isText) return node.text || '';
                        if (node.type.name === 'hardBreak') return '\n';

                        let text = '';
                        if (node.type.name === 'bulletList') {
                            node.forEach((child: any) => {
                                text += serializeNode(child, 'bullet');
                            });
                            return text;
                        }
                        if (node.type.name === 'orderedList') {
                            let i = node.attrs?.start || 1;
                            node.forEach((child: any) => {
                                text += serializeNode(child, 'ordered', i);
                                i++;
                            });
                            return text;
                        }
                        if (node.type.name === 'listItem') {
                            const prefix = listType === 'ordered' ? `${index}. ` : '- ';
                            let itemText = '';
                            node.forEach((child: any) => {
                                itemText += serializeNode(child);
                            });
                            return prefix + itemText.trimEnd() + '\n';
                        }

                        if (node.isBlock) {
                            node.forEach((child: any) => {
                                text += serializeNode(child);
                            });
                            return text + '\n';
                        }
                        if (!node.isLeaf) {
                            node.forEach((child: any) => {
                                text += serializeNode(child);
                            });
                        }
                        return text;
                    };

                    let result = '';
                    slice.content.forEach((node: any) => {
                        result += serializeNode(node);
                    });
                    return result.trim();
                },
            },
            onUpdate: ({ editor: ed }) => {
                if (isUpdatingFromStore.current) return;
                const currentTabId = useAppStore.getState().activeNoteId;
                if (currentTabId) {
                    useAppStore.getState().updateNoteContent(currentTabId, ed.getHTML());
                }
            },
            onSelectionUpdate: () => {
                setTick((prev) => prev + 1);
            },
            onTransaction: () => {
                setTick((prev) => prev + 1);
            },
        },
        []
    );

    // Sync editor content when active tab changes ONLY
    useEffect(() => {
        if (!editor || !activeNoteId) return;
        const note = useAppStore.getState().notes.find((n) => n.id === activeNoteId);
        if (note) {
            isUpdatingFromStore.current = true;
            editor.commands.setContent(note.content || '');
            isUpdatingFromStore.current = false;
        }
    }, [activeNoteId, editor]); // activeNote dependency removed to prevent cursor jumping!

    // 1. Restore scroll position on mount/tab switch (Non-Reactive)
    useEffect(() => {
        if (!editor || !activeNoteId) return;
        const scrollNode = editor.view.dom.parentElement;
        if (!scrollNode) return;

        const savedPos = useAppStore.getState().scrollPositions[`note_${activeNoteId}`];
        if (savedPos !== undefined) {
            // 50ms delay allows Tiptap to fully inject the new long content before jumping
            setTimeout(() => {
                scrollNode.scrollTop = savedPos;
            }, 50);
        }
    }, [editor, activeNoteId]);

    // 2. Safely track scroll position continuously (Non-Reactive)
    useEffect(() => {
        if (!editor || !activeNoteId) return;
        const scrollNode = editor.view.dom.parentElement;
        if (!scrollNode) return;

        const handleScroll = () => {
            useAppStore.getState().setScrollPosition(`note_${activeNoteId}`, scrollNode.scrollTop);
        };

        // Passive listener ensures zero scroll performance degradation
        scrollNode.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollNode.removeEventListener('scroll', handleScroll);
    }, [editor, activeNoteId]);

    // Handle local image file selection
    const handleImageFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!editor || !e.target.files || e.target.files.length === 0) return;
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result as string;
                editor.chain().focus().setImage({ src: base64 }).run();
            };
            reader.readAsDataURL(file);
            // Reset input so the same file can be re-selected
            e.target.value = '';
        },
        [editor]
    );

    // Notes are autosaved; Ctrl+S / Ctrl+Shift+S (and the note menu) export the active note as a .txt file the user picks a place for.
    const saveAsText = useCallback(async () => {
        if (!editor || !activeNote) return;
        const notify = (title: string, body: string) => window.api?.sendNotification?.(title, body);
        try {
            const result = await window.api.saveNoteAsText(activeNote.title, editor.getText({ blockSeparator: '\n' }));
            if (result.success) {
                const name = result.path?.split(/[\\/]/).pop() ?? '';
                notify(
                    t('noteSavedTitle'),
                    t('noteSavedBody').replace('{name}', () => name)
                );
            } else if (result.reason !== 'Canceled') {
                console.error('Failed to save note:', result.reason);
                notify(t('noteSavedTitle'), t('noteSaveFailed'));
            }
        } catch (error) {
            console.error('Error saving note:', error);
            notify(t('noteSavedTitle'), t('noteSaveFailed'));
        }
    }, [editor, activeNote, t]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!isSaveShortcut(e)) return;
            e.preventDefault();
            if (!e.repeat) void saveAsText();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [saveAsText]);

    const triggerImagePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    if (!editor || !activeNote) return null;

    const wordCount = editor.getText({ blockSeparator: ' ' }).trim().split(/\s+/).filter(Boolean).length;
    const tool = (icon: string, label: string, active: boolean, onClick: () => void) => (
        <IconButton icon={icon} label={label} size={40} pressed={active || undefined} onClick={onClick} />
    );
    const divider = <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--kb-stroke-strong)]" />;

    return (
        <div className="flex min-h-0 w-full max-w-full flex-1 flex-col px-9 pt-6 pb-4">
            {/* Hidden file input for image selection */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileSelect} />

            {/* Title area */}
            <div className="no-drag-region mb-4 flex items-center gap-3">
                <input
                    className="w-full min-w-0 [font:var(--kb-type-display)] border-none bg-transparent text-fg-1 outline-none placeholder:text-fg-3 focus:ring-0"
                    placeholder={t('noteTitlePlaceholder')}
                    type="text"
                    value={activeNote.title}
                    onChange={(e) => updateNoteTitle(activeNote.id, e.target.value)}
                />
                <Menu
                    aria-label={t('noteMenu')}
                    placement="bottom-end"
                    trigger={<IconButton icon="more_horiz" label={t('noteMenu')} size={36} />}
                    items={[
                        {
                            id: 'save-as-text',
                            icon: 'download',
                            label: t('noteSaveAsText'),
                            shortcut: formatShortcut('Mod+S'), // MAC-023
                            onSelect: () => void saveAsText(),
                        },
                    ]}
                />
            </div>

            {/* Floating formatting toolbar: an inset pill, active tool = container */}
            <div className="no-drag-region mb-4 flex items-center gap-1 self-start rounded-full bg-inset p-1">
                {tool('format_bold', t('noteBold'), editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
                {tool('format_italic', t('noteItalic'), editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
                {tool('format_underlined', t('noteUnderline'), editor.isActive('underline'), () =>
                    editor.chain().focus().toggleUnderline().run()
                )}
                {divider}
                {tool('format_list_bulleted', t('noteBulletList'), editor.isActive('bulletList'), () =>
                    editor.chain().focus().toggleBulletList().run()
                )}
                {tool('format_list_numbered', t('noteNumberedList'), editor.isActive('orderedList'), () =>
                    editor.chain().focus().toggleOrderedList().run()
                )}
                {divider}
                {tool('image', t('noteInsertImage'), false, triggerImagePicker)}
            </div>

            {/* Tiptap Editor Content */}
            <EditorContent editor={editor} className="no-drag-region min-h-0 flex-1 overflow-y-auto" />

            {/* Status line: notes are autosaved, so this always reads "saved" */}
            <p className="mt-3 flex shrink-0 items-center gap-1.5 [font:var(--kb-type-caption)] text-fg-2">
                <Icon name="check" size={16} className="text-accent" />
                <span>
                    {t('notesSaved')} · {t('notesWordCount').replace('{count}', () => String(wordCount))}
                </span>
            </p>
        </div>
    );
});

export default NoteEditor;
