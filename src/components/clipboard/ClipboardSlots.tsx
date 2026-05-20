import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useClipboardStore } from '../../store/useClipboardStore';
import type { SlotState } from '../../store/useClipboardStore';
import { useAppStore } from '../../store/useAppStore';
import TooltipButton from '../layout/TooltipButton';

function getSlotColorClass(state: SlotState, design: string): string {
    switch (state) {
        case 'empty':
            return 'radio-grey';
        case 'listening':
            return 'radio-blue';
        case 'filled':
            return 'radio-green';
        case 'selected':
            return `radio-green ring-2 ring-primary ring-offset-1 ${design === 'style2' ? 'ring-offset-transparent' : 'ring-offset-[var(--theme-bg-dark)]'}`;
        default:
            return 'radio-grey';
    }
}

const ClipboardSlots: React.FC = () => {
    const {
        slots,
        isCopyModeActive,
        isPasteModeActive,
        toggleCopyMode,
        togglePasteMode,
        addClipboardItem,
        pasteNextItem,
        resetAll,
        clearSlot,
        setListeningSlot,
        setSelectedSlot,
        setSlotCount: setStoreSlotCount,
    } = useClipboardStore();
    const { t, design, slotCount, edgePosition, orientation } = useAppStore();

    const [activePreviewSlot, setActivePreviewSlot] = useState<number | null>(null);
    const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Synchronize slot count from AppStore to ClipboardStore
    useEffect(() => {
        setStoreSlotCount(slotCount);
    }, [slotCount, setStoreSlotCount]);

    // Auto-close timer logic
    useEffect(() => {
        if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
        }

        if (activePreviewSlot !== null) {
            autoCloseTimerRef.current = setTimeout(() => {
                setActivePreviewSlot(null);
                setPreviewRect(null);
            }, 5000);
        }

        return () => {
            if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
        };
    }, [activePreviewSlot]);

    // Outside click listener for preview
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activePreviewSlot !== null && containerRef.current && !containerRef.current.contains(event.target as Node)) {
                // Check if click was on the portal content (which is outside containerRef)
                const portalContent = document.getElementById('clipboard-preview-portal');
                if (portalContent && portalContent.contains(event.target as Node)) return;

                setActivePreviewSlot(null);
                setPreviewRect(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activePreviewSlot]);

    // Listen for clipboard updates from Electron backend
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        if (window.api?.onClipboardUpdate) {
            cleanup = window.api.onClipboardUpdate((data) => {
                addClipboardItem(data.type as 'text' | 'image', data.content);
            });
        }
        return () => {
            if (cleanup) cleanup();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (isCopyModeActive) {
            window.api?.startClipboardListener?.();
        } else {
            window.api?.stopClipboardListener?.();
        }
    }, [isCopyModeActive]);

    const hasPasteableItems = slots.some(s => s.state === 'filled' || s.state === 'selected');

    // Sync global paste mode to backend
    useEffect(() => {
        if (isPasteModeActive && hasPasteableItems) {
            window.api?.setGlobalPasteMode(true);
        } else {
            window.api?.setGlobalPasteMode(false);
        }
        return () => window.api?.setGlobalPasteMode(false);
    }, [isPasteModeActive, hasPasteableItems]);

    // Listen for global OS paste trigger
    useEffect(() => {
        if (!isPasteModeActive) return;
        const cleanup = window.api?.onRequestNextPaste(() => {
            const targetSlot = slots.find(s => s.state === 'selected') || slots.find(s => s.state === 'filled');
            if (targetSlot && targetSlot.content && targetSlot.type) {
                window.api?.executeGlobalPaste({ type: targetSlot.type, content: targetSlot.content });
                pasteNextItem();
            }
        });
        return cleanup;
    }, [isPasteModeActive, slots, pasteNextItem]);

    // Listen for macOS paste error (e.g. missing Accessibility permission)
    useEffect(() => {
        const cleanup = window.api?.onClipboardPasteError?.((data) => {
            if (data.error === 'accessibility-denied') {
                alert(data.message);
            } else {
                console.error('[ClipboardSlots] Paste error:', data.message);
            }
        });
        return () => { if (cleanup) cleanup(); };
    }, []);

    const handleSlotClick = (e: React.MouseEvent, index: number, state: SlotState) => {
        e.preventDefault();
        
        // Always allowed to toggle preview on filled slots (unless in copy mode looking for empty)
        if (!isCopyModeActive && (state === 'filled' || state === 'selected')) {
            if (activePreviewSlot === index) {
                setActivePreviewSlot(null);
                setPreviewRect(null);
            } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setPreviewRect(rect);
                setActivePreviewSlot(index);
            }
            
            // If in paste mode, also select it
            if (isPasteModeActive) {
                setSelectedSlot(index);
                const slotData = slots[index];
                if (slotData && slotData.content && slotData.type) {
                    window.api?.writeToClipboard({ type: slotData.type, content: slotData.content });
                }
            }
            return;
        }

        if (isCopyModeActive && state === 'empty') {
            setListeningSlot(index);
        }
    };

    const truncateContent = (content: any, limit: number = 150) => {
        if (typeof content !== 'string') return '';
        if (content.length <= limit) return content;
        return content.substring(0, limit) + '...';
    };

    return (
        <div ref={containerRef} className={`flex ${orientation === 'horizontal' ? 'flex-row h-full py-2 px-1' : 'flex-col w-full px-2'} items-center gap-2 no-drag-region`}>
            {/* Copy Button */}
            <TooltipButton
                onClick={toggleCopyMode}
                onDoubleClick={resetAll}
                className={`w-12 h-12 flex items-center justify-center transition-all cursor-pointer rounded-full hover:scale-110 active:scale-95 shadow-lg ${isCopyModeActive
                    ? 'text-green-500 bg-green-500/10 border-green-500/50'
                    : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'
                    }`}
                label={t('copy')}
            >
                <span className="material-symbols-outlined text-[24px]">content_copy</span>
            </TooltipButton>

            {/* Unified Slot Circles */}
            <div className={orientation === 'horizontal' 
                ? "grid grid-rows-2 grid-flow-col gap-1.5 relative h-[80%] my-auto justify-items-center items-center" 
                : "grid grid-cols-4 gap-2 relative w-[80%] mx-auto justify-items-center"}>
                {slots.map((slot, index) => (
                    <div key={`slot-container-${index}`} className="relative">
                        <label
                            className="relative flex items-center justify-center cursor-pointer group"
                            onClick={(e) => handleSlotClick(e, index, slot.state)}
                            onDoubleClick={(e) => {
                                e.preventDefault();
                                clearSlot(index);
                            }}
                        >
                            <input
                                readOnly
                                checked={slot.state !== 'empty'}
                                className={`custom-radio ${getSlotColorClass(slot.state, design)} pointer-events-none`}
                                type="radio"
                                name={`slot_${index}`}
                            />
                        </label>

                        {/* Preview Popover (Rendered via Portal to body to avoid clipping by Sidebar overflow) */}
                        {activePreviewSlot === index && slot.content && previewRect && createPortal(
                            <div 
                                id="clipboard-preview-portal"
                                className={`fixed z-[999999] animate-in fade-in slide-in-from-top-1 duration-200 pointer-events-auto`}
                                style={orientation === 'horizontal'
                                    ? {
                                        left: `${previewRect.left + previewRect.width / 2}px`,
                                        transform: 'translateX(-50%)',
                                        ...(edgePosition === 'top'
                                            ? { top: `${previewRect.bottom + 12}px` }
                                            : { bottom: `${window.innerHeight - previewRect.top + 12}px` })
                                    }
                                    : {
                                        top: `${previewRect.top + previewRect.height / 2}px`,
                                        transform: 'translateY(-50%)',
                                        ...(edgePosition === 'left' 
                                            ? { left: `${previewRect.right + 12}px` } 
                                            : { right: `${window.innerWidth - previewRect.left + 12}px` })
                                    }
                                }
                            >
                                <div className="min-w-[140px] max-w-[240px] p-2 rounded-md bg-black/90 backdrop-blur-3xl border border-white/20 shadow-[0_25px_60px_rgba(0,0,0,0.8)] ring-1 ring-white/10 relative overflow-hidden group/preview">
                                    {/* Close Button */}
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setActivePreviewSlot(null);
                                            setPreviewRect(null);
                                        }}
                                        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-md hover:bg-white/20 text-white/30 hover:text-white transition-all cursor-pointer z-[10]"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
 
                                    <div className="flex items-center gap-1.5 mb-1 opacity-40 select-none">
                                        <span className="material-symbols-outlined text-[13px]">
                                            {slot.type === 'image' ? 'image' : 'description'}
                                        </span>
                                        <span className="text-[9px] font-black uppercase tracking-widest">{slot.type}</span>
                                    </div>
                                    <div className="text-[12px] text-slate-100 leading-snug line-clamp-3 break-words px-0.5 select-text">
                                        {slot.type === 'image' ? (
                                            <div className="w-full h-12 rounded bg-white/5 border border-white/5 flex items-center justify-center italic text-[10px] text-white/30">
                                                {t('imagePreview')}
                                            </div>
                                        ) : (
                                            truncateContent(slot.content)
                                        )}
                                    </div>
                                </div>
                                {/* Arrow */}
                                <div className={orientation === 'horizontal'
                                    ? `absolute left-1/2 -translate-x-1/2 border-x-[5px] border-x-transparent 
                                       ${edgePosition === 'top' 
                                           ? 'border-b-[5px] border-b-black/90 -top-1' 
                                           : 'border-t-[5px] border-t-black/90 -bottom-1'}`
                                    : `absolute top-1/2 -translate-y-1/2 border-y-[5px] border-y-transparent 
                                       ${edgePosition === 'left' 
                                           ? 'border-r-[5px] border-r-black/90 -left-1' 
                                           : 'border-l-[5px] border-l-black/90 -right-1'}`
                                } />
                            </div>,
                            document.body
                        )}
                    </div>
                ))}
            </div>

            {/* Paste Button */}
            <TooltipButton
                onClick={togglePasteMode}
                onDoubleClick={resetAll}
                className={`w-12 h-12 flex items-center justify-center transition-all cursor-pointer rounded-full hover:scale-110 active:scale-95 shadow-lg ${isPasteModeActive
                    ? 'text-primary bg-primary/20 border-primary/50'
                    : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'
                    }`}
                label={t('paste')}
            >
                <span className="material-symbols-outlined text-[24px]">content_paste</span>
            </TooltipButton>
        </div>
    );

};

export default ClipboardSlots;

