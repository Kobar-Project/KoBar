import React, { useEffect, useId, useRef } from 'react';

// KoBar head mark whose eyes follow the cursor in two stages (the head drifts and tilts slowly, the eyes move inside it faster).
// The eyes are cut out of the head with an SVG mask, so they are real holes on any background (glass or solid).
// All geometry lives in a 100 x 100 box; the head turns around HEAD_PIVOT.
//
// Idle cost is zero on purpose: nothing runs unless the cursor tracking setting is on (`follow`), the pointer is over the
// anchor, or `attention` fires a single blink. Motion uses CSS transform only, a frame loop exists only while the head is
// still easing toward its target, and everything stops while the window is hidden or the user prefers reduced motion.

const HEAD_PATH =
    'M82 58C82 72.91 67.67 85 50 85C32.33 85 18 72.91 18 58C18 52.84 19.72 48.02 22.69 43.92L24.4 23.97Q24.7 20.49 26.31 19.71Q27.91 18.94 30.82 20.88L43.18 29.12Q44.78 30.19 45.51 31.26C46.97 31.09 48.47 31 50 31C51.53 31 53.03 31.09 54.49 31.26Q55.22 30.19 56.82 29.12L69.18 20.88Q72.09 18.94 73.69 19.71Q75.3 20.49 75.6 23.97L77.31 43.92C80.28 48.02 82 52.84 82 58Z';
const EYES = [
    { x: 36.5, y: 50, width: 8, height: 16 },
    { x: 55.5, y: 50, width: 8, height: 16 },
] as const;
const HEAD_PIVOT = { x: 50, y: 58 } as const;

/** Motion limits, in units of the 100 x 100 box (degrees for the tilt). */
const MOTION = {
    headShift: 2,
    headTilt: 6,
    eyeShiftX: 5,
    eyeShiftY: 4,
    headEase: 0.09, // per frame; lower = lazier head
    eyeEase: 0.24, // the eyes react faster than the head
} as const;

const BLINK_MS = 140;
const BLINK_SCALE = 0.12;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface KoBarHeadProps {
    /** Rendered size in px (square). */
    size?: number;
    /** Head colour. Defaults to currentColor, so a text colour on a parent tints it. */
    color?: string;
    /** Cursor tracking setting (`enableEyeAnimation`). When off, the head only looks at the cursor while the pointer is over the anchor. */
    follow?: boolean;
    /** Blinks once each time this turns true (e.g. a notification arrived). */
    attention?: boolean;
    /** Element whose centre is the "look from" point and whose hover wakes the head. Defaults to the svg itself. */
    anchorRef?: React.RefObject<HTMLElement | null>;
    /** Cursor distance (px) at which the look reaches its limit. */
    reach?: number;
    className?: string;
}

