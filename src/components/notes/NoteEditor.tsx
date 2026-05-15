import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useAppStore } from '../../store/useAppStore';
import { useSpeechToText } from '../../hooks/useSpeechToText';

const NoteEditor: React.FC = React.memo(() => {
    const { activeNoteId, updateNoteTitle, t, design, language } = useAppStore();
    const activeNote = useAppStore((state) => state.notes.find(n => n.id === activeNoteId));
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isUpdatingFromStore = useRef(false);
    const [, setTick] = useState(0);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                bulletList: { keepMarks: true },
                orderedList: { keepMarks: true },
            }),
            Underline,
            Image.configure({
                inline: false,
                allowBase64: true
            }),
            Placeholder.configure({
                placeholder: 'Start writing your note…',
            }),
        ],
        content: activeNote?.content || '',
        editorProps: {
            attributes: {
                class: 'flex-1 text-slate-300 text-lg leading-relaxed outline-none no-drag-region overflow-y-auto max-w-none',
                spellcheck: 'false'
            },
            clipboardTextSerializer: (slice) => {
                const serializeNode = (node: any, listType: 'bullet' | 'ordered' | null = null, index: number = 0): string => {
                    if (node.isText) return node.text || '';
                    if (node.type.name === 'hardBreak') return '\n';

                    let text = '';
                    if (node.type.name === 'bulletList') {
                        node.forEach((child: any) => { text += serializeNode(child, 'bullet'); });
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
                        node.forEach((child: any) => { itemText += serializeNode(child); });
                        return prefix + itemText.trimEnd() + '\n';
                    }

                    if (node.isBlock) {
                        node.forEach((child: any) => { text += serializeNode(child); });
                        return text + '\n';
                    }
                    if (!node.isLeaf) {
                        node.forEach((child: any) => { text += serializeNode(child); });
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
        }
    }, []);

    const handleTranscript = useCallback((text: string) => {
        if (editor) {
            editor.chain().focus().insertContent(text + ' ').run();
        }
    }, [editor]);

    const { isListening, toggleListening, isSupported, error } = useSpeechToText({
        onTranscript: handleTranscript,
        language
    });

    useEffect(() => {
        if (error) {
            console.error('Speech-to-Text Error:', error);
        }
    }, [error]);

    // Sync editor content when active tab changes ONLY
    useEffect(() => {
        if (!editor || !activeNoteId) return;
        const note = useAppStore.getState().notes.find(n => n.id === activeNoteId);
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
            setTimeout(() => { scrollNode.scrollTop = savedPos; }, 50);
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
    const handleImageFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
    }, [editor]);

    const triggerImagePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);



    if (!editor || !activeNote) return null;

    return (
        <div
            className={`flex-1 p-8 flex flex-col overflow-y-auto w-full max-w-full ${design === 'style2' ? 'bg-transparent' : ''}`}
        >
            {/* Hidden file input for image selection */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageFileSelect}
            />

            {/* Title area */}
            <div className="flex items-center gap-4 mb-6 no-drag-region">
                <input
                    className="bg-transparent text-4xl font-bold text-slate-100 border-none outline-none w-full focus:ring-0 placeholder-slate-700"
                    placeholder={t('noteTitlePlaceholder')}
                    type="text"
                    value={activeNote.title}
                    onChange={(e) => updateNoteTitle(activeNote.id, e.target.value)}
                />
            </div>

            {/* Formatting Toolbar */}
            <div className="flex items-center gap-4 mb-8 pb-4 border-b text-slate-400 no-drag-region" style={{ borderColor: 'var(--theme-border)' }}>
                <button
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={`hover:text-slate-200 transition-colors cursor-pointer ${editor.isActive('bold') ? 'text-primary' : ''}`}
                    title="Bold"
                >
                    <span className="material-symbols-outlined text-[20px]">format_bold</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={`hover:text-slate-200 transition-colors cursor-pointer ${editor.isActive('italic') ? 'text-primary' : ''}`}
                    title="Italic"
                >
                    <span className="material-symbols-outlined text-[20px]">format_italic</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    className={`hover:text-slate-200 transition-colors cursor-pointer ${editor.isActive('underline') ? 'text-primary' : ''}`}
                    title="Underline"
                >
                    <span className="material-symbols-outlined text-[20px]">format_underlined</span>
                </button>
                <div className="w-px h-5" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                <button
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    className={`hover:text-slate-200 transition-colors cursor-pointer ${editor.isActive('bulletList') ? 'text-primary' : ''}`}
                    title="Bullet List"
                >
                    <span className="material-symbols-outlined text-[20px]">format_list_bulleted</span>
                </button>
                <button
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    className={`hover:text-slate-200 transition-colors cursor-pointer ${editor.isActive('orderedList') ? 'text-primary' : ''}`}
                    title="Numbered List"
                >
                    <span className="material-symbols-outlined text-[20px]">format_list_numbered</span>
                </button>
                <div className="w-px h-5" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                <button
                    onClick={triggerImagePicker}
                    className="hover:text-slate-200 transition-colors cursor-pointer"
                    title="Insert Image"
                >
                    <span className="material-symbols-outlined text-[20px]">image</span>
                </button>
                {isSupported && (
                    <>
                        <div className="w-px h-5" style={{ backgroundColor: 'var(--theme-border)' }}></div>
                        <button
                            onClick={toggleListening}
                            className={`hover:text-slate-200 transition-colors cursor-pointer flex items-center gap-1.5 
                                ${isListening ? 'text-orange-500 animate-pulse' : ''} 
                                ${error ? 'text-red-500' : ''}`}
                            title={error ? `${t('voiceToText')}: ${error}` : (isListening ? t('listening') : t('voiceToText'))}
                        >
                            <span className="material-symbols-outlined text-[20px]">
                                {error ? 'mic_off' : 'mic'}
                            </span>
                            {isListening && <span className="text-[10px] font-bold uppercase tracking-wider">{t('listening')}</span>}
                        </button>
                    </>
                )}
            </div>

            {/* Tiptap Editor Content */}
            <EditorContent editor={editor} className="flex-1 overflow-y-auto no-drag-region" />
        </div>
    );
});

export default NoteEditor;
