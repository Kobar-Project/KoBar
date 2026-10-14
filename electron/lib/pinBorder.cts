// Pin border overlay (T-146): style, motion detection, fade and persistence helpers for the coloured frame drawn around
// a window pinned with Pin Window To Top. Pure logic plus two small file helpers (read tolerant, write atomic); no Electron
// access, so everything here is unit tested (tests/pinBorder.test.ts).
import * as fs from 'fs';

/** The only user-tunable part of the pin border: a `#RRGGBB` colour and a line width in CSS pixels (1-4). */
export interface PinBorderStyle {
    color: string;
    width: number;
}

export interface PinRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const PIN_STYLE_FILE_NAME = 'pin-style.json';
/** pin-style.json is a two-field object; anything larger is not ours and is ignored. */
export const PIN_STYLE_FILE_MAX_BYTES = 4096;
export const PIN_BORDER_MIN_WIDTH = 1;
export const PIN_BORDER_MAX_WIDTH = 4;

/** Neon presets offered by the settings page (T-753). Cyan is the default. */
export const PIN_BORDER_PRESETS = {
    cyan: { color: '#00E5FF', width: 2 },
    green: { color: '#39FF14', width: 2 },
    magenta: { color: '#FF2BD6', width: 2 },
} as const satisfies Record<string, PinBorderStyle>;

export const DEFAULT_PIN_BORDER_STYLE: PinBorderStyle = { ...PIN_BORDER_PRESETS.cyan };

/** The tracked window must keep its rect unchanged this long before the border fades back in. */
export const PIN_BORDER_STILL_MS = 120;
/** Movement tolerance in physical pixels: a rect counts as changed when any edge moved by more than this. */
export const PIN_BORDER_MOVE_TOLERANCE_PX = 0;
/** Fade-in duration of the border after the tracked window became still. Hiding is instant. */
export const PIN_BORDER_FADE_MS = 180;
/** easeOutCubic (fast start, soft landing) as a CSS timing function. */
export const PIN_BORDER_FADE_EASING_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** While the rect is unchanged, the overlay's always-on-top state is re-asserted at most this often. */
export const PIN_BORDER_ZORDER_REFRESH_MS = 500;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Returns a normalized copy (`#RRGGBB` upper case, integer width 1-4) or null for anything else. Never throws. */
export function validatePinBorderStyle(input: unknown): PinBorderStyle | null {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
    let color: unknown;
    let width: unknown;
    try {
        color = (input as { color?: unknown }).color;
        width = (input as { width?: unknown }).width;
    } catch {
        return null;
    }
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null;
    if (typeof width !== 'number' || !Number.isInteger(width) || width < PIN_BORDER_MIN_WIDTH || width > PIN_BORDER_MAX_WIDTH) return null;
    return { color: color.toUpperCase(), width };
}

export function rectsEqual(a: PinRect | null, b: PinRect | null, tolerance = 0): boolean {
    if (!a || !b) return a === b;
    return (
        Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance
    );
}

/** Windows parks minimized top-level windows at (-32000, -32000); an empty rect cannot carry a border either. */
export function isHiddenWindowRect(rect: PinRect): boolean {
    return (rect.x <= -32000 && rect.y <= -32000) || rect.width <= 0 || rect.height <= 0;
}

export type PinMotionState = 'moving' | 'still';

export interface PinMotionUpdate {
    state: PinMotionState;
    /** True exactly once per transition from moving to still. */
    becameStill: boolean;
}

export interface PinMotionDetector {
    update(rect: PinRect): PinMotionUpdate;
    /** Forget the last rect; the next update starts a new moving phase. */
    reset(): void;
    readonly state: PinMotionState;
}

/**
 * Feed it one rect per tracker tick. The first rect and every changed rect (beyond `tolerancePx`) mean "moving";
 * the state turns "still" once the rect stayed unchanged for at least `stillMs`.
 */
export function createMotionDetector(options: { stillMs?: number; tolerancePx?: number; now?: () => number } = {}): PinMotionDetector {
    const stillMs = options.stillMs ?? PIN_BORDER_STILL_MS;
    const tolerancePx = options.tolerancePx ?? PIN_BORDER_MOVE_TOLERANCE_PX;
    const now = options.now ?? Date.now;
    let last: PinRect | null = null;
    let lastChangeAt = 0;
    let state: PinMotionState = 'moving';

    return {
        update(rect) {
            const t = now();
            if (!last || !rectsEqual(last, rect, tolerancePx)) {
                last = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                lastChangeAt = t;
                state = 'moving';
                return { state, becameStill: false };
            }
            if (state === 'moving' && t - lastChangeAt >= stillMs) {
                state = 'still';
                return { state, becameStill: true };
            }
            return { state, becameStill: false };
        },
        reset() {
            last = null;
            state = 'moving';
        },
        get state() {
            return state;
        },
    };
}

