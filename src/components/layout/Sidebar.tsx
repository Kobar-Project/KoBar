import React from 'react';

import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';

import { setIsResizingGlobal } from '../../App';

import TooltipButton from './TooltipButton';
import { BarItem } from '../../sidebar/BarItem';
import { useRovingToolbar } from '../../sidebar/useRovingToolbar';
import { BarHeader } from '../../sidebar/BarHeader';
import EyeNotification from './EyeNotification';
import { useExtensionRegistry } from '../extensions/extensionRegistry';
import { getWindowGeometry, refreshWindowGeometry, subscribeWindowGeometry } from '../../utils/windowGeometry';
import { computeVisibleArea, hasDisplayInfo, visibleAreaFromWorkArea, windowOriginForDisplay } from '../../utils/visibleArea';
import { exceedsDragThreshold } from '../../utils/dragThreshold';
import KoBarHead from './KoBarHead';

const Sidebar: React.FC = () => {
    const toggleNotePanel = useAppStore(state => state.toggleNotePanel);
    const edgePosition = useAppStore(state => state.edgePosition);
    const isNotePanelOpen = useAppStore(state => state.isNotePanelOpen);
    const setMiniMode = useAppStore(state => state.setMiniMode);
    const isMiniMode = useAppStore(state => state.isMiniMode);

    const t = useT();

    const isMac = useAppStore(state => state.isMac);
    
    // T-206: plugin roots remount on every data context switch (load / save / isolation toggle / delete).
    const dataContextId = useAppStore(state => state.dataContextId);




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
    const showTooltips = useAppStore(state => state.showTooltips);
    const isDraggingGlobal = useAppStore(state => state.isDraggingGlobal);
    const isHighlightingToggleNotes = useAppStore(state => state.isHighlightingToggleNotes);


    
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
    const sidebarContainerRef = React.useRef<HTMLDivElement>(null);
    const toolbarHandlers = useRovingToolbar(sidebarContainerRef, orientation === 'horizontal' ? 'horizontal' : 'vertical');

    const [reorderMode, setReorderMode] = React.useState<boolean>(false);
    const [barMenuOpen, setBarMenuOpen] = React.useState(false);
    const longPressTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [dragOverId, setDragOverId] = React.useState<string | null>(null);
    const [isDev, setIsDev] = React.useState(false);

    React.useEffect(() => {
        if (window.api?.isDev) {
            window.api.isDev().then(setIsDev).catch(console.warn);
        }
    }, []);

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


    
    // Drag to scroll logic
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const [isDragScrolling, setIsDragScrolling] = React.useState(false);
    const scrollDragStart = React.useRef({ y: 0, scrollTop: 0 });

    const screenBounds = useAppStore(state => state.screenBounds);
    const calculatedMaxHeight = screenBounds ? Math.max(200, screenBounds.height - 40) : 800;
    const calculatedMaxWidth = screenBounds ? Math.max(200, screenBounds.width - 40) : 1200;

    const handleScrollMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || e.defaultPrevented) return;
        // R-09: horizontal bar has no drag grip; empty bar space moves the bar instead.
        if (orientation === 'horizontal' && isEmptyBarSpace(e)) {
            handleSidebarDragStart(e);
            return;
        }
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
        dragRef.current = { startX: e.clientX, startY: e.clientY, dragged: false };
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
            // R-08: below the pixel threshold a press is still a click (Eye click guard), so the bar does not move yet.
            if (
                !dragRef.current.dragged &&
                !exceedsDragThreshold(
                    { x: dragRef.current.startX, y: dragRef.current.startY },
                    { x: e.clientX, y: e.clientY }
                )
            ) {
                return;
            }
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

                // T-322: the window origin for that display from the live model (window model A: the display's origin).
                const targetOrigin = windowOriginForDisplay(activeDisplay, getWindowGeometry());
                if (targetOrigin) {
                    const newWinX = targetOrigin.x;
                    const newWinY = targetOrigin.y;

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

                let activeScreenPhysicalCenter = physicalOriginX + getWindowGeometry().centerX; // Fallback to primary
                let activeScreenPhysicalCenterY = physicalOriginY + getWindowGeometry().centerY;

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

                try {
                    let pos = { x: sidebarDragRef.current.lastX, y: sidebarDragRef.current.lastY };
                    let displayBounds = null;

                    if (window.api?.recenterWindowOnWidget && !isMac) {
                        // T-322: a failed call keeps the drop where it is (it used to leave the drag stuck).
                        const result = await window.api.recenterWindowOnWidget(pos.x, pos.y, sidebarWidth, 20).catch((err: unknown) => {
                            console.warn('[KoBar] recenterWindowOnWidget failed:', err);
                            return null;
                        });
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
                        // T-322: the window was re-fitted to the drop display; read the model and the window position again (the
                        // re-fit event may still be queued) and take the usable area (the work area recenterWindowOnWidget returned)
                        // relative to the real window origin. Window model A: taskbar offsets at the top/left included.
                        refreshWindowGeometry();
                        const geometry = getWindowGeometry();
                        let windowOrigin: { x: number; y: number } | null = null;
                        if (window.api?.getWindowPositionSync) {
                            const [wx, wy] = window.api.getWindowPositionSync();
                            if (Number.isFinite(wx) && Number.isFinite(wy)) windowOrigin = { x: wx, y: wy };
                        }
                        if (windowOrigin) windowPosRef.current = windowOrigin;
                        const inModel = !!windowOrigin && hasDisplayInfo(geometry)
                            && windowOrigin.x === geometry.displayBounds.x && windowOrigin.y === geometry.displayBounds.y;
                        const area = (displayBounds && windowOrigin
                            ? visibleAreaFromWorkArea(displayBounds, windowOrigin, inModel ? { width: geometry.width, height: geometry.height } : null)
                            : null) ?? computeVisibleArea(geometry, screenBounds);
                        visibleLeft = area.left;
                        visibleRight = area.right;
                        visibleTop = area.top;
                        visibleBottom = area.bottom;
                        activeScreenCenter = area.centerX;
                        activeScreenCenterY = area.centerY;
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
                } catch (err) {
                    // T-322: whatever fails in the drop maths, the drag below still ends (no stuck drag / disabled layout sync).
                    console.warn('[KoBar] sidebar drop failed:', err);
                }

                // Always end the drag (also after a failure above). A catch rather than finally: the React Compiler behind the
                // react-hooks lint rules does not support try/finally.
                setIsSidebarDragging(false);
                setIsResizingGlobal(false);
                useAppStore.getState().setIsDraggingGlobal(false);
            }
        };
        // T-322: main re-fits the window after the drag moved it onto another display (size and origin can differ from what
        // moveWindow asked for, e.g. mixed DPI); re-read the real window position so the cursor maths does not use a stale origin.
        let unsubscribeGeometry: (() => void) | null = null;
        if (isSidebarDragging) {
            window.addEventListener('mousemove', handleSidebarDragMove);
            window.addEventListener('mouseup', handleSidebarDragEnd);
            if (!isMac) {
                unsubscribeGeometry = subscribeWindowGeometry(() => {
                    if (!window.api?.getWindowPositionSync) return;
                    const [wx, wy] = window.api.getWindowPositionSync();
                    if (Number.isFinite(wx) && Number.isFinite(wy)) windowPosRef.current = { x: wx, y: wy };
                });
            }
        }
        return () => {
            window.removeEventListener('mousemove', handleSidebarDragMove);
            window.removeEventListener('mouseup', handleSidebarDragEnd);
            unsubscribeGeometry?.();
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



    // R-09: a press/right-click on the bar's own background (not on a plugin button) counts as empty bar space.
    const isEmptyBarSpace = (e: React.MouseEvent) =>
        e.target === e.currentTarget || (e.target as HTMLElement).dataset?.barEmpty === 'true';

    // Handle Eye Button: dual-purpose handle — drag moves the whole bar, click enters Mini Mode.
    const handleEyeMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        e.preventDefault(); // Prevent accidental text selection
        // Bridge: also kick off the sidebar drag so the Eye acts as a drag handle for the whole bar
        handleSidebarDragStart(e);
    };

    const consumeHeaderDrag = () => {
        const wasDrag = dragRef.current.dragged;
        dragRef.current.dragged = false;
        return wasDrag;
    };

    const enterMiniMode = () => {
        // Use the eye button's actual DOM rect center for pixel-perfect alignment
        if (eyeButtonRef.current) {
            const rect = eyeButtonRef.current.getBoundingClientRect();
            setMiniMode(true, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        } else {
            setMiniMode(true);
        }
    };

    const handleEyeClick = () => {
        // If a real drag happened (handleSidebarDragMove set the flag), don't enter Mini Mode —
        // the sidebar was already repositioned by the drag system.
        const wasDrag = dragRef.current.dragged;
        dragRef.current.dragged = false; // a later keyboard activation must not inherit this flag
        if (wasDrag) return;
        enterMiniMode();
    };

    // The menu's click would reach the window listener that ends reorder mode, so enter it on the next tick.
    const startReorder = () => {
        window.setTimeout(() => setReorderMode(true), 0);
    };

    const dynamicButtons = extensionsRegistry.getButtons();
    const dynamicInlineWidgets = extensionsRegistry.getInlineWidgets();
    const allExts = [...dynamicButtons, ...dynamicInlineWidgets];

    // Plugins missing from featureOrder are appended to it (so they show at the end) from an effect, not from render.
    const missingIds = allExts.map((e) => e.id).filter((id) => !featureOrder.includes(id));
    const missingKey = missingIds.length ? JSON.stringify(missingIds) : '';
    React.useEffect(() => {
        if (!missingKey) return;
        const current = useAppStore.getState().featureOrder;
        const add = (JSON.parse(missingKey) as string[]).filter((id) => !current.includes(id));
        if (add.length) setFeatureOrder([...current, ...add]);
    }, [missingKey, setFeatureOrder]);

    return (
        <div className="relative z-50 pointer-events-none" style={{ width: orientation === 'horizontal' ? 'fit-content' : `${sidebarWidth}px`, height: orientation === 'horizontal' ? `${sidebarWidth}px` : 'fit-content' }}>
            <div 
                ref={sidebarContainerRef}
                role="toolbar"
                aria-label="KoBar"
                aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
                onKeyDown={toolbarHandlers.onKeyDown}
                onFocus={toolbarHandlers.onFocus}
                onMouseDown={orientation === 'horizontal' ? (e) => { if (e.button === 0 && isEmptyBarSpace(e)) handleSidebarDragStart(e); } : undefined}
                onContextMenu={orientation === 'horizontal' ? (e) => { if (isEmptyBarSpace(e)) { e.preventDefault(); setBarMenuOpen(true); } } : undefined}
                className={`flex ${orientation === 'horizontal' ? 'flex-row pr-2 h-full w-fit' : 'flex-col pb-2 w-full h-fit'} items-center overflow-hidden ${isMiniMode ? 'pointer-events-none' : 'pointer-events-auto'} transition-all duration-500
                    ${orientation === 'horizontal' ? '' : (isMac && edgePosition === 'left' ? 'pt-8' : '')}
                    ${design === 'style2' 
                        ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-2xl') + ' rounded-[2.5rem] shadow-e3 border border-stroke') 
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
                {/* 1a. Bar header (R2-02): the whole area drags the bar (pixel threshold) and a click opens the bar menu. */}
                <BarHeader
                    orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
                    open={barMenuOpen}
                    onOpenChange={setBarMenuOpen}
                    onReorder={startReorder}
                    onMiniMode={enterMiniMode}
                    onDragStart={handleSidebarDragStart}
                    consumeDrag={consumeHeaderDrag}
                />

                {/* 1b. Scrollable Container for Features */}
                <div 
                    ref={scrollRef}
                    onMouseDown={handleScrollMouseDown}
                    data-bar-empty="true"
                    className={`flex ${orientation === 'horizontal' ? 'flex-row h-full w-fit overflow-x-hidden' : 'flex-col w-full h-fit overflow-y-hidden'} items-center custom-scrollbar`} 
                >
                    <div data-bar-empty="true" className={`${orientation === 'horizontal' ? 'h-full flex-row px-1.5' : 'w-full flex-col py-1.5'} flex items-center cursor-default`} style={{ zoom: iconScale, gap: `${featureSpacing}px` }}>
                    {/* Dynamic Feature Order with Separators */}
                    {(() => {
                        // Sort all plugins according to featureOrder
                        const sortedFeatures = [...allExts].sort((a, b) => {
                            const idxA = featureOrder.indexOf(a.id);
                            const idxB = featureOrder.indexOf(b.id);
                            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                            if (idxA !== -1 && idxB === -1) return -1;
                            if (idxA === -1 && idxB !== -1) return 1;
                            return 0;
                        });

                        return sortedFeatures.map((feat: any) => {
                            const isWidget = !!feat.render;
                            const id = feat.id;
                            const isDragOver = dragOverId === id;
                            
                            return (
                                <React.Fragment key={`${id}-${dataContextId}`}>
                                    <div 
                                        draggable={reorderMode}
                                        onDragStart={(e) => onPluginDragStart(e, id)}
                                        onDragOver={(e) => onPluginDragOver(e, id)}
                                        onDrop={(e) => onPluginDrop(e, id)}
                                        onDragLeave={() => setDragOverId(null)}
                                        onMouseDown={handlePluginMouseDown}
                                        onMouseUp={handlePluginMouseUp}
                                        onMouseLeave={handlePluginMouseUp}
                                        className={`w-full flex justify-center no-drag-region transition-all ${reorderMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                        style={{ 
                                            transform: isDragOver ? (orientation === 'horizontal' ? 'translateX(10px)' : 'translateY(10px)') : 'none',
                                            opacity: isDragOver ? 0.5 : 1
                                        }}
                                    >
                                        {isWidget ? (
                                            // T-503: v1 inline widgets resolve the dark scheme tokens; display: contents keeps layout/events
                                            <div data-scheme="dark" data-bar-widget="" className="contents">
                                                {feat.render()}
                                            </div>
                                        ) : (
                                            <BarItem
                                                label={reorderMode ? (t('dragToReorder' as any) || 'Drag to reorder') : feat.label}
                                                active={activeExtensionPanelId === id}
                                                orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
                                                edge={edgePosition}
                                                tooltipDisabled={!showTooltips || isDraggingGlobal || isMiniMode}
                                                style={{ pointerEvents: reorderMode ? 'none' : 'auto' }}
                                                onClick={(e) => {
                                                    if (reorderMode) return;
                                                    const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
                                                    feat.onClick(e as any, rect);
                                                }}
                                            >
                                                <span className="material-symbols-outlined" style={{ fontSize: 'var(--kb-bar-icon)' }}>{feat.icon}</span>
                                            </BarItem>
                                        )}
                                    </div>
                                </React.Fragment>
                            );
                        });
                    })()}
                    </div>
                </div> {/* End scrollable container */}

                {/* 1c. Bottom Static Utilities (Always Bottom / Right) */}
                <div className={`flex ${orientation === 'horizontal' ? 'flex-row' : 'flex-col'} items-center gap-4 no-drag-region shrink-0 ${orientation === 'horizontal' ? 'py-2 pr-0' : 'px-2 pb-0'}`}>
                    <div style={{ zoom: iconScale }} className="transition-all">
                        <BarItem
                            label={t('miniMode')}
                            ref={eyeButtonRef}
                            tone="accent"
                            orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
                            edge={edgePosition}
                            tooltipDisabled={!showTooltips || isDraggingGlobal || isMiniMode}
                            onMouseDown={handleEyeMouseDown}
                            onClick={handleEyeClick}
                            className={`cursor-grab active:cursor-grabbing ${orientation === 'horizontal' ? '' : 'mt-2'}`}
                        >
                            <span className="flex items-center justify-center pointer-events-none">
                                <KoBarHead className="size-[calc(var(--kb-bar-icon)*1.35)]" follow={enableEyeAnimation} anchorRef={eyeButtonRef} />
                            </span>
                            {isDev && (
                                <span className="absolute -top-1 -right-1 z-[1000] bg-orange-500 text-black text-[9px] font-extrabold px-1 py-0.5 rounded-sm border border-orange-600 select-none pointer-events-none tracking-wide uppercase leading-none font-sans">
                                    dev
                                </span>
                            )}
                        </BarItem>
                        <EyeNotification />
                    </div>
                </div>
            </div>

            <TooltipButton
                label={t('toggleNotes')}
                className={`absolute border flex items-center justify-center transition-all shadow-2xl z-[60] 
                    ${isMiniMode ? 'pointer-events-none' : 'pointer-events-auto'}
                    ${isHighlightingToggleNotes ? 'ring-4 ring-primary animate-pulse text-primary bg-primary/20 border-primary' : 'text-fg-2 hover:text-primary hover:bg-fill-hover'}`}
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
