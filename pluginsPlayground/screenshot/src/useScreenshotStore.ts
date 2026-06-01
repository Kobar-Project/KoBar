import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────
export type CaptureMode = 'region' | 'window' | 'fullscreen';

export type AnnotationTool = 'select' | 'pen' | 'highlighter' | 'text' | 'arrow' | 'rect' | 'circle';

export interface RegionSelection {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

export interface AnnotationShape {
    id: string;
    tool: AnnotationTool;
    points?: number[];       // For pen/highlighter strokes
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    color: string;
    strokeWidth: number;
    opacity: number;
    isFilled?: boolean;
    fontFamily?: string;
}

export type ScreenshotPhase = 'idle' | 'capturing' | 'selecting' | 'editing';

export interface QuickSaveSlot {
    label: string;
    path: string;
}

// ─── Store ────────────────────────────────────────────────────────
interface ScreenshotState {
    // Phase Management
    phase: ScreenshotPhase;
    setPhase: (phase: ScreenshotPhase) => void;

    // Display Bounds Mapping (KoBar 6000x4000 ghost window offset)
    screenBounds: { width: number; height: number; x: number; y: number } | null;
    setScreenBounds: (bounds: { width: number; height: number; x: number; y: number } | null) => void;
    windowPosition: { x: number; y: number };
    setWindowPosition: (pos: { x: number; y: number }) => void;

    // Capture Source
    captureMode: CaptureMode;
    setCaptureMode: (mode: CaptureMode) => void;
    capturedImageDataUrl: string;
    setCapturedImageDataUrl: (url: string) => void;

    // Region Selection
    selection: RegionSelection | null;
    setSelection: (sel: RegionSelection | null) => void;

    // Annotation Tools
    activeTool: AnnotationTool;
    setActiveTool: (tool: AnnotationTool) => void;
    activeColor: string;
    setActiveColor: (color: string) => void;
    activeStrokeWidth: number;
    setActiveStrokeWidth: (w: number) => void;
    annotations: AnnotationShape[];
    addAnnotation: (shape: AnnotationShape) => void;
    updateAnnotation: (id: string, updates: Partial<AnnotationShape>) => void;
    bringToFront: (id: string) => void;
    removeAnnotation: (id: string) => void;
    clearAnnotations: () => void;

    // Export Settings
    exportFormat: 'png' | 'jpg' | 'webp';
    setExportFormat: (format: 'png' | 'jpg' | 'webp') => void;
    quickSaveSlots: QuickSaveSlot[];
    setQuickSaveSlots: (slots: QuickSaveSlot[]) => void;

    // Reset
    resetScreenshot: () => void;
}

const initialState = {
    phase: 'idle' as ScreenshotPhase,
    screenBounds: null as { width: number; height: number; x: number; y: number } | null,
    windowPosition: { x: 0, y: 0 },
    captureMode: 'region' as CaptureMode,
    capturedImageDataUrl: '',
    selection: null as RegionSelection | null,
    activeTool: 'select' as AnnotationTool,
    activeColor: '#ff3366',
    activeStrokeWidth: 3,
    annotations: [] as AnnotationShape[],
    exportFormat: 'png' as 'png' | 'jpg' | 'webp',
    quickSaveSlots: [] as QuickSaveSlot[],
};

export const useScreenshotStore = create<ScreenshotState>((set) => ({
    ...initialState,

    setPhase: (phase) => set({ phase }),
    setScreenBounds: (screenBounds) => set({ screenBounds }),
    setWindowPosition: (windowPosition) => set({ windowPosition }),
    setCaptureMode: (captureMode) => set({ captureMode }),
    setCapturedImageDataUrl: (url) => set({ capturedImageDataUrl: url }),
    setSelection: (selection) => set({ selection }),
    setActiveTool: (activeTool) => set({ activeTool }),
    setActiveColor: (activeColor) => set({ activeColor }),
    setActiveStrokeWidth: (activeStrokeWidth) => set({ activeStrokeWidth }),

    addAnnotation: (shape) => set((s) => ({ annotations: [...s.annotations, shape] })),
    updateAnnotation: (id, updates) => set((s) => ({
        annotations: s.annotations.map(a => a.id === id ? { ...a, ...updates } : a)
    })),
    bringToFront: (id) => set((s) => {
        const item = s.annotations.find(a => a.id === id);
        if (!item) return s;
        return {
            annotations: [...s.annotations.filter(a => a.id !== id), item]
        };
    }),
    removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter(a => a.id !== id) })),
    clearAnnotations: () => set({ annotations: [] }),

    setExportFormat: (exportFormat) => set({ exportFormat }),
    setQuickSaveSlots: (quickSaveSlots) => set({ quickSaveSlots }),

    resetScreenshot: () => set({ ...initialState }),
}));
