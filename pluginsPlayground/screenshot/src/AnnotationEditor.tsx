import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Circle, Arrow, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { useScreenshotStore } from './useScreenshotStore';
const useAppStore = (window as any).useAppStore;
import type { AnnotationTool } from './useScreenshotStore';

// ─── Tool Configuration ─────────────────────────────────────────────
const TOOLS: { key: AnnotationTool; icon: string; label: string }[] = [
    { key: 'select', icon: 'arrow_selector_tool', label: 'Select' },
    { key: 'pen', icon: 'draw', label: 'Pen' },
    { key: 'highlighter', icon: 'ink_highlighter', label: 'Highlighter' },
    { key: 'text', icon: 'title', label: 'Text' },
    { key: 'arrow', icon: 'north_east', label: 'Arrow' },
    { key: 'rect', icon: 'rectangle', label: 'Rectangle' },
    { key: 'circle', icon: 'circle', label: 'Circle' },
];

const COLORS = ['#ff3366', '#f4a125', '#00c853', '#2979ff', '#aa00ff', '#ffffff', '#000000'];
const STROKE_WIDTHS = [2, 3, 5, 8];
const FONTS = [
    { name: 'Sans', value: "'Space Grotesk', sans-serif" },
    { name: 'Serif', value: "'Playfair Display', serif" },
    { name: 'Mono', value: "'JetBrains Mono', monospace" }
];

// ─── Utility: Generate unique ID ────────────────────────────────────
let shapeCounter = 0;
function generateId(): string {
    return `shape_${Date.now()}_${shapeCounter++}`;
}

// ─── Toolbar Component ──────────────────────────────────────────────
interface EditorToolbarProps {
    activeTool: AnnotationTool;
    activeColor: string;
    activeStrokeWidth: number;
    onToolChange: (tool: AnnotationTool) => void;
    onColorChange: (color: string) => void;
    onStrokeWidthChange: (w: number) => void;
    onUndo: () => void;
    onClear: () => void;
    isFilled: boolean;
    setIsFilled: (f: boolean) => void;
    currentFontFamily: string;
    onFontFamilyChange: (font: string) => void;
    hasBorder: boolean;
    onToggleBorder: () => void;
    onCopy: () => void;
    onSave: () => void;
    onDone: () => void;
    exportFormat: 'png' | 'jpg' | 'webp';
    onFormatChange: (f: 'png' | 'jpg' | 'webp') => void;
}

