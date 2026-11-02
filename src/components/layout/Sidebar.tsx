import React from 'react';

import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';

import { setIsResizingGlobal } from '../../App';

import { BarGlyph, BarItem } from '../../sidebar/BarItem';
import { BarButton } from '../../sidebar/BarButton';
import { BarTile } from '../../sidebar/BarTile';
import { BarWidgetCell } from '../../sidebar/BarWidgetCell';
import { BarItemMenu, type BarItemMenuTarget } from '../../sidebar/BarItemMenu';
import { barThickness, GEOMETRY, layoutBar, type BarBlock, type BarItemInput } from '../../sidebar/barLayout';
import { setBarMode } from '../../sidebar/barModeStore';
import { tooltipSideForEdge } from '../../sidebar/barEdge';
import { useRovingToolbar } from '../../sidebar/useRovingToolbar';
import { BarHeader } from '../../sidebar/BarHeader';
import { cx, INTERACTIVE } from '../../ui/cx';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import EyeNotification from './EyeNotification';
import { useExtensionRegistry, type ExtensionButton, type ExtensionInlineWidget } from '../extensions/extensionRegistry';
import { manifestDefaultSize, setBarHostContext, setBarItemPresentation } from '../extensions/barPresentation';
import { getWindowGeometry, refreshWindowGeometry, subscribeWindowGeometry } from '../../utils/windowGeometry';
import { computeVisibleArea, hasDisplayInfo, visibleAreaFromWorkArea, windowOriginForDisplay } from '../../utils/visibleArea';
import { exceedsDragThreshold } from '../../utils/dragThreshold';
import KoBarHead from './KoBarHead';

type ButtonExt = ExtensionButton;
type WidgetExt = ExtensionInlineWidget;
type ExtItem = ButtonExt | WidgetExt;
const isWidgetItem = (f: ExtItem): f is WidgetExt => !('onClick' in f);

