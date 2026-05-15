import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useScreenshotStore } from '../../store/useScreenshotStore';
import { useAppStore } from '../../store/useAppStore';
import type { CaptureMode } from '../../store/useScreenshotStore';

interface DisplayCapture {
    displayId: string;
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    imageDataUrl: string;
}

interface SelectionCoords {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

// ─── Magnifier (Loupe) Component ────────────────────────────────────
const LOUPE_SIZE = 140;
const LOUPE_ZOOM = 4;

const Loupe: React.FC<{
    mouseX: number;
    mouseY: number;
    imageRef: React.RefObject<HTMLCanvasElement | null>;
}> = React.memo(({ mouseX, mouseY, imageRef }) => {
    const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = loupeCanvasRef.current;
        const sourceCanvas = imageRef.current;
        if (!canvas || !sourceCanvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const sampleRadius = LOUPE_SIZE / (2 * LOUPE_ZOOM);

        ctx.clearRect(0, 0, LOUPE_SIZE * dpr, LOUPE_SIZE * dpr);
        ctx.save();

        // Clip to circle
        ctx.beginPath();
        ctx.arc((LOUPE_SIZE * dpr) / 2, (LOUPE_SIZE * dpr) / 2, (LOUPE_SIZE * dpr) / 2, 0, Math.PI * 2);
        ctx.clip();

        // Draw zoomed portion of the source
        // Master canvas matches window coordinates perfectly
        ctx.drawImage(
            sourceCanvas,
            (mouseX - sampleRadius) * dpr,
            (mouseY - sampleRadius) * dpr,
            sampleRadius * 2 * dpr,
            sampleRadius * 2 * dpr,
            0,
            0,
            LOUPE_SIZE * dpr,
            LOUPE_SIZE * dpr
        );

        ctx.restore();

        // Draw crosshair
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        const center = (LOUPE_SIZE * dpr) / 2;

        ctx.beginPath();
        ctx.moveTo(center, 0);
        ctx.lineTo(center, LOUPE_SIZE * dpr);
        ctx.moveTo(0, center);
        ctx.lineTo(LOUPE_SIZE * dpr, center);
        ctx.stroke();

        // Draw border ring
        ctx.strokeStyle = 'rgba(244, 161, 37, 0.9)';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.arc(center, center, (LOUPE_SIZE * dpr) / 2 - 2 * dpr, 0, Math.PI * 2);
        ctx.stroke();
    }, [mouseX, mouseY, imageRef]);

    const dpr = window.devicePixelRatio || 1;
    // Offset the loupe so it doesn't sit directly under the cursor
    const offsetX = 20;
    const offsetY = -LOUPE_SIZE - 20;

    return (
        <canvas
            ref={loupeCanvasRef}
            width={LOUPE_SIZE * dpr}
            height={LOUPE_SIZE * dpr}
            style={{
                position: 'fixed',
                left: mouseX + offsetX,
                top: mouseY + offsetY,
                width: LOUPE_SIZE,
                height: LOUPE_SIZE,
                borderRadius: '50%',
                pointerEvents: 'none',
                zIndex: 999999,
                boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
        />
    );
});

// ─── Capture Mode Toolbar ───────────────────────────────────────────
const CaptureToolbar: React.FC<{
    mode: CaptureMode;
    onModeChange: (mode: CaptureMode) => void;
    onCancel: () => void;
}> = React.memo(({ mode, onModeChange, onCancel }) => {
    const t = useAppStore((s) => s.t);

    const modes: { key: CaptureMode; icon: string; label: string }[] = [
        { key: 'region', icon: 'crop', label: t('ssRegion') },
        { key: 'fullscreen', icon: 'fullscreen', label: t('ssFullScreen') },
    ];

    return (
        <div
            className="pointer-events-auto"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: 'fixed',
                top: 16,
                right: 16,
                zIndex: 999998,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px',
                borderRadius: 12,
                background: 'rgba(26, 22, 18, 0.85)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(244, 161, 37, 0.3)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            }}
        >
            {modes.map((m) => (
                <button
                    key={m.key}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        onModeChange(m.key);
                    }}
                    title={m.label}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 500,
                        transition: 'all 0.2s ease',
                        background: mode === m.key
                            ? 'rgba(244, 161, 37, 0.25)'
                            : 'transparent',
                        color: mode === m.key
                            ? '#f4a125'
                            : 'rgba(255, 255, 255, 0.7)',
                    }}
                >
                    <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
                    >
                        {m.icon}
                    </span>
                    {m.label}
                </button>
            ))}

            {/* Divider */}
            <div style={{
                width: 1,
                height: 24,
                background: 'rgba(255, 255, 255, 0.15)',
                margin: '0 4px',
            }} />

            {/* Cancel */}
            <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                }}
                title={`${t('cancel')} (Esc)`}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 500,
                    background: 'rgba(255, 51, 102, 0.15)',
                    color: '#ff3366',
                    transition: 'all 0.2s ease',
                }}
            >
                <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18 }}
                >
                    close
                </span>
                {t('cancel')}
            </button>
        </div>
    );
});

