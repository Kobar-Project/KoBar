import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isSaveShortcut } from './saveShortcut';
import { IconButton, Menu } from '../../ui';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';

const NoteEditor: React.FC = React.memo(() => {
    const activeNoteId = useAppStore((s) => s.activeNoteId);
    const updateNoteTitle = useAppStore((s) => s.updateNoteTitle);
    const design = useAppStore((s) => s.design);
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
                        const mod = st.isMac ? '⌘' : st.language === 'de' ? 'Strg' : 'Ctrl';
                        const hint = st.t('noteLinkHint').replace('{mod}', mod);
                        if (anchor.title !== hint) anchor.title = hint;
                        return false;
                    },
                },
                attributes: {
                    class: 'kobar-note-editor flex-1 text-fg-1 text-lg leading-relaxed outline-none no-drag-region overflow-y-auto max-w-none',
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

    return (
        <div className={`flex-1 p-8 flex flex-col overflow-y-auto w-full max-w-full ${design === 'style2' ? 'bg-transparent' : ''}`}>
            {/* Hidden file input for image selection */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileSelect} />

            {/* Title area */}
            <div className="flex items-center gap-4 mb-6 no-drag-region">
                <input
                    className="bg-transparent text-4xl font-bold text-fg-1 border-none outline-none w-full focus:ring-0 placeholder-fg-3"
                    placeholder={t('noteTitlePlaceholder')}
                    type="text"
                    value={activeNote.title}
                    onChange={(e) => updateNoteTitle(activeNote.id, e.target.value)}
                />
                <Menu
                    aria-label={t('noteMenu')}
                    placement="bottom-end"
                    trigger={<IconButton icon="more_horiz" label={t('noteMenu')} size={28} />}
                    items={[
                        {
                            id: 'save-as-text',
                            icon: 'download',
                            label: t('noteSaveAsText'),
                            shortcut: 'Ctrl+S',
                            onSelect: () => void saveAsText(),
                        },
                    ]}
                />
            </div>

            {/* Formatting Toolbar */}
            <div
                className="flex items-center gap-4 mb-8 pb-4 border-b text-fg-2 no-drag-region"
                style={{ borderColor: 'var(--theme-border)' }}
            >
                <button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={`hover:text-fg-1 transition-colors cursor-pointer ${editor.isActive('bold') ? 'text-primary' : ''}`}
                    title={t('noteBold')}
                    aria-label={t('noteBold')}
                >
                    <span className="material-symbols-outlined text-[20px]">format_bold</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={`hover:text-fg-1 transition-colors cursor-pointer ${editor.isActive('italic') ? 'text-primary' : ''}`}
                    title={t('noteItalic')}
                    aria-label={t('noteItalic')}
                >
                    <span className="material-symbols-outlined text-[20px]">format_italic</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    className={`hover:text-fg-1 transition-colors cursor-pointer ${editor.isActive('underline') ? 'text-primary' : ''}`}
                    title={t('noteUnderline')}
                    aria-label={t('noteUnderline')}
                >
                    <span className="material-symbols-outlined text-[20px]">format_underlined</span>
                </button>
                <div className="w-px h-5" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                <button
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={`hover:text-fg-1 transition-colors cursor-pointer ${editor.isActive('bulletList') ? 'text-primary' : ''}`}
                    title={t('noteBulletList')}
                    aria-label={t('noteBulletList')}
                >
                    <span className="material-symbols-outlined text-[20px]">format_list_bulleted</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={`hover:text-fg-1 transition-colors cursor-pointer ${editor.isActive('orderedList') ? 'text-primary' : ''}`}
                    title={t('noteNumberedList')}
                    aria-label={t('noteNumberedList')}
                >
                    <span className="material-symbols-outlined text-[20px]">format_list_numbered</span>
                </button>
                <div className="w-px h-5" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                <button
                    onClick={triggerImagePicker}
                    className="hover:text-fg-1 transition-colors cursor-pointer"
                    title={t('noteInsertImage')}
                    aria-label={t('noteInsertImage')}
                >
                    <span className="material-symbols-outlined text-[20px]">image</span>
                </button>
            </div>

            {/* Tiptap Editor Content */}
            <EditorContent editor={editor} className="flex-1 overflow-y-auto no-drag-region" />
        </div>
    );
});

export default NoteEditor;
