import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/list';
// @ts-expect-error No types available for @editorjs/checklist
import Checklist from '@editorjs/checklist';
import CustomCodeTool from './CustomCodeTool';
import Quote from '@editorjs/quote';
import Delimiter from '@editorjs/delimiter';
import { useAppStore } from '../../store/useAppStore';
import { validateEditorJsData } from './editorConverters';
import type { EditorJsOutputData } from './editorConverters';
import BlockInsertionPanel from './BlockInsertionPanel';

interface PlusTrigger {
    x: number;
    y: number;
    blockIndex: number;
}

const EditorJsEditor: React.FC = React.memo(() => {
    const activeNoteId = useAppStore((state) => state.activeNoteId);
    const activeNote = useAppStore((state) => state.notes.find(n => n.id === state.activeNoteId));
    const updateNoteTitle = useAppStore((state) => state.updateNoteTitle);
    const updateNoteEditorjsData = useAppStore((state) => state.updateNoteEditorjsData);
    const t = useAppStore((state) => state.t);
    const design = useAppStore((state) => state.design);

    const editorRef = useRef<EditorJS | null>(null);
    const holderRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isMountedRef = useRef(false);
    const isSavingRef = useRef(false);
    const currentNoteIdRef = useRef<number | null>(null);

    // Block insertion panel state
    const [showInsertPanel, setShowInsertPanel] = useState(false);
    const [insertPanelPos, setInsertPanelPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [plusTrigger, setPlusTrigger] = useState<PlusTrigger | null>(null);
    const [slashBlockIndex, setSlashBlockIndex] = useState<number | null>(null);

    // Parse stored Editor.js data for a note
    const getEditorData = useCallback((note: typeof activeNote): EditorJsOutputData => {
        if (!note?.editorjsData) {
            return { time: Date.now(), blocks: [{ type: 'paragraph', data: { text: '' } }], version: '2.30.0' };
        }
        try {
            const parsed = JSON.parse(note.editorjsData);
            if (validateEditorJsData(parsed)) {
                return parsed;
            }
        } catch {
            // Invalid JSON, return empty
        }
        return { time: Date.now(), blocks: [{ type: 'paragraph', data: { text: '' } }], version: '2.30.0' };
    }, []);

    // Save current editor content to store
    const saveToStore = useCallback(async () => {
        if (!editorRef.current || isSavingRef.current) return;
        isSavingRef.current = true;
        try {
            const outputData = await editorRef.current.save();
            const currentId = currentNoteIdRef.current;
            if (currentId) {
                updateNoteEditorjsData(currentId, JSON.stringify(outputData));
            }
        } catch (err) {
            console.error('[EditorJS] Save failed:', err);
        } finally {
            isSavingRef.current = false;
        }
    }, [updateNoteEditorjsData]);

    // Initialize or re-initialize Editor.js
    useEffect(() => {
        if (!holderRef.current || !activeNote || activeNote.isSettings) return;
        if (activeNote.editorType !== 'editorjs') return;

        // If we're switching to a different note, save the old one first then destroy
        const initEditor = async () => {
            // Save previous content before switching
            if (editorRef.current && currentNoteIdRef.current !== null && currentNoteIdRef.current !== activeNote.id) {
                try {
                    const prevData = await editorRef.current.save();
                    updateNoteEditorjsData(currentNoteIdRef.current, JSON.stringify(prevData));
                } catch { /* ignore save errors on switch */ }
            }

            // Destroy previous instance
            if (editorRef.current) {
                try {
                    editorRef.current.destroy();
                } catch { /* ignore destroy errors */ }
                editorRef.current = null;
            }

            currentNoteIdRef.current = activeNote.id;

            const data = getEditorData(activeNote);

            // Small delay to ensure DOM element is clean
            await new Promise(resolve => setTimeout(resolve, 50));

            if (!holderRef.current) return;

            // Clear any leftover DOM content
            holderRef.current.innerHTML = '';

            const editor = new EditorJS({
                holder: holderRef.current,
                data: data,
                placeholder: t('editorjsPlaceholder') || "Press '/' or click '+' to add a block...",
                tools: {
                    header: {
                        class: Header as any,
                        config: {
                            levels: [1, 2, 3, 4, 5, 6],
                            defaultLevel: 2
                        },
                        inlineToolbar: true,
                    },
                    list: {
                        class: List as any,
                        inlineToolbar: true,
                        config: {
                            defaultStyle: 'unordered'
                        }
                    },
                    checklist: {
                        class: Checklist as any,
                        inlineToolbar: true,
                    },
                    code: {
                        class: CustomCodeTool as any,
                    },
                    quote: {
                        class: Quote as any,
                        inlineToolbar: true,
                        config: {
                            quotePlaceholder: 'Enter a quote',
                            captionPlaceholder: 'Quote author',
                        }
                    },
                    delimiter: {
                        class: Delimiter as any,
                    },
                },
                onChange: async () => {
                    if (isMountedRef.current) {
                        await saveToStore();
                    }
                },
                onReady: () => {
                    isMountedRef.current = true;
                    // Restore scroll position
                    if (containerRef.current) {
                        const savedPos = useAppStore.getState().scrollPositions[`note_editorjs_${activeNote.id}`];
                        if (savedPos !== undefined) {
                            setTimeout(() => {
                                if (containerRef.current) containerRef.current.scrollTop = savedPos;
                            }, 50);
                        }
                    }
                },
                // Minimal config — we handle the toolbox ourselves
                minHeight: 100,
            });

            editorRef.current = editor;
        };

        initEditor();

        return () => {
            isMountedRef.current = false;
        };
    }, [activeNoteId, activeNote?.editorType]); // Only re-init on tab change or type change

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (editorRef.current) {
                // Save before destroy
                const id = currentNoteIdRef.current;
                if (id) {
                    editorRef.current.save().then(data => {
                        useAppStore.getState().updateNoteEditorjsData(id, JSON.stringify(data));
                    }).catch(() => {});
                }
                try {
                    editorRef.current.destroy();
                } catch { /* ignore */ }
                editorRef.current = null;
            }
        };
    }, []);

    // Track scroll position
    useEffect(() => {
        if (!containerRef.current || !activeNoteId) return;
        const scrollNode = containerRef.current;

        const handleScroll = () => {
            useAppStore.getState().setScrollPosition(`note_editorjs_${activeNoteId}`, scrollNode.scrollTop);
        };

        scrollNode.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollNode.removeEventListener('scroll', handleScroll);
    }, [activeNoteId]);

    // Detect "/" key press for slash command and "+" button hover
    useEffect(() => {
        const holder = holderRef.current;
        if (!holder) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;

                const range = sel.getRangeAt(0);
                const blockEl = (range.startContainer as HTMLElement).closest?.('.ce-block') 
                    || (range.startContainer.parentElement)?.closest?.('.ce-block');
                
                if (!blockEl) return;

                // Only trigger on empty blocks or at the start of text
                const contentEl = blockEl.querySelector('.ce-paragraph, [contenteditable]');
                const textContent = contentEl?.textContent || '';
                
                // If the block is empty or has only whitespace, show the panel
                if (textContent.trim() === '' || textContent.trim() === '/') {
                    e.preventDefault();
                    
                    // Clear the slash character
                    if (contentEl && contentEl.textContent) {
                        contentEl.textContent = '';
                    }

                    const rect = blockEl.getBoundingClientRect();
                    const containerRect = containerRef.current?.getBoundingClientRect();
                    
                    if (containerRect) {
                        // Find block index
                        const allBlocks = holder.querySelectorAll('.ce-block');
                        let blockIndex = 0;
                        allBlocks.forEach((b, i) => { if (b === blockEl) blockIndex = i; });
                        
                        setSlashBlockIndex(blockIndex);
                        setInsertPanelPos({
                            x: rect.left,
                            y: rect.bottom + 4,
                        });
                        setShowInsertPanel(true);
                    }
                }
            }

            if (e.key === 'Escape' && showInsertPanel) {
                setShowInsertPanel(false);
                setSlashBlockIndex(null);
            }
        };

        holder.addEventListener('keydown', handleKeyDown);
        return () => holder.removeEventListener('keydown', handleKeyDown);
    }, [showInsertPanel]);

    // Update plus trigger position on mouse move over blocks
    useEffect(() => {
        const holder = holderRef.current;
        if (!holder) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (showInsertPanel) return; // Don't show + while panel is open
            
            const target = e.target as HTMLElement;
            const blockEl = target.closest?.('.ce-block');
            
            if (!blockEl) {
                setPlusTrigger(null);
                return;
            }

            // Check if this block is empty
            const contentEl = blockEl.querySelector('.ce-paragraph, [contenteditable]');
            const textContent = contentEl?.textContent || '';
            
            if (textContent.trim() !== '') {
                setPlusTrigger(null);
                return;
            }

            const rect = blockEl.getBoundingClientRect();
            const allBlocks = holder.querySelectorAll('.ce-block');
            let blockIndex = 0;
            allBlocks.forEach((b, i) => { if (b === blockEl) blockIndex = i; });

            setPlusTrigger({
                x: rect.left + 4, // Shifted to right to avoid overlap with native drag handle
                y: rect.top + rect.height / 2 - 12,
                blockIndex,
            });
        };

        const handleMouseLeave = () => {
            setPlusTrigger(null);
        };

        holder.addEventListener('mousemove', handleMouseMove);
        holder.addEventListener('mouseleave', handleMouseLeave);
        return () => {
            holder.removeEventListener('mousemove', handleMouseMove);
            holder.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [showInsertPanel]);

    // Handle plus button click
    const handlePlusClick = useCallback(() => {
        if (!plusTrigger) return;

        const holder = holderRef.current;
        if (!holder) return;

        const blockEl = holder.querySelectorAll('.ce-block')[plusTrigger.blockIndex];
        if (!blockEl) return;

        const rect = blockEl.getBoundingClientRect();
        setSlashBlockIndex(plusTrigger.blockIndex);
        setInsertPanelPos({
            x: rect.left,
            y: rect.bottom + 4,
        });
        setShowInsertPanel(true);
        setPlusTrigger(null);
    }, [plusTrigger]);

    // Handle block type selection from the insertion panel
    const handleBlockSelect = useCallback(async (blockType: string) => {
        setShowInsertPanel(false);
        setSlashBlockIndex(null);

        if (!editorRef.current) return;

        const editor = editorRef.current;
        const currentIndex = slashBlockIndex ?? 0;

        try {
            // Insert the block at the current position
            switch (blockType) {
                case 'header':
                    await editor.blocks.insert('header', { text: '', level: 2 }, undefined, currentIndex, true);
                    break;
                case 'list-unordered':
                    await editor.blocks.insert('list', { style: 'unordered', items: [''] }, undefined, currentIndex, true);
                    break;
                case 'list-ordered':
                    await editor.blocks.insert('list', { style: 'ordered', items: [''] }, undefined, currentIndex, true);
                    break;
                case 'checklist':
                    await editor.blocks.insert('checklist', { items: [{ text: '', checked: false }] }, undefined, currentIndex, true);
                    break;
                case 'code':
                    await editor.blocks.insert('code', { code: '' }, undefined, currentIndex, true);
                    break;
                case 'quote':
                    await editor.blocks.insert('quote', { text: '', caption: '' }, undefined, currentIndex, true);
                    break;
                case 'delimiter':
                    await editor.blocks.insert('delimiter', {}, undefined, currentIndex, true);
                    break;
                case 'image':
                    // Trigger file picker for image
                    triggerImagePicker();
                    return;
                default:
                    break;
            }

            // Delete the empty placeholder block if we replaced it
            if (slashBlockIndex !== null) {
                try {
                    // The new block was inserted, now remove the old empty block that's now shifted
                    const blockCount = editor.blocks.getBlocksCount();
                    if (blockCount > 1) {
                        // The old block is now at currentIndex + 1 since we inserted before it
                        editor.blocks.delete(currentIndex + 1);
                    }
                } catch { /* ignore if deletion fails */ }
            }

            // Focus the newly inserted block
            editor.caret.setToBlock(currentIndex, 'start');
        } catch (err) {
            console.error('[EditorJS] Block insert failed:', err);
        }
    }, [slashBlockIndex]);

    // Image picker for Editor.js
    const fileInputRef = useRef<HTMLInputElement>(null);

    const triggerImagePicker = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleImageFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!editorRef.current || !e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result as string;
            if (editorRef.current) {
                const index = slashBlockIndex ?? editorRef.current.blocks.getBlocksCount();
                // Insert a paragraph with image content as a workaround
                // Editor.js image tool with base64 inline
                await editorRef.current.blocks.insert('paragraph', {
                    text: `<img src="${base64}" style="max-width:100%;border-radius:8px;" />`
                }, undefined, index, true);
            }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }, [slashBlockIndex]);

    if (!activeNote || activeNote.isSettings) return null;

    return (
        <div
            ref={containerRef}
            className={`flex-1 p-8 flex flex-col overflow-y-auto w-full max-w-full relative ${design === 'style2' ? 'bg-transparent' : ''}`}
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

            {/* Editor.js Holder */}
            <div
                ref={holderRef}
                className="flex-1 no-drag-region editorjs-holder"
                id={`editorjs-holder-${activeNoteId}`}
            />

            {/* Plus trigger button (appears on empty block hover) */}
            {plusTrigger && !showInsertPanel && createPortal(
                <button
                    onClick={handlePlusClick}
                    className="editorjs-plus-trigger-btn fixed z-[200] no-drag-region pointer-events-auto"
                    style={{
                        left: `${plusTrigger.x}px`,
                        top: `${plusTrigger.y}px`,
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--theme-primary)',
                        background: 'var(--theme-bg-dark)',
                        border: '1px solid var(--theme-border)',
                        transition: 'all 0.15s ease',
                    }}
                    title="Add block"
                >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                </button>,
                document.body
            )}

            {/* Block Insertion Panel */}
            {showInsertPanel && (
                <BlockInsertionPanel
                    position={insertPanelPos}
                    onSelect={handleBlockSelect}
                    onClose={() => { setShowInsertPanel(false); setSlashBlockIndex(null); }}
                    containerRef={containerRef}
                />
            )}
        </div>
    );
});

export default EditorJsEditor;
