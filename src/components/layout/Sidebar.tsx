import React from 'react';
import ClipboardSlots from '../clipboard/ClipboardSlots';
import { useAppStore } from '../../store/useAppStore';
import { useScreenshotStore } from '../../store/useScreenshotStore';
import { setIsResizingGlobal } from '../../App';
import FocusButton from './FocusButton';
import CalculatorButton from './CalculatorButton';
import TooltipButton from './TooltipButton';

const Sidebar: React.FC = () => {
    const toggleNotePanel = useAppStore(state => state.toggleNotePanel);
    const edgePosition = useAppStore(state => state.edgePosition);
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const setMiniMode = useAppStore(state => state.setMiniMode);
    const pinnedApps = useAppStore(state => state.pinnedApps);
    const pinApp = useAppStore(state => state.pinApp);
    const unpinApp = useAppStore(state => state.unpinApp);
    const t = useAppStore(state => state.t);
    const isShortcutsEnabled = useAppStore(state => state.isShortcutsEnabled);
    const isCopyPasteEnabled = useAppStore(state => state.isCopyPasteEnabled);
    const isScreenshotEnabled = useAppStore(state => state.isScreenshotEnabled);
    const isFocusModeEnabled = useAppStore(state => state.isFocusModeEnabled);
    const isCalculatorEnabled = useAppStore(state => state.isCalculatorEnabled);
    const isColorPickerEnabled = useAppStore(state => state.isColorPickerEnabled);
    const setIsColorPickerOpen = useAppStore(state => state.setIsColorPickerOpen);
    const isColorPickerOpen = useAppStore(state => state.isColorPickerOpen);
    const setColorPickerAnchorRect = useAppStore(state => state.setColorPickerAnchorRect);
    const isMac = useAppStore(state => state.isMac);
    
    // Todo List
    const isTodoListEnabled = useAppStore(state => state.isTodoListEnabled);
    const isTodoListOpen = useAppStore(state => state.isTodoListOpen);
    const setIsTodoListOpen = useAppStore(state => state.setIsTodoListOpen);
    const setTodoListAnchorRect = useAppStore(state => state.setTodoListAnchorRect);

    // Pin Injector
    const isPinInjectorEnabled = useAppStore(state => state.isPinInjectorEnabled);
    const isTargetingMode = useAppStore(state => state.isTargetingMode);
    const setIsTargetingMode = useAppStore(state => state.setIsTargetingMode);
    const pinnedWindowHwnd = useAppStore(state => state.pinnedWindowHwnd);

    // KoBox
    const isKoBoxEnabled = useAppStore(state => state.isKoBoxEnabled);
    const [isKoBoxHovered, setIsKoBoxHovered] = React.useState(false);

    // Snippet Vault
    const isSnippetVaultEnabled = useAppStore(state => state.isSnippetVaultEnabled);
    const isSnippetVaultOpen = useAppStore(state => state.isSnippetVaultOpen);
    const setIsSnippetVaultOpen = useAppStore(state => state.setIsSnippetVaultOpen);
    const setSnippetVaultAnchorRect = useAppStore(state => state.setSnippetVaultAnchorRect);

    // AI Hub
    const isAiHubEnabled = useAppStore(state => state.isAiHubEnabled);
    const isAiHubOpen = useAppStore(state => state.isAiHubOpen);
    const setIsAiHubOpen = useAppStore(state => state.setIsAiHubOpen);
    const setAiHubAnchorRect = useAppStore(state => state.setAiHubAnchorRect);

    // KoPlayer
    const isKoPlayerEnabled = useAppStore(state => state.isKoPlayerEnabled);
    const isKoPlayerOpen = useAppStore(state => state.isKoPlayerOpen);
    const setIsKoPlayerOpen = useAppStore(state => state.setIsKoPlayerOpen);
    const setKoPlayerAnchorRect = useAppStore(state => state.setKoPlayerAnchorRect);

    // KoCalendar
    const isKoCalendarEnabled = useAppStore(state => state.isKoCalendarEnabled);
    const isKoCalendarOpen = useAppStore(state => state.isKoCalendarOpen);

    const maxShortcuts = useAppStore(state => state.maxShortcuts);
    const featureOrder = useAppStore(state => state.featureOrder);
    const featureSpacing = useAppStore(state => state.featureSpacing);

    const design = useAppStore(state => state.design);
    const sidebarWidth = useAppStore(state => state.sidebarWidth);
    const iconScale = useAppStore(state => state.iconScale);
    const toggleWidth = useAppStore(state => state.toggleWidth);
    const glassOpacity = useAppStore(state => state.glassOpacity);

    // Sidebar drag state
    const setSidebarPosition = useAppStore(state => state.setSidebarPosition);
    const [isSidebarDragging, setIsSidebarDragging] = React.useState(false);
    const sidebarDragRef = React.useRef({ offsetX: 0, offsetY: 0, lastX: 0, lastY: 0 });
    const localDisplaysRef = React.useRef<{ primaryDisplay: any, allDisplays: any[] } | null>(null);
    
    const dragRef = React.useRef({ startX: 0, startY: 0, dragged: false });
    const eyeButtonRef = React.useRef<HTMLButtonElement>(null);
    const sidebarContainerRef = React.useRef<HTMLDivElement>(null);
    
    // Drag to scroll logic
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [isDragScrolling, setIsDragScrolling] = React.useState(false);
    const scrollDragStart = React.useRef({ y: 0, scrollTop: 0 });

    const screenBounds = useAppStore(state => state.screenBounds);
    const calculatedMaxHeight = screenBounds ? Math.max(200, screenBounds.height - 40) : 800;

    const handleScrollMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || e.defaultPrevented) return;
        setIsDragScrolling(true);
        setIsResizingGlobal(true);
        scrollDragStart.current = { y: e.clientY, scrollTop: scrollRef.current?.scrollTop || 0 };
    };

    React.useEffect(() => {
        const handleScrollMouseMove = (e: MouseEvent) => {
            if (!isDragScrolling || !scrollRef.current) return;
            const dy = e.clientY - scrollDragStart.current.y;
            scrollRef.current.scrollTop = scrollDragStart.current.scrollTop - dy;
        };
        const handleScrollMouseUp = () => {
            if (isDragScrolling) {
                setIsDragScrolling(false);
                setIsResizingGlobal(false);
            }
        };

        if (isDragScrolling) {
            window.addEventListener('mousemove', handleScrollMouseMove);
            window.addEventListener('mouseup', handleScrollMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleScrollMouseMove);
            window.removeEventListener('mouseup', handleScrollMouseUp);
        };
    }, [isDragScrolling]);

    // Sidebar drag-to-move logic (drag the top handle bar)
    const handleSidebarDragStart = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setIsSidebarDragging(true);
        setIsResizingGlobal(true);
        
        // Fetch up-to-date screen topology to calculate drag positions accurately across multiple monitors.
        if (window.api?.getDisplaysInfo) {
            window.api.getDisplaysInfo().then(info => {
                localDisplaysRef.current = info;
            }).catch(err => console.warn('IPC getDisplaysInfo not ready yet:', err));
        }
        
        const wrapperEl = document.getElementById('kobar-sidebar-wrapper');
        const pos = useAppStore.getState().sidebarPosition;

        if (wrapperEl) {
            let startX = 0;
            let startY = 0;

            if (pos) {
                startX = pos.x;
                startY = pos.y;
            } else {
                const rect = wrapperEl.getBoundingClientRect();
                startX = rect.left;
                startY = rect.top;
            }

            sidebarDragRef.current = {
                offsetX: e.clientX - startX,
                offsetY: e.clientY - startY,
                lastX: startX,
                lastY: startY,
            };

            // Guarantee absolute position and neutralize any transform quirks
            wrapperEl.style.transform = 'none';
            wrapperEl.style.position = 'absolute';
            wrapperEl.style.left = `${startX}px`;
            wrapperEl.style.top = `${startY}px`;
        }
    };

    React.useEffect(() => {
        const handleSidebarDragMove = (e: MouseEvent) => {
            if (!isSidebarDragging) return;
            dragRef.current.dragged = true; // Mark that a real drag occurred (used by Eye click guard)
            const newX = e.clientX - sidebarDragRef.current.offsetX;
            const newY = e.clientY - sidebarDragRef.current.offsetY;
            
            // Fast DOM manipulation
            const wrapperEl = document.getElementById('kobar-sidebar-wrapper');
            if (wrapperEl) {
                wrapperEl.style.left = `${newX}px`;
                wrapperEl.style.top = `${newY}px`;
                document.dispatchEvent(new CustomEvent('kobar-drag', { detail: { x: newX, y: newY } }));
            }
            
            sidebarDragRef.current.lastX = newX;
            sidebarDragRef.current.lastY = newY;

            // Real-time multi-monitor edge detection
            let activeScreenCenter = 0;

            if (isMac) {
                const visibleW = screenBounds?.width ?? window.innerWidth;
                activeScreenCenter = visibleW / 2;
            } else {
                let primaryX = 0;
                let primaryW = 1920;
                let allDisplays = [] as any[];

                if (localDisplaysRef.current) {
                    primaryX = localDisplaysRef.current.primaryDisplay.workArea.x;
                    primaryW = localDisplaysRef.current.primaryDisplay.workArea.width;
                    allDisplays = localDisplaysRef.current.allDisplays;
                } else {
                    primaryX = screenBounds?.x ?? 0;
                    primaryW = screenBounds?.width ?? window.innerWidth;
                }

                // Compute exact absolute coordinates in OS space
                // Windows ghost window origin (newX=0) maps precisely to this physical OS pixel:
                const physicalOriginX = primaryX + (primaryW / 2) - 3000;
                // Add the relative dragged sidebar center to get absolute physical pixel:
                const physicalCurrentX = physicalOriginX + newX + (sidebarWidth / 2);

                let activeScreenPhysicalCenter = physicalOriginX + 3000; // Fallback to primary

                const activeMonitor = allDisplays.find(d => 
                    physicalCurrentX >= d.bounds.x && physicalCurrentX < (d.bounds.x + d.bounds.width)
                );

                if (activeMonitor) {
                    activeScreenPhysicalCenter = activeMonitor.bounds.x + (activeMonitor.bounds.width / 2);
                } else if (screenBounds) {
                    activeScreenPhysicalCenter = (screenBounds?.x ?? 0) + ((screenBounds?.width ?? window.innerWidth) / 2);
                }

                // Project center BACK to relative ghost window space for React math
                activeScreenCenter = activeScreenPhysicalCenter - physicalOriginX;
            }

            const currentCenter = newX + (sidebarWidth / 2);
            const isLeftHalf = currentCenter < activeScreenCenter;
            const newEdge = isLeftHalf ? 'left' : 'right';

            if (useAppStore.getState().edgePosition !== newEdge) {
                useAppStore.getState().setEdgePosition(newEdge);
            }
        };
        const handleSidebarDragEnd = () => {
            if (isSidebarDragging) {
                setIsSidebarDragging(false);
                setIsResizingGlobal(false);

                const pos = { x: sidebarDragRef.current.lastX, y: sidebarDragRef.current.lastY };
                // Synchronize global store with the final drop position
                setSidebarPosition(pos);

                let activeScreenCenter = 0;
                let visibleLeft = 0;
                let visibleRight = 0;

                if (isMac) {
                    const visibleW = screenBounds?.width ?? window.innerWidth;
                    visibleLeft = 0;
                    visibleRight = visibleW;
                    activeScreenCenter = visibleW / 2;
                } else {
                    let primaryX = 0;
                    let primaryW = 1920;
                    let allDisplays = [] as any[];

                    if (localDisplaysRef.current) {
                        primaryX = localDisplaysRef.current.primaryDisplay.workArea.x;
                        primaryW = localDisplaysRef.current.primaryDisplay.workArea.width;
                        allDisplays = localDisplaysRef.current.allDisplays;
                    } else {
                        primaryX = screenBounds?.x ?? 0;
                        primaryW = screenBounds?.width ?? window.innerWidth;
                    }

                    const physicalOriginX = primaryX + (primaryW / 2) - 3000;
                    const physicalCurrentX = physicalOriginX + pos.x + (sidebarWidth / 2);

                    const activeMonitor = allDisplays.find(d => 
                        physicalCurrentX >= d.bounds.x && physicalCurrentX < (d.bounds.x + d.bounds.width)
                    );

                    if (activeMonitor) {
                        visibleLeft = activeMonitor.bounds.x - physicalOriginX;
                        visibleRight = (activeMonitor.bounds.x + activeMonitor.bounds.width) - physicalOriginX;
                        activeScreenCenter = visibleLeft + (activeMonitor.bounds.width / 2);
                    } else {
                        const fallBackW = screenBounds?.width ?? window.innerWidth;
                        visibleLeft = 3000 + (screenBounds?.x ?? 0) - (fallBackW / 2);
                        visibleRight = visibleLeft + fallBackW;
                        activeScreenCenter = visibleLeft + (fallBackW / 2);
                    }
                }

                const currentCenter = pos.x + (sidebarWidth / 2);
                const isLeftHalf = currentCenter < activeScreenCenter;
                
                const SNAP_THRESHOLD = 100;
                const distToLeft = Math.abs(pos.x - visibleLeft);
                const distToRight = Math.abs(pos.x + sidebarWidth - visibleRight);

                if (distToLeft <= SNAP_THRESHOLD) {
                    // Snap to left edge of active monitor
                    useAppStore.getState().setEdgePosition('left');
                    setSidebarPosition({ x: visibleLeft, y: pos.y });
                } else if (distToRight <= SNAP_THRESHOLD) {
                    // Snap to right edge of active monitor
                    useAppStore.getState().setEdgePosition('right');
                    setSidebarPosition({ x: visibleRight - sidebarWidth, y: pos.y });
                } else {
                    // Free-floating: aktif ekranın hangi yarısında olduğuna (isLeftHalf) göre left/right ayarla
                    useAppStore.getState().setEdgePosition(isLeftHalf ? 'left' : 'right');
                    setSidebarPosition({ x: pos.x, y: pos.y });
                }
            }
        };
        if (isSidebarDragging) {
            window.addEventListener('mousemove', handleSidebarDragMove);
            window.addEventListener('mouseup', handleSidebarDragEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleSidebarDragMove);
            window.removeEventListener('mouseup', handleSidebarDragEnd);
        };
    }, [isSidebarDragging, screenBounds, sidebarWidth]);

    const setLastSidebarHeight = useAppStore(state => state.setLastSidebarHeight);

    // Send Rect to electron for clamping natively and store height locally
    React.useEffect(() => {
        if (!sidebarContainerRef.current) return;
        const observer = new ResizeObserver(() => {
            if (!sidebarContainerRef.current) return;
            const rect = sidebarContainerRef.current.getBoundingClientRect();
            // Store the dynamic height so we can anchor the sidebar to the bottom when exiting mini-mode
            setLastSidebarHeight(rect.height);
            
            window.api?.updateSidebarRect?.({
                 width: rect.width,
                 height: rect.height,
                 offsetX: rect.left,
                 offsetY: rect.top
            });
        });
        observer.observe(sidebarContainerRef.current);
        return () => observer.disconnect();
    }, []);

    // Launcher Delete State
    const [deletingId, setDeletingId] = React.useState<string | null>(null);
    const deleteTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        const handleDocClick = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest('.shortcut-item')) {
                setDeletingId(null);
            }
        };
        document.addEventListener('mousedown', handleDocClick);
        return () => document.removeEventListener('mousedown', handleDocClick);
    }, []);

    // Handle Eye Button: dual-purpose handle — drag moves the whole bar, click enters Mini Mode.
    const handleEyeMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        e.preventDefault(); // Prevent accidental text selection
        // Reset dragged flag before each interaction
        dragRef.current = { startX: e.clientX, startY: e.clientY, dragged: false };
        // Bridge: also kick off the sidebar drag so the Eye acts as a drag handle for the whole bar
        handleSidebarDragStart(e);
    };

    const handleEyeClick = () => {
        // If a real drag happened (handleSidebarDragMove set the flag), don't enter Mini Mode —
        // the sidebar was already repositioned by the drag system.
        if (dragRef.current.dragged) return;
        // Use the eye button's actual DOM rect center for pixel-perfect alignment
        if (eyeButtonRef.current) {
            const rect = eyeButtonRef.current.getBoundingClientRect();
            setMiniMode(true, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        } else {
            setMiniMode(true);
        }
    };

    return (
        <div className="relative z-50 h-fit pointer-events-none" style={{ width: `${sidebarWidth}px` }}>
            {/* 1. Main Floating Sidebar (Fixed Size, inner scrollable) */}
            <div 
                ref={sidebarContainerRef}
                className={`flex flex-col items-center py-4 w-full h-fit overflow-hidden pointer-events-auto transition-all duration-500
                    ${isMac && edgePosition === 'left' ? 'pt-8' : ''}
                    ${design === 'style2' 
                        ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-2xl') + ' rounded-[2.5rem] shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10') 
                        : 'bg-[var(--theme-bg-dark)] rounded-3xl shadow-2xl border border-[var(--theme-border)]'}`}
                style={{ 
                    maxHeight: `${calculatedMaxHeight}px`,
                    borderLeft: edgePosition === 'right' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : '', 
                    borderRight: edgePosition === 'left' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : '',
                    backgroundColor: design === 'style2' 
                        ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                        : 'var(--theme-bg-dark)'
                }}
            >
                {/* 1a. Top Drag Region & Branding (Always Top) */}
                <div 
                    className="h-6 w-full shrink-0 flex items-center justify-center -mb-2 cursor-grab active:cursor-grabbing"
                    onMouseDown={handleSidebarDragStart}
                >
                    <div className="w-8 h-1 bg-white/10 rounded-full mt-1 transition-all" style={{ zoom: iconScale }}></div>
                </div>

                <div className="w-10 h-px bg-white/5 no-drag-region shrink-0 my-2" />

                {/* 1b. Scrollable Container for Features */}
                <div 
                    ref={scrollRef}
                    onMouseDown={handleScrollMouseDown}
                    className="flex flex-col items-center w-full h-fit overflow-y-hidden custom-scrollbar" 
                >
                    <div className="w-full flex flex-col items-center cursor-default" style={{ zoom: iconScale, gap: `${featureSpacing}px` }}>
                    {/* Dynamic Feature Order with Separators */}
                    {(() => {
                        const features = featureOrder.map(featureId => {
                        switch (featureId) {
                            case 'shortcuts':
                                return isShortcutsEnabled ? (
                                    <div key="shortcuts" className="w-full flex flex-col items-center gap-3 no-drag-region px-2">
                                        <TooltipButton
                                            as="div"
                                            label={t('dragDropApp')}
                                            className="w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center text-slate-500 hover:text-primary hover:border-primary transition-all cursor-pointer group bg-white/5 hover:bg-white/10"
                                            style={{ borderColor: 'var(--theme-border)' }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={async (e: React.DragEvent) => {
                                                e.preventDefault();
                                                if (pinnedApps.length >= maxShortcuts) return;
                                                const file = e.dataTransfer.files[0];
                                                if (!file) return;
                                                const filePath = window.api?.getFilePath(file) || (file as any).path as string;
                                                if (!filePath) return;
                                                
                                                const iconDataUrl = await window.api?.getFileIcon(filePath);
                                                const name = file.name.replace(/\.[^/.]+$/, "");
                                                pinApp({ id: Date.now().toString(), name, path: filePath, icon: iconDataUrl || '' });
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px] group-hover:scale-110 transition-transform">add_to_home_screen</span>
                                        </TooltipButton>

                                        <div className="flex flex-col items-center gap-2.5 w-full">
                                            {pinnedApps.slice(0, maxShortcuts).map(app => {
                                                const isGenericOrEmpty = !app.icon || app.icon === '' || app.icon.length < 3000;
                                                const appInitials = app.name ? app.name.substring(0, 2).toUpperCase() : '??';

                                                return (
                                                    <div key={app.id} className="shortcut-item relative w-12 h-12 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <TooltipButton
                                                            label={app.name}
                                                            className={`w-full h-full rounded-xl border flex items-center justify-center overflow-hidden transition-all hover:scale-110 active:scale-95 shadow-lg
                                                                ${design === 'style2' ? 'bg-transparent' : 'bg-[#1e1b17]'}`}
                                                            style={{ borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)' }}
                                                            onMouseDown={() => {
                                                                deleteTimeoutRef.current = setTimeout(() => setDeletingId(app.id), 600);
                                                            }}
                                                            onMouseUp={() => { if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current); }}
                                                            onMouseLeave={() => { if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current); }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (deletingId !== app.id && app.path) window.api?.launchFile(app.path);
                                                            }}
                                                        >
                                                            {isGenericOrEmpty ? (
                                                                <div className="w-full h-full flex items-center justify-center font-bold text-[10px] text-primary/70">{appInitials}</div>
                                                            ) : (
                                                                <img src={app.icon} className="w-full h-full object-contain p-2" alt={app.name} draggable={false} />
                                                            )}
                                                        </TooltipButton>

                                                        {deletingId === app.id && (
                                                            <button
                                                                onMouseDown={(e) => e.stopPropagation()}
                                                                onClick={(e) => { e.stopPropagation(); unpinApp(app.id); setDeletingId(null); }}
                                                                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white flex items-center justify-center shadow-lg hover:bg-red-600 z-10"
                                                            >
                                                                <span className="material-symbols-outlined text-[12px]">close</span>
                                                            </button>
                                                            )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : null;
                            case 'aihub':
                                if (!isAiHubEnabled) return null;
                                return (
                                    <div key={featureId} className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('aiHub')}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setAiHubAnchorRect(rect);
                                                setIsAiHubOpen(!isAiHubOpen);
                                            }}
                                            className={`flex items-center justify-center rounded-full w-10 h-10 transition-colors ${isAiHubOpen ? 'bg-primary/20 text-primary' : 'bg-slate-800/50 hover:bg-slate-700/70'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 h-6 flex items-center justify-center ${isAiHubOpen ? 'text-primary' : 'text-slate-400'}`}>smart_toy</span>
                                        </TooltipButton>
                                    </div>
                                );
                            case 'copypaste':
                                return isCopyPasteEnabled ? (
                                    <div key="copypaste" className="w-full no-drag-region">
                                        <ClipboardSlots />
                                    </div>
                                ) : null;
                            case 'screenshot':
                                return isScreenshotEnabled ? (
                                    <div key="screenshot" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('screenshot')}
                                            className="w-12 h-12 rounded-full flex items-center justify-center text-slate-400 hover:text-primary transition-all bg-white/5 hover:bg-white/10 shadow-lg"
                                            onClick={() => useScreenshotStore.getState().setPhase('capturing')}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">photo_camera</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'focusmode':
                                return isFocusModeEnabled ? (
                                    <div key="focusmode" className="w-full flex justify-center no-drag-region">
                                        <FocusButton />
                                    </div>
                                ) : null;
                            case 'calculator':
                                return isCalculatorEnabled ? (
                                    <div key="calculator" className="w-full flex justify-center no-drag-region">
                                        <CalculatorButton />
                                    </div>
                                ) : null;
                            case 'colorpicker':
                                return isColorPickerEnabled ? (
                                    <div key="colorpicker" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('colorPicker')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isColorPickerOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isColorPickerOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setColorPickerAnchorRect(rect);
                                                setIsColorPickerOpen(!isColorPickerOpen);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">palette</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'kocalendar':
                                return isKoCalendarEnabled ? (
                                    <div key="kocalendar" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={(t as any)('koCalendar') || 'Calendar'}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isKoCalendarOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isKoCalendarOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                useAppStore.getState().setKoCalendarAnchorRect(rect);
                                                useAppStore.getState().setIsKoCalendarOpen(!isKoCalendarOpen);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">calendar_month</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'todolist':
                                return isTodoListEnabled ? (
                                    <div key="todolist" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('todoList')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isTodoListOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isTodoListOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setTodoListAnchorRect(rect);
                                                setIsTodoListOpen(!isTodoListOpen);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">checklist</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'pininjector':
                                return isPinInjectorEnabled ? (
                                    <div key="pininjector" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={pinnedWindowHwnd ? t('unpinCurrent') || 'Unpin Window' : t('pinToTop')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg
                                                ${pinnedWindowHwnd ? 'text-white' : 
                                                  isTargetingMode ? 'animate-pulse text-red-400 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 
                                                  'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10 hover:scale-110'}`}
                                            style={pinnedWindowHwnd ? { backgroundColor: '#10b981', boxShadow: '0 0 20px rgba(16,185,129,0.7)' } : undefined}
                                            onClick={(e) => {
                                                // Skip if double-click just fired
                                                if ((e.currentTarget as any)._skipClick) return;
                                                
                                                if (pinnedWindowHwnd) {
                                                    window.api?.unpinCurrentWindow?.();
                                                    return;
                                                }
                                                if (!isTargetingMode) {
                                                    setIsTargetingMode(true);
                                                    window.api?.enterPinTargetingMode?.();
                                                } else {
                                                    setIsTargetingMode(false);
                                                }
                                            }}
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                const target = e.currentTarget as any;
                                                target._skipClick = true;
                                                setTimeout(() => target._skipClick = false, 300);
                                                
                                                setIsTargetingMode(false);
                                                window.api?.unpinAll?.();
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">{pinnedWindowHwnd ? 'bookmark_remove' : 'push_pin'}</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'kobox':
                                return isKoBoxEnabled ? (
                                    <div key="kobox" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('kobox')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg
                                                ${isKoBoxHovered ? 'bg-primary/30 text-primary scale-110 shadow-[0_0_15px_rgba(244,161,37,0.4)]' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10 hover:scale-105'}`}
                                            onClick={() => window.api?.openKoBox?.()}
                                            onDragOver={(e) => { e.preventDefault(); setIsKoBoxHovered(true); }}
                                            onDragLeave={() => setIsKoBoxHovered(false)}
                                            onDrop={(e: React.DragEvent) => {
                                                e.preventDefault();
                                                setIsKoBoxHovered(false);
                                                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                                    const paths = Array.from(e.dataTransfer.files).map(f => window.api?.getFilePath?.(f) || (f as any).path).filter(Boolean) as string[];
                                                    if (paths.length > 0) {
                                                        window.api?.dropToKoBox?.(paths);
                                                    }
                                                }
                                            }}
                                        >
                                            <span className={`material-symbols-outlined text-[24px] transition-transform duration-300 ${isKoBoxHovered ? 'scale-125 rotate-12' : ''}`}>inventory_2</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'snippetvault':
                                return isSnippetVaultEnabled ? (
                                    <div key="snippetvault" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('snippetVault')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isSnippetVaultOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isSnippetVaultOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setSnippetVaultAnchorRect(rect);
                                                setIsSnippetVaultOpen(!isSnippetVaultOpen);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">library_books</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            case 'koplayer':
                                return isKoPlayerEnabled ? (
                                    <div key="koplayer" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label="KoPlayer"
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isKoPlayerOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isKoPlayerOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setKoPlayerAnchorRect(rect);
                                                setIsKoPlayerOpen(!isKoPlayerOpen);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">music_note</span>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            default:
                                return null;
                        }
                    }).filter(Boolean);

                    return features.map((feat, idx) => (
                        <React.Fragment key={idx}>
                            {feat}
                            {(idx < features.length - 1) && (
                                <div className="w-10 h-px bg-white/5 no-drag-region shrink-0" />
                            )}
                        </React.Fragment>
                    ));
                })()}
                    </div>
                </div> {/* End scrollable container */}

                <div className="w-10 h-px bg-white/5 no-drag-region shrink-0 my-2" />

                {/* 1c. Bottom Static Utilities (Always Bottom) */}
                <div className="flex flex-col items-center gap-4 no-drag-region shrink-0 px-2 pb-2">
                    <div style={{ zoom: iconScale }} className="transition-all">
                        <TooltipButton
                            label={t('miniMode')}
                            buttonRef={eyeButtonRef}
                            onMouseDown={handleEyeMouseDown}
                            onClick={handleEyeClick}
                            className={`w-12 h-12 rounded-full border-2 border-primary text-primary flex items-center justify-center transition-all hover:bg-primary/40 cursor-grab active:cursor-grabbing group mt-2
                                ${design === 'style2' ? 'bg-primary/5 backdrop-blur-md' : 'bg-primary/20 shadow-[0_0_20px_rgba(244,161,37,0.2)]'}`}
                        >
                            <span className="material-symbols-outlined text-[28px] group-hover:scale-110 transition-transform">visibility</span>
                        </TooltipButton>
                    </div>
                </div>
            </div>

            {/* 2. Toggle Notch (Outside scroll container to prevent clipping) */}
            <TooltipButton
                label={t('toggleNotes')}
                className="absolute top-1/2 -translate-y-1/2 h-12 border flex items-center justify-center text-slate-400 hover:text-primary hover:bg-white/5 transition-all shadow-2xl z-[60] pointer-events-auto"
                style={{ 
                    backgroundColor: design === 'style2' 
                        ? (isMac ? 'transparent' : `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)`) 
                        : 'var(--theme-bg-dark)', 
                    borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)',
                    width: `${toggleWidth}px`,
                    ...(design === 'style2' && !isMac ? { backdropFilter: 'blur(16px)' } : {}),
                    ...(edgePosition === 'left' 
                        ? { right: `-${toggleWidth}px`, borderLeft: 'none', borderTopRightRadius: design === 'style2' ? '15px' : '10px', borderBottomRightRadius: design === 'style2' ? '15px' : '10px' }
                        : { left: `-${toggleWidth}px`, borderRight: 'none', borderTopLeftRadius: design === 'style2' ? '15px' : '10px', borderBottomLeftRadius: design === 'style2' ? '15px' : '10px' })
                }}
                onClick={toggleNotePanel}
            >
                <span className="material-symbols-outlined text-[20px]">
                    {edgePosition === 'left' ? (isNotePanelOpen ? 'chevron_left' : 'chevron_right') : (isNotePanelOpen ? 'chevron_right' : 'chevron_left')}
                </span>
            </TooltipButton>
        </div>
    );
};

export default Sidebar;
