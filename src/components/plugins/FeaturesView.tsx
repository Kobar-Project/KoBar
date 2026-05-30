import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const FeaturesView: React.FC = () => {
    const design = useAppStore(state => state.design);
    const t = useAppStore(state => state.t);
    const featureOrder = useAppStore(state => state.featureOrder);
    const setFeatureOrder = useAppStore(state => state.setFeatureOrder);
    
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

    // Feature Toggles from AppStore
    const isShortcutsEnabled = useAppStore(state => state.isShortcutsEnabled);
    const setIsShortcutsEnabled = useAppStore(state => state.setIsShortcutsEnabled);
    const isCopyPasteEnabled = useAppStore(state => state.isCopyPasteEnabled);
    const setIsCopyPasteEnabled = useAppStore(state => state.setIsCopyPasteEnabled);
    const isScreenshotEnabled = useAppStore(state => state.isScreenshotEnabled);
    const setIsScreenshotEnabled = useAppStore(state => state.setIsScreenshotEnabled);
    const isFocusModeEnabled = useAppStore(state => state.isFocusModeEnabled);
    const setIsFocusModeEnabled = useAppStore(state => state.setIsFocusModeEnabled);
    const isCalculatorEnabled = useAppStore(state => state.isCalculatorEnabled);
    const setIsCalculatorEnabled = useAppStore(state => state.setIsCalculatorEnabled);
    const isColorPickerEnabled = useAppStore(state => state.isColorPickerEnabled);
    const setIsColorPickerEnabled = useAppStore(state => state.setIsColorPickerEnabled);
    const isTodoListEnabled = useAppStore(state => state.isTodoListEnabled);
    const setIsTodoListEnabled = useAppStore(state => state.setIsTodoListEnabled);
    const isKoCalendarEnabled = useAppStore(state => state.isKoCalendarEnabled);
    const setIsKoCalendarEnabled = useAppStore(state => state.setIsKoCalendarEnabled);
    const isPinInjectorEnabled = useAppStore(state => state.isPinInjectorEnabled);
    const setIsPinInjectorEnabled = useAppStore(state => state.setIsPinInjectorEnabled);
    const isKoBoxEnabled = useAppStore(state => state.isKoBoxEnabled);
    const setIsKoBoxEnabled = useAppStore(state => state.setIsKoBoxEnabled);
    const isSnippetVaultEnabled = useAppStore(state => state.isSnippetVaultEnabled);
    const setIsSnippetVaultEnabled = useAppStore(state => state.setIsSnippetVaultEnabled);
    const isAiHubEnabled = useAppStore(state => state.isAiHubEnabled);
    const setIsAiHubEnabled = useAppStore(state => state.setIsAiHubEnabled);
    const isKoPlayerEnabled = useAppStore(state => state.isKoPlayerEnabled);
    const setIsKoPlayerEnabled = useAppStore(state => state.setIsKoPlayerEnabled);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedItemIndex(index);
        
        // Use the entire row as the drag image
        const row = (e.currentTarget as HTMLElement).closest('.feature-row');
        if (row && e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(row, 20, row.clientHeight / 2);
        }

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        
        setTimeout(() => {
            if (row instanceof HTMLElement) {
                row.style.opacity = '0.4';
            }
        }, 0);
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const newOrder = [...featureOrder];
        const draggedItem = newOrder[draggedItemIndex];
        newOrder.splice(draggedItemIndex, 1);
        newOrder.splice(index, 0, draggedItem);

        setFeatureOrder(newOrder);
        setDraggedItemIndex(index); 
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        setDraggedItemIndex(null);
        const row = (e.currentTarget as HTMLElement).closest('.feature-row');
        if (row instanceof HTMLElement) {
            row.style.opacity = '1';
        }
    };

    const getFeatureMeta = (id: string): { icon: string; title: string; isEnabled: boolean; onToggle: () => void; desc: string } | null => {
        switch (id) {
            case 'shortcuts': return { icon: 'bolt', title: t('shortcuts'), isEnabled: isShortcutsEnabled, onToggle: () => setIsShortcutsEnabled(!isShortcutsEnabled), desc: 'Drag and drop files, folders, apps, or links for instant access.' };
            case 'copypaste': return { icon: 'content_paste', title: t('copyAndPaste'), isEnabled: isCopyPasteEnabled, onToggle: () => setIsCopyPasteEnabled(!isCopyPasteEnabled), desc: 'Multi-slot clipboard manager.' };
            case 'screenshot': return { icon: 'photo_camera', title: t('screenshot'), isEnabled: isScreenshotEnabled, onToggle: () => setIsScreenshotEnabled(!isScreenshotEnabled), desc: 'Quickly capture and save screen regions.' };
            case 'focusmode': return { icon: 'hourglass_empty', title: t('focusMode'), isEnabled: isFocusModeEnabled, onToggle: () => setIsFocusModeEnabled(!isFocusModeEnabled), desc: 'Pomodoro-style focus timer.' };
            case 'calculator': return { icon: 'calculate', title: t('calculator'), isEnabled: isCalculatorEnabled, onToggle: () => setIsCalculatorEnabled(!isCalculatorEnabled), desc: 'Quick-access calculator for everyday math.' };
            case 'colorpicker': return { icon: 'palette', title: t('colorPicker'), isEnabled: isColorPickerEnabled, onToggle: () => setIsColorPickerEnabled(!isColorPickerEnabled), desc: 'Screen color picker and palette manager.' };
            case 'todolist': return { icon: 'checklist', title: t('todoList'), isEnabled: isTodoListEnabled, onToggle: () => setIsTodoListEnabled(!isTodoListEnabled), desc: 'Manage your tasks directly from the sidebar.' };
            case 'kocalendar': return { icon: 'calendar_month', title: (t as any)('koCalendar') || 'Calendar', isEnabled: isKoCalendarEnabled, onToggle: () => setIsKoCalendarEnabled(!isKoCalendarEnabled), desc: 'Manage your local events and schedule.' };
            case 'pininjector': return { icon: 'push_pin', title: t('pinToTop'), isEnabled: isPinInjectorEnabled, onToggle: () => setIsPinInjectorEnabled(!isPinInjectorEnabled), desc: 'Pin any desktop window to the top.' };
            case 'kobox': return { icon: 'inventory_2', title: t('kobox'), isEnabled: isKoBoxEnabled, onToggle: () => setIsKoBoxEnabled(!isKoBoxEnabled), desc: 'Temporary file drop zone.' };
            case 'snippetvault': return { icon: 'library_books', title: t('snippetVault'), isEnabled: isSnippetVaultEnabled, onToggle: () => setIsSnippetVaultEnabled(!isSnippetVaultEnabled), desc: 'Save and reuse text snippets.' };
            case 'aihub': return { icon: 'smart_toy', title: t('aiHub'), isEnabled: isAiHubEnabled, onToggle: () => setIsAiHubEnabled(!isAiHubEnabled), desc: 'Quick access to AI assistants.' };
            case 'koplayer': return { icon: 'music_note', title: 'KoPlayer', isEnabled: isKoPlayerEnabled, onToggle: () => setIsKoPlayerEnabled(!isKoPlayerEnabled), desc: 'Global media controller.' };
            default: return null;
        }
    };

    const renderFeatureRow = (id: string, index: number) => {
        const meta = getFeatureMeta(id);
        if (!meta) return null;

        return (
            <div
                key={id}
                onDragEnter={(e) => handleDragEnter(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="feature-row relative rounded-xl border overflow-hidden transition-all duration-300"
                style={{
                    backgroundColor: design === 'style2' ? 'rgba(255,255,255,0.03)' : 'var(--theme-bg-dark)',
                    borderColor: meta.isEnabled
                        ? 'rgba(34, 197, 94, 0.25)'
                        : design === 'style2' ? 'rgba(255,255,255,0.05)' : 'var(--theme-border)',
                    boxShadow: meta.isEnabled
                        ? '0 0 24px -6px rgba(34, 197, 94, 0.35), inset 0 1px 0 rgba(34, 197, 94, 0.08)'
                        : '0 0 24px -6px rgba(239, 68, 68, 0.22), inset 0 1px 0 rgba(239, 68, 68, 0.05)',
                    transform: draggedItemIndex === index ? 'scale(1.02)' : 'none',
                    zIndex: draggedItemIndex === index ? 50 : 'auto',
                    position: 'relative',
                }}
            >
                 <div 
                    draggable
                    onDragStart={(e: any) => handleDragStart(e, index)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100 flex items-center justify-center p-2 cursor-move no-drag-region"
                >
                    <span className="material-symbols-outlined text-[20px]">drag_indicator</span>
                </div>

                <div className={`flex items-center gap-4 p-4 pl-10`}>
                    <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300`}
                        style={{ backgroundColor: meta.isEnabled ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.08)' }}
                    >
                        <span
                            className={`material-symbols-outlined text-[20px] transition-colors duration-300`}
                            style={{ color: meta.isEnabled ? '#22c55e' : '#6b7280' }}
                        >
                            {meta.icon}
                        </span>
                    </div>

                    <div className="flex flex-col flex-1 min-w-0">
                        <span className={`text-sm font-medium text-slate-300`}>
                            {meta.title}
                        </span>
                        <span className="text-xs text-slate-500 truncate mt-0.5">{meta.desc}</span>
                    </div>

                    <button
                        onClick={meta.onToggle}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 no-drag-region shrink-0 ${meta.isEnabled ? 'bg-green-500' : 'bg-slate-600'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${meta.isEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between px-2">
                <div className="flex flex-col">
                    <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">{(t as any)('featureToggles') || 'KoBar Features'}</h3>
                    <p className="text-xs text-slate-500 mt-1">{(t as any)('featuresDesc') || 'Enable, disable, and reorder native KoBar features.'}</p>
                </div>
            </div>

            <div className="flex flex-col gap-3 px-2">
                {featureOrder.map((id, index) => renderFeatureRow(id, index))}
            </div>
        </div>
    );
};

export default FeaturesView;
