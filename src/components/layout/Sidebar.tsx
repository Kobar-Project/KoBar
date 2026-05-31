import React from 'react';
import ClipboardSlots from '../clipboard/ClipboardSlots';
import { useAppStore } from '../../store/useAppStore';
import { useScreenshotStore } from '../../store/useScreenshotStore';
import { setIsResizingGlobal } from '../../App';
import FocusButton from './FocusButton';
import CalculatorButton from './CalculatorButton';
import TooltipButton from './TooltipButton';
import { useExtensionRegistry } from '../extensions/extensionRegistry';

const Sidebar: React.FC = () => {
    const toggleNotePanel = useAppStore(state => state.toggleNotePanel);
    const edgePosition = useAppStore(state => state.edgePosition);
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const setMiniMode = useAppStore(state => state.setMiniMode);
    const isMiniMode = useAppStore(state => state.isMiniMode);
    const pinApp = useAppStore(state => state.pinApp);
    const t = useAppStore(state => state.t);
    const isShortcutsEnabled = useAppStore(state => state.isShortcutsEnabled);
    const isShortcutsOpen = useAppStore(state => state.isShortcutsOpen);
    const setIsShortcutsOpen = useAppStore(state => state.setIsShortcutsOpen);
    const setShortcutsAnchorRect = useAppStore(state => state.setShortcutsAnchorRect);
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

    const featureOrder = useAppStore(state => state.featureOrder);
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
                        const features = featureOrder.map(featureId => {
                        switch (featureId) {
                            case 'shortcuts':
                                return isShortcutsEnabled ? (
                                    <div key="shortcuts" className="w-full flex justify-center no-drag-region">
                                        <TooltipButton
                                            label={t('shortcuts')}
                                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                                ${isShortcutsOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                            style={{ borderWidth: isShortcutsOpen ? '1px' : '0px' }}
                                            onClick={(e) => {
                                                const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                setShortcutsAnchorRect(rect);
                                                setIsShortcutsOpen(!isShortcutsOpen);
                                            }}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={async (e: React.DragEvent) => {
                                                e.preventDefault();
                                                // Limit removed
                                                
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
                                                    // Handle browser URL drag and drop
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
                                                        iconDataUrl = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(filePath)}&size=64`;
                                                    } catch (err) {
                                                        if (!name || name.trim() === '') name = filePath;
                                                    }
                                                }

                                                if (filePath) {
                                                    pinApp({ id: Date.now().toString(), name, path: filePath, icon: iconDataUrl });
                                                    const rect = sidebarContainerRef.current?.getBoundingClientRect();
                                                    if (rect) setShortcutsAnchorRect(rect);
                                                    setIsShortcutsOpen(true);
                                                }
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[24px]">bolt</span>
                                        </TooltipButton>
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
                                            <div className="relative inline-flex items-center justify-center text-[24px]" style={{ width: '1em', height: '1em' }}>
                                                <span className="material-symbols-outlined absolute left-1/2 top-1/2" style={{ fontSize: '0.85em', transform: 'translate(-60%, -60%)', opacity: 0.6 }}>movie</span>
                                                <span className="material-symbols-outlined absolute left-1/2 top-1/2" style={{ fontSize: '0.9em', transform: 'translate(-40%, -40%)' }}>music_note</span>
                                            </div>
                                        </TooltipButton>
                                    </div>
                                ) : null;
                            default:
                                return null;
                        }
                    }).filter(Boolean);

                    const dynamicButtons = extensionsRegistry.getButtons();
                    const extFeatures = dynamicButtons.map((btn: any) => {
                        const isOpen = activeExtensionPanelId === btn.id;
                        return (
                            <div key={btn.id} className="w-full flex justify-center no-drag-region">
                                <TooltipButton
                                    label={btn.label}
                                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg
                                        ${isOpen ? 'bg-primary/20 text-primary border-primary/50' : 'bg-white/5 text-slate-400 hover:text-primary hover:bg-white/10'}`}
                                    style={{ borderWidth: isOpen ? '1px' : '0px' }}
                                    onClick={(e) => {
                                        const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                        btn.onClick(e as any, rect);
                                    }}
                                >
                                    <span className="material-symbols-outlined text-[24px]">{btn.icon}</span>
                                </TooltipButton>
                            </div>
                        );
                    });

                    const allFeatures = [...features, ...extFeatures];

                    return allFeatures.map((feat, idx) => (
                        <React.Fragment key={idx}>
                            {feat}
                            {(idx < allFeatures.length - 1) && (
                                <div className={`${orientation === 'horizontal' ? 'h-10 w-px' : 'w-10 h-px'} bg-white/5 no-drag-region shrink-0`} />
                            )}
                        </React.Fragment>
                    ));
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
                            {isDev && (
                                <span className="absolute -top-1 -right-1 z-[1000] bg-orange-500 text-black text-[9px] font-extrabold px-1 py-0.5 rounded-sm border border-orange-600 shadow-[0_0_8px_rgba(249,115,22,0.6)] select-none pointer-events-none tracking-wide scale-90 origin-top-right uppercase leading-none font-sans">
                                    dev
                                </span>
                            )}
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