// ─── Overlay page CSS ───────────────────────────────────────────────
// The overlay is a static, script-free data: URL page. It starts hidden (opacity 0, no transition). Showing inserts
// PIN_BORDER_VISIBLE_CSS via webContents.insertCSS (opacity 1 with a transition, so it fades in); hiding removes that
// sheet again, which falls back to "opacity 0, transition none" and is therefore instant. Style changes insert an
// override sheet built by buildPinBorderStyleCss. Colours reach CSS only after validatePinBorderStyle.

function borderDeclarations(style: PinBorderStyle): string {
    const s = validatePinBorderStyle(style) ?? DEFAULT_PIN_BORDER_STYLE;
    // Inner glow only: an outer shadow would be clipped by the overlay window, which is exactly the tracked rect.
    const glow = s.width * 3;
    return `border:${s.width}px solid ${s.color};box-shadow:inset 0 0 ${glow}px ${s.color}66`;
}

export const PIN_BORDER_VISIBLE_CSS = `html body{opacity:1;transition:opacity ${PIN_BORDER_FADE_MS}ms ${PIN_BORDER_FADE_EASING_CSS}}`;

/** Override sheet for a live style change (higher specificity than the page's own rule). */
export function buildPinBorderStyleCss(style: PinBorderStyle): string {
    return `html body{${borderDeclarations(style)}}`;
}

export function buildPinBorderPageUrl(style: PinBorderStyle): string {
    const css =
        'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}' +
        `body{box-sizing:border-box;${borderDeclarations(style)};opacity:0;transition:none}`;
    return 'data:text/html,' + encodeURIComponent(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`);
}

// ─── Serialized insertCSS slot ──────────────────────────────────────

export interface CssSlotOps {
    insert(css: string): Promise<string>;
    remove(key: string): Promise<void>;
}

export interface CssSlot {
    /** Desired sheet (null = none). Calls are coalesced; the latest wins. */
    set(css: string | null): void;
    dispose(): void;
}

/**
 * Keeps at most one inserted stylesheet per slot and serializes the async insert/remove calls, so a fast
 * show/hide/show sequence can never leave a stale sheet behind. A replacement is inserted before the old sheet is
 * removed (no unstyled frame). Never throws; a failed insert is retried on the next `set`.
 */
export function createCssSlot(ops: CssSlotOps): CssSlot {
    let desired: string | null = null;
    let appliedCss: string | null = null;
    let appliedKey: string | null = null;
    let busy = false;
    let disposed = false;

    const removeQuietly = async (key: string) => {
        try {
            await ops.remove(key);
        } catch {
            /* the page may be gone */
        }
    };

    const pump = async () => {
        if (busy || disposed) return;
        busy = true;
        try {
            while (!disposed && desired !== appliedCss) {
                const target = desired;
                const oldKey = appliedKey;
                if (target !== null) {
                    const key = await ops.insert(target);
                    appliedKey = key;
                    appliedCss = target;
                } else {
                    appliedKey = null;
                    appliedCss = null;
                }
                if (oldKey !== null) await removeQuietly(oldKey);
            }
        } catch {
            /* insert failed: keep the previous state, retry on the next set() */
        } finally {
            busy = false;
        }
    };

    return {
        set(css) {
            desired = css;
            void pump();
        },
        dispose() {
            disposed = true;
        },
    };
}

// ─── Persistence (userData/pin-style.json) ─────────────────────────

/** Reads the saved style. Missing, oversized, corrupt or invalid files yield the default. Never throws. */
export function readPinStyleFile(filePath: string): PinBorderStyle {
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > PIN_STYLE_FILE_MAX_BYTES) return { ...DEFAULT_PIN_BORDER_STYLE };
        return validatePinBorderStyle(JSON.parse(fs.readFileSync(filePath, 'utf8'))) ?? { ...DEFAULT_PIN_BORDER_STYLE };
    } catch {
        return { ...DEFAULT_PIN_BORDER_STYLE };
    }
}

/** Validates and writes the style atomically (temp file in the same folder + rename). Never throws; false on failure. */
export function writePinStyleFileAtomic(filePath: string, style: PinBorderStyle): boolean {
    const valid = validatePinBorderStyle(style);
    if (!valid) return false;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(valid, null, 2), { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(tempPath, filePath);
        return true;
    } catch {
        try {
            fs.rmSync(tempPath, { force: true });
        } catch {
            /* ignore */
        }
        return false;
    }
}
