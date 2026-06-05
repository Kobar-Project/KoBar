import React from 'react';

import { useAppStore } from '../../store/useAppStore';

import { setIsResizingGlobal } from '../../App';

import TooltipButton from './TooltipButton';
import { useExtensionRegistry } from '../extensions/extensionRegistry';

const Sidebar: React.FC = () => {
    const toggleNotePanel = useAppStore(state => state.toggleNotePanel);
    const edgePosition = useAppStore(state => state.edgePosition);
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const setMiniMode = useAppStore(state => state.setMiniMode);
    const isMiniMode = useAppStore(state => state.isMiniMode);

    const t = useAppStore(state => state.t);

    const isMac = useAppStore(state => state.isMac);
    




    const featureOrder = useAppStore(state => state.featureOrder);
    const setFeatureOrder = useAppStore(state => state.setFeatureOrder);
    const featureSpacing = useAppStore(state => state.featureSpacing);

    const design = useAppStore(state => state.design);
    const sidebarWidth = useAppStore(state => state.sidebarWidth);
    const iconScale = useAppStore(state => state.iconScale);
    const toggleWidth = useAppStore(state => state.toggleWidth);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const enableEyeAnimation = useAppStore(state => state.enableEyeAnimation);
    const orientation = useAppStore(state => state.orientation);
    
    // Dynamic Extensions selectors
    const activeExtensionPanelId = useAppStore(state => state.activeExtensionPanelId);
    const extensionReloadTrigger = useAppStore(state => state.extensionReloadTrigger);
    void extensionReloadTrigger; // Force re-render on reload, mark as used to prevent TS6133
    const extensionsRegistry = useExtensionRegistry();

    // Sidebar drag state
    const setSidebarPosition = useAppStore(state => state.setSidebarPosition);
    const [isSidebarDragging, setIsSidebarDragging] = React.useState(false);
    const sidebarDragRef = React.useRef({ offsetX: 0, offsetY: 0, lastX: 0, lastY: 0 });
    const localDisplaysRef = React.useRef<{ primaryDisplay: any, allDisplays: any[] } | null>(null);
    const windowPosRef = React.useRef({ x: 0, y: 0 });
    
    const dragRef = React.useRef({ startX: 0, startY: 0, dragged: false });
    const eyeButtonRef = React.useRef<HTMLButtonElement>(null);
    const innerEyeRef = React.useRef<HTMLSpanElement>(null);
    const sidebarContainerRef = React.useRef<HTMLDivElement>(null);

    const [reorderMode, setReorderMode] = React.useState<boolean>(false);
    const longPressTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [dragOverId, setDragOverId] = React.useState<string | null>(null);

    React.useEffect(() => {
        const handleGlobalClick = () => {
            if (reorderMode) setReorderMode(false);
        };
        window.addEventListener('click', handleGlobalClick);
        return () => window.removeEventListener('click', handleGlobalClick);
    }, [reorderMode]);

    const handlePluginMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || reorderMode) return;
        longPressTimeout.current = setTimeout(() => {
            setReorderMode(true);
            setIsDragScrolling(false);
        }, 500);
    };

    const handlePluginMouseUp = () => {
        if (longPressTimeout.current) {
            clearTimeout(longPressTimeout.current);
            longPressTimeout.current = null;
        }
    };

    const onPluginDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    };

    const onPluginDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOverId !== id) {
            setDragOverId(id);
        }
    };

    const onPluginDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        setDragOverId(null);
        const sourceId = e.dataTransfer.getData('text/plain');
        if (sourceId && sourceId !== targetId) {
            const newOrder = [...featureOrder];
            const sourceIdx = newOrder.indexOf(sourceId);
            const targetIdx = newOrder.indexOf(targetId);
            
            if (sourceIdx !== -1 && targetIdx !== -1) {
                newOrder.splice(sourceIdx, 1);
                newOrder.splice(targetIdx, 0, sourceId);
                setFeatureOrder(newOrder);
            }
        }
    };

    const [isDev, setIsDev] = React.useState(false);

    React.useEffect(() => {
        if (window.api?.isDev) {
            window.api.isDev().then(setIsDev);
        }
    }, []);
    
    // Drag to scroll logic
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [isDragScrolling, setIsDragScrolling] = React.useState(false);
    const scrollDragStart = React.useRef({ y: 0, scrollTop: 0 });

    const screenBounds = useAppStore(state => state.screenBounds);
    const calculatedMaxHeight = screenBounds ? Math.max(200, screenBounds.height - 40) : 800;
    const calculatedMaxWidth = screenBounds ? Math.max(200, screenBounds.width - 40) : 1200;

    const handleScrollMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || e.defaultPrevented) return;
        setIsDragScrolling(true);
        setIsResizingGlobal(true);
        scrollDragStart.current = { 
            y: orientation === 'horizontal' ? e.clientX : e.clientY, 
            scrollTop: orientation === 'horizontal' 
                ? (scrollRef.current?.scrollLeft || 0) 
                : (scrollRef.current?.scrollTop || 0) 
        };
    };

    React.useEffect(() => {
        const handleScrollMouseMove = (e: MouseEvent) => {
            if (!isDragScrolling || !scrollRef.current) return;
            const d = (orientation === 'horizontal' ? e.clientX : e.clientY) - scrollDragStart.current.y;
            if (orientation === 'horizontal') {
                scrollRef.current.scrollLeft = scrollDragStart.current.scrollTop - d;
            } else {
                scrollRef.current.scrollTop = scrollDragStart.current.scrollTop - d;
            }
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
    }, [isDragScrolling, orientation]);

    // Sidebar drag-to-move logic (drag the top handle bar)
    const handleSidebarDragStart = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setIsSidebarDragging(true);
        setIsResizingGlobal(true);
        useAppStore.getState().setIsDraggingGlobal(true);
        
        // Fetch up-to-date screen topology to calculate drag positions accurately across multiple monitors.
        if (window.api?.getDisplaysInfo) {
            window.api.getDisplaysInfo().then(info => {
                localDisplaysRef.current = info;
            }).catch(err => console.warn('IPC getDisplaysInfo not ready yet:', err));
        }

        // Initialize window position synchronously
        if (window.api?.getWindowPositionSync) {
            const [wx, wy] = window.api.getWindowPositionSync();
            windowPosRef.current = { x: wx, y: wy };
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
            
            let mouseX = e.clientX;
            let mouseY = e.clientY;

            // Physical cursor position
            const physicalCursorX = windowPosRef.current.x + mouseX;
            const physicalCursorY = windowPosRef.current.y + mouseY;

            // Find if we crossed display boundary
            if (localDisplaysRef.current && !isMac) {
                const allDisplays = localDisplaysRef.current.allDisplays;
                const activeDisplay = allDisplays.find(d => 
                    physicalCursorX >= d.bounds.x && physicalCursorX < (d.bounds.x + d.bounds.width) &&
                    physicalCursorY >= d.bounds.y && physicalCursorY < (d.bounds.y + d.bounds.height)
                );

                if (activeDisplay) {
                    const windowWidth = 6000;
                    const newWinX = Math.floor(activeDisplay.workArea.x + (activeDisplay.workArea.width / 2) - (windowWidth / 2));
                    const newWinY = activeDisplay.workArea.y;

                    if (newWinX !== windowPosRef.current.x || newWinY !== windowPosRef.current.y) {
                        const dx = newWinX - windowPosRef.current.x;
                        const dy = newWinY - windowPosRef.current.y;

                        // Move the window
                        window.api?.moveWindow(dx, dy);

                        // Update local window position ref
                        windowPosRef.current = { x: newWinX, y: newWinY };

                        // Adjust last values and DOM positions
                        sidebarDragRef.current.lastX -= dx;
                        sidebarDragRef.current.lastY -= dy;
                        
                        const wrapperEl = document.getElementById('kobar-sidebar-wrapper');
                        if (wrapperEl) {
                            wrapperEl.style.left = `${sidebarDragRef.current.lastX}px`;
                            wrapperEl.style.top = `${sidebarDragRef.current.lastY}px`;
                        }

                        // Adjust local event mouse coords for calculations below
                        mouseX -= dx;
                        mouseY -= dy;
                    }
                }
            }

            const newX = mouseX - sidebarDragRef.current.offsetX;
            const newY = mouseY - sidebarDragRef.current.offsetY;
            
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
            let activeScreenCenterY = 0;

            if (isMac) {
                const visibleW = screenBounds?.width ?? window.innerWidth;
                const visibleH = screenBounds?.height ?? window.innerHeight;
                activeScreenCenter = visibleW / 2;
                activeScreenCenterY = visibleH / 2;
            } else {
                let allDisplays = [] as any[];

                if (localDisplaysRef.current) {
                    allDisplays = localDisplaysRef.current.allDisplays;
                }

                // Compute exact absolute coordinates in OS space
                // Windows ghost window origin (newX=0) maps precisely to this physical OS pixel:
                const physicalOriginX = windowPosRef.current.x;
                const physicalOriginY = windowPosRef.current.y;
                
                // Add relative dragged sidebar center to get absolute physical pixel
                const physicalCurrentX = physicalOriginX + newX + (orientation === 'horizontal' ? 0 : sidebarWidth / 2);
                const physicalCurrentY = physicalOriginY + newY + (orientation === 'horizontal' ? sidebarWidth / 2 : 0);

                let activeScreenPhysicalCenter = physicalOriginX + 3000; // Fallback to primary
                let activeScreenPhysicalCenterY = physicalOriginY + 2000;

                const activeMonitor = allDisplays.find(d => 
                    physicalCurrentX >= d.bounds.x && physicalCurrentX < (d.bounds.x + d.bounds.width) &&
                    physicalCurrentY >= d.bounds.y && physicalCurrentY < (d.bounds.y + d.bounds.height)
                ) || allDisplays.find(d => 
                    physicalCurrentX >= d.bounds.x && physicalCurrentX < (d.bounds.x + d.bounds.width)
                );

                if (activeMonitor) {
                    activeScreenPhysicalCenter = activeMonitor.bounds.x + (activeMonitor.bounds.width / 2);
                    activeScreenPhysicalCenterY = activeMonitor.bounds.y + (activeMonitor.bounds.height / 2);
                } else if (screenBounds) {
                    activeScreenPhysicalCenter = (screenBounds?.x ?? 0) + ((screenBounds?.width ?? window.innerWidth) / 2);
                    activeScreenPhysicalCenterY = (screenBounds?.y ?? 0) + ((screenBounds?.height ?? window.innerHeight) / 2);
                }

                // Project center BACK to relative ghost window space for React math
                activeScreenCenter = activeScreenPhysicalCenter - physicalOriginX;
                activeScreenCenterY = activeScreenPhysicalCenterY - physicalOriginY;
            }

            if (orientation === 'horizontal') {
                const currentCenterY = newY + (sidebarWidth / 2);
                const isTopHalf = currentCenterY < activeScreenCenterY;
                const newEdge = isTopHalf ? 'top' : 'bottom';
                if (useAppStore.getState().edgePosition !== newEdge) {
                    useAppStore.getState().setEdgePosition(newEdge);
                }
            } else {
                const currentCenter = newX + (sidebarWidth / 2);
                const isLeftHalf = currentCenter < activeScreenCenter;
                const newEdge = isLeftHalf ? 'left' : 'right';
                if (useAppStore.getState().edgePosition !== newEdge) {
                    useAppStore.getState().setEdgePosition(newEdge);
                }
            }
        };
        const handleSidebarDragEnd = async () => {
            if (isSidebarDragging) {
                if (!dragRef.current.dragged) {
                    setIsSidebarDragging(false);
                    setIsResizingGlobal(false);
                    useAppStore.getState().setIsDraggingGlobal(false);
                    return;
                }

                let pos = { x: sidebarDragRef.current.lastX, y: sidebarDragRef.current.lastY };
                let displayBounds = null;

                if (window.api?.recenterWindowOnWidget && !isMac) {
                    const result = await window.api.recenterWindowOnWidget(pos.x, pos.y, sidebarWidth, 20);
                    if (result) {
                        pos = { x: result.x, y: result.y };
                        displayBounds = result.displayBounds;
                    }
                }

                let activeScreenCenter = 0;
                let activeScreenCenterY = 0;
                let visibleLeft = 0;
                let visibleRight = 0;
                let visibleTop = 0;
                let visibleBottom = 0;

                if (isMac) {
                    const visibleW = screenBounds?.width ?? window.innerWidth;
                    const visibleH = screenBounds?.height ?? window.innerHeight;
                    visibleLeft = 0;
                    visibleRight = visibleW;
                    visibleTop = 0;
                    visibleBottom = visibleH;
                    activeScreenCenter = visibleW / 2;
                    activeScreenCenterY = visibleH / 2;
                } else {
                    // Since the window has been recentered on the active monitor, the active monitor's bounds
                    // relative to the window are simplified:
                    // window center is at X=3000, so active monitor starts at 3000 - activeMonitorW / 2
                    // and ends at 3000 + activeMonitorW / 2.
                    const activeMonitorW = displayBounds?.width ?? screenBounds?.width ?? window.innerWidth;
                    const activeMonitorH = displayBounds?.height ?? screenBounds?.height ?? window.innerHeight;
                    visibleLeft = 3000 - activeMonitorW / 2;
                    visibleRight = 3000 + activeMonitorW / 2;
                    visibleTop = 0;
                    visibleBottom = activeMonitorH;
                    activeScreenCenter = 3000;
                    activeScreenCenterY = activeMonitorH / 2;
                }

                const SNAP_THRESHOLD = 100;

                if (orientation === 'horizontal') {
                    const currentCenterY = pos.y + (sidebarWidth / 2);
                    const isTopHalf = currentCenterY < activeScreenCenterY;
                    const distToTop = Math.abs(pos.y - visibleTop);
                    const distToBottom = Math.abs(pos.y + sidebarWidth - visibleBottom);

                    if (distToTop <= SNAP_THRESHOLD) {
                        useAppStore.getState().setEdgePosition('top');
                        pos = { x: pos.x, y: visibleTop };
                    } else if (distToBottom <= SNAP_THRESHOLD) {
                        useAppStore.getState().setEdgePosition('bottom');
                        pos = { x: pos.x, y: visibleBottom - sidebarWidth };
                    } else {
                        useAppStore.getState().setEdgePosition(isTopHalf ? 'top' : 'bottom');
                        pos = { x: pos.x, y: pos.y };
                    }
                } else {
                    const currentCenter = pos.x + (sidebarWidth / 2);
                    const isLeftHalf = currentCenter < activeScreenCenter;
                    const distToLeft = Math.abs(pos.x - visibleLeft);
                    const distToRight = Math.abs(pos.x + sidebarWidth - visibleRight);

                    if (distToLeft <= SNAP_THRESHOLD) {
                        // Snap to left edge of active monitor
                        useAppStore.getState().setEdgePosition('left');
                        pos = { x: visibleLeft, y: pos.y };
                    } else if (distToRight <= SNAP_THRESHOLD) {
                        // Snap to right edge of active monitor
                        useAppStore.getState().setEdgePosition('right');
                        pos = { x: visibleRight - sidebarWidth, y: pos.y };
                    } else {
                        // Free-floating: aktif ekranın hangi yarısında olduğuna (isLeftHalf) göre left/right ayarla
                        useAppStore.getState().setEdgePosition(isLeftHalf ? 'left' : 'right');
                        pos = { x: pos.x, y: pos.y };
                    }
                }

                // Synchronize global store with the final drop position AFTER calculations
                setSidebarPosition(pos);

                setIsSidebarDragging(false);
                setIsResizingGlobal(false);
                useAppStore.getState().setIsDraggingGlobal(false);
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
    }, [isSidebarDragging, screenBounds, sidebarWidth, orientation]);

    const setLastSidebarHeight = useAppStore(state => state.setLastSidebarHeight);
    const setLastSidebarWidth = useAppStore(state => state.setLastSidebarWidth);

    // Send Rect to electron for clamping natively and store height locally
    React.useEffect(() => {
        if (!sidebarContainerRef.current) return;
        const observer = new ResizeObserver(() => {
            if (!sidebarContainerRef.current) return;
            const rect = sidebarContainerRef.current.getBoundingClientRect();
            // Store the dynamic height and width so we can anchor the sidebar when exiting mini-mode
            setLastSidebarHeight(rect.height);
            setLastSidebarWidth(rect.width);
            
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



    // Eye icon cursor tracking
    React.useEffect(() => {
        if (!enableEyeAnimation) {
            if (innerEyeRef.current) {
                innerEyeRef.current.style.transform = 'translate(0px, 0px)';
                innerEyeRef.current.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)';
            }
            return;
        }

        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (!innerEyeRef.current || !eyeButtonRef.current) return;
            
            const rect = eyeButtonRef.current.getBoundingClientRect();
            const btnX = rect.left + rect.width / 2;
            const btnY = rect.top + rect.height / 2;
            
            const dx = e.clientX - btnX;
            const dy = e.clientY - btnY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const maxTranslate = 5; // px
            
            if (distance > 0) {
                const theta = Math.atan2(dy, dx);
                const pull = Math.min(distance / 150, 1);
                const tx = Math.cos(theta) * pull * maxTranslate;
                const ty = Math.sin(theta) * pull * maxTranslate;
                
                innerEyeRef.current.style.transition = 'none';
                innerEyeRef.current.style.transform = `translate(${tx}px, ${ty}px)`;
            } else {
                innerEyeRef.current.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)';
                innerEyeRef.current.style.transform = 'translate(0px, 0px)';
            }
        };

        const handleMouseLeave = () => {
            if (innerEyeRef.current) {
                innerEyeRef.current.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)';
                innerEyeRef.current.style.transform = 'translate(0px, 0px)';
            }
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseleave', handleMouseLeave);
        
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [enableEyeAnimation]);

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
        <div className="relative z-50 pointer-events-none" style={{ width: orientation === 'horizontal' ? 'fit-content' : `${sidebarWidth}px`, height: orientation === 'horizontal' ? `${sidebarWidth}px` : 'fit-content' }}>
            <div 
                ref={sidebarContainerRef}
                className={`flex ${orientation === 'horizontal' ? 'flex-row pl-4 pr-2 h-full w-fit' : 'flex-col pt-4 pb-2 w-full h-fit'} items-center overflow-hidden ${isMiniMode ? 'pointer-events-none' : 'pointer-events-auto'} transition-all duration-500
                    ${orientation === 'horizontal' ? '' : (isMac && edgePosition === 'left' ? 'pt-8' : '')}
                    ${design === 'style2' 
                        ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-2xl') + ' rounded-[2.5rem] shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10') 
                        : 'bg-[var(--theme-bg-dark)] rounded-3xl shadow-2xl border border-[var(--theme-border)]'}`}
                style={{ 
                    maxHeight: orientation === 'horizontal' ? undefined : `${calculatedMaxHeight}px`,
                    maxWidth: orientation === 'horizontal' ? `${calculatedMaxWidth}px` : undefined,
                    borderLeft: orientation === 'horizontal' ? '' : (edgePosition === 'right' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : ''), 
                    borderRight: orientation === 'horizontal' ? '' : (edgePosition === 'left' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : ''),
                    borderTop: orientation === 'horizontal' && edgePosition === 'bottom' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : '',
                    borderBottom: orientation === 'horizontal' && edgePosition === 'top' ? (design === 'style2' ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--theme-border)') : '',
                    backgroundColor: design === 'style2' 
                        ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                        : 'var(--theme-bg-dark)'
                }}
            >
                {/* 1a. Top/Left Drag Region & Branding */}
                <div 
                    className={`${orientation === 'horizontal' ? 'w-6 h-full -mr-2' : 'h-6 w-full -mb-2'} shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing`}
                    onMouseDown={handleSidebarDragStart}
                >
                    <div className={`${orientation === 'horizontal' ? 'w-1 h-8 ml-1' : 'w-8 h-1 mt-1'} bg-white/10 rounded-full transition-all`} style={{ zoom: iconScale }}></div>
                </div>

                <div className={`${orientation === 'horizontal' ? 'h-10 w-px mx-2' : 'w-10 h-px my-2'} bg-white/5 no-drag-region shrink-0`} />

                {/* 1b. Scrollable Container for Features */}
                <div 
                    ref={scrollRef}
                    onMouseDown={handleScrollMouseDown}
                    className={`flex ${orientation === 'horizontal' ? 'flex-row h-full w-fit overflow-x-hidden' : 'flex-col w-full h-fit overflow-y-hidden'} items-center custom-scrollbar`} 
                >
                    <div className={`${orientation === 'horizontal' ? 'h-full flex-row px-1.5' : 'w-full flex-col py-1.5'} flex items-center cursor-default`} style={{ zoom: iconScale, gap: `${featureSpacing}px` }}>
                    {/* Dynamic Feature Order with Separators */}
                    {(() => {
                        const dynamicButtons = extensionsRegistry.getButtons();
                        const dynamicInlineWidgets = extensionsRegistry.getInlineWidgets();
                        
                        const allExts = [...dynamicButtons, ...dynamicInlineWidgets];

                        // Ensure missing plugins are added to featureOrder implicitly (so they show at the end)
                        const missing = allExts.map(e => e.id).filter(id => !featureOrder.includes(id));
                        if (missing.length > 0) {
                            setTimeout(() => setFeatureOrder([...featureOrder, ...missing]), 0);
                        }

                        // Sort all plugins according to featureOrder
                        const sortedFeatures = [...allExts].sort((a, b) => {
                            const idxA = featureOrder.indexOf(a.id);
                            const idxB = featureOrder.indexOf(b.id);
                            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                            if (idxA !== -1 && idxB === -1) return -1;
                            if (idxA === -1 && idxB !== -1) return 1;
                            return 0;
                        });

                        return sortedFeatures.map((feat: any, idx) => {
                            const isWidget = !!feat.render;
                            const id = feat.id;
                            const isDragOver = dragOverId === id;
                            
                            return (
                                <React.Fragment key={id}>
                                    <div 
                                        draggable={reorderMode}
                                        onDragStart={(e) => onPluginDragStart(e, id)}
                                        onDragOver={(e) => onPluginDragOver(e, id)}
                                        onDrop={(e) => onPluginDrop(e, id)}
                                        onDragLeave={() => setDragOverId(null)}
                                        onMouseDown={handlePluginMouseDown}
                                        onMouseUp={handlePluginMouseUp}
                                        onMouseLeave={handlePluginMouseUp}
                                        className={`w-full flex justify-center no-drag-region transition-all ${reorderMode ? 'cursor-grab hover:scale-105 active:cursor-grabbing' : ''} ${reorderMode && !isDragScrolling ? 'animate-pulse' : ''}`}
                                        style={{ 
                                            transform: isDragOver ? (orientation === 'horizontal' ? 'translateX(10px)' : 'translateY(10px)') : 'none',
                                            opacity: isDragOver ? 0.5 : 1
                                        }}
                                    >
                                        {isWidget ? (
                                            feat.render()
                                        ) : (
                                            <TooltipButton
                                                label={reorderMode ? (t('dragToReorder' as any) || 'Drag to reorder') : feat.label}
                                                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg
                                                    ${!reorderMode ? 'hover:scale-110 active:scale-95' : ''}
                                                    ${activeExtensionPanelId === id ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                                style={{ borderWidth: activeExtensionPanelId === id ? '1px' : '0px', pointerEvents: reorderMode ? 'none' : 'auto' }}
                                                onClick={(e) => {
                                                    if (reorderMode) return;
                                                    const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                    feat.onClick(e as any, rect);
                                                }}
                                            >
                                                <span className="material-symbols-outlined text-[24px]">{feat.icon}</span>
                                            </TooltipButton>
                                        )}
                                    </div>
                                    {(idx < sortedFeatures.length - 1) && (
                                        <div className={`${orientation === 'horizontal' ? 'h-10 w-px' : 'w-10 h-px'} bg-white/5 no-drag-region shrink-0`} />
                                    )}
                                </React.Fragment>
                            );
                        });
                    })()}
                    </div>
                </div> {/* End scrollable container */}

                <div className={`${orientation === 'horizontal' ? 'h-10 w-px mx-2' : 'w-10 h-px my-2'} bg-white/5 no-drag-region shrink-0`} />

                {/* 1c. Bottom Static Utilities (Always Bottom / Right) */}
                <div className={`flex ${orientation === 'horizontal' ? 'flex-row' : 'flex-col'} items-center gap-4 no-drag-region shrink-0 ${orientation === 'horizontal' ? 'py-2 pr-0' : 'px-2 pb-0'}`}>
                    <div style={{ zoom: iconScale }} className="transition-all">
                        <TooltipButton
                            label={t('miniMode')}
                            buttonRef={eyeButtonRef}
                            onMouseDown={handleEyeMouseDown}
                            onClick={handleEyeClick}
                            className={`w-12 h-12 rounded-full border-2 border-primary text-primary flex items-center justify-center transition-all hover:bg-primary/40 cursor-grab active:cursor-grabbing group relative ${orientation === 'horizontal' ? '' : 'mt-2'}
                                ${design === 'style2' ? 'bg-primary/5 backdrop-blur-md' : 'bg-primary/20 shadow-[0_0_20px_rgba(244,161,37,0.2)]'}`}
                        >
                            <span ref={innerEyeRef} className="flex items-center justify-center pointer-events-none">
                                <span className="material-symbols-outlined text-[28px] group-hover:scale-110 transition-transform">visibility</span>
                            </span>
                            {/* isDev && (
                                <span className="absolute -top-1 -right-1 z-[1000] bg-orange-500 text-black text-[9px] font-extrabold px-1 py-0.5 rounded-sm border border-orange-600 shadow-[0_0_8px_rgba(249,115,22,0.6)] select-none pointer-events-none tracking-wide scale-90 origin-top-right uppercase leading-none font-sans">
                                    dev
                                </span>
                            ) */}
                        </TooltipButton>
                    </div>
                </div>
            </div>

            <TooltipButton
                label={t('toggleNotes')}
                className={`absolute border flex items-center justify-center text-slate-400 hover:text-primary hover:bg-white/5 transition-all shadow-2xl z-[60] ${isMiniMode ? 'pointer-events-none' : 'pointer-events-auto'}`}
                style={{ 
                    backgroundColor: design === 'style2' 
                        ? (isMac ? 'transparent' : `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)`) 
                        : 'var(--theme-bg-dark)', 
                    borderColor: design === 'style2' ? 'rgba(255,255,255,0.1)' : 'var(--theme-border)',
                    ...(orientation === 'horizontal'
                        ? {
                            left: '50%',
                            transform: 'translateX(-50%)',
                            height: `${toggleWidth}px`,
                            width: '48px',
                            ...(edgePosition === 'top'
                                ? { top: '100%', borderTop: 'none', borderBottomRightRadius: design === 'style2' ? '15px' : '10px', borderBottomLeftRadius: design === 'style2' ? '15px' : '10px' }
                                : { bottom: '100%', borderBottom: 'none', borderTopRightRadius: design === 'style2' ? '15px' : '10px', borderTopLeftRadius: design === 'style2' ? '15px' : '10px' }
                            )
                        }
                        : {
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: `${toggleWidth}px`,
                            height: '48px',
                            ...(edgePosition === 'left' 
                                ? { right: `-${toggleWidth}px`, borderLeft: 'none', borderTopRightRadius: design === 'style2' ? '15px' : '10px', borderBottomRightRadius: design === 'style2' ? '15px' : '10px' }
                                : { left: `-${toggleWidth}px`, borderRight: 'none', borderTopLeftRadius: design === 'style2' ? '15px' : '10px', borderBottomLeftRadius: design === 'style2' ? '15px' : '10px' })
                        }
                    ),
                    ...(design === 'style2' && !isMac ? { backdropFilter: 'blur(16px)' } : {}),
                }}
                onClick={toggleNotePanel}
            >
                <span className="material-symbols-outlined text-[20px]">
                    {orientation === 'horizontal'
                        ? (edgePosition === 'top' ? (isNotePanelOpen ? 'expand_less' : 'expand_more') : (isNotePanelOpen ? 'expand_more' : 'expand_less'))
                        : (edgePosition === 'left' ? (isNotePanelOpen ? 'chevron_left' : 'chevron_right') : (isNotePanelOpen ? 'chevron_right' : 'chevron_left'))
                    }
                </span>
            </TooltipButton>
        </div>
    );
};

export default Sidebar;
