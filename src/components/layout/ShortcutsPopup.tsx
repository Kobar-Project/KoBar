import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import TooltipButton from './TooltipButton';

const ShortcutsPopup: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const shortcutsAnchorRect = useAppStore(state => state.shortcutsAnchorRect);
    const setIsShortcutsOpen = useAppStore(state => state.setIsShortcutsOpen);
    const design = useAppStore(state => state.design);
    const isMac = useAppStore(state => state.isMac);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const pinnedApps = useAppStore(state => state.pinnedApps);
    const maxShortcuts = useAppStore(state => state.maxShortcuts);
    const pinApp = useAppStore(state => state.pinApp);
    const unpinApp = useAppStore(state => state.unpinApp);
    const reorderPinnedApps = useAppStore(state => state.reorderPinnedApps);
    const t = useAppStore(state => state.t);
    const screenBounds = useAppStore(state => state.screenBounds);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const orientation = useAppStore(state => state.orientation);
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const popupRef = useRef<HTMLDivElement>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
    const [dragEnabled, setDragEnabled] = useState(false);

    const [failedImageIds, setFailedImageIds] = useState<Record<string, boolean>>({});

    const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const prevPositions = useRef<Record<string, { left: number; top: number }>>({});

    useLayoutEffect(() => {
        const ids = [...pinnedApps.map(a => a.id)];
        if (pinnedApps.length < maxShortcuts) {
            ids.push('dropzone');
        }

        for (const id of ids) {
            const domNode = itemRefs.current[id];
            if (!domNode) continue;
            
            const rect = domNode.getBoundingClientRect();
            const prev = prevPositions.current[id];
            
            if (prev) {
                const dx = prev.left - rect.left;
                const dy = prev.top - rect.top;
                
                if (dx !== 0 || dy !== 0) {
                    domNode.style.transition = 'none';
                    domNode.style.transform = `translate(${dx}px, ${dy}px)`;
                    
                    domNode.getBoundingClientRect(); // force reflow
                    
                    domNode.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
                    domNode.style.transform = 'translate(0, 0)';

                    const handleTransitionEnd = () => {
                        domNode.style.transition = '';
                        domNode.style.transform = '';
                    };
                    domNode.addEventListener('transitionend', handleTransitionEnd, { once: true });
                }
            }
        }
        
        // Save current positions for the next render
        const newPositions: Record<string, { left: number; top: number }> = {};
        for (const id of ids) {
            const domNode = itemRefs.current[id];
            if (domNode) {
                const rect = domNode.getBoundingClientRect();
                newPositions[id] = { left: rect.left, top: rect.top };
            }
        }
        prevPositions.current = newPositions;
    }, [pinnedApps, maxShortcuts]);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedItemIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedItemIndex !== null && draggedItemIndex !== index) {
            reorderPinnedApps(draggedItemIndex, index);
            setDraggedItemIndex(index);
        }
    };

    const handleDragEnd = () => {
        setDraggedItemIndex(null);
        setDragEnabled(false);
    };

    useEffect(() => {
        const handleDocClick = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest('.shortcut-card')) {
                setDeletingId(null);
            }
        };
        document.addEventListener('mousedown', handleDocClick);
        return () => document.removeEventListener('mousedown', handleDocClick);
    }, []);

    const getPopupStyle = (): React.CSSProperties => {
        if (!shortcutsAnchorRect) return { display: 'none' };
        
        const popupHeight = 220; // Expected approximate height
        const popupWidth = 260; // w-[260px]
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-surface)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = (shortcutsAnchorRect.left - offsetLeft) + (shortcutsAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = screenXInViewport - offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isSmartPositioning) {
                style.left = '50%';
                style.transform = 'translateX(-50%)';
            } else {
                style.left = adjustedLeft;
            }

            if (edgePosition === 'top') {
                style.top = '100%';
                style.marginTop = '12px';
            } else {
                style.bottom = '100%';
                style.marginBottom = '12px';
            }
        } else {
            let adjustedTop = (shortcutsAnchorRect.top - offsetTop) - 20 + (shortcutsAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = screenYInViewport - offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) {
                style.top = '50%';
                style.transform = 'translateY(-50%)';
            } else {
                style.top = adjustedTop;
            }

            if (edgePosition === 'left') {
                style.left = '100%';
                style.marginLeft = '12px';
            } else {
                style.right = '100%';
                style.marginRight = '12px';
            }
        }
        return style;
    };

    const isSmartRef = useRef(isSmartPositioning);
    useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !shortcutsAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 220;
            const popupWidth = 260;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
            const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

            if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (shortcutsAnchorRect.left - newX) + (shortcutsAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;
            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (shortcutsAnchorRect.top - newY) - 20 + (shortcutsAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;
            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [shortcutsAnchorRect, screenBounds, orientation]);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        if (draggedItemIndex !== null) {
            // Internal drag, do nothing since handleDragEnter has already reordered it dynamically
            return;
        }
        if (pinnedApps.length >= maxShortcuts) return;

        let filePath = '';
        let name = '';
        let iconDataUrl = '';

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            filePath = window.api?.getFilePath(file) || (file as any).path as string;
            if (!filePath) return;
            
            iconDataUrl = await window.api?.getFileIcon(filePath) || '';
            name = file.name.replace(/\.[^/.]+$/, "");
        } else {
            let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('URL');
            if (!url) {
                const text = e.dataTransfer.getData('text/plain');
                if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
                    url = text.trim();
                }
            }
            if (!url) return;
            filePath = url.trim();

            const html = e.dataTransfer.getData('text/html');
            if (html) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    const linkEl = doc.querySelector('a');
                    if (linkEl) {
                        name = linkEl.textContent?.trim() || '';
                    }
                } catch (err) {
                    console.error('Failed to parse dropped HTML:', err);
                }
            }

            try {
                const parsedUrl = new URL(filePath);
                if (!name || name.trim() === '') {
                    name = parsedUrl.hostname.replace('www.', '');
                    if (!name) name = parsedUrl.pathname.split('/').filter(Boolean).pop() || filePath;
                }
                iconDataUrl = `https://www.google.com/s2/favicons?sz=64&domain=${parsedUrl.hostname}`;
            } catch (err) {
                if (!name || name.trim() === '') name = filePath;
            }
        }

        if (filePath) {
            pinApp({ id: Date.now().toString(), name, path: filePath, icon: iconDataUrl });
        }
    };

    return (
        <div
            ref={popupRef}
            className="w-[260px] border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl"
            style={getPopupStyle()}
        >
            <div className="flex justify-between items-center p-4 pb-3">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1 drag-region w-full">
                    {t('shortcuts') || 'Shortcuts'}
                </span>
                <button 
                    onClick={() => setIsShortcutsOpen(false)}
                    className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>

            <div 
                className="flex-1 p-4 grid grid-cols-3 gap-3 justify-items-center max-h-80 overflow-y-auto custom-scrollbar"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                {pinnedApps.slice(0, maxShortcuts).map((app, index) => {
                    const isWebUrlIcon = app.icon && (app.icon.startsWith('http://') || app.icon.startsWith('https://'));
                    const isGenericOrEmpty = failedImageIds[app.id] || (!isWebUrlIcon && (!app.icon || app.icon === '' || app.icon.length < 3000));
                    let finalName = app.name;
                    if (!finalName || finalName.trim() === '') {
                        try {
                            const url = new URL(app.path);
                            finalName = url.hostname.replace('www.', '') || url.pathname.split('/').filter(Boolean).pop() || app.path;
                        } catch {
                            finalName = app.path || '??';
                        }
                    }
                    let cleanName = finalName.replace(/[^a-zA-Z0-9]/g, '');
                    if (!cleanName) cleanName = finalName;
                    const appInitials = cleanName.substring(0, 2).toUpperCase();

                    return (
                        <div
                            key={app.id}
                            ref={el => { itemRefs.current[app.id] = el; }}
                            draggable={dragEnabled}
                            onDragStart={(e) => handleDragStart(e, index)}
                            onDragEnter={(e) => handleDragEnter(e, index)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                            onMouseDown={(e) => {
                                if (e.shiftKey) {
                                    setDragEnabled(true);
                                }
                            }}
                            onMouseUp={() => setDragEnabled(false)}
                            className={`shortcut-card relative w-16 h-16 animate-in fade-in slide-in-from-top-2 duration-300 transition-all ${
                                draggedItemIndex === index ? 'opacity-40 scale-95 border-dashed border-2 border-primary/50 rounded-xl' : ''
                            }`}
                        >
                            <TooltipButton
                                label={app.name}
                                className={`w-full h-full rounded-xl border flex items-center justify-center overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-lg cursor-pointer
                                    ${design === 'style2' ? 'bg-transparent' : 'bg-[#1e1b17]'}`}
                                style={{ borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)' }}
                                onMouseDown={(e) => {
                                    if (e.shiftKey) return;
                                    deleteTimeoutRef.current = setTimeout(() => setDeletingId(app.id), 600);
                                }}
                                onMouseUp={() => { if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current); }}
                                onMouseLeave={() => { if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current); }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (e.shiftKey) return;
                                    if (deletingId !== app.id && app.path) window.api?.launchFile(app.path);
                                }}
                            >
                                {isGenericOrEmpty ? (
                                    <div className="w-full h-full flex items-center justify-center font-bold text-xs text-primary/70">{appInitials}</div>
                                ) : (
                                    <img 
                                        src={app.icon} 
                                        className="w-full h-full object-contain p-3" 
                                        alt={app.name} 
                                        draggable={false} 
                                        onError={() => setFailedImageIds(prev => ({ ...prev, [app.id]: true }))}
                                    />
                                )}
                            </TooltipButton>

                            {deletingId === app.id && (
                                <button
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => { e.stopPropagation(); unpinApp(app.id); setDeletingId(null); }}
                                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white flex items-center justify-center shadow-lg hover:bg-red-600 z-10 cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                </button>
                            )}
                        </div>
                    );
                })}

                {pinnedApps.length < maxShortcuts && (
                    <div
                        ref={el => { itemRefs.current['dropzone'] = el; }}
                        className="w-16 h-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-slate-500 hover:text-primary hover:border-primary transition-all cursor-default bg-white/5 p-1"
                        style={{ borderColor: 'var(--theme-border)' }}
                    >
                        <span className="text-[10px] font-bold text-center leading-tight pointer-events-none">
                            Drop an URL or file address
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ShortcutsPopup;
