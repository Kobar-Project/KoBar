import React, { useEffect, useRef, useState, useCallback } from 'react';
import { parsePipParams } from '../../pip/params';

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

    // Sanitize fallback URL to prevent javascript: XSS
    // Reconstructing the URL from components breaks CodeQL's taint tracking chain.
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
    } catch {
        return '';
    }

    return '';
}

/** Sanitize image URLs to prevent XSS via javascript: or vbscript: */
function sanitizeImageUrl(url: string | null): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        if (parsed.protocol === 'data:') {
            // Data URIs are harder to reconstruct safely without tracking, but we can verify it's an image.
            if (url.startsWith('data:image/')) return url;
        }
        return null;
    } catch {
        return null;
    }
}

const PipPlayer: React.FC = () => {
    const { url: rawUrl, title: initialTitle, albumArt: initialAlbumArt } = parsePipParams(window.location.search);

    const finalUrl = getPlayableUrl(rawUrl);

    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isOverControls, setIsOverControls] = useState(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const [mediaArt, setMediaArt] = useState(sanitizeImageUrl(initialAlbumArt));

    // Subscribe to SMTC media updates (same as KoPlayer — narrow pip preload bridge)
    useEffect(() => {
        const unsub = window.pipApi?.onMediaUpdate?.((data) => {
            if (data) {
                if (data.title) setMediaTitle(data.title);
                if (data.albumArt) setMediaArt(sanitizeImageUrl(data.albumArt));
            }
        });
        return () => unsub?.();
    }, []);

    // Create the iframe element imperatively to avoid React re-rendering issues
    // Using iframe instead of <webview> fixes YouTube Error 153 (automation detection)
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !finalUrl) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setError('No video URL provided.');
            setLoading(false);
            return;
        }

        container.textContent = ''; // GUARANTEE ONLY ONE IFRAME EXISTS

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
        // SEC-07: confine the embedded page (no top navigation, popups, forms or downloads).
        // `allow-popups` is intentionally NOT granted (T-136), so links inside the embed (YouTube logo, video title)
        // are inert in the PiP. Opening them would need a main-process external-open path; that is a product decision.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');

        iframe.addEventListener('load', () => {
            setLoading(false);
            // Tell YouTube to start broadcasting infoDelivery events
            iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
        });

        container.appendChild(iframe);

        return () => {
            if (container?.contains(iframe)) {
                container.removeChild(iframe);
            }
        };
    }, [finalUrl]);

    useEffect(() => {
        // We handle hover state using edge hitboxes and overlay mouseLeave instead of document listeners
        // because the cross-origin iframe swallows document-level mouse events.
    }, []);

    const handleClose = () => {
        window.pipApi?.close?.();
    };

    const hasArt = !!mediaArt;

    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                position: 'relative',
                overflow: 'hidden',
                background: '#000',
                fontFamily: "'Space Grotesk Variable', 'Space Grotesk', 'Inter', sans-serif",
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

            {/* Animations */}
            <style>{`
                @keyframes pip-spin { to { transform: rotate(360deg); } }
                * { box-sizing: border-box; }
                button:focus { outline: none !important; box-shadow: none !important; }
            `}</style>
        </div>
    );
};

export default PipPlayer;
