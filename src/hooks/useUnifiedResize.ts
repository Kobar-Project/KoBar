import { useRef, useState, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { setIsResizingGlobal } from '../App';

type ResizeDirection = 'side' | 'bottom' | 'corner';
type ResizeTarget = 'note';

interface UseUnifiedResizeOptions {
    target: ResizeTarget;
    direction: ResizeDirection;
    onResizeTemp: (width: number, height: number) => void;
    onResizeEnd?: () => void;
}

export const useUnifiedResize = ({ target, direction, onResizeTemp, onResizeEnd }: UseUnifiedResizeOptions) => {
    const [isResizing, setIsResizing] = useState(false);
    
    // Store refs to keep values across closures without re-binding event listeners
    const startPosRef = useRef({ x: 0, y: 0 });
    const startSizeRef = useRef({ width: 0, height: 0 });
    const activeRef = useRef(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsResizingGlobal(true);
        setIsResizing(true);
        activeRef.current = true;
        
        // Keep window focused and receptive to OS level clicks
        window.api?.setIgnoreMouseEvents(false);

        const state = useAppStore.getState();
        const startWidth = state.notePanelWidth;
        const startHeight = state.notePanelHeight;

        startPosRef.current = { x: e.screenX, y: e.screenY };
        startSizeRef.current = { width: startWidth, height: startHeight };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!activeRef.current) return;
            
            const currentState = useAppStore.getState();
            const { edgePosition, screenBounds, sidebarWidth } = currentState;

            // Multi-monitor aware bounds
            const boundsX = screenBounds?.x ?? 0;
            const boundsY = screenBounds?.y ?? 0;
            const maxW = (screenBounds?.width ?? 1920) - sidebarWidth - 40;
            const maxH = (screenBounds?.height ?? 800) - 100;

            let newWidth = startSizeRef.current.width;
            let newHeight = startSizeRef.current.height;

            if (direction === 'side' || direction === 'corner') {
                const deltaX = moveEvent.screenX - startPosRef.current.x;
                if (edgePosition === 'right') {
                    if (deltaX < 0 && moveEvent.screenX <= boundsX + 20) {
                        newWidth = maxW; 
                    } else {
                        newWidth = startSizeRef.current.width - deltaX;
                    }
                } else {
                    if (deltaX > 0 && moveEvent.screenX >= boundsX + (screenBounds?.width ?? 1920) - 20) {
                        newWidth = maxW;
                    } else {
                        newWidth = startSizeRef.current.width + deltaX;
                    }
                }
            }

            if (direction === 'bottom' || direction === 'corner') {
                const deltaY = moveEvent.screenY - startPosRef.current.y;
                if (deltaY > 0 && moveEvent.screenY >= boundsY + (screenBounds?.height ?? 800) - 30) {
                     newHeight = maxH;
                } else {
                    newHeight = startSizeRef.current.height + deltaY;
                }
            }

            // For Notes, we apply the "Sticky Dimension Principle":
            // Never auto-shrink a dimension that is already larger than the target display's max limit.
             const effectiveMaxW = target === 'note' ? Math.max(maxW, startSizeRef.current.width) : maxW;
             const effectiveMaxH = target === 'note' ? Math.max(maxH, startSizeRef.current.height) : maxH;

            const clampedWidth = Math.min(Math.max(newWidth, 250), effectiveMaxW);
            const clampedHeight = Math.min(Math.max(newHeight, 200), effectiveMaxH);

            onResizeTemp(clampedWidth, clampedHeight);
        };

        const handleMouseUp = (moveEvent: MouseEvent) => {
            if (!activeRef.current) return;
            activeRef.current = false;
            setIsResizing(false);
            setIsResizingGlobal(false);

            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            
            const currentState = useAppStore.getState();
            const { edgePosition, screenBounds, sidebarWidth } = currentState;
            const maxW = (screenBounds?.width ?? 1920) - sidebarWidth - 40;
            const maxH = (screenBounds?.height ?? 800) - 100;
            
            let finalWidth = startSizeRef.current.width;
            let finalHeight = startSizeRef.current.height;

            if (direction === 'side' || direction === 'corner') {
                const deltaX = moveEvent.screenX - startPosRef.current.x;
                if (edgePosition === 'right') {
                   finalWidth = startSizeRef.current.width - deltaX;
                } else {
                   finalWidth = startSizeRef.current.width + deltaX;
                }
            }
            if (direction === 'bottom' || direction === 'corner') {
                const deltaY = moveEvent.screenY - startPosRef.current.y;
                finalHeight = startSizeRef.current.height + deltaY;
            }

            const effectiveMaxW = target === 'note' ? Math.max(maxW, startSizeRef.current.width) : maxW;
            const effectiveMaxH = target === 'note' ? Math.max(maxH, startSizeRef.current.height) : maxH;

            const clampedWidth = Math.min(Math.max(finalWidth, 250), effectiveMaxW);
            const clampedHeight = Math.min(Math.max(finalHeight, 200), effectiveMaxH);

            if (direction === 'side' || direction === 'corner') {
                currentState.setNotePanelWidth(clampedWidth);
            }
            if (direction === 'bottom' || direction === 'corner') {
                currentState.setNotePanelHeight(clampedHeight);
            }

            onResizeEnd?.();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

    }, [target, direction, onResizeTemp, onResizeEnd]);

    const handleDoubleClick = useCallback(() => {
        const state = useAppStore.getState();
        const { screenBounds } = state;
        const defaultW = 400;
        const defaultH = Math.min(600, (screenBounds?.height ?? 800) - 40);

        if (direction === 'side' || direction === 'corner') {
            state.setNotePanelWidth(defaultW);
        }
        if (direction === 'bottom' || direction === 'corner') {
            state.setNotePanelHeight(defaultH);
        }

        const newW = (direction === 'side' || direction === 'corner') ? defaultW : state.notePanelWidth;
        const newH = (direction === 'bottom' || direction === 'corner') ? defaultH : state.notePanelHeight;

        onResizeTemp(newW, newH);
    }, [direction, onResizeTemp]);

    return {
        isResizing,
        handleMouseDown,
        handleDoubleClick
    };
};