/** Length reserved along the bar for each v1 inline widget (opaque plugin DOM, at most this tall). */
const WIDGET_RESERVE_PX = 160;

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
    const density = useAppStore(state => state.density);
    const barItemSizes = useAppStore(state => state.barItemSizes);
    const notesTabVisible = useAppStore(state => state.notesTabVisible);
    const privacyMode = useAppStore(state => state.privacyMode);
    const language = useAppStore(state => state.language);
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
    // Inline widgets measured larger than a grid cell: shown as their own block in the wide bar.
    const [oversizedWidgets, setOversizedWidgets] = React.useState<ReadonlySet<string>>(() => new Set());
    const onWidgetFit = React.useCallback((id: string, fits: boolean) => {
        setOversizedWidgets((prev) => {
            if (prev.has(id) === !fits) return prev;
            const next = new Set(prev);
            if (fits) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
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


    
    const screenBounds = useAppStore(state => state.screenBounds);
    const calculatedMaxHeight = screenBounds ? Math.max(200, screenBounds.height - 40) : 800;
    const calculatedMaxWidth = screenBounds ? Math.max(200, screenBounds.width - 40) : 1200;

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

    // Bar thickness (cross axis) in px from mode and density; updated after each layout (see below), read by the drag maths.
    const thicknessRef = React.useRef(barThickness('normal', 'thin'));

    React.useEffect(() => {
        const sidebarWidth = thicknessRef.current;
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
    }, [isSidebarDragging, screenBounds, orientation]);

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

    const dynamicButtons: ExtensionButton[] = extensionsRegistry.getButtons();
    const dynamicInlineWidgets: ExtensionInlineWidget[] = extensionsRegistry.getInlineWidgets();
    const allExts: ExtItem[] = [...dynamicButtons, ...dynamicInlineWidgets];
    // The open panel marks its plugin's button active even when the two ids differ (most plugins use `-btn` / `-panel`).
    // A registry instance kept by dev HMR may predate buttonIdForPanel: then only the same-id rule applies.
    const activeButtonId: string | null =
        typeof extensionsRegistry.buttonIdForPanel === 'function'
            ? extensionsRegistry.buttonIdForPanel(activeExtensionPanelId)
            : activeExtensionPanelId;

    // Plugins missing from featureOrder are appended to it (so they show at the end) from an effect, not from render.
    // A new plugin whose manifest asks for a tile gets that size once; an existing choice is never changed.
    const missingIds = allExts.map((e) => e.id).filter((id) => !featureOrder.includes(id));
    const missingKey = missingIds.length ? JSON.stringify(missingIds) : '';
    React.useEffect(() => {
        if (!missingKey) return;
        const state = useAppStore.getState();
        const add = (JSON.parse(missingKey) as string[]).filter((id) => !state.featureOrder.includes(id));
        if (!add.length) return;
        setFeatureOrder([...state.featureOrder, ...add]);
        for (const id of add) {
            if (state.barItemSizes[id] === undefined && manifestDefaultSize(id) === 'tile') state.setBarItemSize(id, 'tile');
        }
    }, [missingKey, setFeatureOrder]);

    // ---- Layout: every enabled item is on the bar (no "More" overflow); tiles collapse first, then the middle scrolls ----
    const horizontal = orientation === 'horizontal';
    const barOrientation = horizontal ? 'horizontal' : 'vertical';
    const tooltipOff = !showTooltips || isDraggingGlobal || isMiniMode;
    const featById = new Map(allExts.map((f) => [f.id, f] as const));
    const sortedFeatures = [...allExts].sort((a, b) => {
        const idxA = featureOrder.indexOf(a.id);
        const idxB = featureOrder.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1 && idxB === -1) return -1;
        if (idxA === -1 && idxB !== -1) return 1;
        return 0;
    });
    const barFeatures = sortedFeatures;
    // Widgets that do not fit a grid cell reserve a fixed length; in the thin bar every widget does (it is not measured there).
    const anyTileWanted = barFeatures.some((f) => !isWidgetItem(f) && barItemSizes[f.id] === 'tile');
    const widgetCount = barFeatures.filter((f) => isWidgetItem(f) && (!anyTileWanted || oversizedWidgets.has(f.id))).length;
    // Inline widgets are opaque plugin DOM: they never collapse and reserve a fixed length.
    const inputs: BarItemInput[] = barFeatures.map((f) =>
        isWidgetItem(f)
            ? { id: f.id, size: 'icon', active: true }
            : { id: f.id, size: barItemSizes[f.id] === 'tile' ? 'tile' : 'icon', active: activeButtonId === f.id }
    );
    const axisAvailable = horizontal ? calculatedMaxWidth : calculatedMaxHeight;
    const layout = layoutBar(inputs, density, Math.max(120, axisAvailable - widgetCount * WIDGET_RESERVE_PX));
    const wide = layout.mode === 'wide';
    const thickness = barThickness(density, layout.mode);
    const collapsedSet = new Set(layout.collapsed);

    React.useLayoutEffect(() => {
        thicknessRef.current = thickness;
        setBarMode(layout.mode);
    }, [thickness, layout.mode]);

    // Presentation feed: each plugin learns its effective size and whether the bar collapsed its tile.
    const presentationKey = JSON.stringify(
        dynamicButtons.map((b) => {
            const collapsed = collapsedSet.has(b.id);
            const size = !collapsed && barItemSizes[b.id] === 'tile' ? 'tile' : 'icon';
            return [b.id, size, collapsed];
        })
    );
    React.useEffect(() => {
        for (const [id, size, autoCollapsed] of JSON.parse(presentationKey) as [string, 'icon' | 'tile', boolean][]) {
            setBarItemPresentation(id, { size, autoCollapsed });
        }
    }, [presentationKey]);

    React.useEffect(() => {
        setBarHostContext({ privacy: privacyMode, locale: language, barVisible: !isMiniMode });
    }, [privacyMode, language, isMiniMode]);

    // ---- Item menu (right-click, context-menu key, Shift+F10) ----
    const [itemMenu, setItemMenu] = React.useState<BarItemMenuTarget | null>(null);
    const openItemMenu = (id: string, element: HTMLElement) => {
        const feat = featById.get(id);
        if (!feat) return;
        const widget = isWidgetItem(feat);
        const r = element.getBoundingClientRect();
        setItemMenu({
            id,
            name: widget ? id : feat.label,
            icon: widget ? 'widgets' : feat.icon,
            widget,
            rect: { left: r.left, top: r.top, width: r.width, height: r.height },
            element,
        });
    };
    const itemMenuFromEvent = (target: EventTarget | null): boolean => {
        const holder = (target as HTMLElement | null)?.closest<HTMLElement>('[data-bar-id]');
        const id = holder?.dataset.barId;
        if (!holder || !id) return false;
        openItemMenu(id, holder.querySelector<HTMLElement>('[data-bar-item]') ?? holder);
        return true;
    };

    const openFeature = (id: string, e: React.MouseEvent<HTMLElement>) => {
        const feat = featById.get(id);
        if (!feat || isWidgetItem(feat) || reorderMode) return;
        const rect = sidebarContainerRef.current?.getBoundingClientRect() || e.currentTarget.getBoundingClientRect();
        feat.onClick(e as any, rect);
    };

    // ---- Rendering helpers ----
    const wrap = (id: string, node: React.ReactNode, className?: string) => (
        <div
            key={`${id}-${dataContextId}`}
            data-bar-id={id}
            draggable={reorderMode}
            onDragStart={(e) => onPluginDragStart(e, id)}
            onDragOver={(e) => onPluginDragOver(e, id)}
            onDrop={(e) => onPluginDrop(e, id)}
            onDragLeave={() => setDragOverId(null)}
            onMouseDown={handlePluginMouseDown}
            onMouseUp={handlePluginMouseUp}
            onMouseLeave={handlePluginMouseUp}
            className={cx(
                'no-drag-region flex shrink-0 items-center justify-center',
                reorderMode && 'cursor-grab active:cursor-grabbing',
                dragOverId === id && 'opacity-50',
                className
            )}
        >
            {node}
        </div>
    );

    const renderWidget = (feat: WidgetExt) =>
        wrap(
            feat.id,
            <div
                data-bar-widget-host=""
                // The widget sizes itself along the bar (e.g. Clipboard Manager's slot grid grows with its slot count): no
                // length cap and no clipping, or its own buttons are cut off and look glued to the neighbouring icons.
                className={cx(
                    'flex shrink-0 items-center justify-center',
                    horizontal ? cx('h-[var(--kb-bar-item)]', wide && 'h-[var(--kb-tile)]') : cx('w-[var(--kb-bar-item)]', wide && 'w-full')
                )}
            >
                {/* T-503: v1 inline widgets resolve the dark scheme tokens; display: contents keeps layout/events */}
                <div data-scheme="dark" data-bar-widget="" className="contents">
                    {feat.render()}
                </div>
            </div>,
            wide && !horizontal ? 'w-full' : undefined
        );

    const renderIcon = (id: string, variant: 'thin' | 'cell', gridKey?: string) => {
        const feat = featById.get(id);
        if (!feat) return null;
        if (isWidgetItem(feat)) return renderWidget(feat);
        return wrap(
            id,
            <BarButton
                id={id}
                icon={feat.icon}
                name={feat.label}
                variant={variant}
                active={activeButtonId === id}
                autoCollapsed={collapsedSet.has(id)}
                privacy={privacyMode}
                reorderMode={reorderMode}
                gridKey={gridKey}
                edge={edgePosition}
                orientation={barOrientation}
                tooltipDisabled={tooltipOff}
                reorderLabel={t('dragToReorder' as any) || 'Drag to reorder'}
                onOpen={(e) => openFeature(id, e)}
            />
        );
    };

    const renderTile = (id: string) => {
        const feat = featById.get(id);
        if (!feat || isWidgetItem(feat)) return null;
        return wrap(
            id,
            <BarTile
                id={id}
                name={feat.label}
                icon={feat.icon}
                active={activeButtonId === id}
                privacy={privacyMode}
                tileSize={GEOMETRY[density]?.tile ?? GEOMETRY.normal.tile}
                edge={edgePosition}
                orientation={barOrientation}
                tooltipDisabled={tooltipOff}
                style={{ pointerEvents: reorderMode ? 'none' : 'auto' }}
                onClick={(e) => openFeature(id, e)}
            />
        );
    };

    // A 2-column grid of icon cells. A single-control inline widget takes a cell like any icon (measured by BarWidgetCell);
    // only a widget larger than a cell closes the grid, is shown on its own and a new grid follows.
    const renderGrid = (ids: string[], blockKey: string) => {
        const pieces: Array<{ widget: WidgetExt } | { cells: string[] }> = [];
        for (const id of ids) {
            const feat = featById.get(id);
            if (feat && isWidgetItem(feat) && oversizedWidgets.has(id)) {
                pieces.push({ widget: feat });
                continue;
            }
            const last = pieces[pieces.length - 1];
            if (last && 'cells' in last) last.cells.push(id);
            else pieces.push({ cells: [id] });
        }
        return pieces.map((piece, n) => {
            if ('widget' in piece) return renderWidget(piece.widget);
            const gridKey = `${blockKey}-${n}`;
            return (
                <div
                    key={gridKey}
                    data-bar-empty="true"
                    data-bar-cells=""
                    className={cx(
                        'grid shrink-0 gap-[var(--kb-tile-gap)]',
                        horizontal
                            ? 'grid-flow-col grid-rows-[repeat(2,var(--kb-tile-cell))]'
                            : 'grid-cols-[repeat(2,var(--kb-tile-cell))]'
                    )}
                >
                    {piece.cells.map((id) => {
                        const feat = featById.get(id);
                        if (feat && isWidgetItem(feat)) {
                            return wrap(
                                id,
                                <BarWidgetCell id={id} onFit={onWidgetFit}>
                                    <div data-scheme="dark" data-bar-widget="" className="contents">
                                        {feat.render()}
                                    </div>
                                </BarWidgetCell>
                            );
                        }
                        return renderIcon(id, 'cell', gridKey);
                    })}
                </div>
            );
        });
    };

    const renderMini = () => {
        const dev = isDev && (
            <span
                title={t('devBuildTooltip')}
                className="pointer-events-none absolute -end-1 -top-1 z-10 rounded-sm border border-stroke bg-[var(--kb-bg-container)] px-1 font-sans text-[9px] leading-3 font-bold text-[var(--kb-on-container)] select-none"
            >
                dev
            </span>
        );
        return (
            <div key="bar-mini" className={cx('relative flex shrink-0 items-center justify-center', wide && !horizontal && 'w-full')}>
                <Tooltip content={t('miniMode')} side={tooltipSideForEdge(edgePosition)} disabled={tooltipOff} describe={false}>
                    <button
                        ref={eyeButtonRef}
                        type="button"
                        aria-label={t('miniMode')}
                        data-bar-item=""
                        data-bar-mini=""
                        onMouseDown={handleEyeMouseDown}
                        onClick={handleEyeClick}
                        className={cx(
                            INTERACTIVE,
                            'no-drag-region relative flex shrink-0 cursor-grab items-center justify-center bg-[var(--kb-accent)] text-[var(--kb-on-accent)] transition-colors duration-[var(--kb-dur-fast)] hover:bg-[var(--kb-accent-hover)] active:cursor-grabbing',
                            wide
                                ? cx('rounded-lg', horizontal ? 'h-[var(--kb-tile)] w-[calc(var(--kb-tile)*0.75)]' : 'h-[calc(var(--kb-tile)*0.75)] w-full')
                                : 'size-[var(--kb-bar-item)] rounded-full'
                        )}
                    >
                        <span className="pointer-events-none flex items-center justify-center text-[color-mix(in_srgb,var(--kb-on-accent)_60%,transparent)]">
                            <KoBarHead className="size-[calc(var(--kb-bar-icon)*1.35)]" follow={enableEyeAnimation} anchorRef={eyeButtonRef} />
                        </span>
                        {dev}
                    </button>
                </Tooltip>
                <EyeNotification />
            </div>
        );
    };

    const addPluginCell = (
        <BarItem
            key="bar-add-plugin"
            label={t('barAddPlugin')}
            orientation={barOrientation}
            edge={edgePosition}
            tooltipDisabled={tooltipOff}
            data-bar-add-plugin=""
            onClick={() => useAppStore.getState().openPluginsTab()}
        >
            <BarGlyph name="add" />
        </BarItem>
    );

    const renderBlock = (block: BarBlock, index: number): React.ReactNode => {
        switch (block.kind) {
            case 'handle':
                return (
                    <BarHeader
                        key="bar-handle"
                        orientation={barOrientation}
                        open={barMenuOpen}
                        onOpenChange={setBarMenuOpen}
                        onReorder={startReorder}
                        onMiniMode={enterMiniMode}
                        onDragStart={handleSidebarDragStart}
                        consumeDrag={consumeHeaderDrag}
                    />
                );
            case 'thin':
                return renderIcon(block.id, 'thin');
            case 'tile':
                return renderTile(block.id);
            case 'grid':
                return renderGrid(block.ids, `grid-${index}`);
            case 'divider':
                return (
                    <div
                        key={`divider-${index}`}
                        role="separator"
                        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
                        data-bar-empty="true"
                        className={cx('shrink-0 bg-[var(--kb-stroke-subtle)]', horizontal ? 'h-full w-px' : 'h-px w-full')}
                    />
                );
            case 'mini':
                return (
                    <React.Fragment key="bar-mini-block">
                        {barFeatures.length === 0 && addPluginCell}
                        {renderMini()}
                    </React.Fragment>
                );
        }
    };

    const macTopPad = !horizontal && isMac && edgePosition === 'left';
    // Notes tab: 22 x 56 edge tab on the inner side of the bar, rounded on its free side.
    const notesTabSide = horizontal
        ? edgePosition === 'top'
            ? 'top-full rounded-b-[12px] border-t-0'
            : 'bottom-full rounded-t-[12px] border-b-0'
        : edgePosition === 'left'
          ? 'left-full rounded-r-[12px] border-l-0'
          : 'right-full rounded-l-[12px] border-r-0';
    const chevron = horizontal
        ? edgePosition === 'top'
            ? isNotePanelOpen ? 'expand_less' : 'expand_more'
            : isNotePanelOpen ? 'expand_more' : 'expand_less'
        : edgePosition === 'left'
          ? isNotePanelOpen ? 'chevron_left' : 'chevron_right'
          : isNotePanelOpen ? 'chevron_right' : 'chevron_left';

    return (
        <div
            className="relative z-50 pointer-events-none"
            style={{ width: horizontal ? 'fit-content' : `${thickness}px`, height: horizontal ? `${thickness}px` : 'fit-content' }}
        >
            <div
                ref={sidebarContainerRef}
                role="toolbar"
                aria-label="KoBar"
                aria-orientation={barOrientation}
                data-bar-mode={layout.mode}
                onKeyDown={(e) => {
                    if (!e.defaultPrevented && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && itemMenuFromEvent(e.target)) {
                        e.preventDefault();
                        return;
                    }
                    toolbarHandlers.onKeyDown(e);
                }}
                onFocus={toolbarHandlers.onFocus}
                onMouseDown={horizontal ? (e) => { if (e.button === 0 && isEmptyBarSpace(e)) handleSidebarDragStart(e); } : undefined}
                onContextMenu={(e) => {
                    if (e.defaultPrevented) return;
                    if (itemMenuFromEvent(e.target)) {
                        e.preventDefault();
                        return;
                    }
                    if (horizontal && isEmptyBarSpace(e)) {
                        e.preventDefault();
                        setBarMenuOpen(true);
                    }
                }}
                className={cx(
                    'flex items-center overflow-hidden border border-stroke bg-[var(--kb-material-bg)] shadow-e3',
                    horizontal ? 'h-full w-fit flex-row' : 'h-fit w-full flex-col',
                    wide ? 'rounded-2xl p-[var(--kb-bar-pad)] gap-[var(--kb-bar-gap)]' : 'rounded-full p-1.5 gap-0.5',
                    isMiniMode ? 'pointer-events-none' : 'pointer-events-auto'
                )}
                style={{
                    maxHeight: horizontal ? undefined : `${calculatedMaxHeight}px`,
                    maxWidth: horizontal ? `${calculatedMaxWidth}px` : undefined,
                    // MAC-025: kept from v1; presumably clears the macOS menu bar (main window spans full display bounds) for the left-docked vertical bar. Verify on a Mac (MAC-041/042).
                    paddingTop: macTopPad ? '2rem' : undefined,
                }}
            >
                {renderBlock(layout.blocks[0], 0)}
                {/* Everything between the handle and the mini button; it scrolls only when even the all-icon bar does not fit. */}
                <div
                    data-bar-scroll=""
                    data-bar-empty="true"
                    className={cx(
                        'scrollbar-hide flex min-h-0 min-w-0 items-center',
                        horizontal ? 'h-full flex-row overflow-x-auto' : 'w-full flex-col overflow-y-auto',
                        wide ? 'gap-[var(--kb-bar-gap)]' : 'gap-0.5',
                        !layout.fits && 'shrink'
                    )}
                    onWheel={
                        horizontal && !layout.fits
                            ? (e) => {
                                  e.currentTarget.scrollLeft += e.deltaY;
                              }
                            : undefined
                    }
                >
                    {layout.blocks.slice(1, -1).map((block, i) => renderBlock(block, i + 1))}
                </div>
                {renderBlock(layout.blocks[layout.blocks.length - 1], layout.blocks.length - 1)}
            </div>

            <BarItemMenu
                target={itemMenu}
                edge={edgePosition}
                orientation={barOrientation}
                onClose={() => setItemMenu(null)}
                onReorder={startReorder}
            />

            {notesTabVisible && !isMiniMode && (
                <Tooltip content={t('toggleNotes')} side={tooltipSideForEdge(edgePosition)} disabled={tooltipOff} describe={false}>
                    <button
                        type="button"
                        aria-label={t('toggleNotes')}
                        aria-expanded={isNotePanelOpen}
                        data-bar-notes-tab=""
                        data-highlight={isHighlightingToggleNotes ? '' : undefined}
                        onClick={toggleNotePanel}
                        className={cx(
                            INTERACTIVE,
                            'pointer-events-auto absolute z-[60] flex items-center justify-center border border-stroke bg-[var(--kb-material-bg)] text-fg-2 shadow-e2 transition-colors duration-[var(--kb-dur-fast)] hover:bg-[var(--kb-bg-container)] hover:text-fg-1',
                            horizontal ? 'left-1/2 h-[22px] w-14 -translate-x-1/2' : 'top-1/2 h-14 w-[22px] -translate-y-1/2',
                            notesTabSide,
                            isHighlightingToggleNotes && 'bg-[var(--kb-bg-container)] text-[var(--kb-on-container)] outline-2 outline-[var(--kb-accent)]'
                        )}
                    >
                        <Icon name={chevron} size={16} />
                    </button>
                </Tooltip>
            )}
        </div>
    );
};

export default Sidebar;
