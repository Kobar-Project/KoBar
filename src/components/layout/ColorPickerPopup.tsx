import React, { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useClipboardStore } from '../../store/useClipboardStore';

function hexToHSL(hex: string): [number, number, number] {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function getContrastColor(hex: string) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    let yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}

export function hsvToHex(h: number, s: number, v: number): string {
    s /= 100;
    v /= 100;
    let i = Math.floor(h / 60);
    let f = h / 60 - i;
    let p = v * (1 - s);
    let q = v * (1 - f * s);
    let t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsv(hex: string): [number, number, number] {
    let hexStr = hex;
    if (hexStr.length === 4) {
        hexStr = '#' + hexStr[1] + hexStr[1] + hexStr[2] + hexStr[2] + hexStr[3] + hexStr[3];
    } else if (hexStr.length !== 7) {
        return [0, 0, 100];
    }
    let r = parseInt(hexStr.slice(1, 3), 16) / 255;
    let g = parseInt(hexStr.slice(3, 5), 16) / 255;
    let b = parseInt(hexStr.slice(5, 7), 16) / 255;
    
    if (isNaN(r)) r = 0;
    if (isNaN(g)) g = 0;
    if (isNaN(b)) b = 0;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    } else {
        h = 0; // Default to red hue when grayscale
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

const ColorPickerPopup: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const colorPickerAnchorRect = useAppStore(state => state.colorPickerAnchorRect);
    const setIsColorPickerOpen = useAppStore(state => state.setIsColorPickerOpen);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const currentColor = useAppStore(state => state.currentColor);
    const setCurrentColor = useAppStore(state => state.setCurrentColor);
    const colorPalettes = useAppStore(state => state.colorPalettes);
    const addPalette = useAppStore(state => state.addPalette);
    const updatePalette = useAppStore(state => state.updatePalette);
    const deletePalette = useAppStore(state => state.deletePalette);
    const duplicatePalette = useAppStore(state => state.duplicatePalette);
    const autoCopyColor = useAppStore(state => state.autoCopyColor);
    const isCopyPasteEnabled = useAppStore(state => state.isCopyPasteEnabled);
    const screenBounds = useAppStore(state => state.screenBounds);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const isMac = useAppStore(state => state.isMac);

    const { forceAddClipboardItem } = useClipboardStore();
    const [activeTab, setActiveTab] = useState<'wheel' | 'palettes'>('wheel');
    const popupRef = useRef<HTMLDivElement>(null);

    // Track which palette slot we are currently editing
    const [editingPalette, setEditingPalette] = useState<{ id: string, index: number } | null>(null);

    // HSV state for custom picker
    const [hsv, setHsv] = useState<[number, number, number]>(hexToHsv(currentColor));
    const [isDraggingSat, setIsDraggingSat] = useState(false);
    const [isDraggingHue, setIsDraggingHue] = useState(false);
    const satRectRef = useRef<HTMLDivElement>(null);
    const hueRectRef = useRef<HTMLDivElement>(null);

    // Synchronize HSV state with currentColor
    React.useEffect(() => {
        const newHsv = hexToHsv(currentColor);
        setHsv(newHsv);
    }, [currentColor]);

    const handleSatMove = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        if (!satRectRef.current) return;
        const rect = satRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
        
        const newS = Math.round(x * 100);
        const newV = Math.round(y * 100);
        
        setHsv(prev => [prev[0], newS, newV]);
        const newHex = hsvToHex(hsv[0], newS, newV);
        setCurrentColor(newHex);

        if (editingPalette) {
            const palette = colorPalettes.find(p => p.id === editingPalette.id);
            if (palette) {
                const newColors = [...palette.colors];
                newColors[editingPalette.index] = newHex;
                updatePalette(palette.id, { colors: newColors });
            }
        }
    };

    const handleHueMove = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
        if (!hueRectRef.current) return;
        const rect = hueRectRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newH = Math.round(x * 360);
        
        setHsv(prev => [newH, prev[1], prev[2]]);
        const newHex = hsvToHex(newH, hsv[1], hsv[2]);
        setCurrentColor(newHex);

        if (editingPalette) {
            const palette = colorPalettes.find(p => p.id === editingPalette.id);
            if (palette) {
                const newColors = [...palette.colors];
                newColors[editingPalette.index] = newHex;
                updatePalette(palette.id, { colors: newColors });
            }
        }
    };

    React.useEffect(() => {
        const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
            if (isDraggingSat) handleSatMove(e);
            if (isDraggingHue) handleHueMove(e);
        };
        const handleGlobalUp = () => {
            setIsDraggingSat(false);
            setIsDraggingHue(false);
        };

        if (isDraggingSat || isDraggingHue) {
            window.addEventListener('mousemove', handleGlobalMove);
            window.addEventListener('mouseup', handleGlobalUp);
            window.addEventListener('touchmove', handleGlobalMove);
            window.addEventListener('touchend', handleGlobalUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
            window.removeEventListener('touchmove', handleGlobalMove);
            window.removeEventListener('touchend', handleGlobalUp);
        };
    }, [isDraggingSat, isDraggingHue, hsv]);

    const orientation = useAppStore(state => state.orientation);
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const getPopupStyle = (): React.CSSProperties => {
        if (!colorPickerAnchorRect) return { display: 'none' };
        
        const popupHeight = 450; // Approximated height
        const popupWidth = 320; // w-80 is 320px
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            backgroundColor: design === 'style2' 
                ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                : 'var(--theme-surface)',
            borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
            backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
            let adjustedLeft = (colorPickerAnchorRect.left - offsetLeft) + (colorPickerAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = screenXInViewport + (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = screenXInViewport - offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isSmartPositioning) {
                style.left = '50%';
                style.transform = 'translateX(-50%)';
            } else {
                style.left = adjustedLeft;
            }

            if (edgePosition === 'top') {
                style.top = '100%';
                style.marginTop = '12px';
            } else {
                style.bottom = '100%';
                style.marginBottom = '12px';
            }
        } else {
            let adjustedTop = (colorPickerAnchorRect.top - offsetTop) - 20 + (colorPickerAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = screenYInViewport + (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = screenYInViewport - offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) {
                style.top = '50%';
                style.transform = 'translateY(-50%)';
            } else {
                style.top = adjustedTop;
            }

            if (edgePosition === 'left') {
                style.left = '100%';
                style.marginLeft = '12px';
            } else {
                style.right = '100%';
                style.marginRight = '12px';
            }
        }
        return style;
    };

    const isSmartRef = useRef(isSmartPositioning);
    React.useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    React.useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !colorPickerAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 450;
            const popupWidth = 320;
            
            const screenXInViewport = (screenBounds?.x ?? 0) - window.screenX;
        const screenYInViewport = (screenBounds?.y ?? 0) - window.screenY;

        if (orientation === "horizontal") {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (colorPickerAnchorRect.left - newX) + (colorPickerAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = screenXInViewport + (screenWidth - newX) - popupWidth - 20;
                const minLeft = screenXInViewport - newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;

            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (colorPickerAnchorRect.top - newY) - 20 + (colorPickerAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = screenYInViewport + (screenHeight - newY) - popupHeight - 20;
                const minTop = screenYInViewport - newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;

            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [colorPickerAnchorRect, screenBounds, orientation]);

    const handleEyeDropper = async () => {
        try {
            if ('EyeDropper' in window) {
                const eyeDropper = new (window as any).EyeDropper();
                const result = await eyeDropper.open();
                const hex = result.sRGBHex.toUpperCase();
                setCurrentColor(hex);
                copyColor(hex);
            } else {
                alert('Your browser does not support the EyeDropper API');
            }
        } catch (e) {
            console.log('EyeDropper cancelled or failed', e);
        }
    };

    const copyColor = (hex: string) => {
        navigator.clipboard.writeText(hex);
        if (autoCopyColor && isCopyPasteEnabled) {
            forceAddClipboardItem('text', hex);
        }
    };

    const copyColors = (hexes: string[]) => {
        hexes.forEach(hex => forceAddClipboardItem('text', hex));
    };

    const generateHarmonies = (hex: string) => {
        const [h, s, l] = hexToHSL(hex);
        return {
            Analogous: [hslToHex((h + 330) % 360, s, l), hex, hslToHex((h + 30) % 360, s, l)],
            Complementary: [hex, hslToHex((h + 180) % 360, s, l)],
            SplitComplementary: [hex, hslToHex((h + 150) % 360, s, l), hslToHex((h + 210) % 360, s, l)],
            Triadic: [hex, hslToHex((h + 120) % 360, s, l), hslToHex((h + 240) % 360, s, l)],
            Tetradic: [hex, hslToHex((h + 90) % 360, s, l), hslToHex((h + 180) % 360, s, l), hslToHex((h + 270) % 360, s, l)],
        };
    };

    const renderColorBox = (hex: string, index: number) => (
        <button 
            key={`${hex}-${index}`} 
            onClick={() => copyColor(hex)}
            className="h-10 flex-1 rounded-md flex items-center justify-center font-bold text-xs shadow-inner cursor-pointer transition-transform hover:scale-105 active:scale-95 border border-black/10 text-shadow-sm"
            style={{ backgroundColor: hex, color: getContrastColor(hex) }}
            title="Click to copy"
        >
            {hex}
        </button>
    );

    const harmonies = generateHarmonies(currentColor);

    return (
        <div
            ref={popupRef}
            className="w-80 border p-4 shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden rounded-xl"
            style={getPopupStyle()}
        >
            <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold ml-1 drag-region w-full">Color Picker</span>
                <div className="flex gap-1">
                    <button 
                        onClick={handleEyeDropper}
                        className="w-6 h-6 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-all no-drag-region"
                        title="Pick Color from Screen"
                    >
                        <span className="material-symbols-outlined text-[16px]">colorize</span>
                    </button>
                    <button 
                        onClick={() => setIsColorPickerOpen(false)}
                        className="w-6 h-6 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-black/20 p-1 rounded-lg mb-4">
                <button 
                    onClick={() => {
                        setActiveTab('wheel');
                        setEditingPalette(null);
                    }}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${activeTab === 'wheel' ? 'bg-white/10 shadow-sm text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Wheel & Harmonies
                </button>
                <button 
                    onClick={() => setActiveTab('palettes')}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${activeTab === 'palettes' ? 'bg-white/10 shadow-sm text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Palettes
                </button>
            </div>

            {activeTab === 'wheel' ? (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col items-center">
                        {/* Custom Saturation/Value Square */}
                        <div 
                            ref={satRectRef}
                            className="w-full h-32 relative cursor-crosshair overflow-hidden border border-white/10 shadow-inner"
                            style={{ backgroundColor: `hsl(${hsv[0]}, 100%, 50%)` }}
                            onMouseDown={(e) => { setIsDraggingSat(true); handleSatMove(e); }}
                            onTouchStart={(e) => { setIsDraggingSat(true); handleSatMove(e); }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent"></div>
                            <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent"></div>
                            {/* Cursor */}
                            <div 
                                className="absolute w-3 h-3 border-2 border-white rounded-full shadow-lg -translate-x-1/2 translate-y-1/2 pointer-events-none"
                                style={{ 
                                    left: `${hsv[1]}%`, 
                                    bottom: `${hsv[2]}%`,
                                    backgroundColor: currentColor
                                }}
                            ></div>
                        </div>

                        {/* Custom Hue Slider */}
                        <div 
                            ref={hueRectRef}
                            className="w-full h-3 mt-4 rounded-full relative cursor-pointer border border-white/10"
                            style={{ 
                                background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' 
                            }}
                            onMouseDown={(e) => { setIsDraggingHue(true); handleHueMove(e); }}
                            onTouchStart={(e) => { setIsDraggingHue(true); handleHueMove(e); }}
                        >
                            {/* Cursor */}
                            <div 
                                className="absolute w-4 h-4 bg-white border border-slate-400 rounded-full shadow-md -top-0.5 -translate-x-1/2 pointer-events-none"
                                style={{ left: `${(hsv[0] / 360) * 100}%` }}
                            ></div>
                        </div>

                        <div className="flex items-center gap-3 w-full mt-4">
                            <div 
                                className="w-10 h-10 rounded-full border-2 shadow-sm"
                                style={{ backgroundColor: currentColor, borderColor: 'var(--theme-border)' }}
                            ></div>
                            <div className="flex-1 flex flex-col gap-1">
                                <div className="flex bg-black/30 rounded-lg p-0.5">
                                    <div className="flex-1 py-1 text-[10px] text-center font-bold text-primary bg-primary/10 rounded-md">HEX</div>
                                    <div className="flex-1 py-1 text-[10px] text-center font-bold text-slate-500 rounded-md">RGB</div>
                                </div>
                                <input 
                                    type="text" 
                                    className="bg-black/20 text-center uppercase font-bold text-sm tracking-widest text-slate-200 border rounded-lg py-1 w-full outline-none"
                                    style={{ borderColor: 'var(--theme-border)' }}
                                    value={currentColor}
                                    onChange={(e) => setCurrentColor(e.target.value.toUpperCase())}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="h-[1px] w-full bg-slate-700/50 my-1"></div>

                    <div className="h-64 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-4">
                        {Object.entries(harmonies).map(([name, colors]) => (
                            <div key={name}>
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-xs text-slate-400">{name.replace(/([A-Z])/g, ' $1').trim()}</span>
                                    <button 
                                        onClick={() => copyColors(colors)}
                                        className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded text-slate-300 transition-colors"
                                    >
                                        Copy All
                                    </button>
                                </div>
                                <div className="flex gap-1">
                                    {colors.map((hex, idx) => renderColorBox(hex, idx))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-3 h-80 overflow-y-auto pr-2 custom-scrollbar">
                    <button 
                        onClick={() => addPalette({ id: Date.now().toString(), name: 'New Palette', colors: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF'] })}
                        className="w-full py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg text-sm hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                    >
                        <span className="material-symbols-outlined text-sm">add</span>
                        Create New Palette
                    </button>

                    {colorPalettes.length === 0 ? (
                        <div className="text-center text-slate-500 text-sm mt-8">No palettes created yet.</div>
                    ) : (
                        colorPalettes.map(palette => (
                            <div key={palette.id} className="bg-black/20 rounded-lg p-2 border" style={{ borderColor: 'var(--theme-border)' }}>
                                <div className="flex justify-between items-center mb-2">
                                    <input 
                                        type="text"
                                        className="bg-transparent text-sm font-medium text-slate-200 outline-none w-full"
                                        value={palette.name}
                                        onChange={(e) => updatePalette(palette.id, { name: e.target.value })}
                                    />
                                    <div className="flex gap-1">
                                        <button onClick={() => duplicatePalette(palette.id)} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-white bg-white/5 rounded">
                                            <span className="material-symbols-outlined text-[13px]">content_copy</span>
                                        </button>
                                        <button onClick={() => deletePalette(palette.id)} className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-400 bg-red-500/10 rounded">
                                            <span className="material-symbols-outlined text-[13px]">delete</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    {palette.colors.map((hex, index) => (
                                        <div key={index} className="flex flex-col gap-1 flex-1">
                                            <div 
                                                className={`h-8 rounded-sm shadow-inner cursor-pointer relative group flex items-center justify-center overflow-hidden border-2 transition-all
                                                    ${editingPalette?.id === palette.id && editingPalette?.index === index ? 'border-primary ring-2 ring-primary/20 scale-105' : 'border-black/20'}`}
                                                style={{ backgroundColor: hex }}
                                                onClick={() => {
                                                    setCurrentColor(hex);
                                                    setEditingPalette({ id: palette.id, index });
                                                    setActiveTab('wheel');
                                                }}
                                                title="Click to edit with custom wheel"
                                            >
                                                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors flex items-center justify-center">
                                                    <span className="material-symbols-outlined text-white opacity-0 group-hover:opacity-100 text-sm transition-opacity">edit</span>
                                                </div>
                                            </div>
                                            <input 
                                                type="text" 
                                                value={hex}
                                                onChange={(e) => {
                                                    const newColors = [...palette.colors];
                                                    newColors[index] = e.target.value.toUpperCase();
                                                    updatePalette(palette.id, { colors: newColors });
                                                }}
                                                maxLength={7}
                                                className="bg-transparent text-[10px] text-center text-slate-400 hover:text-slate-200 focus:text-white outline-none w-full uppercase"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default ColorPickerPopup;