const EditorToolbar: React.FC<EditorToolbarProps> = React.memo(({ 
    activeTool, activeColor, activeStrokeWidth, onToolChange, onColorChange, 
    onStrokeWidthChange, onUndo, onClear, isFilled, setIsFilled,
    currentFontFamily, onFontFamilyChange, hasBorder, onToggleBorder,
    onCopy, onSave, onDone, exportFormat, onFormatChange
}) => {
    const t = useAppStore((s: any) => s.t);
    return (
    <div
        className="pointer-events-auto"
        style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 8px',
            borderRadius: 12,
            background: 'rgba(26, 22, 18, 0.92)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(244, 161, 37, 0.25)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        }}
    >
        {/* Tool Buttons */}
        {TOOLS.map((tool) => (
            <button
                key={tool.key}
                onClick={() => onToolChange(tool.key)}
                title={t(`ss${tool.key.charAt(0).toUpperCase() + tool.key.slice(1)}` as any)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background: activeTool === tool.key ? 'rgba(244, 161, 37, 0.25)' : 'transparent',
                    color: activeTool === tool.key ? '#f4a125' : 'rgba(255,255,255,0.65)',
                }}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                    {tool.icon}
                </span>
            </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }} />

        {/* Color Swatches */}
        {COLORS.map((c) => (
            <button
                key={c}
                onClick={() => onColorChange(c)}
                style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: activeColor === c ? '2px solid #f4a125' : '2px solid transparent',
                    background: c,
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                    boxShadow: activeColor === c ? '0 0 0 2px rgba(244,161,37,0.3)' : 'none',
                }}
            />
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }} />

        {/* Stroke Width Selector */}
        {STROKE_WIDTHS.map((w) => (
            <button
                key={w}
                onClick={() => onStrokeWidthChange(w)}
                title={`${w}px`}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    background: activeStrokeWidth === w ? 'rgba(244,161,37,0.2)' : 'transparent',
                }}
            >
                <div style={{
                    width: 16,
                    height: w,
                    borderRadius: w / 2,
                    background: activeStrokeWidth === w ? '#f4a125' : 'rgba(255,255,255,0.5)',
                }} />
            </button>
        ))}

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }} />

        {/* Undo & Clear */}
        <button onClick={onUndo} title={t('ssUndo')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'transparent', color: 'rgba(255,255,255,0.65)',
        }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>undo</span>
        </button>

        {/* Fill Toggle */}
        {(activeTool === 'rect' || activeTool === 'circle') && (
            <button
                onClick={() => setIsFilled(!isFilled)}
                title={isFilled ? t('ssFilled') : t('ssOutline')}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: isFilled ? 'rgba(244, 161, 37, 0.25)' : 'rgba(255,255,255,0.05)',
                    color: isFilled ? '#f4a125' : 'rgba(255,255,255,0.65)',
                    marginLeft: 6
                }}
            >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    {isFilled ? 'format_color_fill' : 'border_style'}
                </span>
            </button>
        )}

        <button onClick={onClear} title={t('ssClearAll')} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'rgba(255, 51, 102, 0.12)', color: '#ff3366',
            marginLeft: 6
        }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete_sweep</span>
        </button>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)', margin: '0 8px' }} />

        {/* Global Image Border Toggle */}
        <button
            onClick={onToggleBorder}
            title={t('ssImageBorder')}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: hasBorder ? 'rgba(244,161,37,0.2)' : 'rgba(255,255,255,0.05)',
                color: hasBorder ? '#f4a125' : 'white',
                transition: 'all 0.2s ease'
            }}
        >
            <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 0" }}>
                frame_inspect
            </span>
        </button>

        {/* Font Switcher (Only for Text tool) */}
        {activeTool === 'text' && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                {FONTS.map(f => (
                    <button
                        key={f.name}
                        onClick={() => onFontFamilyChange(f.value)}
                        style={{
                            padding: '4px 6px', fontSize: 10, borderRadius: 4, border: 'none',
                            background: currentFontFamily === f.value ? 'rgba(244,161,37,0.3)' : 'rgba(255,255,255,0.05)',
                            color: 'white', cursor: 'pointer',
                            fontWeight: currentFontFamily === f.value ? 700 : 400
                        }}
                    >
                        {f.name}
                    </button>
                ))}
            </div>
        )}

        <div style={{ width: 1, height: 24, background: 'rgba(244,161,37,0.25)', margin: '0 8px' }} />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Format Selector */}
            {(['png', 'jpg', 'webp'] as const).map((f) => (
                <button
                    key={f}
                    onClick={() => onFormatChange(f)}
                    style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontFamily: "'Space Grotesk', monospace",
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        background: exportFormat === f ? 'rgba(244,161,37,0.2)' : 'transparent',
                        color: exportFormat === f ? '#f4a125' : 'rgba(255,255,255,0.5)',
                        transition: 'all 0.15s',
                    }}
                >
                    {f}
                </button>
            ))}

            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 4px' }} />

            {/* Copy to Clipboard */}
            <button onClick={onCopy} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(0, 200, 83, 0.15)', color: '#00c853',
                fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500,
                transition: 'all 0.2s',
            }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>content_copy</span>
                {t('copy')}
            </button>

            {/* Quick Save */}
            <button onClick={onSave} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(41, 121, 255, 0.15)', color: '#2979ff',
                fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 500,
                transition: 'all 0.2s',
            }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>save</span>
                {t('ssSave')}
            </button>

            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', margin: '0 4px' }} />

            {/* Done */}
            <button onClick={onDone} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'rgba(244, 161, 37, 0.2)', color: '#f4a125',
                fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600,
                transition: 'all 0.2s',
            }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                {t('ssDone')}
            </button>
        </div>
    </div>
    );
});

