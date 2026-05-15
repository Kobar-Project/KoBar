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
    const [isDragging, setIsDragging] = useState(false);
    const dragInitRef = useRef({ dragged: false, offsetX: 0, offsetY: 0 });

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
        dragInitRef.current = {
            dragged: false,
            offsetX: e.clientX - posRef.current.x,
            offsetY: e.clientY - posRef.current.y,
        };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            const newX = e.clientX - dragInitRef.current.offsetX;
            const newY = e.clientY - dragInitRef.current.offsetY;

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

        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                setIsResizingGlobal(false);
                // Re-sync React state once drag completes
                setPos({ x: posRef.current.x, y: posRef.current.y });
                // Persist the final position to global store so Sidebar knows where the Eye was
                useAppStore.getState().setMiniMode(true, { x: posRef.current.x, y: posRef.current.y });
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
                className={`w-12 h-12 rounded-full border-2 border-primary text-primary flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-grab active:cursor-grabbing group
                    ${design === 'style2' ? ((isMac ? 'backdrop-blur-md' : 'backdrop-blur-xl') + ' shadow-[0_0_20px_rgba(255,255,255,0.05)]') : 'shadow-[0_0_20px_rgba(244,161,37,0.4)]'}`}
                style={{
                    backgroundColor: design === 'style2' 
                        ? `color-mix(in srgb, var(--theme-bg-dark) ${glassOpacity}%, transparent)` 
                        : 'var(--theme-bg-dark)'
                }}
            >
                <span className="material-symbols-outlined text-[24px] group-hover:scale-110 transition-transform">visibility</span>
            </button>
        </div>
    );
};

export default FloatingEye;
