import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useT } from '../../i18n/useT';
import { setIsResizingGlobal } from '../../App';
import EyeNotification from './EyeNotification';
import KoBarHead from './KoBarHead';
import { getWindowGeometry, subscribeWindowGeometry, useWindowGeometry } from '../../utils/windowGeometry';
import { exceedsDragThreshold } from '../../utils/dragThreshold';
import { computeVisibleArea, defaultEyePosition, windowOriginForDisplay } from '../../utils/visibleArea';

const FloatingEye: React.FC = () => {
    const edgePosition = useAppStore((state) => state.edgePosition);
    const miniModePosition = useAppStore((state) => state.miniModePosition);
    const design = useAppStore((state) => state.design);
    const glassOpacity = useAppStore((state) => state.glassOpacity);
    const iconScale = useAppStore((state) => state.iconScale);
    const screenBounds = useAppStore((state) => state.screenBounds);
    const enableEyeAnimation = useAppStore((state) => state.enableEyeAnimation);
    const notificationVisible = useAppStore((state) => state.eyeNotification?.isVisible === true);

    const isMac = useAppStore((state) => state.isMac);
    const t = useT();
    // T-322: the live window model (re-renders after a re-fit); the store keeps the eye on screen (store/windowLayoutSync.ts).
    const windowGeometry = useWindowGeometry();

    let safeDefaultX: number;
    let safeDefaultY: number;
    if (isMac) {
        // Calculate safe fallback coordinates using actual monitor dimensions: the visible area matches `screenBounds`.
        const visibleH = screenBounds?.height ?? getWindowGeometry().fallbackScreenHeight;
        const visibleW = screenBounds?.width ?? getWindowGeometry().fallbackScreenWidth;
        // For X: place the Eye near the current edge within the visible viewport.
        const centerX = Math.floor(window.innerWidth / 2);
        safeDefaultX =
            edgePosition === 'left'
                ? centerX - visibleW / 2 + 60 // Near left edge of visible area
                : centerX + visibleW / 2 - 60; // Near right edge of visible area
        // For Y: the sidebar starts at CSS top ≈ 20px. Place the Eye at the
        // vertical center of the visible monitor area, referenced from that origin.
        safeDefaultY = 20 + visibleH / 2;
    } else {
        // T-322: near the docked edge of the usable screen area (window coordinates), vertically at its centre.
        const fallback = defaultEyePosition(computeVisibleArea(windowGeometry, screenBounds), edgePosition);
        safeDefaultX = fallback.x;
        safeDefaultY = fallback.y;
    }

    const defaultX = miniModePosition?.x ?? safeDefaultX;
    const defaultY = miniModePosition?.y ?? safeDefaultY;

    const [pos, setPos] = useState({ x: defaultX, y: defaultY });
    const posRef = useRef({ x: defaultX, y: defaultY });
    const containerRef = useRef<HTMLDivElement>(null);
    const eyeButtonRef = useRef<HTMLButtonElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isDev, setIsDev] = useState(false);
    const dragInitRef = useRef({ dragged: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
    const windowPosRef = useRef({ x: 0, y: 0 });
    const localDisplaysRef = useRef<{ primaryDisplay: any; allDisplays: any[] } | null>(null);

    // If the mini-mode position changes while already in Mini Mode, sync the local pos
    useEffect(() => {
        if (miniModePosition) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPos({ x: miniModePosition.x, y: miniModePosition.y });
            posRef.current = { x: miniModePosition.x, y: miniModePosition.y };
        }
    }, [miniModePosition]);

    useEffect(() => {
        if (window.api?.isDev) {
            window.api.isDev().then(setIsDev).catch(console.warn);
        }
    }, []);

    // Removed local boundary clamping so it can live anywhere in the unbound OS window

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Only left click
        e.preventDefault(); // Prevent text selection during drag
        setIsDragging(true);
        setIsResizingGlobal(true); // Prevent transparent click-through issues globally
        useAppStore.getState().setIsDraggingGlobal(true);
        dragInitRef.current = {
            dragged: false,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - posRef.current.x,
            offsetY: e.clientY - posRef.current.y,
        };

        // Fetch display info and window position
        if (window.api?.getDisplaysInfo) {
            window.api
                .getDisplaysInfo()
                .then((info) => {
                    localDisplaysRef.current = info;
                })
                .catch((err) => console.warn('IPC getDisplaysInfo not ready:', err));
        }
        if (window.api?.getWindowPositionSync) {
            const [wx, wy] = window.api.getWindowPositionSync();
            windowPosRef.current = { x: wx, y: wy };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // R-08: a press that has not travelled past the threshold is still a click; do not move anything yet.
            if (
                !dragInitRef.current.dragged &&
                !exceedsDragThreshold({ x: dragInitRef.current.startX, y: dragInitRef.current.startY }, { x: e.clientX, y: e.clientY })
            ) {
                return;
            }

            let mouseX = e.clientX;
            let mouseY = e.clientY;

            // Physical cursor position
            const physicalCursorX = windowPosRef.current.x + mouseX;
            const physicalCursorY = windowPosRef.current.y + mouseY;

            // Find if we crossed display boundary
            if (localDisplaysRef.current && !isMac) {
                const allDisplays = localDisplaysRef.current.allDisplays;
                const activeDisplay = allDisplays.find(
                    (d) =>
                        physicalCursorX >= d.bounds.x &&
                        physicalCursorX < d.bounds.x + d.bounds.width &&
                        physicalCursorY >= d.bounds.y &&
                        physicalCursorY < d.bounds.y + d.bounds.height
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
                        posRef.current.x -= dx;
                        posRef.current.y -= dy;

                        if (containerRef.current) {
                            containerRef.current.style.left = `${posRef.current.x}px`;
                            containerRef.current.style.top = `${posRef.current.y}px`;
                        }

                        // Adjust local event mouse coords for calculations below
                        mouseX -= dx;
                        mouseY -= dy;
                    }
                }
            }

            const newX = mouseX - dragInitRef.current.offsetX;
            const newY = mouseY - dragInitRef.current.offsetY;

            const dx = newX - posRef.current.x;
            const dy = newY - posRef.current.y;

            // Past the click threshold (checked above): this press is a drag, so the click that follows is ignored.
            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                dragInitRef.current.dragged = true;
            }

            // Fast DOM manipulation to bypass React rendering during drag
            posRef.current = { x: newX, y: newY };
            if (containerRef.current) {
                containerRef.current.style.left = `${newX}px`;
                containerRef.current.style.top = `${newY}px`;
            }
        };

        const handleMouseUp = async () => {
            if (isDragging) {
                setIsDragging(false);
                setIsResizingGlobal(false);

                try {
                    if (dragInitRef.current.dragged) {
                        let finalPos = { x: posRef.current.x, y: posRef.current.y };
                        if (window.api?.recenterWindowOnWidget && !isMac) {
                            // T-322: a failed call keeps the drop where it is (and still ends the drag below).
                            const result = await window.api.recenterWindowOnWidget(finalPos.x, finalPos.y, 48, 48).catch((err: unknown) => {
                                console.warn('[KoBar] recenterWindowOnWidget failed:', err);
                                return null;
                            });
                            if (result) {
                                finalPos = { x: result.x, y: result.y };
                            }
                        }

                        // Re-sync React state once drag completes
                        setPos(finalPos);
                        // Persist the final position to global store so Sidebar knows where the Eye was
                        useAppStore.getState().setMiniMode(true, finalPos);
                    }
                } catch (err) {
                    console.warn('[KoBar] eye drop failed:', err);
                }

                // T-322: always reached (a catch rather than finally: the React Compiler behind the react-hooks lint rules does not
                // support try/finally). Cleared only after the drop position is committed, so the re-fit announced during
                // recenterWindowOnWidget does not re-clamp the stale pre-drag position (store/windowLayoutSync.ts skips while dragging).
                // isDragging / isResizingGlobal were cleared above, before anything that can fail.
                useAppStore.getState().setIsDraggingGlobal(false);
            }
        };

        // T-322: main re-fits the window after the drag moved it onto another display (size and origin can differ from what
        // moveWindow asked for, e.g. mixed DPI); re-read the real window position so the cursor maths does not use a stale origin.
        let unsubscribeGeometry: (() => void) | null = null;
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            if (!isMac) {
                unsubscribeGeometry = subscribeWindowGeometry(() => {
                    if (!window.api?.getWindowPositionSync) return;
                    const [wx, wy] = window.api.getWindowPositionSync();
                    if (Number.isFinite(wx) && Number.isFinite(wy)) windowPosRef.current = { x: wx, y: wy };
                });
            }
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            unsubscribeGeometry?.();
        };
    }, [isDragging, isMac]);

    const handleClick = () => {
        const wasDrag = dragInitRef.current.dragged;
        dragInitRef.current.dragged = false; // a later keyboard activation must not inherit this flag
        if (!wasDrag) {
            // Persist current Eye position so Sidebar opens at the same spot
            useAppStore.getState().setMiniMode(false, { x: posRef.current.x, y: posRef.current.y });
        }
    };

    return (
        <div
            ref={containerRef}
            className="fixed z-[999] pointer-events-auto"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, -50%) scale(${iconScale})`, transformOrigin: 'center center' }}
        >
            <button
                ref={eyeButtonRef}
                type="button"
                title={t('eyeExpand')}
                aria-label={t('eyeExpand')}
                onMouseDown={handleMouseDown}
                onClick={handleClick}
                className={`w-12 h-12 rounded-full border-2 border-primary text-primary flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing group relative
                    shadow-e2 ${design === 'style2' ? (isMac ? 'backdrop-blur-md' : 'backdrop-blur-xl') : ''}`}
                style={{
                    backgroundColor:
                        design === 'style2'
                            ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)`
                            : 'var(--theme-bg-dark)',
                }}
            >
                <span className="flex items-center justify-center pointer-events-none transition-transform group-hover:scale-110">
                    <KoBarHead
                        size={30}
                        color="var(--kb-mini-head)"
                        follow={enableEyeAnimation}
                        attention={notificationVisible}
                        anchorRef={eyeButtonRef}
                    />
                </span>
                {isDev && (
                    <span className="absolute -top-1 -right-1 z-[1000] bg-orange-500 text-black text-[9px] font-extrabold px-1 py-0.5 rounded-sm border border-orange-600 select-none pointer-events-none tracking-wide scale-90 origin-top-right uppercase leading-none font-sans">
                        dev
                    </span>
                )}
            </button>
            <EyeNotification />
        </div>
    );
};

export default FloatingEye;
