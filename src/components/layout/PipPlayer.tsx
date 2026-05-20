import React, { useEffect, useRef, useState } from 'react';

/** Convert a raw URL to the best playable form for the webview */
function getPlayableUrl(rawUrl: string): string {
    if (!rawUrl) return '';

    // Local Windows file path → file:// URL
    if (/^[A-Za-z]:[/\\]/.test(rawUrl)) {
        return 'file:///' + rawUrl.replace(/\\/g, '/');
    }

    // YouTube watch → embed (no ads, no nav UI, autoplay)
    const ytMatch = rawUrl.match(
        /(?:youtube\.com\/watch[?&]v=|youtu\.be\/)([\w-]+)/
    );
    if (ytMatch) {
        return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    }

    return rawUrl;
}

const PipPlayer: React.FC = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawUrl = decodeURIComponent(urlParams.get('url') || '');
    const title = decodeURIComponent(urlParams.get('title') || 'PIP Video');

    const finalUrl = getPlayableUrl(rawUrl);

    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Create the iframe element imperatively to avoid React re-rendering issues
    // Using iframe instead of <webview> fixes YouTube Error 153 (automation detection)
    useEffect(() => {
        if (!containerRef.current || !finalUrl) {
            setError('No video URL provided.');
            setLoading(false);
            return;
        }

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

        iframe.addEventListener('load', () => setLoading(false));

        containerRef.current.appendChild(iframe);

        return () => {
            if (containerRef.current?.contains(iframe)) {
                containerRef.current.removeChild(iframe);
            }
        };
    }, [finalUrl]);

    const handleClose = () => {
        window.api?.closePip?.();
    };

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
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onDoubleClick={handleClose}
        >
            {/* Webview container — fills the entire window */}
            <div
                ref={containerRef}
                style={{ position: 'absolute', inset: 0 }}
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
            <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                justifyContent: 'space-between',
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 0.18s ease',
                pointerEvents: isHovered ? 'auto' : 'none',
                zIndex: 20,
            }}>
                {/* Top bar: drag region + title + close */}
                <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)',
                    WebkitAppRegion: 'drag',
                } as React.CSSProperties}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        WebkitAppRegion: 'drag',
                    } as React.CSSProperties}>
                        <span className="material-symbols-outlined"
                            style={{ color: '#f4a125', fontSize: 15, flexShrink: 0 }}>pip</span>
                        <span style={{
                            color: '#e2e8f0', fontSize: 11, fontWeight: 600,
                            maxWidth: 220, overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{title}</span>
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

                {/* Bottom bar: hint text + drag knob */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)',
                    WebkitAppRegion: 'no-drag',
                } as React.CSSProperties}>
                    <span style={{ color: 'rgba(148,163,184,0.7)', fontSize: 10, userSelect: 'none' }}>
                        Double-click to close
                    </span>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        color: 'rgba(148,163,184,0.5)', fontSize: 10,
                        WebkitAppRegion: 'drag', cursor: 'grab',
                    } as React.CSSProperties}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>drag_indicator</span>
                    </div>
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

export default PipPlayer;
