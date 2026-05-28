import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';

interface BlockOption {
    id: string;
    icon: string;
    label: string;
    description: string;
}

interface BlockInsertionPanelProps {
    position: { x: number; y: number };
    onSelect: (blockType: string) => void;
    onClose: () => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

const BlockInsertionPanel: React.FC<BlockInsertionPanelProps> = ({
    position,
    onSelect,
    onClose,
    containerRef,
}) => {
    const t = useAppStore((state) => state.t);
    const design = useAppStore((state) => state.design);
    const isMac = useAppStore((state) => state.isMac);

    const [searchQuery, setSearchQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const blockOptions: BlockOption[] = [
        { id: 'header', icon: 'title', label: t('blockHeading') || 'Heading', description: 'H1-H6' },
        { id: 'list-unordered', icon: 'format_list_bulleted', label: t('blockBulletedList') || 'Bulleted List', description: '•' },
        { id: 'list-ordered', icon: 'format_list_numbered', label: t('blockNumberedList') || 'Numbered List', description: '1.' },
        { id: 'checklist', icon: 'checklist', label: t('blockChecklist') || 'Checklist', description: '☑' },
        { id: 'code', icon: 'code', label: t('blockCode') || 'Code', description: '<>' },
        { id: 'quote', icon: 'format_quote', label: t('blockQuote') || 'Quote', description: '"' },
        { id: 'image', icon: 'image', label: t('blockImage') || 'Image', description: '📷' },
        { id: 'delimiter', icon: 'horizontal_rule', label: t('blockDivider') || 'Divider', description: '—' },
    ];

    const filteredOptions = searchQuery.trim()
        ? blockOptions.filter(opt =>
            opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            opt.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : blockOptions;

    // Auto-focus search input
    useEffect(() => {
        const timer = setTimeout(() => {
            searchInputRef.current?.focus();
        }, 50);
        return () => clearTimeout(timer);
    }, []);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredOptions[highlightedIndex]) {
                onSelect(filteredOptions[highlightedIndex].id);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [filteredOptions, highlightedIndex, onSelect, onClose]);

    // Reset highlight when filter changes
    useEffect(() => {
        setHighlightedIndex(0);
    }, [searchQuery]);

    // Compute panel position so it doesn't overflow NotePanel edges
    const [adjustedPos, setAdjustedPos] = useState(position);

    useEffect(() => {
        if (!panelRef.current) {
            setAdjustedPos(position);
            return;
        }

        const panelRect = panelRef.current.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        const notePanel = containerRef.current?.closest('.relative') as HTMLElement | null;
        const notePanelRect = notePanel?.getBoundingClientRect();

        // Use notePanel bounds if available, otherwise viewport
        const boundsRight = notePanelRect?.right ?? window.innerWidth;
        const boundsBottom = notePanelRect?.bottom ?? window.innerHeight;
        const boundsLeft = notePanelRect?.left ?? 0;
        const boundsTop = notePanelRect?.top ?? 0;

        const padding = 12; // Minimum distance from NotePanel edges

        let x = position.x;
        let y = position.y;

        // Horizontal constraint
        if (x + panelRect.width + padding > boundsRight) {
            x = boundsRight - panelRect.width - padding;
        }
        if (x < boundsLeft + padding) {
            x = boundsLeft + padding;
        }

        // Vertical constraint — if panel would go below bounds, open upward
        if (y + panelRect.height + padding > boundsBottom) {
            // Open upward from the block
            y = position.y - panelRect.height - 8;
        }
        if (y < boundsTop + padding) {
            y = boundsTop + padding;
        }

        setAdjustedPos({ x, y });
    }, [position, containerRef]);

    const panelContent = (
        <div
            ref={panelRef}
            className="fixed z-[300] no-drag-region block-insertion-panel"
            style={{
                left: `${adjustedPos.x}px`,
                top: `${adjustedPos.y}px`,
                backgroundColor: design === 'style2'
                    ? `color-mix(in srgb, var(--theme-bg-dark) 90%, transparent)`
                    : 'var(--theme-bg-dark)',
                border: '1px solid var(--theme-border)',
                borderRadius: '0.75rem',
                boxShadow: '0 12px 48px rgba(0, 0, 0, 0.5)',
                backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(24px)') : 'none',
                maxHeight: '320px',
                minWidth: '240px',
                overflow: 'hidden',
                animation: 'blockPanelIn 0.15s ease-out',
            }}
            onKeyDown={handleKeyDown}
        >
            {/* Search input */}
            <div className="p-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter..."
                    className="w-full bg-transparent text-sm text-slate-300 outline-none placeholder-slate-600 px-2 py-1.5"
                />
            </div>

            {/* Block options */}
            <div className="overflow-y-auto max-h-[264px] p-1 custom-scrollbar">
                {filteredOptions.length === 0 ? (
                    <div className="text-center text-sm text-slate-500 py-4">
                        No blocks found
                    </div>
                ) : (
                    filteredOptions.map((opt, index) => (
                        <button
                            key={opt.id}
                            onClick={() => onSelect(opt.id)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            className={`block-insertion-item w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer no-drag-region
                                ${index === highlightedIndex ? 'bg-[var(--theme-accent-glow)]' : 'hover:bg-[var(--theme-accent-glow)]'}`}
                            style={{
                                color: index === highlightedIndex ? '#e2e8f0' : '#94a3b8',
                            }}
                        >
                            {/* Icon container */}
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                style={{
                                    backgroundColor: index === highlightedIndex
                                        ? 'rgba(255,255,255,0.08)'
                                        : 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <span
                                    className="material-symbols-outlined text-[18px]"
                                    style={{
                                        color: index === highlightedIndex ? 'var(--theme-primary)' : 'inherit'
                                    }}
                                >
                                    {opt.icon}
                                </span>
                            </div>

                            {/* Label & description */}
                            <div className="flex flex-col min-w-0">
                                <span className="text-sm font-medium leading-tight">{opt.label}</span>
                                <span className="text-[11px] text-slate-500 leading-tight">{opt.description}</span>
                            </div>
                        </button>
                    ))
                )}
            </div>
        </div>
    );

    return createPortal(panelContent, document.body);
};

export default BlockInsertionPanel;
