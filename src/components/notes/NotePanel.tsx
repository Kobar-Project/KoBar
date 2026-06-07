import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';
import NoteEditor from './NoteEditor';
import SettingsPanel from './SettingsPanel';
import PluginsPanel from '../plugins/PluginsPanel';
import ResizerHandle from './ResizerHandle';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';

const NotePanel: React.FC = () => {
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const notePanelWidth = useAppStore(state => state.notePanelWidth);
    const notePanelHeight = useAppStore(state => state.notePanelHeight);
    const notes = useAppStore(state => state.notes);
    const activeNoteId = useAppStore(state => state.activeNoteId);
    const setActiveNoteId = useAppStore(state => state.setActiveNoteId);
    const addNote = useAppStore(state => state.addNote);
    const deleteNote = useAppStore(state => state.deleteNote);
    const updateNoteEmoji = useAppStore(state => state.updateNoteEmoji);
    const t = useAppStore(state => state.t);
    const isHighlightingSettingsBtn = useAppStore(state => state.isHighlightingSettingsBtn);
    const isHighlightingPluginsBtn = useAppStore(state => state.isHighlightingPluginsBtn);
    const openSettingsTab = useAppStore(state => state.openSettingsTab);
    const openPluginsTab = useAppStore(state => state.openPluginsTab);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const isMac = useAppStore(state => state.isMac);

    const activeNote = notes.find(n => n.id === activeNoteId);

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
    const handleResizeTemp = useCallback((w: number, h: number) => {
        if (panelRef.current) {
            panelRef.current.style.width = `${w}px`;
            panelRef.current.style.height = `${h}px`;
        }
        if (!isResizing) setIsResizing(true);
    }, [isResizing]);

    const [emojiPickerTabId, setEmojiPickerTabId] = useState<number | null>(null);
    const [emojiPickerX, setEmojiPickerX] = useState<number>(0);
    const emojiPickerRef = useRef<HTMLDivElement>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: number, x: number, y: number } | null>(null);
    const deleteConfirmRef = useRef<HTMLDivElement>(null);

    // Close on outside click for delete confirm
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (deleteConfirmRef.current && !deleteConfirmRef.current.contains(e.target as Node)) {
                setDeleteConfirm(null);
            }
        };
        if (deleteConfirm !== null) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [deleteConfirm]);

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

    const handleDelete = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        const noteToDelete = notes.find(n => n.id === id);
        if (noteToDelete?.isSettings || noteToDelete?.isPlugins) {
            deleteNote(id);
            return;
        }
        setDeleteConfirm({ id, x: e.clientX, y: e.clientY });
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

    const toggleEmojiPicker = (e: React.MouseEvent, tabId: number) => {
        e.stopPropagation();
        
        if (emojiPickerTabId === tabId) {
            setEmojiPickerTabId(null);
            return;
        }

        // Calculate position relative to the container
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const parentRect = (e.currentTarget as HTMLElement).closest('.relative')?.getBoundingClientRect();
        
        if (parentRect) {
            let leftPos = (rect.left - parentRect.left) + (rect.width / 2) - 150; // 150 is half of picker width (300)
            
            // Constrain within the panel (don't go off left/right edges)
            const minPadding = 20;
            const currentWidth = panelRef.current?.offsetWidth || 400;
            const maxLeft = currentWidth - 320; // picker width (300) + padding
            leftPos = Math.max(minPadding, Math.min(leftPos, maxLeft));
            
            setEmojiPickerX(leftPos);
        }
        
        setEmojiPickerTabId(tabId);
    };

    const tabsRef = useRef<HTMLDivElement>(null);
    const [isDraggingTabs, setIsDraggingTabs] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeftState, setScrollLeftState] = useState(0);
    const [dragDistance, setDragDistance] = useState(0);

    const handleTabsMouseDown = (e: React.MouseEvent) => {
        if (!tabsRef.current) return;
        setIsDraggingTabs(true);
        setStartX(e.pageX - tabsRef.current.offsetLeft);
        setScrollLeftState(tabsRef.current.scrollLeft);
        setDragDistance(0);
    };

    const handleTabsMouseLeave = () => {
        setIsDraggingTabs(false);
    };

    const handleTabsMouseUp = () => {
        setIsDraggingTabs(false);
    };

    const handleTabsMouseMove = (e: React.MouseEvent) => {
        if (!isDraggingTabs || !tabsRef.current) return;
        e.preventDefault();
        const x = e.pageX - tabsRef.current.offsetLeft;
        const walk = (x - startX) * 1.5; // Scroll speed multiplier
        tabsRef.current.scrollLeft = scrollLeftState - walk;
        setDragDistance(Math.abs(walk));
    };

    const handleTabClick = (noteId: number) => {
        // Only switch tabs if we didn't drag much
        if (dragDistance < 5) {
            setActiveNoteId(noteId);
        }
    };

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (e.currentTarget) {
            e.currentTarget.scrollLeft += e.deltaY;
        }
    };

    return (
        <div
            ref={panelRef}
            className={`relative flex flex-col border z-30 shadow-2xl shrink-0 pointer-events-auto ${isNotePanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0 border-none'}
                ${design === 'style2' ? 'rounded-[2.5rem]' : ''}
                ${isResizing ? '' : 'transition-all duration-500'}`}
            style={{
                width: `${notePanelWidth}px`,
                height: `${notePanelHeight}px`,
                backgroundColor: design === 'style2'
                    ? `color-mix(in srgb, var(--theme-bg-base) ${glassOpacity}%, transparent)`
                    : 'var(--theme-bg-base)',
                borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
                backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(32px)') : 'none',
                willChange: 'width, height'
            }}
        >
            {/* Side Resizer */}
            <ResizerHandle direction="side" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />
            {/* Bottom Resizer */}
            <ResizerHandle direction="bottom" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />
            {/* Corner Resizer */}
            <ResizerHandle direction="corner" onResizeTemp={handleResizeTemp} onResizeEnd={() => setIsResizing(false)} />

            {/* Tabs Header */}
            <div className={`flex items-end border-b pt-4 px-4 gap-6 no-drag-region shrink-0 relative transition-all duration-500
                ${design === 'style2' ? 'bg-transparent border-white/5' : 'bg-[var(--theme-bg-dark)] border-[var(--theme-border)]'}`}>
                <div
                    ref={tabsRef}
                    onWheel={handleWheel}
                    onMouseDown={handleTabsMouseDown}
                    onMouseLeave={handleTabsMouseLeave}
                    onMouseUp={handleTabsMouseUp}
                    onMouseMove={handleTabsMouseMove}
                    className={`flex-1 flex gap-2 overflow-x-auto scrollbar-hide snap-x select-none ${isDraggingTabs ? 'cursor-grabbing' : 'cursor-grab'}`}
                >
                    {notes.map((note) => (
                        <div
                            key={note.id}
                            role="button"
                            onClick={() => handleTabClick(note.id)}
                            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 snap-start no-drag-region ${note.id === activeNoteId
                                ? 'text-slate-200 border border-b-0 relative top-[1px]'
                                : 'text-slate-400 hover:text-slate-200 cursor-pointer'
                                }`}
                            style={note.id === activeNoteId ? {
                                backgroundColor: design === 'style2' ? 'transparent' : 'var(--theme-bg-base)',
                                borderColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-border)'
                            } : {}}
                        >
                            {/* Icon: emoji or Material icon */}
                            <span
                                onClick={(e) => {
                                    if (note.isSettings || note.isPlugins) return;
                                    toggleEmojiPicker(e, note.id);
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className={`emoji-trigger ${note.isSettings || note.isPlugins ? '' : 'cursor-pointer hover:scale-110 transition-transform'}`}
                                title={note.isSettings || note.isPlugins ? '' : t('changeIcon')}
                            >
                                {note.emoji ? (
                                    <span className="text-[18px] pointer-events-none">{note.emoji}</span>
                                ) : (
                                    <span className="material-symbols-outlined text-[18px] pointer-events-none">{note.icon}</span>
                                )}
                            </span>
                            {note.isSettings ? t('settings') : note.title}
                            {note.id === activeNoteId && (
                                <span
                                    onClick={(e) => handleDelete(e, note.id)}
                                    className="material-symbols-outlined text-[16px] ml-2 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-sm transition-all p-0.5"
                                    title={t('closeTab')}
                                >
                                    close
                                </span>
                            )}
                        </div>
                    ))}
                    <button
                        onClick={() => addNote()}
                        className="px-3 py-2.5 text-slate-400 hover:text-slate-200 text-sm font-medium rounded-t-lg transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                        title={t('addNewNote')}
                    >
                        <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                </div>

                {/* Top Right Action Buttons */}
                <div className="mb-2 flex items-center gap-1 pointer-events-auto">
                    <button
                        onClick={openPluginsTab}
                        className={`p-1.5 transition-all flex items-center justify-center ${isHighlightingPluginsBtn ? 'ring-4 ring-primary animate-pulse text-primary bg-primary/20 rounded-full' : 'text-slate-500 hover:text-primary rounded-lg hover:bg-white/5'}`}
                        title={(t as any)('plugins') || 'Plugins'}
                    >
                        <span className="material-symbols-outlined text-[22px]">extension</span>
                    </button>
                    <button
                        onClick={openSettingsTab}
                        className={`p-1.5 transition-all flex items-center justify-center ${isHighlightingSettingsBtn ? 'ring-4 ring-primary animate-pulse text-primary bg-primary/20 rounded-full' : 'text-slate-500 hover:text-primary rounded-lg hover:bg-white/5'}`}
                        title={t('settings')}
                    >
                        <span className="material-symbols-outlined text-[22px]">settings</span>
                    </button>
                </div>

                {/* Delete Confirm Popup */}
                {deleteConfirm !== null && createPortal(
                    <div
                        ref={deleteConfirmRef}
                        className="fixed z-[110] border rounded-lg shadow-2xl flex flex-col p-4 pointer-events-auto"
                        style={{
                            top: `${deleteConfirm.y + 10}px`,
                            left: `${deleteConfirm.x - 60}px`,
                            backgroundColor: design === 'style2'
                                ? `color-mix(in srgb, var(--theme-bg-dark) 80%, transparent)`
                                : 'var(--theme-bg-dark)',
                            borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)',
                            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(16px)') : 'none',
                        }}
                    >
                        <span className="text-slate-200 text-sm mb-4">{t('deleteConfirmMsg')}</span>
                        <div className="flex gap-2 justify-end items-center">
                            <button
                                onClick={(e) => { e.stopPropagation(); cancelDelete(); }}
                                className="px-4 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors rounded-md"
                                style={{ backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-bg-base)' }}
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); confirmDelete(); }}
                                className="px-4 py-1.5 text-xs font-medium text-red-500 hover:text-white bg-red-500/10 hover:bg-red-500 transition-colors border border-red-500/30 rounded-md"
                            >
                                {t('deleteTitle')}
                            </button>
                        </div>
                    </div>,
                    document.body
                )}
            </div>

            {/* Emoji Picker Popover - Absolutely positioned within NotePanel */}
            {emojiPickerTabId !== null && (
                <div
                    ref={emojiPickerRef}
                    className="absolute z-[100] no-drag-region shadow-2xl rounded-xl overflow-hidden pointer-events-auto"
                    style={{
                        top: '80px', 
                        left: `${emojiPickerX}px`,
                        backgroundColor: 'var(--theme-bg-dark)',
                        border: '1px solid rgba(255,255,255,0.1)'
                    }}
                >
                    <EmojiPicker
                        onEmojiClick={handleEmojiSelect}
                        theme={Theme.DARK}
                        width={300}
                        height={350}
                        searchPlaceholder="Search emoji..."
                        lazyLoadEmojis
                    />
                </div>
            )}

            {/* Editor or Settings Area */}
            {activeNote?.isSettings ? (
                <SettingsPanel />
            ) : activeNote?.isPlugins ? (
                <PluginsPanel />
            ) : (
                <NoteEditor />
            )}
        </div>
    );
};

export default NotePanel;