// ═══════════════════════════════════════════════════════════════════
// MAIN ANNOTATION EDITOR COMPONENT
// ═══════════════════════════════════════════════════════════════════
const AnnotationEditor: React.FC = () => {
    const phase = useScreenshotStore((s) => s.phase);
    const capturedImageDataUrl = useScreenshotStore((s) => s.capturedImageDataUrl);
    const activeTool = useScreenshotStore((s) => s.activeTool);
    const setActiveTool = useScreenshotStore((s) => s.setActiveTool);
    const activeColor = useScreenshotStore((s) => s.activeColor);
    const setActiveColor = useScreenshotStore((s) => s.setActiveColor);
    const activeStrokeWidth = useScreenshotStore((s) => s.activeStrokeWidth);
    const setActiveStrokeWidth = useScreenshotStore((s) => s.setActiveStrokeWidth);
    const annotations = useScreenshotStore((s) => s.annotations);
    const addAnnotation = useScreenshotStore((s) => s.addAnnotation);
    const updateAnnotation = useScreenshotStore((s) => s.updateAnnotation);
    const bringToFront = useScreenshotStore((s) => s.bringToFront);
    const removeAnnotation = useScreenshotStore((s) => s.removeAnnotation);
    const clearAnnotations = useScreenshotStore((s) => s.clearAnnotations);
    const exportFormat = useScreenshotStore((s) => s.exportFormat);
    const setExportFormat = useScreenshotStore((s) => s.setExportFormat);
    const resetScreenshot = useScreenshotStore((s) => s.resetScreenshot);
    const screenBounds = useScreenshotStore((s) => s.screenBounds);
    const windowPosition = useScreenshotStore((s) => s.windowPosition);

    const [selectedShapeId, setSelectedShapeIdState] = useState<string | null>(null);

    const setSelectedShapeId = useCallback((id: string | null) => {
        setSelectedShapeIdState(id);
        if (id) {
            bringToFront(id);
        }
    }, [bringToFront]);

    const stageRef = useRef<Konva.Stage>(null);
    const transformerRef = useRef<Konva.Transformer>(null);

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<number[]>([]);
    const [drawStartPos, setDrawStartPos] = useState<{ x: number; y: number } | null>(null);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
    const [stageScale, setStageScale] = useState(1);
    const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);
    const [isFilled, setIsFilled] = useState(false);

    // Live Text State
    const [textEntry, setTextEntry] = useState<{ x: number; y: number; value: string; id: string; fontSize: number; color: string; fontFamily: string } | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [fontFamily, setFontFamily] = useState(FONTS[0].value);

    // Image Border State
    const [hasImageBorder, setHasImageBorder] = useState(false);
    const [imageBorderColor, setImageBorderColor] = useState(activeColor);
    const [isImageBorderSelected, setIsImageBorderSelected] = useState(false);

    const onToggleBorder = useCallback(() => {
        const newState = !hasImageBorder;
        setHasImageBorder(newState);
        if (newState) {
            setIsImageBorderSelected(true);
            setSelectedShapeId(null);
            setImageBorderColor(activeColor);
        } else {
            setIsImageBorderSelected(false);
        }
    }, [hasImageBorder, activeColor, setSelectedShapeId]);

    const onColorChange = useCallback((color: string) => {
        setActiveColor(color);
        if (isImageBorderSelected) {
            setImageBorderColor(color);
        } else if (selectedShapeId) {
            updateAnnotation(selectedShapeId, { color });
        }
    }, [selectedShapeId, isImageBorderSelected, setActiveColor, updateAnnotation]);

    const onToolChange = useCallback((tool: AnnotationTool) => {
        setActiveTool(tool);
        setSelectedShapeId(null);
        setIsImageBorderSelected(false);
    }, [setActiveTool, setSelectedShapeId]);

    // ─── Load the captured image ─────────────────────────────────
    useEffect(() => {
        if (!capturedImageDataUrl) return;
        const img = new window.Image();
        img.onload = () => {
            setBgImage(img);
            // Scale to fit screen while preserving aspect ratio
            const maxW = (screenBounds ? screenBounds.width : window.innerWidth) - 100;
            const maxH = (screenBounds ? screenBounds.height : window.innerHeight) - 140;
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);
            setStageSize({
                width: Math.round(img.width * scale),
                height: Math.round(img.height * scale),
            });
            // Force redraw in case Konva needs a bump
            setTimeout(() => {
                stageRef.current?.batchDraw();
            }, 50);
        };
        img.onerror = (err) => {
            console.error('Failed to load bgImage in AnnotationEditor:', err);
        };
        img.src = capturedImageDataUrl;
    }, [capturedImageDataUrl, screenBounds]);

    // ─── Transformer follows selection ───────────────────────────
    useEffect(() => {
        const transformer = transformerRef.current;
        const stage = stageRef.current;
        if (!transformer || !stage) return;

        if (selectedShapeId && activeTool === 'select') {
            const node = stage.findOne(`#${selectedShapeId}`);
            if (node) {
                transformer.nodes([node]);
            } else {
                transformer.nodes([]);
            }
        } else {
            transformer.nodes([]);
        }
        transformer.getLayer()?.batchDraw();
    }, [selectedShapeId, activeTool, annotations]);

    // ─── Keyboard shortcuts ──────────────────────────────────────
    useEffect(() => {
        if (phase !== 'editing') return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleDone();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                handleUndo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [phase]);

    // ─── Drawing handlers ────────────────────────────────────────
    const handleStageMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage();
        if (e.evt.button === 1 && stage) {
            stage.draggable(true);
            stage.startDrag();
            stage.container().style.cursor = 'grabbing';
            return;
        }

        const clickedOnEmpty = e.target === stage;

        if (activeTool === 'select') {
            if (clickedOnEmpty) setSelectedShapeId(null);
            return;
        }

        // If clicking an existing text node while TEXT tool is active, start editing it
        if (activeTool === 'text' && !clickedOnEmpty) {
            const id = e.target.id();
            const shape = annotations.find(a => a.id === id);
            if (shape && shape.tool === 'text') {
                bringToFront(id);
                handleStartTextEdit(shape);
                return;
            }
        }

        if (!clickedOnEmpty) {
            // If we are starting to draw but clicked on some object, we should probably deselect previous one
            setSelectedShapeId(null);
            setIsImageBorderSelected(false);
        }

        const pointer = stage?.getPointerPosition();
        if (!pointer || !stage) return;
        
        let transform = stage.getAbsoluteTransform().copy();
        transform.invert();
        const pos = transform.point(pointer);

        setIsDrawing(true);
        setDrawStartPos(pos);

        if (activeTool === 'pen' || activeTool === 'highlighter') {
            setCurrentPoints([pos.x, pos.y]);
        }
    }, [activeTool]);

    const handleStageMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!isDrawing) return;
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (!pointer || !stage) return;
        
        let transform = stage.getAbsoluteTransform().copy();
        transform.invert();
        const pos = transform.point(pointer);

        setCurrentMousePos(pos);
        if (activeTool === 'pen' || activeTool === 'highlighter') {
            setCurrentPoints((prev) => [...prev, pos.x, pos.y]);
        }
    }, [isDrawing, activeTool]);

    const handleStageMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button === 1) {
            const stage = e.target.getStage();
            if (stage) {
                stage.stopDrag();
                stage.draggable(false);
                stage.container().style.cursor = activeTool === 'select' ? 'default' : (activeTool === 'text' ? 'text' : 'crosshair');
            }
            return;
        }

        if (!isDrawing || !drawStartPos) return;
        setIsDrawing(false);
        setCurrentMousePos(null);

        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (!pointer || !stage) return;
        
        let transform = stage.getAbsoluteTransform().copy();
        transform.invert();
        const pos = transform.point(pointer);

        const id = generateId();

        if (activeTool === 'pen' || activeTool === 'highlighter') {
            if (currentPoints.length >= 4) {
                addAnnotation({
                    id,
                    tool: activeTool,
                    points: [...currentPoints],
                    color: activeColor,
                    strokeWidth: activeTool === 'highlighter' ? activeStrokeWidth * 4 : activeStrokeWidth,
                    opacity: activeTool === 'highlighter' ? 0.4 : 1,
                });
            }
            setCurrentPoints([]);
        } else if (activeTool === 'arrow') {
            const dx = pos.x - drawStartPos.x;
            const dy = pos.y - drawStartPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 5) {
                addAnnotation({
                    id,
                    tool: 'arrow',
                    points: [drawStartPos.x, drawStartPos.y, pos.x, pos.y],
                    color: activeColor,
                    strokeWidth: activeStrokeWidth,
                    opacity: 1,
                });
            }
        } else if (activeTool === 'rect') {
            const w = Math.abs(pos.x - drawStartPos.x);
            const h = Math.abs(pos.y - drawStartPos.y);
            if (w > 3 && h > 3) {
                addAnnotation({
                    id,
                    tool: 'rect',
                    x: Math.min(drawStartPos.x, pos.x),
                    y: Math.min(drawStartPos.y, pos.y),
                    width: w,
                    height: h,
                    color: activeColor,
                    strokeWidth: activeStrokeWidth,
                    opacity: 1,
                    isFilled,
                });
            }
        } else if (activeTool === 'circle') {
            const dx = pos.x - drawStartPos.x;
            const dy = pos.y - drawStartPos.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            if (radius > 3) {
                addAnnotation({
                    id,
                    tool: 'circle',
                    x: drawStartPos.x,
                    y: drawStartPos.y,
                    width: radius,
                    color: activeColor,
                    strokeWidth: activeStrokeWidth,
                    opacity: 1,
                    isFilled,
                });
            }
        } else if (activeTool === 'text') {
            setTextEntry({ 
                x: pos.x, 
                y: pos.y, 
                value: '', 
                id: generateId(),
                fontSize: activeStrokeWidth * 10,
                color: activeColor,
                fontFamily: fontFamily
            });
            setEditingNodeId(null);
        }

        setDrawStartPos(null);
    }, [isDrawing, drawStartPos, activeTool, activeColor, activeStrokeWidth, currentPoints, addAnnotation, fontFamily, annotations]);

    const getCompositeDataUrl = useCallback(async () => {
        const stage = stageRef.current;
        if (!stage || !bgImage) return null;
        
        // Hide transformer temporarily
        const transformers = stage.find('Transformer');
        transformers.forEach((t: any) => t.hide());
        
        const annotationsDataUrl = stage.toDataURL({
            pixelRatio: 2, // High quality export
            mimeType: 'image/png'
        });
        
        // Show transformer again
        transformers.forEach((t: any) => t.show());
        
        return new Promise<string>((resolve) => {
            const canvas = document.createElement('canvas');
            // We use pixelRatio 2 for high quality to match stage
            canvas.width = stageSize.width * 2;
            canvas.height = stageSize.height * 2;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(annotationsDataUrl);

            // Draw background image
            ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);

            // Draw annotations on top
            const annImg = new window.Image();
            annImg.onload = () => {
                ctx.drawImage(annImg, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
            };
            annImg.src = annotationsDataUrl;
        });
    }, [bgImage, stageSize]);

    const handleCopy = useCallback(async () => {
        const dataUrl = await getCompositeDataUrl();
        if (!dataUrl) return;

        // Strip the data:image/png;base64, prefix
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        await (window as any).api.clipboardWriteImage(base64Data);
    }, [getCompositeDataUrl]);

    const handleSave = useCallback(async () => {
        const dataUrl = await getCompositeDataUrl();
        if (!dataUrl) return;

        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        await (window as any).api.invoke('save-screenshot', base64Data);
    }, [getCompositeDataUrl]);

    const handleStartTextEdit = useCallback((shape: any) => {
        const id = shape.id;
        const textNode = stageRef.current?.findOne(`#${id}`) as any;
        if (!textNode) return;

        bringToFront(id);
        setEditingNodeId(id);
        setSelectedShapeId(id);
        setTextEntry({
            id: id,
            x: textNode.x(),
            y: textNode.y(),
            value: textNode.text(),
            fontSize: textNode.fontSize(),
            color: textNode.fill(),
            fontFamily: textNode.fontFamily(),
        });
    }, []);

    const handleDone = useCallback(() => {
        resetScreenshot();
        (window as any).api?.screenshotSessionComplete();
    }, [resetScreenshot]);

    const handleUndo = useCallback(() => {
        const current = useScreenshotStore.getState().annotations;
        if (current.length > 0) {
            useScreenshotStore.getState().removeAnnotation(current[current.length - 1].id);
        }
    }, []);

    // Don't render if not in editing phase
    if (phase !== 'editing' || !bgImage) return null;

    // Calculate local position of the primary monitor within the multi-monitor ghost window
    const offsetX = screenBounds ? screenBounds.x - windowPosition.x : 0;
    const offsetY = screenBounds ? screenBounds.y - windowPosition.y : 0;
    const cw = screenBounds ? screenBounds.width : '100%';
    const ch = screenBounds ? screenBounds.height : '100%';

    return (
        <div
            className="pointer-events-auto"
            style={{
                position: 'fixed',
                left: offsetX,
                top: offsetY,
                width: cw,
                height: ch,
                zIndex: 999990,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(10, 8, 6, 0.95)',
            }}
        >
            {/* Annotation Toolbar */}
            <EditorToolbar
                activeTool={activeTool}
                activeColor={activeColor}
                activeStrokeWidth={activeStrokeWidth}
                onToolChange={onToolChange}
                onColorChange={onColorChange}
                onStrokeWidthChange={setActiveStrokeWidth}
                onUndo={handleUndo}
                onClear={clearAnnotations}
                isFilled={isFilled}
                setIsFilled={setIsFilled}
                currentFontFamily={fontFamily}
                onFontFamilyChange={setFontFamily}
                hasBorder={hasImageBorder}
                onToggleBorder={onToggleBorder}
                onCopy={handleCopy}
                onSave={handleSave}
                onDone={handleDone}
                exportFormat={exportFormat}
                onFormatChange={setExportFormat}
            />

            {/* Konva Stage */}
            <div style={{
                borderRadius: 8,
                overflow: 'hidden',
                boxShadow: '0 16px 64px rgba(0,0,0,0.7)',
                border: '1px solid rgba(244,161,37,0.15)',
            }}>
                <Stage
                    ref={stageRef}
                    width={stageSize.width}
                    height={stageSize.height}
                    x={stagePos.x}
                    y={stagePos.y}
                    scaleX={stageScale}
                    scaleY={stageScale}
                    onDragStart={() => setIsDrawing(false)}
                    onDragEnd={(e) => {
                        if (e.target === e.target.getStage()) {
                            setStagePos({ x: e.target.x(), y: e.target.y() });
                        }
                    }}
                    onMouseDown={handleStageMouseDown}
                    onMouseMove={handleStageMouseMove}
                    onMouseUp={handleStageMouseUp}
                    onWheel={(e) => {
                        e.evt.preventDefault();
                        const stage = stageRef.current;
                        if (!stage) return;
                        
                        const scaleBy = 1.05;
                        const oldScale = stage.scaleX();
                        const pointer = stage.getPointerPosition();
                        if (!pointer) return;

                        const mousePointTo = {
                            x: (pointer.x - stage.x()) / oldScale,
                            y: (pointer.y - stage.y()) / oldScale,
                        };

                        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
                        setStageScale(newScale);

                        setStagePos({
                            x: pointer.x - mousePointTo.x * newScale,
                            y: pointer.y - mousePointTo.y * newScale,
                        });
                    }}
                    style={{
                        cursor: activeTool === 'select' ? 'default' :
                            activeTool === 'text' ? 'text' : 'crosshair',
                    }}
                >
                    {/* Background Image Layer */}
                    <Layer>
                        <KonvaImage
                            image={bgImage}
                            width={stageSize.width}
                            height={stageSize.height}
                        />
                        {hasImageBorder && (
                            <Rect
                                x={0}
                                y={0}
                                width={stageSize.width}
                                height={stageSize.height}
                                stroke={imageBorderColor}
                                strokeWidth={activeStrokeWidth * 2}
                                listening={true}
                                onClick={() => {
                                    if (activeTool === 'select') {
                                        setIsImageBorderSelected(true);
                                        setSelectedShapeId(null);
                                    }
                                }}
                            />
                        )}
                    </Layer>

                    {/* Annotations Layer */}
                    <Layer>
                        {annotations.map((shape) => {
                            switch (shape.tool) {
                                case 'pen':
                                case 'highlighter':
                                    return (
                                        <Line
                                            key={shape.id}
                                            id={shape.id}
                                            points={shape.points || []}
                                            stroke={shape.color}
                                            strokeWidth={shape.strokeWidth}
                                            opacity={shape.opacity}
                                            tension={0.5}
                                            lineCap="round"
                                            lineJoin="round"
                                            globalCompositeOperation={
                                                shape.tool === 'highlighter' ? 'multiply' : 'source-over'
                                            }
                                            draggable={activeTool === 'select'}
                                            onClick={() => activeTool === 'select' && setSelectedShapeId(shape.id)}
                                        />
                                    );
                                case 'arrow':
                                    return (
                                        <Arrow
                                            key={shape.id}
                                            id={shape.id}
                                            points={shape.points || []}
                                            stroke={shape.color}
                                            strokeWidth={shape.strokeWidth}
                                            fill={shape.color}
                                            pointerLength={10}
                                            pointerWidth={8}
                                            draggable={activeTool === 'select'}
                                            onClick={() => activeTool === 'select' && setSelectedShapeId(shape.id)}
                                        />
                                    );
                                case 'rect':
                                    return (
                                        <Rect
                                            key={shape.id}
                                            id={shape.id}
                                            x={shape.x}
                                            y={shape.y}
                                            width={shape.width}
                                            height={shape.height}
                                            stroke={shape.color}
                                            fill={shape.isFilled ? shape.color : undefined}
                                            strokeWidth={shape.strokeWidth}
                                            draggable={activeTool === 'select'}
                                            onClick={() => activeTool === 'select' && setSelectedShapeId(shape.id)}
                                        />
                                    );
                                case 'circle':
                                    return (
                                        <Circle
                                            key={shape.id}
                                            id={shape.id}
                                            x={shape.x}
                                            y={shape.y}
                                            radius={shape.width || 50}
                                            stroke={shape.color}
                                            fill={shape.isFilled ? shape.color : undefined}
                                            strokeWidth={shape.strokeWidth}
                                            draggable={activeTool === 'select'}
                                            onClick={() => activeTool === 'select' && setSelectedShapeId(shape.id)}
                                        />
                                    );
                                case 'text':
                                    return (
                                        <Text
                                            key={shape.id}
                                            id={shape.id}
                                            x={shape.x}
                                            y={shape.y}
                                            text={shape.text || ''}
                                            fontSize={shape.strokeWidth * 10}
                                            fill={shape.color}
                                            fontFamily={shape.fontFamily || FONTS[0].value}
                                            fontStyle="bold"
                                            visible={editingNodeId !== shape.id}
                                            draggable={activeTool === 'select'}
                                            onClick={() => activeTool === 'select' && setSelectedShapeId(shape.id)}
                                            onDblClick={() => handleStartTextEdit(shape)}
                                            onTap={() => handleStartTextEdit(shape)}
                                        />
                                    );
                                default:
                                    return null;
                            }
                        })}

                        {/* Live drawing preview */}
                        {isDrawing && (activeTool === 'pen' || activeTool === 'highlighter') && currentPoints.length >= 4 && (
                            <Line
                                points={currentPoints}
                                stroke={activeColor}
                                strokeWidth={activeTool === 'highlighter' ? activeStrokeWidth * 4 : activeStrokeWidth}
                                opacity={activeTool === 'highlighter' ? 0.4 : 1}
                                tension={0.5}
                                lineCap="round"
                                lineJoin="round"
                                globalCompositeOperation={activeTool === 'highlighter' ? 'multiply' : 'source-over'}
                            />
                        )}

                        {isDrawing && activeTool === 'arrow' && drawStartPos && currentMousePos && (
                            <Arrow
                                points={[drawStartPos.x, drawStartPos.y, currentMousePos.x, currentMousePos.y]}
                                stroke={activeColor}
                                fill={activeColor}
                                strokeWidth={activeStrokeWidth}
                                pointerLength={10}
                                pointerWidth={10}
                            />
                        )}

                        {isDrawing && activeTool === 'rect' && drawStartPos && currentMousePos && (
                            <Rect
                                x={Math.min(drawStartPos.x, currentMousePos.x)}
                                y={Math.min(drawStartPos.y, currentMousePos.y)}
                                width={Math.abs(currentMousePos.x - drawStartPos.x)}
                                height={Math.abs(currentMousePos.y - drawStartPos.y)}
                                stroke={activeColor}
                                fill={isFilled ? activeColor : undefined}
                                strokeWidth={activeStrokeWidth}
                            />
                        )}

                        {isDrawing && activeTool === 'circle' && drawStartPos && currentMousePos && (
                            <Circle
                                x={drawStartPos.x}
                                y={drawStartPos.y}
                                radius={Math.sqrt(Math.pow(currentMousePos.x - drawStartPos.x, 2) + Math.pow(currentMousePos.y - drawStartPos.y, 2))}
                                stroke={activeColor}
                                fill={isFilled ? activeColor : undefined}
                                strokeWidth={activeStrokeWidth}
                            />
                        )}

                        {/* Transformer for select mode */}
                        <Transformer
                            ref={transformerRef}
                            boundBoxFunc={(oldBox, newBox) => {
                                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                                return newBox;
                            }}
                        />
                    </Layer>
                </Stage>

                {/* Text Input Overlay */}
                {textEntry && (
                    <div style={{
                        position: 'absolute',
                        left: (textEntry.x * stageScale + stagePos.x) + ((stageRef.current?.container().getBoundingClientRect().left || 0) - offsetX),
                        top: (textEntry.y * stageScale + stagePos.y) + ((stageRef.current?.container().getBoundingClientRect().top || 0) - offsetY),
                        zIndex: 2000,
                        transformOrigin: 'top left',
                        transform: `scale(${stageScale})`
                    }}>
                        <textarea
                            autoFocus
                            value={textEntry.value}
                            onChange={(e) => setTextEntry({ ...textEntry, value: e.target.value })}
                            onBlur={() => {
                                const trimmed = textEntry.value.trim();
                                if (editingNodeId) {
                                    if (trimmed) {
                                        updateAnnotation(editingNodeId, { text: trimmed });
                                    } else {
                                        removeAnnotation(editingNodeId);
                                    }
                                } else if (trimmed) {
                                    addAnnotation({
                                        id: textEntry.id,
                                        tool: 'text',
                                        x: textEntry.x,
                                        y: textEntry.y,
                                        text: trimmed,
                                        color: textEntry.color,
                                        strokeWidth: textEntry.fontSize / 10,
                                        fontFamily: textEntry.fontFamily,
                                        opacity: 1,
                                    });
                                }
                                setTextEntry(null);
                                setEditingNodeId(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.currentTarget.blur();
                                }
                                if (e.key === 'Escape') {
                                    setTextEntry(null);
                                    setEditingNodeId(null);
                                }
                            }}
                            style={{
                                background: 'transparent',
                                color: textEntry.color,
                                fontSize: textEntry.fontSize,
                                fontFamily: textEntry.fontFamily,
                                border: '1px dashed rgba(244,161,37,0.5)',
                                outline: 'none',
                                padding: '2px 4px',
                                minWidth: 100,
                                overflow: 'hidden',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                resize: 'none',
                                fontWeight: 'bold'
                            }}
                        />
                    </div>
                )}
            </div>

        </div>
    );
};

export default AnnotationEditor;
