import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { setIsResizingGlobal } from '../../App';

const FloatingEye: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const miniModePosition = useAppStore(state => state.miniModePosition);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const iconScale = useAppStore(state => state.iconScale);
    const screenBounds = useAppStore(state => state.screenBounds);
    const enableEyeAnimation = useAppStore(state => state.enableEyeAnimation);

    // Calculate safe fallback coordinates using actual monitor dimensions.
    // The ghost window is 6000×4000, but the visible area matches `screenBounds`.
    // Using window.innerWidth/Height (6000/4000) would place the Eye at Y=2000,
    // far off-screen on most monitors. Instead, use screenBounds as the sizing reference.
    const visibleH = screenBounds?.height ?? 800;
    const visibleW = screenBounds?.width ?? 1920;

    // For X: place the Eye near the current edge within the visible viewport.
    // The sidebar is centered in the ghost window via CSS justify-center,
    // so its left offset ≈ (6000 - sidebarWidth) / 2.
    // For the fallback, stay near the sidebar's edge:
    // left edge → slightly inward from the sidebar's expected CSS position
    // right edge → slightly inward from the other side
    const isMac = useAppStore(state => state.isMac);
    const centerX = isMac ? Math.floor(window.innerWidth / 2) : 3000;
    const safeDefaultX = edgePosition === 'left'
        ? (centerX - visibleW / 2 + 60)   // Near left edge of visible area within ghost window
        : (centerX + visibleW / 2 - 60);  // Near right edge of visible area within ghost window

    // For Y: the sidebar starts at CSS top ≈ 20px. Place the Eye at the
    // vertical center of the visible monitor area, referenced from that origin.
    const safeDefaultY = 20 + (visibleH / 2);

    const defaultX = miniModePosition?.x ?? safeDefaultX;
    const defaultY = miniModePosition?.y ?? safeDefaultY;

    const [pos, setPos] = useState({ x: defaultX, y: defaultY });
    const posRef = useRef({ x: defaultX, y: defaultY });
    const containerRef = useRef<HTMLDivElement>(null);
    const innerEyeRef = useRef<HTMLSpanElement>(null);
    const eyeButtonRef = useRef<HTMLButtonElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragInitRef = useRef({ dragged: false, offsetX: 0, offsetY: 0 });
    const windowPosRef = useRef({ x: 0, y: 0 });
    const localDisplaysRef = useRef<{ primaryDisplay: any, allDisplays: any[] } | null>(null);

    // If teleport is triggered while already in Mini Mode, update pos to the new cursor center
    useEffect(() => {
        if (miniModePosition) {
            setPos({ x: miniModePosition.x, y: miniModePosition.y });
            posRef.current = { x: miniModePosition.x, y: miniModePosition.y };
        }
    }, [miniModePosition]);

    // Removed local boundary clamping so it can live anywhere in the unbound OS window

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Only left click
        e.preventDefault(); // Prevent text selection during drag
        setIsDragging(true);
        setIsResizingGlobal(true); // Prevent transparent click-through issues globally
        useAppStore.getState().setIsDraggingGlobal(true);
        dragInitRef.current = {
            dragged: false,
            offsetX: e.clientX - posRef.current.x,
            offsetY: e.clientY - posRef.current.y,
        };

        // Fetch display info and window position
        if (window.api?.getDisplaysInfo) {
            window.api.getDisplaysInfo().then(info => {
                localDisplaysRef.current = info;
            }).catch(err => console.warn('IPC getDisplaysInfo not ready:', err));
        }
        if (window.api?.getWindowPositionSync) {
            const [wx, wy] = window.api.getWindowPositionSync();
            windowPosRef.current = { x: wx, y: wy };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

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

            // If moved more than 0.5px, consider it a drag so we don't trigger click
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
                useAppStore.getState().setIsDraggingGlobal(false);

                if (dragInitRef.current.dragged) {
                    let finalPos = { x: posRef.current.x, y: posRef.current.y };
                    if (window.api?.recenterWindowOnWidget && !isMac) {
                        const result = await window.api.recenterWindowOnWidget(finalPos.x, finalPos.y, 48, 48);
                        if (result) {
                            finalPos = { x: result.x, y: result.y };
                        }
                    }

                    // Re-sync React state once drag completes
                    setPos(finalPos);
                    // Persist the final position to global store so Sidebar knows where the Eye was
                    useAppStore.getState().setMiniMode(true, finalPos);
                }
            }
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    // Eye icon cursor tracking
    useEffect(() => {
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
            
            const maxTranslate = 6; // px
            
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

    const handleClick = () => {
        if (!dragInitRef.current.dragged) {
            // Persist current Eye position so Sidebar opens at the same spot
            useAppStore.getState().setMiniMode(false, { x: posRef.current.x, y: posRef.current.y });
        }
    };

    return (
        <div
            ref={containerRef}
            className="fixed z-[999] pointer-events-auto"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, -50%) scale(${iconScale})`, transformOrigin: 'center center' }}
            onMouseDown={handleMouseDown}
            onClick={handleClick}
        >
            <button 
                ref={eyeButtonRef}
                className={`w-12 h-12 rounded-full border-2 border-primary text-primary flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing group relative
                    ${design === 'style2' ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-xl') + ' shadow-[0_0_20px_rgba(255,255,255,0.05)]') : 'shadow-[0_0_20px_rgba(244,161,37,0.4)]'}`}
                style={{
                    backgroundColor: design === 'style2' 
                        ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                        : 'var(--theme-bg-dark)'
                }}
            >
                <span ref={innerEyeRef} className="flex items-center justify-center pointer-events-none">
                    <span className="material-symbols-outlined text-[24px] group-hover:scale-110 transition-transform">visibility</span>
                </span>
                {/* isDev && (
                    <span className="absolute -top-1 -right-1 z-[1000] bg-orange-500 text-black text-[9px] font-extrabold px-1 py-0.5 rounded-sm border border-orange-600 shadow-[0_0_8px_rgba(249,115,22,0.6)] select-none pointer-events-none tracking-wide scale-90 origin-top-right uppercase leading-none font-sans">
                        dev
                    </span>
                ) */}
            </button>
        </div>
    );
};

export default FloatingEye;