// ─── Dimension Label ────────────────────────────────────────────────
const DimensionLabel: React.FC<{
    x: number;
    y: number;
    width: number;
    height: number;
}> = React.memo(({ x, y, width, height }) => {
    if (width === 0 && height === 0) return null;

    return (
        <div
            style={{
                position: 'fixed',
                left: x + 8,
                top: y + height - 28,
                zIndex: 999998,
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(26, 22, 18, 0.85)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(244, 161, 37, 0.4)',
                color: '#f4a125',
                fontSize: 10,
                fontFamily: "'Space Grotesk', monospace",
                fontWeight: 700,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
        >
            {Math.abs(Math.round(width))} × {Math.abs(Math.round(height))}
        </div>
    );
});

// ═══════════════════════════════════════════════════════════════════
// MAIN SCREENSHOT OVERLAY COMPONENT
// ═══════════════════════════════════════════════════════════════════
const ScreenshotOverlay: React.FC = () => {
    const phase = useScreenshotStore((s) => s.phase);
    const setPhase = useScreenshotStore((s) => s.setPhase);
    const captureMode = useScreenshotStore((s) => s.captureMode);
    const setCaptureMode = useScreenshotStore((s) => s.setCaptureMode);
    const setSelection = useScreenshotStore((s) => s.setSelection);
    const setCapturedImageDataUrl = useScreenshotStore((s) => s.setCapturedImageDataUrl);
    const resetScreenshot = useScreenshotStore((s) => s.resetScreenshot);
    const windowPosition = useScreenshotStore((s) => s.windowPosition);
    const setWindowPosition = useScreenshotStore((s) => s.setWindowPosition);
    const setScreenBounds = useScreenshotStore((s) => s.setScreenBounds);
    const t = useAppStore((s) => s.t);

    const [captures, setCaptures] = useState<DisplayCapture[]>([]);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [selCoords, setSelCoords] = useState<SelectionCoords | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    // ─── Initiate Capture ────────────────────────────────────────
    const startCapture = useCallback(async () => {
        setSelCoords(null);
        setCaptures([]);
        try {
            const data = await window.api.startScreenshotCapture();
            if ((data as any).error === 'permission_denied') {
                console.warn('Screenshot capture aborted: Permission denied.');
                handleCancel();
                return;
            }
            if (data.captures && data.captures.length > 0) {
                setCaptures(data.captures);
                setWindowPosition(data.windowPosition);
                setScreenBounds(data.captures[0].bounds);
                setPhase('selecting');
            } else {
                console.warn('No captures returned from main process');
                handleCancel();
            }
        } catch (err) {
            console.error('Screenshot capture failed:', err);
            handleCancel();
        }
    }, [setPhase]);

    // When phase enters 'capturing', fire the capture
    useEffect(() => {
        if (phase === 'capturing') {
            startCapture();
        }
    }, [phase, startCapture]);

    // ─── Paint the frozen background onto our canvas ─────────────
    useEffect(() => {
        if (phase !== 'selecting' || captures.length === 0) return;

        const canvas = backgroundCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        
        // Master canvas spans the entire KoBar ghost window
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw each physical screen's capture onto the master canvas at its relative offset
        captures.forEach((capture) => {
            const img = new Image();
            img.onload = () => {
                const offsetX = capture.bounds.x - windowPosition.x;
                const offsetY = capture.bounds.y - windowPosition.y;
                ctx.drawImage(
                    img,
                    offsetX * dpr,
                    offsetY * dpr,
                    capture.bounds.width * dpr,
                    capture.bounds.height * dpr
                );
            };
            img.src = capture.imageDataUrl;
        });
    }, [phase, captures, windowPosition]);

    // ─── Keyboard: Escape to cancel ──────────────────────────────
    useEffect(() => {
        if (phase !== 'selecting') return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [phase]);

    // ─── Mouse handlers for region selection ─────────────────────
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (captureMode !== 'region') return;
        setIsDragging(true);
        setSelCoords({
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
        });
    }, [captureMode]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY });
        if (isDragging && selCoords) {
            setSelCoords((prev) =>
                prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null
            );
        }
    }, [isDragging, selCoords]);

    const handleMouseUp = useCallback(() => {
        if (!isDragging || !selCoords) return;
        setIsDragging(false);

        const w = Math.abs(selCoords.currentX - selCoords.startX);
        const h = Math.abs(selCoords.currentY - selCoords.startY);

        // Minimum viable selection: at least 10×10 to prevent accidental clicks
        if (w < 10 || h < 10) {
            setSelCoords(null);
            return;
        }

        // Action Menu will now be displayed instead of auto-transitioning
    }, [isDragging, selCoords, captures]);

    // ─── Full Screen mode: instant capture ───────────────────────
    const handleModeChange = useCallback((mode: CaptureMode) => {
        setCaptureMode(mode);
        if (mode === 'fullscreen' && captures.length > 0) {
            // Specifically capture ONLY the primary monitor area
            const primary = captures[0];
            cropAndTransition(
                primary.bounds.x - windowPosition.x,
                primary.bounds.y - windowPosition.y,
                primary.bounds.width,
                primary.bounds.height
            );
        }
    }, [captures, setCaptureMode, setCapturedImageDataUrl, setSelection, setPhase]);

    // ─── Crop the selected region from the background canvas ─────
    const cropAndTransition = useCallback((x: number, y: number, w: number, h: number) => {
        const sourceCanvas = backgroundCanvasRef.current;
        if (!sourceCanvas || captures.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = w * dpr;
        cropCanvas.height = h * dpr;
        const ctx = cropCanvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(
            sourceCanvas,
            x * dpr,
            y * dpr,
            w * dpr,
            h * dpr,
            0,
            0,
            w * dpr,
            h * dpr
        );

        const croppedDataUrl = cropCanvas.toDataURL('image/png');
        setCapturedImageDataUrl(croppedDataUrl);
        setSelection({ startX: x, startY: y, endX: x + w, endY: y + h });
        setPhase('editing');
    }, [captures, setCapturedImageDataUrl, setSelection, setPhase]);

    // ─── Cancel and restore KoBar ────────────────────────────────
    const handleCancel = useCallback(() => {
        resetScreenshot();
        window.api?.cancelScreenshot();
    }, [resetScreenshot]);

    // ─── Compute selection rectangle ─────────────────────────────
    const selRect = selCoords
        ? {
            x: Math.min(selCoords.startX, selCoords.currentX),
            y: Math.min(selCoords.startY, selCoords.currentY),
            width: Math.abs(selCoords.currentX - selCoords.startX),
            height: Math.abs(selCoords.currentY - selCoords.startY),
        }
        : null;

    // ─── Action Menu for confirming selection ────────────────────
    const renderActionButtons = () => {
        if (phase !== 'selecting' || isDragging || !selRect || (selRect.width < 10 && selRect.height < 10)) return null;

        return (
            <div
                className="pointer-events-auto"
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    position: 'absolute',
                    top: selRect.y + selRect.height - 42,
                    right: window.innerWidth - (selRect.x + selRect.width) + 8,
                    zIndex: 999999,
                    display: 'flex',
                    gap: '6px',
                    padding: '4px',
                    background: 'rgba(26, 22, 18, 0.5)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.05)',
                }}
            >
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelCoords(null);
                    }}
                    style={{
                        padding: '6px 16px',
                        background: 'rgba(30, 30, 30, 0.95)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: '500',
                    }}
                >
                    {t('ssRetake')}
                </button>
                <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        cropAndTransition(selRect.x, selRect.y, selRect.width, selRect.height);
                    }}
                    style={{
                        padding: '6px 20px',
                        background: '#f4a125',
                        color: '#1a1612',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 12px rgba(244, 161, 37, 0.4)'
                    }}
                >
                    {t('ssConfirm')}
                </button>
            </div>
        );
    };

    // Don't render if not in selecting phase
    if (phase !== 'selecting') return null;

    return (
        <div
            ref={overlayRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 999990,
                cursor: captureMode === 'region' ? 'crosshair' : 'default',
                userSelect: 'none',
            }}
        >
            {/* Frozen Desktop Master Canvas */}
            <canvas
                ref={backgroundCanvasRef}
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                }}
            />

            {/* Dark overlay with cutout for the selection */}
            {captureMode === 'region' && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.45)',
                        // If there's an active selection, mask it out
                        ...(selRect && selRect.width > 0 && selRect.height > 0
                            ? {
                                clipPath: `polygon(
                                    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                                    ${selRect.x}px ${selRect.y}px,
                                    ${selRect.x}px ${selRect.y + selRect.height}px,
                                    ${selRect.x + selRect.width}px ${selRect.y + selRect.height}px,
                                    ${selRect.x + selRect.width}px ${selRect.y}px,
                                    ${selRect.x}px ${selRect.y}px
                                )`,
                            }
                            : {}),
                        pointerEvents: 'none',
                        transition: 'clip-path 0.05s ease-out',
                    }}
                />
            )}

            {/* Selection border */}
            {selRect && selRect.width > 0 && selRect.height > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        left: selRect.x,
                        top: selRect.y,
                        width: selRect.width,
                        height: selRect.height,
                        border: '2px solid #f4a125',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(244, 161, 37, 0.2)',
                        pointerEvents: 'none',
                        zIndex: 999995,
                    }}
                />
            )}

            {/* Dimension Label */}
            {selRect && selRect.width > 0 && selRect.height > 0 && (
                <DimensionLabel
                    x={selRect.x}
                    y={selRect.y}
                    width={selRect.width}
                    height={selRect.height}
                />
            )}

            {/* Magnifier (only while dragging in region mode) */}
            {isDragging && captureMode === 'region' && (
                <Loupe
                    mouseX={mousePos.x}
                    mouseY={mousePos.y}
                    imageRef={backgroundCanvasRef}
                />
            )}

            {/* Top Toolbar */}
            <CaptureToolbar
                mode={captureMode}
                onModeChange={handleModeChange}
                onCancel={handleCancel}
            />

            {/* Action Buttons (Accept / Retake) */}
            {renderActionButtons()}
        </div>
    );
};

export default ScreenshotOverlay;
