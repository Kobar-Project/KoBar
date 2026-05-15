import React, { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/useAppStore';

interface TooltipButtonProps {
    label: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    onMouseDown?: (e: React.MouseEvent) => void;
    onMouseUp?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    className?: string;
    style?: React.CSSProperties;
    disabled?: boolean;
    tooltipSide?: 'left' | 'right' | 'auto';
    as?: 'button' | 'div';
    draggable?: boolean;
    onDragOver?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

const TooltipButton: React.FC<TooltipButtonProps> = ({
    label,
    children,
    onClick,
    onDoubleClick,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    className,
    style,
    disabled,
    tooltipSide = 'auto',
    as = 'button',
    draggable,
    onDragOver,
    onDragLeave,
    onDrop,
    buttonRef,
}) => {
    const { edgePosition, showTooltips } = useAppStore();
    const internalRef = useRef<HTMLElement>(null);
    const ref = (buttonRef as React.RefObject<HTMLElement>) ?? internalRef;

    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });

    const side = tooltipSide === 'auto' ? edgePosition : tooltipSide;

    const handleMouseEnter = useCallback(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            const x = side === 'left' ? rect.left - 8 : rect.right + 8;
            const y = rect.top + rect.height / 2;
            setPos({ x, y });
            setVisible(true);
        }
    }, [ref, side]);

    const handleMouseLeave = useCallback((e: React.MouseEvent) => {
        setVisible(false);
        onMouseLeave?.(e);
    }, [onMouseLeave]);

    const tooltip = showTooltips && visible && label ? createPortal(
        <div
            className="fixed pointer-events-none whitespace-nowrap border rounded-lg py-1.5 px-3 shadow-lg text-xs font-semibold text-primary"
            style={{
                zIndex: 9999,
                backgroundColor: 'var(--theme-bg-base)',
                borderColor: 'var(--theme-border)',
                top: pos.y,
                left: side === 'left' ? pos.x - 4 : pos.x,
                transform: side === 'left' ? 'translate(-100%, -50%)' : 'translate(0%, -50%)',
            }}
        >
            {label}
        </div>,
        document.body
    ) : null;

    const commonProps = {
        className,
        style,
        disabled,
        onClick,
        onDoubleClick,
        onMouseDown,
        onMouseUp,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        draggable,
        onDragOver,
        onDragLeave,
        onDrop,
    };

    if (as === 'div') {
        return (
            <>
                <div {...commonProps} ref={ref as React.RefObject<HTMLDivElement>}>
                    {children}
                </div>
                {tooltip}
            </>
        );
    }

    return (
        <>
            <button
                {...commonProps}
                ref={ref as React.RefObject<HTMLButtonElement>}
            >
                {children}
            </button>
            {tooltip}
        </>
    );
};

export default TooltipButton;
