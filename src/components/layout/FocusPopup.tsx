import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';

const MELODIES = ['Alarm', 'Bells', 'Calming', 'Cosmic', 'Guitar', 'Hiphop', 'Ringtones'];

export const FocusPopup: React.FC = () => {
    const { 
        t, edgePosition, focusSettings, setFocusSettings, isFocusActive, 
        startFocusMode, stopFocusMode, isFocusPopupOpen, setIsFocusPopupOpen, focusAnchorRect, screenBounds, 
        isPopupSmartPositioning 
    } = useAppStore();
    
    // Preview logic
    const [isPlayingPreview, setIsPlayingPreview] = useState(false);
    const [melodyDropdownOpen, setMelodyDropdownOpen] = useState(false);
    const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

    // Load initial values into local state for the panel
    const [localMin, setLocalMin] = useState(focusSettings.minutes);
    const [localSec, setLocalSec] = useState(focusSettings.seconds);
    const [localMelody, setLocalMelody] = useState(focusSettings.melody);
    const [localLoop, setLocalLoop] = useState(focusSettings.loop);

    const popupRef = useRef<HTMLDivElement>(null);

    const stopPreview = () => {
        if (audioPreviewRef.current) {
            audioPreviewRef.current.pause();
            audioPreviewRef.current.currentTime = 0;
        }
        setIsPlayingPreview(false);
    };

    const togglePreview = async () => {
        if (isPlayingPreview) {
            stopPreview();
            return;
        }
        
        try {
            const base64 = await window.api?.getMelodyAudio(localMelody);
            if (base64) {
                if (!audioPreviewRef.current) {
                    audioPreviewRef.current = new Audio();
                }
                audioPreviewRef.current.src = `${base64}`;
                audioPreviewRef.current.load();
                audioPreviewRef.current.play();
                setIsPlayingPreview(true);
                audioPreviewRef.current.onended = () => setIsPlayingPreview(false);
            }
        } catch(e) {
            console.error('Preview error', e);
        }
    };

    const handleStart = () => {
        setFocusSettings({
            minutes: localMin,
            seconds: localSec,
            melody: localMelody,
            loop: localLoop
        });
        stopPreview();
        startFocusMode();
        setIsFocusPopupOpen(false);
    };

    useEffect(() => {
        if (isFocusPopupOpen && !isFocusActive) {
            setLocalMin(focusSettings.minutes);
            setLocalSec(focusSettings.seconds);
            setLocalMelody(focusSettings.melody);
            setLocalLoop(focusSettings.loop);
        }
    }, [isFocusPopupOpen, isFocusActive, focusSettings]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isFocusPopupOpen &&
                popupRef.current && !popupRef.current.contains(e.target as Node)
            ) {
                // If they clicked the focus button itself, it will trigger its own toggle
                const target = e.target as HTMLElement;
                if (!target.closest('.focus-trigger-btn')) {
                    setIsFocusPopupOpen(false);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isFocusPopupOpen, setIsFocusPopupOpen]);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = (): React.CSSProperties => {
        if (!focusAnchorRect) return { display: 'none' };
        
        const popupHeight = 280; // approximate
        const popupWidth = 256; // w-64 is 256px
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            backgroundColor: 'var(--theme-surface)',
            borderColor: 'var(--theme-border)',
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        if (orientation === 'horizontal') {
            let adjustedLeft = (focusAnchorRect.left - offsetLeft) + (focusAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = -offsetLeft + 20;
            if (adjustedLeft < minLeft) adjustedLeft = minLeft;
            if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;

            if (!isPopupSmartPositioning) {
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
            let adjustedTop = (focusAnchorRect.top - offsetTop) - 20 + (focusAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = -offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isPopupSmartPositioning) {
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

    const isSmartRef = useRef(isPopupSmartPositioning);
    useEffect(() => { isSmartRef.current = isPopupSmartPositioning; }, [isPopupSmartPositioning]);

    useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !focusAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 280;
            const popupWidth = 256;
            
            if (orientation === 'horizontal') {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (focusAnchorRect.left - newX) + (focusAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = (screenWidth - newX) - popupWidth - 20;
                const minLeft = -newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;
                popupRef.current.style.top = '';
            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (focusAnchorRect.top - newY) - 20 + (focusAnchorRect.height / 2) - (popupHeight / 2);
                const maxTop = (screenHeight - newY) - popupHeight - 20;
                const minTop = -newY + 20;
                if (adjustedTop < minTop) adjustedTop = minTop;
                if (adjustedTop > maxTop) adjustedTop = maxTop;
                popupRef.current.style.top = `${adjustedTop}px`;
                popupRef.current.style.left = '';
            }
        };
        document.addEventListener('kobar-drag', onDrag);
        return () => document.removeEventListener('kobar-drag', onDrag);
    }, [focusAnchorRect, screenBounds, orientation]);

    if (!isFocusPopupOpen) return null;

    return (
        <div
            ref={popupRef}
            className="w-64 rounded-xl border p-4 shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-visible"
            style={getPopupStyle()}
        >
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-primary font-bold">{t('focusMode')}</h3>
                <button onClick={() => setIsFocusPopupOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>

            {/* Time Pickers */}
            <div className="flex gap-4 mb-4">
                <div className="flex-1">
                    <label className="text-xs text-slate-400 mb-1 block">{t('minutes')}</label>
                    <div className="flex items-center border rounded overflow-hidden" style={{ borderColor: 'var(--theme-border)' }}>
                        <button
                            type="button"
                            disabled={isFocusActive || localMin <= 0}
                            onClick={() => setLocalMin(m => Math.max(0, m - 1))}
                            className="px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[14px]">remove</span>
                        </button>
                        <input
                            type="number"
                            disabled={isFocusActive}
                            value={localMin}
                            onChange={(e) => {
                                let val = parseInt(e.target.value, 10);
                                if (isNaN(val)) val = 0;
                                setLocalMin(Math.min(120, Math.max(0, val)));
                            }}
                            className="flex-1 w-full text-center text-slate-200 text-sm py-1 tabular-nums bg-transparent outline-none focus:bg-primary/10 transition-colors disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none no-drag-region"
                        />
                        <button
                            type="button"
                            disabled={isFocusActive || localMin >= 120}
                            onClick={() => setLocalMin(m => Math.min(120, m + 1))}
                            className="px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[14px]">add</span>
                        </button>
                    </div>
                </div>
                <div className="flex-1">
                    <label className="text-xs text-slate-400 mb-1 block">{t('seconds')}</label>
                    <div className="flex items-center border rounded overflow-hidden" style={{ borderColor: 'var(--theme-border)' }}>
                        <button
                            type="button"
                            disabled={isFocusActive || localSec <= 0}
                            onClick={() => setLocalSec(s => Math.max(0, s - 1))}
                            className="px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[14px]">remove</span>
                        </button>
                        <input
                            type="number"
                            disabled={isFocusActive}
                            value={localSec}
                            onChange={(e) => {
                                let val = parseInt(e.target.value, 10);
                                if (isNaN(val)) val = 0;
                                setLocalSec(Math.min(59, Math.max(0, val)));
                            }}
                            className="flex-1 w-full text-center text-slate-200 text-sm py-1 tabular-nums bg-transparent outline-none focus:bg-primary/10 transition-colors disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none no-drag-region"
                        />
                        <button
                            type="button"
                            disabled={isFocusActive || localSec >= 59}
                            onClick={() => setLocalSec(s => Math.min(59, s + 1))}
                            className="px-2 py-1.5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[14px]">add</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Melody Selection */}
            <div className="mb-4">
                <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                        <button
                            type="button"
                            onClick={() => !isFocusActive && setMelodyDropdownOpen(!melodyDropdownOpen)}
                            disabled={isFocusActive}
                            className="w-full bg-black/20 border rounded px-2 py-1.5 text-slate-200 text-left flex items-center justify-between disabled:opacity-50 cursor-pointer hover:border-primary/50 transition-colors"
                            style={{ borderColor: 'var(--theme-border)' }}
                        >
                            <span>{localMelody}</span>
                            <span className="material-symbols-outlined text-[16px] text-slate-400">
                                {melodyDropdownOpen ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>
                        {melodyDropdownOpen && (
                            <div
                                className="absolute top-full left-0 w-full mt-1 rounded border shadow-xl overflow-y-auto"
                                style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-border)', zIndex: 10000 }}
                            >
                                {MELODIES.map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => {
                                            setLocalMelody(m);
                                            setMelodyDropdownOpen(false);
                                            stopPreview();
                                        }}
                                        className={`w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-primary/20 ${m === localMelody ? 'text-primary font-semibold bg-primary/10' : 'text-slate-300'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={togglePreview}
                        disabled={isFocusActive}
                        className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 border border-primary/30"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            {isPlayingPreview ? 'stop' : 'play_arrow'}
                        </span>
                    </button>
                </div>
            </div>

            {/* Loop Toggle */}
            <div className="flex items-center justify-between mb-6">
                <span className="text-sm text-slate-300 font-medium">{t('loop')}</span>
                <button
                    onClick={() => !isFocusActive && setLocalLoop(!localLoop)}
                    disabled={isFocusActive}
                    className={`w-11 h-6 rounded-full transition-colors relative flex items-center border border-black/20 disabled:opacity-50 no-drag-region ${localLoop ? 'bg-primary' : 'bg-slate-600'}`}
                >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute transition-transform ${localLoop ? 'translate-x-[22px]' : 'translate-x-[4px]'}`} />
                </button>
            </div>

            {/* Start/Stop Button */}
            {isFocusActive ? (
                <button
                    onClick={() => {
                        stopFocusMode();
                        setIsFocusPopupOpen(false);
                    }}
                    className="w-full py-2 rounded-lg font-bold transition-all active:scale-95 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                >
                    {t('stop')}
                </button>
            ) : (
                <button
                    onClick={handleStart}
                    disabled={localMin === 0 && localSec === 0}
                    className="w-full py-2 rounded-lg font-bold transition-all active:scale-95 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {t('start')}
                </button>
            )}

        </div>
    );
};
