import React, { useRef, useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

const KoPlayerPopup: React.FC = () => {
    const edgePosition = useAppStore(state => state.edgePosition);
    const koPlayerAnchorRect = useAppStore(state => state.koPlayerAnchorRect);
    const setIsKoPlayerOpen = useAppStore(state => state.setIsKoPlayerOpen);
    const design = useAppStore(state => state.design);
    const glassOpacity = useAppStore(state => state.glassOpacity);
    const currentMedia = useAppStore(state => state.currentMedia);
    const screenBounds = useAppStore(state => state.screenBounds);
    const t = useAppStore(state => state.t);
    const isSmartPositioning = useAppStore(state => state.isPopupSmartPositioning);
    const isMac = useAppStore(state => state.isMac);

    const popupRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLDivElement>(null);
    const artistRef = useRef<HTMLDivElement>(null);
    const [titleOverflows, setTitleOverflows] = useState(false);
    const [artistOverflows, setArtistOverflows] = useState(false);

    // Detect text overflow for marquee effect
    useEffect(() => {
        const checkOverflow = () => {
            if (titleRef.current) {
                setTitleOverflows(titleRef.current.scrollWidth > titleRef.current.clientWidth);
            }
            if (artistRef.current) {
                setArtistOverflows(artistRef.current.scrollWidth > artistRef.current.clientWidth);
            }
        };
        checkOverflow();
        // Re-check on media change
    }, [currentMedia?.title, currentMedia?.artist]);

    // We need sidebarPosition because if it exists, our wrapper is absolute, which shifts the coordinate space.
    const sidebarPosition = useAppStore(state => state.sidebarPosition);

    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = (): React.CSSProperties => {
        if (!koPlayerAnchorRect) return { display: 'none' };
        
        const popupHeight = 280;
        const popupWidth = 288; // w-72 is 288px
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
        
        // Remove wrapper offset from viewport rect
        const offsetTop = sidebarPosition ? sidebarPosition.y : 0;
        const offsetLeft = sidebarPosition ? sidebarPosition.x : 0;

        const style: React.CSSProperties = {
            position: 'absolute',
            zIndex: 99999,
            willChange: 'transform, opacity',
            transitionProperty: 'opacity, transform, filter'
        };

        if (orientation === 'horizontal') {
            let adjustedLeft = (koPlayerAnchorRect.left - offsetLeft) + (koPlayerAnchorRect.width / 2) - (popupWidth / 2);
            const maxLeft = (screenWidth - offsetLeft) - popupWidth - 20;
            const minLeft = -offsetLeft + 20;
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
            let adjustedTop = (koPlayerAnchorRect.top - offsetTop) - 20 + (koPlayerAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = -offsetTop + 20;
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
    useEffect(() => { isSmartRef.current = isSmartPositioning; }, [isSmartPositioning]);

    useEffect(() => {
        const onDrag = (e: any) => {
            if (!popupRef.current || !koPlayerAnchorRect || !isSmartRef.current) return;
            const newX = e.detail.x;
            const newY = e.detail.y;
            const popupHeight = 280;
            const popupWidth = 288;
            
            if (orientation === 'horizontal') {
                const screenWidth = screenBounds?.width ?? 1200;
                let adjustedLeft = (koPlayerAnchorRect.left - newX) + (koPlayerAnchorRect.width / 2) - (popupWidth / 2);
                const maxLeft = (screenWidth - newX) - popupWidth - 20;
                const minLeft = -newX + 20;
                if (adjustedLeft < minLeft) adjustedLeft = minLeft;
                if (adjustedLeft > maxLeft) adjustedLeft = maxLeft;
                popupRef.current.style.left = `${adjustedLeft}px`;
                popupRef.current.style.top = '';
            } else {
                const screenHeight = screenBounds?.height ?? 800;
                let adjustedTop = (koPlayerAnchorRect.top - newY) - 20 + (koPlayerAnchorRect.height / 2) - (popupHeight / 2);
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
    }, [koPlayerAnchorRect, screenBounds, orientation]);

    const handleCommand = (cmd: 'play' | 'pause' | 'next' | 'prev') => {
        window.api?.sendMediaCommand?.(cmd);
    };

    const hasMedia = currentMedia && currentMedia.title;

    return (
        <div
            ref={popupRef}
            className="w-72 border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-2xl"
            style={{
                ...getPopupStyle(),
                backgroundColor: design === 'style2' 
                    ? `color-mix(in srgb, var(--theme-surface) ${glassOpacity}%, transparent)` 
                    : 'var(--theme-surface)',
                borderColor: design === 'style2' ? 'rgba(255, 255, 255, 0.1)' : 'var(--theme-border)',
                backdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
                WebkitBackdropFilter: design === 'style2' ? (isMac ? 'blur(8px)' : 'blur(20px)') : 'none',
            }}
        >
            {/* Blurred Album Art Background Layer */}
            {hasMedia && currentMedia.albumArt && (
                <div className="absolute inset-0 overflow-hidden rounded-2xl" style={{ zIndex: 0 }}>
                    <img 
                        src={currentMedia.albumArt} 
                        alt="" 
                        className="w-full h-full object-cover"
                        style={{ filter: 'blur(40px) brightness(0.3) saturate(1.5)', transform: 'scale(1.5)' }}
                        draggable={false}
                    />
                    <div className="absolute inset-0 bg-black/40" />
                </div>
            )}

            {/* Content Layer */}
            <div className="relative flex flex-col" style={{ zIndex: 1 }}>
                {/* Header */}
                <div className="flex justify-between items-center px-4 pt-3 pb-1">
                    <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-primary text-[14px]">music_note</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">KoPlayer</span>
                    </div>
                    <button 
                        onClick={() => setIsKoPlayerOpen(false)}
                        className="w-5 h-5 rounded-md bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                    >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                </div>

                {hasMedia ? (
                    <>
                        {/* Album Art + Track Info */}
                        <div className="flex flex-col items-center px-5 pt-3 pb-2">
                            {/* Album Art Thumbnail */}
                            <div className="w-28 h-28 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] mb-4 border border-white/10 shrink-0">
                                {currentMedia.albumArt ? (
                                    <img 
                                        src={currentMedia.albumArt} 
                                        alt={currentMedia.title}
                                        className="w-full h-full object-cover"
                                        draggable={false}
                                    />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-primary text-[40px] opacity-60">album</span>
                                    </div>
                                )}
                            </div>

                            {/* Track Title — Marquee on overflow */}
                            <div className="w-full overflow-hidden relative h-6 flex items-center justify-center">
                                <div 
                                    ref={titleRef}
                                    className={`text-sm font-semibold text-white whitespace-nowrap ${titleOverflows ? 'koplayer-marquee' : 'text-center w-full truncate'}`}
                                >
                                    {titleOverflows ? (
                                        <>
                                            <span>{currentMedia.title}</span>
                                            <span className="mx-8 text-slate-500">•</span>
                                            <span>{currentMedia.title}</span>
                                        </>
                                    ) : (
                                        currentMedia.title
                                    )}
                                </div>
                            </div>

                            {/* Artist — Marquee on overflow */}
                            <div className="w-full overflow-hidden relative h-5 flex items-center justify-center">
                                <div 
                                    ref={artistRef}
                                    className={`text-xs text-slate-400 whitespace-nowrap ${artistOverflows ? 'koplayer-marquee' : 'text-center w-full truncate'}`}
                                >
                                    {artistOverflows ? (
                                        <>
                                            <span>{currentMedia.artist}</span>
                                            <span className="mx-8 text-slate-600">•</span>
                                            <span>{currentMedia.artist}</span>
                                        </>
                                    ) : (
                                        currentMedia.artist || t('unknownArtist')
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Playback Controls */}
                        <div className="flex items-center justify-center gap-3 px-5 pb-4 pt-2">
                            {/* Previous */}
                            <button
                                onClick={() => handleCommand('prev')}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region"
                            >
                                <span className="material-symbols-outlined text-[22px]">skip_previous</span>
                            </button>

                            {/* Play/Pause */}
                            <button
                                onClick={() => handleCommand(currentMedia.isPlaying ? 'pause' : 'play')}
                                className="w-14 h-14 rounded-full bg-primary text-slate-900 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(244,161,37,0.4)] hover:shadow-[0_4px_25px_rgba(244,161,37,0.6)] no-drag-region"
                            >
                                <span className="material-symbols-outlined text-[28px]">
                                    {currentMedia.isPlaying ? 'pause' : 'play_arrow'}
                                </span>
                            </button>

                            {/* Next */}
                            <button
                                onClick={() => handleCommand('next')}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region"
                            >
                                <span className="material-symbols-outlined text-[22px]">skip_next</span>
                            </button>
                        </div>
                    </>
                ) : (
                    /* Empty State */
                    <div className="flex flex-col items-center justify-center py-10 px-6">
                        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <span className="material-symbols-outlined text-slate-500 text-[32px] koplayer-pulse">music_off</span>
                        </div>
                        <p className="text-sm text-slate-400 text-center font-medium">{t('noMediaPlaying')}</p>
                        <p className="text-xs text-slate-600 text-center mt-1">{t('playSomething')}</p>
                    </div>
                )}
            </div>

            {/* Inline CSS for marquee + pulse animation */}
            <style>{`
                .koplayer-marquee {
                    display: inline-block;
                    animation: koplayer-scroll 12s linear infinite;
                }
                @keyframes koplayer-scroll {
                    0% { transform: translateX(0%); }
                    100% { transform: translateX(-50%); }
                }
                .koplayer-pulse {
                    animation: koplayer-icon-pulse 2s ease-in-out infinite;
                }
                @keyframes koplayer-icon-pulse {
                    0%, 100% { opacity: 0.4; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.08); }
                }
            `}</style>
        </div>
    );
};

export default KoPlayerPopup;