const KoBarHead: React.FC<KoBarHeadProps> = ({
    size = 30,
    color = 'currentColor',
    follow = false,
    attention = false,
    anchorRef,
    reach = 150,
    className,
}) => {
    const maskId = 'kobar-head-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const svgRef = useRef<SVGSVGElement>(null);
    const headRef = useRef<SVGGElement>(null);
    const eyesRef = useRef<SVGGElement>(null);
    const eyeRefs = useRef<(SVGRectElement | null)[]>([]);

    // Cursor tracking: listeners are attached only while tracking is wanted (setting on, or hovering) and the page is visible.
    useEffect(() => {
        const head = headRef.current;
        const eyes = eyesRef.current;
        if (!head || !eyes) return;

        const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY);
        const target = { x: 0, y: 0 };
        const h = { x: 0, y: 0 };
        const e = { x: 0, y: 0 };
        let raf = 0;
        let hovering = false;
        let attached = false;

        const apply = () => {
            head.style.transform = `translate(${(h.x * MOTION.headShift).toFixed(2)}px, ${(h.y * MOTION.headShift * 0.75).toFixed(2)}px) rotate(${(h.x * MOTION.headTilt).toFixed(2)}deg)`;
            eyes.style.transform = `translate(${(e.x * MOTION.eyeShiftX).toFixed(2)}px, ${(e.y * MOTION.eyeShiftY).toFixed(2)}px)`;
        };
        const tick = () => {
            h.x += (target.x - h.x) * MOTION.headEase;
            h.y += (target.y - h.y) * MOTION.headEase;
            e.x += (target.x - e.x) * MOTION.eyeEase;
            e.y += (target.y - e.y) * MOTION.eyeEase;
            apply();
            const settled =
                Math.abs(target.x - h.x) + Math.abs(target.y - h.y) < 0.002 && Math.abs(target.x - e.x) + Math.abs(target.y - e.y) < 0.002;
            raf = settled ? 0 : requestAnimationFrame(tick);
        };
        const kick = () => {
            if (!raf) raf = requestAnimationFrame(tick);
        };
        const reset = () => {
            target.x = 0;
            target.y = 0;
            h.x = h.y = e.x = e.y = 0;
            cancelAnimationFrame(raf);
            raf = 0;
            head.style.transform = '';
            eyes.style.transform = '';
        };
        const anchor = () => anchorRef?.current ?? svgRef.current;

        const handleMove = (ev: MouseEvent) => {
            const el = anchor();
            if (!el) return;
            const r = el.getBoundingClientRect();
            const dx = ev.clientX - (r.left + r.width / 2);
            const dy = ev.clientY - (r.top + r.height / 2);
            const dist = Math.hypot(dx, dy);
            if (dist < 1) {
                target.x = 0;
                target.y = 0;
            } else {
                const pull = Math.min(dist / reach, 1);
                target.x = (dx / dist) * pull;
                target.y = (dy / dist) * pull;
            }
            kick();
        };
        const lookAway = () => {
            target.x = 0;
            target.y = 0;
            kick();
        };

        const sync = () => {
            const want = (follow || hovering) && !document.hidden && !reduced?.matches;
            if (want && !attached) {
                window.addEventListener('mousemove', handleMove);
                document.addEventListener('mouseleave', lookAway);
                attached = true;
            } else if (!want && attached) {
                window.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseleave', lookAway);
                attached = false;
                if (document.hidden || reduced?.matches) reset();
                else lookAway();
            }
        };
        const onEnter = () => {
            hovering = true;
            sync();
        };
        const onLeave = () => {
            hovering = false;
            sync();
        };

        const anchorEl = anchor();
        anchorEl?.addEventListener('pointerenter', onEnter);
        anchorEl?.addEventListener('pointerleave', onLeave);
        document.addEventListener('visibilitychange', sync);
        reduced?.addEventListener?.('change', sync);
        sync();

        return () => {
            anchorEl?.removeEventListener('pointerenter', onEnter);
            anchorEl?.removeEventListener('pointerleave', onLeave);
            document.removeEventListener('visibilitychange', sync);
            reduced?.removeEventListener?.('change', sync);
            window.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseleave', lookAway);
            reset();
        };
    }, [follow, anchorRef, reach]);

    // Event blink: one short blink when `attention` turns on. No timers while idle.
    useEffect(() => {
        if (!attention || window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return;
        const rects = eyeRefs.current;
        const setScale = (scale: number) => rects.forEach((rect) => rect && (rect.style.transform = `scaleY(${scale})`));
        setScale(BLINK_SCALE);
        const reopen = window.setTimeout(() => setScale(1), BLINK_MS);
        return () => {
            window.clearTimeout(reopen);
            setScale(1);
        };
    }, [attention]);

    return (
        <svg
            ref={svgRef}
            width={size}
            height={size}
            viewBox="0 0 100 100"
            aria-hidden="true"
            focusable="false"
            className={className}
            style={{ overflow: 'visible' }}
        >
            <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140">
                    <rect x="-20" y="-20" width="140" height="140" fill="#fff" />
                    <g ref={eyesRef}>
                        {EYES.map((eye, i) => (
                            <rect
                                key={i}
                                ref={(el) => {
                                    eyeRefs.current[i] = el;
                                }}
                                x={eye.x}
                                y={eye.y}
                                width={eye.width}
                                height={eye.height}
                                rx={eye.width / 2}
                                fill="#000"
                                style={{
                                    transformBox: 'fill-box',
                                    transformOrigin: 'center',
                                    transition: `transform ${BLINK_MS / 2}ms ease-out`,
                                }}
                            />
                        ))}
                    </g>
                </mask>
            </defs>
            <g ref={headRef} style={{ transformOrigin: `${HEAD_PIVOT.x}px ${HEAD_PIVOT.y}px` }}>
                <path d={HEAD_PATH} fill={color} mask={`url(#${maskId})`} />
            </g>
        </svg>
    );
};

export default KoBarHead;
