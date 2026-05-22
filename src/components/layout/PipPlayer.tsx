import React, { useEffect, useRef, useState, useCallback } from 'react';

/** Convert a raw URL to the best playable form for the webview */
function getPlayableUrl(rawUrl: string): string {
    if (!rawUrl) return '';

    // YouTube watch → embed (no ads, no nav UI, autoplay)
    const ytMatch = rawUrl.match(
        /(?:youtube\.com\/watch[?&]v=|youtu\.be\/)([\w-]+)/
    );
    if (ytMatch) {
        return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
    }

    return rawUrl;
}

const PipPlayer: React.FC = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawUrl = decodeURIComponent(urlParams.get('url') || '');
    const initialTitle = decodeURIComponent(urlParams.get('title') || 'PIP Video');
    const initialAlbumArt = decodeURIComponent(urlParams.get('albumArt') || '');

    const finalUrl = getPlayableUrl(rawUrl);

    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isOverControls, setIsOverControls] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const triggerHover = useCallback(() => {
        setIsHovered(true);
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        if (!isOverControls) {
            hoverTimeoutRef.current = setTimeout(() => {
                setIsHovered(false);
            }, 2500);
        }
    }, [isOverControls]);

    useEffect(() => {
        if (isOverControls) {
            setIsHovered(true);
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        } else {
            triggerHover();
        }
        return () => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        };
    }, [isOverControls, triggerHover]);

    // Live media state — mirrors KoPlayer, updated via SMTC polling
    const [mediaTitle, setMediaTitle] = useState(initialTitle);
    const [mediaArt, setMediaArt] = useState(initialAlbumArt || null);
    const [isPlaying, setIsPlaying] = useState(true);

    // Subscribe to SMTC media updates (same as KoPlayer — preload has full api bridge)
    useEffect(() => {
        const unsub = window.api?.onMediaUpdate?.((data) => {
            if (data) {
                if (data.title) setMediaTitle(data.title);
                if (data.albumArt) setMediaArt(data.albumArt);
                // Intentionally NOT updating isPlaying from SMTC here
                // because we paused the browser's SMTC session!
            }
        });
        return () => unsub?.();
    }, []);

    // Listen to YouTube iframe messages to sync play/pause button state
    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (e.origin !== 'https://www.youtube.com') return;
            try {
                const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
                if (data.event === 'infoDelivery' && data.info) {
                    if (data.info.playerState === 1) setIsPlaying(true);   // Playing
                    if (data.info.playerState === 2) setIsPlaying(false);  // Paused
                }
            } catch (err) {}
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Create the iframe element imperatively to avoid React re-rendering issues
    // Using iframe instead of <webview> fixes YouTube Error 153 (automation detection)
    useEffect(() => {
        if (!containerRef.current || !finalUrl) {
            setError('No video URL provided.');
            setLoading(false);
            return;
        }

        containerRef.current.innerHTML = ''; // GUARANTEE ONLY ONE IFRAME EXISTS

        const iframe = document.createElement('iframe');
        iframe.src = finalUrl;
        iframe.style.cssText = `
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        `;
        // Allow autoplay and fullscreen inside the iframe
        iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
        iframe.setAttribute('allowfullscreen', 'true');

        iframe.addEventListener('load', () => {
            setLoading(false);
            // Tell YouTube to start broadcasting infoDelivery events
            iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
        });

        containerRef.current.appendChild(iframe);

        return () => {
            if (containerRef.current?.contains(iframe)) {
                containerRef.current.removeChild(iframe);
            }
        };
    }, [finalUrl]);

    useEffect(() => {
        // We handle hover state using edge hitboxes and overlay mouseLeave instead of document listeners
        // because the cross-origin iframe swallows document-level mouse events.
    }, []);

    const handleClose = () => {
        window.api?.closePip?.();
    };

    const handleCommand = useCallback((cmd: 'play' | 'pause' | 'next' | 'prev') => {
        if (!containerRef.current) return;
        const iframe = containerRef.current.querySelector('iframe');
        if (!iframe || !iframe.contentWindow) return;

        if (cmd === 'play') {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
            setIsPlaying(true);
        } else if (cmd === 'pause') {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
            setIsPlaying(false);
        } else if (cmd === 'next') {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'nextVideo', args: [] }), '*');
        } else if (cmd === 'prev') {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'previousVideo', args: [] }), '*');
        }
    }, []);

    const hasArt = !!mediaArt;

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                position: 'relative',
                overflow: 'hidden',
                background: '#000',
                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
            }}
        >
            {/* Edge hit-boxes to reliably trigger hover since the cross-origin iframe swallows document-level mouse events */}
            {!isHovered && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 16, pointerEvents: 'auto' }} onMouseEnter={triggerHover} onMouseMove={triggerHover} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 16, pointerEvents: 'auto' }} onMouseEnter={triggerHover} onMouseMove={triggerHover} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 16, pointerEvents: 'auto' }} onMouseEnter={triggerHover} onMouseMove={triggerHover} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 16, pointerEvents: 'auto' }} onMouseEnter={triggerHover} onMouseMove={triggerHover} />
                </div>
            )}

            {/* Blurred album art background — mirrors KoPlayer exactly */}
            {hasArt && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
                    <img
                        src={mediaArt!}
                        alt=""
                        style={{
                            width: '100%', height: '100%', objectFit: 'cover',
                            filter: 'blur(30px) brightness(0.25) saturate(1.6)',
                            transform: 'scale(1.4)',
                            pointerEvents: 'none',
                        }}
                        draggable={false}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
                </div>
            )}

            {/* Webview container — fills the entire window */}
            <div
                ref={containerRef}
                style={{ position: 'absolute', inset: 0, zIndex: 1 }}
            />

            {/* Loading spinner */}
            {loading && !error && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)', gap: 12, pointerEvents: 'none',
                    zIndex: 10,
                }}>
                    <div style={{
                        width: 34, height: 34,
                        border: '3px solid rgba(244,161,37,0.2)',
                        borderTop: '3px solid #f4a125',
                        borderRadius: '50%',
                        animation: 'pip-spin 0.7s linear infinite',
                    }} />
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>Loading video…</span>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.9)', gap: 12,
                    padding: 24, textAlign: 'center', zIndex: 10,
                }}>
                    <span className="material-symbols-outlined" style={{ color: '#f87171', fontSize: 40 }}>
                        videocam_off
                    </span>
                    <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0, lineHeight: 1.5 }}>{error}</p>
                    <button onClick={handleClose} style={{
                        padding: '7px 18px', borderRadius: 8,
                        border: '1px solid rgba(244,161,37,0.4)',
                        background: 'rgba(244,161,37,0.12)',
                        color: '#f4a125', fontSize: 12, cursor: 'pointer',
                    }}>Close</button>
                </div>
            )}

            {/* Hover overlay — controls + drag handle */}
            <div 
                style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.18s ease',
                pointerEvents: 'none', // Must be none to allow clicks to pass to YouTube iframe!
                zIndex: 20,
            }}>
                {/* Top bar: drag region + album art thumbnail + title + close */}
                <div 
                    onMouseEnter={() => setIsOverControls(true)}
                    onMouseLeave={() => setIsOverControls(false)}
                    style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)',
                    WebkitAppRegion: 'drag',
                    pointerEvents: isHovered ? 'auto' : 'none',
                    gap: 8,
                } as React.CSSProperties}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0,
                        WebkitAppRegion: 'drag',
                    } as React.CSSProperties}>
                        {/* Album art thumbnail — same as KoPlayer's album art */}
                        {hasArt ? (
                            <img
                                src={mediaArt!}
                                alt=""
                                style={{
                                    width: 22, height: 22, borderRadius: 4,
                                    objectFit: 'cover', flexShrink: 0,
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    WebkitAppRegion: 'drag',
                                } as React.CSSProperties}
                                draggable={false}
                            />
                        ) : (
                            <span className="material-symbols-outlined"
                                style={{ color: '#ffffff', fontSize: 15, flexShrink: 0, WebkitAppRegion: 'drag' } as React.CSSProperties}>
                                pip
                            </span>
                        )}
                        <span style={{
                            color: '#e2e8f0', fontSize: 11, fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            flex: 1,
                        }}>{mediaTitle}</span>
                    </div>
                    <button
                        onClick={handleClose}
                        style={{
                            width: 22, height: 22, borderRadius: 6, border: 'none',
                            background: 'rgba(239,68,68,0.25)', color: '#f87171',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', WebkitAppRegion: 'no-drag',
                            transition: 'background 0.15s', outline: 'none', flexShrink: 0,
                        } as React.CSSProperties}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.6)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.25)')}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                    </button>
                </div>

                </div>

            {/* Animations + font preload */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');
                @keyframes pip-spin { to { transform: rotate(360deg); } }
                * { box-sizing: border-box; }
                button:focus { outline: none !important; box-shadow: none !important; }
            `}</style>
        </div>
    );
};

/** Shared style for prev/next control buttons */
const pipCtrlBtn: any = {
    width: 26, height: 26,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255,255,255,0.08)',
    color: '#e2e8f0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s',
    outline: 'none',
    flexShrink: 0,
    WebkitAppRegion: 'no-drag',
};

export default PipPlayer;
