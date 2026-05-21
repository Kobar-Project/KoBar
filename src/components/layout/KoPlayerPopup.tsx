import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';

/** Get a short display label from a URL */
function urlShortLabel(url: string): string {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        // For YouTube, extract video title hint from path/params
        if (host.includes('youtube') || host === 'youtu.be') return `▶ YouTube: ${u.searchParams.get('v') || u.pathname.slice(1)}`;
        if (host.includes('youtu.be')) return `▶ YouTube: ${u.pathname.slice(1)}`;
        return `▶ ${host}${u.pathname.length > 1 ? u.pathname.slice(0, 24) : ''}`;
    } catch {
        return url.slice(0, 36);
    }
}

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

    // PIP state
    const [pipActive, setPipActive] = useState(false);
    const [pipPhase, setPipPhase] = useState<'idle' | 'detecting' | 'pick' | 'manual'>('idle');
    const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
    const [manualUrl, setManualUrl] = useState('');

    // Pre-cached video URLs from SMTC background scan
    const activeVideoUrls = useAppStore(state => state.activeVideoUrls);
    const currentMediaSourceApp = useAppStore(state => state.currentMediaSourceApp);
    const BROWSER_IDS = ['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi'];
    const isBrowserSource = BROWSER_IDS.some(b => currentMediaSourceApp.includes(b));
    const hasPreCachedVideo = isBrowserSource && activeVideoUrls.length > 0;

    // Detect text overflow for marquee effect
    useEffect(() => {
        if (titleRef.current) setTitleOverflows(titleRef.current.scrollWidth > titleRef.current.clientWidth);
        if (artistRef.current) setArtistOverflows(artistRef.current.scrollWidth > artistRef.current.clientWidth);
    }, [currentMedia?.title, currentMedia?.artist]);

    // Listen for PIP window closed event from main process
    useEffect(() => {
        const unsub = window.api?.onPipClosed?.(() => {
            setPipActive(false);
            setPipPhase('idle');
        });
        return () => unsub?.();
    }, []);

    const sidebarPosition = useAppStore(state => state.sidebarPosition);
    const orientation = useAppStore(state => state.orientation);

    const getPopupStyle = (): React.CSSProperties => {
        if (!koPlayerAnchorRect) return { display: 'none' };

        const popupHeight = 290;
        const popupWidth = 288;
        const screenHeight = screenBounds?.height ?? 800;
        const screenWidth = screenBounds?.width ?? 1200;
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

            if (!isSmartPositioning) { style.left = '50%'; style.transform = 'translateX(-50%)'; }
            else { style.left = adjustedLeft; }

            if (edgePosition === 'top') { style.top = '100%'; style.marginTop = '12px'; }
            else { style.bottom = '100%'; style.marginBottom = '12px'; }
        } else {
            let adjustedTop = (koPlayerAnchorRect.top - offsetTop) - 20 + (koPlayerAnchorRect.height / 2) - (popupHeight / 2);
            const maxTop = (screenHeight - offsetTop) - popupHeight - 20;
            const minTop = -offsetTop + 20;
            if (adjustedTop < minTop) adjustedTop = minTop;
            if (adjustedTop > maxTop) adjustedTop = maxTop;

            if (!isSmartPositioning) { style.top = '50%'; style.transform = 'translateY(-50%)'; }
            else { style.top = adjustedTop; }

            if (edgePosition === 'left') { style.left = '100%'; style.marginLeft = '12px'; }
            else { style.right = '100%'; style.marginRight = '12px'; }
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
            const popupHeight = 290;
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

    /** Main PIP button click: use pre-cached URLs or detect URLs in browsers, then decide */
    const handlePipClick = useCallback(async () => {
        if (pipActive) {
            window.api?.closePip?.();
            setPipActive(false);
            setPipPhase('idle');
            return;
        }

        // Fast path: use pre-cached URLs from SMTC background scan
        if (hasPreCachedVideo) {
            if (activeVideoUrls.length === 1) {
                window.api?.sendMediaCommand?.('pause');
                window.api?.openPip?.(activeVideoUrls[0], currentMedia?.title || 'PIP Video', currentMedia?.albumArt || undefined);
                setPipActive(true);
                setPipPhase('idle');
                return;
            } else {
                setDetectedUrls(activeVideoUrls);
                setPipPhase('pick');
                return;
            }
        }

        // Slow path: on-demand scan
        setPipPhase('detecting');
        setDetectedUrls([]);

        const urls = await window.api?.getActiveVideoUrls?.().catch(() => []) ?? [];

        if (urls.length === 1) {
            // Exactly one → open immediately
            window.api?.sendMediaCommand?.('pause');
            window.api?.openPip?.(urls[0], currentMedia?.title || 'PIP Video', currentMedia?.albumArt || undefined);
            setPipActive(true);
            setPipPhase('idle');
        } else if (urls.length > 1) {
            // Multiple → let user pick
            setDetectedUrls(urls);
            setPipPhase('pick');
        } else {
            // Nothing found → show manual URL input
            setPipPhase('manual');
        }
    }, [pipActive, currentMedia?.title, currentMedia?.albumArt, hasPreCachedVideo, activeVideoUrls]);

    const handlePickUrl = (url: string) => {
        window.api?.sendMediaCommand?.('pause');
        window.api?.openPip?.(url, currentMedia?.title || 'PIP Video', currentMedia?.albumArt || undefined);
        setPipActive(true);
        setPipPhase('idle');
    };

    const handleManualOpen = () => {
        const url = manualUrl.trim();
        if (!url) return;
        window.api?.sendMediaCommand?.('pause');
        window.api?.openPip?.(url, currentMedia?.title || 'PIP Video', currentMedia?.albumArt || undefined);
        setPipActive(true);
        setPipPhase('idle');
        setManualUrl('');
    };

    const hasMedia = currentMedia && currentMedia.title;

    // Tailwind classes for PIP button states to match Calculator fx button
    const getPipBtnClass = () => {
        if (pipActive) return 'bg-primary/20 text-primary';
        if (pipPhase === 'detecting') return 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20';
        return 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10';
    };

    return (
        <div
            ref={popupRef}
            className="w-72 border shadow-2xl pointer-events-auto animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col rounded-xl"
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
            {/* Blurred Album Art Background */}
            {hasMedia && currentMedia.albumArt && (
                <div className="absolute inset-0 overflow-hidden rounded-xl" style={{ zIndex: 0 }}>
                    <img
                        src={currentMedia.albumArt} alt="" className="w-full h-full object-cover"
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
                        <div className="relative inline-flex items-center justify-center text-[16px] text-primary" style={{ width: '1em', height: '1em' }}>
                            <span className="material-symbols-outlined absolute left-1/2 top-1/2" style={{ fontSize: '0.85em', transform: 'translate(-60%, -60%)', opacity: 0.6 }}>movie</span>
                            <span className="material-symbols-outlined absolute left-1/2 top-1/2" style={{ fontSize: '0.9em', transform: 'translate(-40%, -40%)' }}>music_note</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold ml-1">KoPlayer</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {/* PIP Button — always visible */}
                        <button
                            onClick={handlePipClick}
                            className={`relative w-6 h-6 rounded-full flex items-center justify-center transition-all no-drag-region ${getPipBtnClass()}`}
                            title={pipActive ? 'Close PIP' : hasPreCachedVideo ? 'Video detected — open in PiP' : 'Open video in Picture-in-Picture'}
                        >
                            {pipPhase === 'detecting' ? (
                                <div style={{
                                    width: 12, height: 12, borderRadius: '50%',
                                    border: '1.5px solid rgba(165,180,252,0.3)',
                                    borderTop: '1.5px solid #a5b4fc',
                                    animation: 'koplayer-spin 0.7s linear infinite',
                                }} />
                            ) : (
                                <span className="material-symbols-outlined text-[14px]">
                                    {pipActive ? 'pip_exit' : 'pip'}
                                </span>
                            )}
                            {/* Green dot: video pre-detected via SMTC background scan */}
                            {hasPreCachedVideo && !pipActive && pipPhase !== 'detecting' && (
                                <span style={{
                                    position: 'absolute', top: 1, right: 1,
                                    width: 5, height: 5, borderRadius: '50%',
                                    background: '#4ade80',
                                    boxShadow: '0 0 4px rgba(74,222,128,0.7)',
                                }} />
                            )}
                        </button>
                        <button
                            onClick={() => setIsKoPlayerOpen(false)}
                            className="w-6 h-6 rounded-full bg-white/5 text-slate-400 hover:text-white hover:bg-red-500/20 flex items-center justify-center transition-all no-drag-region"
                        >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                    </div>
                </div>

                {/* ── Pick URL panel (multiple detected) ── */}
                {pipPhase === 'pick' && (
                    <div className="mx-3 mb-2 rounded-lg overflow-hidden no-drag-region"
                        style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.45)' }}>
                        <div className="flex justify-between items-center px-3 pt-2 pb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Multiple videos — pick one
                            </span>
                            <button onClick={() => setPipPhase('idle')}
                                className="text-slate-500 hover:text-white transition-colors">
                                <span className="material-symbols-outlined text-[13px]">close</span>
                            </button>
                        </div>
                        <div style={{ maxHeight: 130, overflowY: 'auto' }} className="custom-scrollbar pb-1">
                            {detectedUrls.map((url, i) => (
                                <button
                                    key={i}
                                    onClick={() => handlePickUrl(url)}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-primary text-[14px] shrink-0">play_circle</span>
                                    <span className="text-xs text-slate-300 truncate">{urlShortLabel(url)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Manual URL input (nothing detected) ── */}
                {pipPhase === 'manual' && (
                    <div className="mx-3 mb-2 rounded-lg overflow-hidden no-drag-region"
                        style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.45)', padding: '10px 12px' }}>
                        <p className="text-[10px] text-slate-500 mb-2 leading-snug">
                            Paste a video URL:
                        </p>
                        <div className="flex gap-1.5">
                            <input
                                type="text"
                                value={manualUrl}
                                onChange={e => setManualUrl(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleManualOpen()}
                                placeholder="https://youtube.com/watch?v=…"
                                className="flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 outline-none"
                                style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    userSelect: 'text', WebkitUserSelect: 'text',
                                } as React.CSSProperties}
                                autoFocus
                            />
                            <button
                                onClick={handleManualOpen}
                                disabled={!manualUrl.trim()}
                                className="px-2.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
                                style={{ background: 'rgba(244,161,37,0.2)', border: '1px solid rgba(244,161,37,0.4)', color: '#f4a125' }}
                            >
                                Open
                            </button>
                        </div>
                        <button onClick={() => setPipPhase('idle')}
                            className="mt-2 text-[10px] text-slate-600 hover:text-slate-400 transition-colors w-full text-center">
                            Cancel
                        </button>
                    </div>
                )}

                {/* ── Main media content ── */}
                {hasMedia ? (
                    <>
                        <div className="flex flex-col items-center px-5 pt-3 pb-2">
                            {/* Album Art */}
                            <div className="w-28 h-28 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] mb-4 border border-white/10 shrink-0">
                                {currentMedia.albumArt ? (
                                    <img src={currentMedia.albumArt} alt={currentMedia.title}
                                        className="w-full h-full object-cover" draggable={false} />
                                ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center">
                                        <span className="material-symbols-outlined text-primary text-[40px] opacity-60">album</span>
                                    </div>
                                )}
                            </div>

                            {/* Track Title */}
                            <div className="w-full overflow-hidden relative h-6 flex items-center justify-center">
                                <div ref={titleRef}
                                    className={`text-sm font-semibold text-white whitespace-nowrap ${titleOverflows ? 'koplayer-marquee' : 'text-center w-full truncate'}`}>
                                    {titleOverflows ? (
                                        <><span>{currentMedia.title}</span><span className="mx-8 text-slate-500">•</span><span>{currentMedia.title}</span></>
                                    ) : currentMedia.title}
                                </div>
                            </div>

                            {/* Artist */}
                            <div className="w-full overflow-hidden relative h-5 flex items-center justify-center">
                                <div ref={artistRef}
                                    className={`text-xs text-slate-400 whitespace-nowrap ${artistOverflows ? 'koplayer-marquee' : 'text-center w-full truncate'}`}>
                                    {artistOverflows ? (
                                        <><span>{currentMedia.artist}</span><span className="mx-8 text-slate-600">•</span><span>{currentMedia.artist}</span></>
                                    ) : (currentMedia.artist || t('unknownArtist'))}
                                </div>
                            </div>
                        </div>

                        {/* Playback Controls */}
                        <div className="flex items-center justify-center gap-3 px-5 pb-4 pt-2">
                            <button onClick={() => handleCommand('prev')}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region">
                                <span className="material-symbols-outlined text-[22px]">skip_previous</span>
                            </button>
                            <button
                                onClick={() => handleCommand(currentMedia.isPlaying ? 'pause' : 'play')}
                                className="w-14 h-14 rounded-full bg-primary text-slate-900 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(244,161,37,0.4)] hover:shadow-[0_4px_25px_rgba(244,161,37,0.6)] no-drag-region">
                                <span className="material-symbols-outlined text-[28px]">
                                    {currentMedia.isPlaying ? 'pause' : 'play_arrow'}
                                </span>
                            </button>
                            <button onClick={() => handleCommand('next')}
                                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 no-drag-region">
                                <span className="material-symbols-outlined text-[22px]">skip_next</span>
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 px-6">
                        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <span className="material-symbols-outlined text-slate-500 text-[32px] koplayer-pulse">music_off</span>
                        </div>
                        <p className="text-sm text-slate-400 text-center font-medium">{t('noMediaPlaying')}</p>
                        <p className="text-xs text-slate-600 text-center mt-1">{t('playSomething')}</p>
                    </div>
                )}
            </div>

            {/* Inline animations */}
            <style>{`
                .koplayer-marquee { display:inline-block; animation:koplayer-scroll 12s linear infinite; }
                @keyframes koplayer-scroll { 0%{transform:translateX(0%)} 100%{transform:translateX(-50%)} }
                .koplayer-pulse { animation:koplayer-icon-pulse 2s ease-in-out infinite; }
                @keyframes koplayer-icon-pulse { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.08)} }
                @keyframes koplayer-spin { to{transform:rotate(360deg)} }
            `}</style>
        </div>
    );
};

export default KoPlayerPopup;
