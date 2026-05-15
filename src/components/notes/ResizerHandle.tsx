import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useUnifiedResize } from '../../hooks/useUnifiedResize';

type ResizeDirection = 'side' | 'bottom' | 'corner';

interface ResizerHandleProps {
    direction: ResizeDirection;
    onResizeTemp: (width: number, height: number) => void;
    onResizeEnd?: () => void;
    target?: 'note' | 'aihub';
}

const ResizerHandle: React.FC<ResizerHandleProps> = ({ direction, onResizeTemp, onResizeEnd, target = 'note' }) => {
    const edgePosition = useAppStore(state => state.edgePosition);

    const { isResizing, handleMouseDown, handleDoubleClick } = useUnifiedResize({
        target,
        direction,
        onResizeTemp,
        onResizeEnd
    });

    // Direction-specific classes
    const directionClasses = (() => {
        switch (direction) {
            case 'side':
                return `absolute top-0 bottom-0 w-6 cursor-ew-resize ${edgePosition === 'right' ? 'left-0 -ml-3' : 'right-0 -mr-3'}`;
            case 'bottom':
                return 'absolute bottom-0 left-0 right-0 h-6 -mb-3 cursor-ns-resize';
            case 'corner':
                return `absolute bottom-0 w-6 h-6 -mb-3 cursor-nwse-resize ${edgePosition === 'right' ? 'left-0 -ml-3' : 'right-0 -mr-3'}`;
        }
    })();

    return (
        <div
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            className={`${directionClasses} resizer-handle hover:bg-primary/30 transition-colors z-50 [-webkit-app-region:no-drag] ${isResizing ? 'bg-primary/30' : 'bg-black/1'}`}
        />
    );
};

export default ResizerHandle;
